# Workstream session registry

The registry is an optional hint store. Missing records stay missing, while
updates merge atomically so concurrent lifecycle writers do not erase fields.

```ts setup
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

```ts cleanup
await rm(stateDir, { recursive: true, force: true });
```
