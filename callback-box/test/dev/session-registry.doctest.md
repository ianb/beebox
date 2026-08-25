# Workstream session registry

The registry is an optional hint store. Missing records stay missing, while
updates merge atomically so concurrent lifecycle writers do not erase fields.

```ts setup
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const registryLib = join(repoRoot, "bin/lib/session-registry.sh");

async function registryShell(stateDir: string, body: string) {
  return execFileAsync("bash", ["-c", `. "$1"; ${body}`, "registry-test", registryLib], {
    env: { ...process.env, CALLBACK_STATE_DIR: stateDir },
  });
}
```

## Missing and merged records

```ts
const stateDir = await mkdtemp(join(tmpdir(), "session-registry-doctest-"));
const missing = await registryShell(stateDir, 'session_registry_read "seam" || printf missing');
missing.stdout
=> missing

await registryShell(stateDir, `session_registry_merge seam '{"agent":"claude","tty":"/dev/ttys001"}'`);
await registryShell(stateDir, `session_registry_merge seam '{"sessionId":"abc"}'`);
const record = JSON.parse(await readFile(join(stateDir, "workstreams/seam.json"), "utf8"));
JSON.stringify({ name: record.name, agent: record.agent, tty: record.tty, sessionId: record.sessionId, hasUpdatedAt: Boolean(record.updatedAt) })
=> {"name":"seam","agent":"claude","tty":"/dev/ttys001","sessionId":"abc","hasUpdatedAt":true}
```

## Concurrent updates retain both fields

```ts continue
await Promise.all([
  registryShell(stateDir, `session_registry_merge seam '{"model":"opus"}'`),
  registryShell(stateDir, `session_registry_merge seam '{"emoji":"🧵"}'`),
]);
const concurrent = JSON.parse(await readFile(join(stateDir, "workstreams/seam.json"), "utf8"));
JSON.stringify({ model: concurrent.model, emoji: concurrent.emoji })
=> {"model":"opus","emoji":"🧵"}

await registryShell(stateDir, `session_registry_merge seam '{"baseSha":"first"}'`);
await registryShell(stateDir, `session_registry_merge seam '{"baseSha":"later"}' --preserve-base-sha`);
const baseRecord = JSON.parse(await readFile(join(stateDir, "workstreams/seam.json"), "utf8"));
baseRecord.baseSha
=> first

const codexSummary = await registryShell(stateDir, `session_registry_merge codex-only '{"agent":"codex"}'; session_registry_summary codex-only`);
JSON.parse(codexSummary.stdout).hasSession
=> true

await registryShell(stateDir, `session_registry_merge described '{"description":"Workstream routing"}'`);
await registryShell(stateDir, `session_registry_merge described '{"agent":"codex"}'`);
JSON.parse((await registryShell(stateDir, `session_registry_summary described`)).stdout).description
=> Workstream routing
```

## Launch leases are bounded and token-owned

A launch lease is active immediately after begin. A stale token cannot complete
it, a matching failure becomes visible, and a later matching completion merges
the session patch while removing the lease.

```ts continue
const begun = await registryShell(stateDir, [
  "session_registry_begin_launch launch-seam token-a",
  'record=$(session_registry_read launch-seam)',
  'session_registry_launch_status_from_record "$record" "$(date +%s)"',
].join("; "));
JSON.parse(begun.stdout).state
=> active

const staleCompletion = await registryShell(stateDir, [
  "rc=0",
  `session_registry_complete_launch launch-seam token-stale '{"agent":"claude"}' || rc=$?`,
  'record=$(session_registry_read launch-seam)',
  'status=$(session_registry_launch_status_from_record "$record" "$(date +%s)")',
  'jq -cn --argjson record "$record" --argjson status "$status" --arg rc "$rc" "{rc:(\$rc|tonumber),token:\$record.launch.token,state:\$status.state,agent:(\$record.agent // null)}"',
].join("; "));
JSON.stringify(JSON.parse(staleCompletion.stdout))
=> {"rc":2,"token":"token-a","state":"active","agent":null}

await registryShell(stateDir, "session_registry_fail_launch launch-seam token-a setup-failed");
const failed = JSON.parse((await registryShell(stateDir, [
  'record=$(session_registry_read launch-seam)',
  'session_registry_launch_status_from_record "$record" "$(date +%s)"',
].join("; "))).stdout);
JSON.stringify({ state: failed.state, reason: failed.reason, hasFailedAt: Boolean(failed.failedAt) })
=> {"state":"failed","reason":"setup-failed","hasFailedAt":true}

await registryShell(stateDir, "session_registry_begin_launch launch-seam token-b");
const retried = JSON.parse((await registryShell(stateDir, "session_registry_launch_status launch-seam")).stdout);
JSON.stringify({ state: retried.state, failedAt: retried.failedAt, reason: retried.reason })
=> {"state":"active","failedAt":null,"reason":null}

await registryShell(stateDir, `session_registry_complete_launch launch-seam token-b '{"agent":"codex","baseSha":"abc"}'`);
const completed = JSON.parse(await readFile(join(stateDir, "workstreams/launch-seam.json"), "utf8"));
JSON.stringify({ agent: completed.agent, baseSha: completed.baseSha, launch: completed.launch ?? null })
=> {"agent":"codex","baseSha":"abc","launch":null}
```

The classifier derives expiry from one stored timestamp. It distinguishes
expired, failed, malformed, and absent launch state without waiting.

```ts continue
const expired = JSON.parse((await registryShell(stateDir, `session_registry_launch_status_from_record '{"launch":{"token":"old","startedAt":"2026-01-01T00:00:00Z"}}' 1767229201`)).stdout);
const failedStatus = JSON.parse((await registryShell(stateDir, `session_registry_launch_status_from_record '{"launch":{"token":"bad","startedAt":"2026-01-01T00:00:00Z","failedAt":"2026-01-01T00:01:00Z","failureReason":"shell-exit"}}' 1767225601`)).stdout);
const malformed = JSON.parse((await registryShell(stateDir, `session_registry_launch_status_from_record '{"launch":{"token":"bad"}}' 1767225601`)).stdout);
const absent = JSON.parse((await registryShell(stateDir, `session_registry_launch_status_from_record '{}' 1767225601`)).stdout);
await writeFile(join(stateDir, "workstreams/corrupt.json"), "not json\n");
const corrupt = JSON.parse((await registryShell(stateDir, "session_registry_launch_status corrupt")).stdout);
JSON.stringify({ expired: expired.state, failed: failedStatus.state, malformed: malformed.state, absent: absent.state, corrupt: corrupt.state })
=> {"expired":"expired","failed":"failed","malformed":"unknown","absent":"none","corrupt":"none"}

await registryShell(stateDir, "session_registry_begin_launch prunable prune-token; session_registry_fail_launch prunable prune-token setup-failed; session_registry_prune 4102444800");
const pruned = await registryShell(stateDir, "session_registry_read prunable || printf missing");
pruned.stdout
=> missing
```

```ts cleanup
await rm(stateDir, { recursive: true, force: true });
```
