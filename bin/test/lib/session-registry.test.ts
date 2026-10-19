// # Workstream session registry
//
// The registry is an optional hint store. Missing records stay missing, while
// updates merge atomically so concurrent lifecycle writers do not erase fields.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
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
    env: { ...process.env, BBX_STATE_DIR: stateDir },
  });
}

// ## Missing and merged records
void test("Missing and merged records", async (t) => {
  t.teardown(async () => {
    try {
      await rm(stateDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L27
  const stateDir = await mkdtemp(join(tmpdir(), "session-registry-doctest-"));
  const missing = await registryShell(stateDir, 'session_registry_read "seam" || printf missing');
  t.check(missing.stdout, "missing");

  // doctest:L32
  await registryShell(stateDir, "session_registry_merge seam '{\"agent\":\"claude\",\"tty\":\"/dev/ttys001\"}'");
  await registryShell(stateDir, "session_registry_merge seam '{\"sessionId\":\"abc\"}'");
  const record = JSON.parse(await readFile(join(stateDir, "workstreams/seam.json"), "utf8"));
  t.check({ name: record.name, agent: record.agent, tty: record.tty, sessionId: record.sessionId, hasUpdatedAt: Boolean(record.updatedAt) }, {
    name: "seam",
    agent: "claude",
    tty: "/dev/ttys001",
    sessionId: "abc",
    hasUpdatedAt: true,
  });

  // ## Concurrent updates retain both fields

  // doctest:L42
  await Promise.all([
    registryShell(stateDir, "session_registry_merge seam '{\"model\":\"opus\"}'"),
    registryShell(stateDir, "session_registry_merge seam '{\"emoji\":\"🧵\"}'"),
  ]);
  const concurrent = JSON.parse(await readFile(join(stateDir, "workstreams/seam.json"), "utf8"));
  t.check({ model: concurrent.model, emoji: concurrent.emoji }, {
    model: "opus",
    emoji: "🧵",
  });

  // doctest:L50
  await registryShell(stateDir, "session_registry_merge seam '{\"baseSha\":\"first\"}'");
  await registryShell(stateDir, "session_registry_merge seam '{\"baseSha\":\"later\"}' --preserve-base-sha");
  const baseRecord = JSON.parse(await readFile(join(stateDir, "workstreams/seam.json"), "utf8"));
  t.check(baseRecord.baseSha, "first");

  // doctest:L56
  const codexSummary = await registryShell(stateDir, "session_registry_merge codex-only '{\"agent\":\"codex\"}'; session_registry_summary codex-only");
  t.check(JSON.parse(codexSummary.stdout).hasSession, true);

  // doctest:L60
  await registryShell(stateDir, "session_registry_merge described '{\"description\":\"Workstream routing\"}'");
  await registryShell(stateDir, "session_registry_merge described '{\"agent\":\"codex\"}'");
  t.check(JSON.parse((await registryShell(stateDir, "session_registry_summary described")).stdout).description, "Workstream routing");

  // ## Launch leases are bounded and token-owned
  //
  // A launch lease is active immediately after begin. A stale token cannot complete
  // it, a matching failure becomes visible, and a later matching completion merges
  // the session patch while removing the lease.

  // doctest:L73
  const begun = await registryShell(stateDir, [
    "session_registry_begin_launch launch-seam token-a",
    "record=$(session_registry_read launch-seam)",
    'session_registry_launch_status_from_record "$record" "$(date +%s)"',
  ].join("; "));
  t.check(JSON.parse(begun.stdout).state, "active");

  // doctest:L81
  const staleCompletion = await registryShell(stateDir, [
    "rc=0",
    "session_registry_complete_launch launch-seam token-stale '{\"agent\":\"claude\"}' || rc=$?",
    "record=$(session_registry_read launch-seam)",
    'status=$(session_registry_launch_status_from_record "$record" "$(date +%s)")',
    'jq -cn --argjson record "$record" --argjson status "$status" --arg rc "$rc" "{rc:(\\$rc|tonumber),token:\\$record.launch.token,state:\\$status.state,agent:(\\$record.agent // null)}"',
  ].join("; "));
  t.check(JSON.parse(staleCompletion.stdout), {
    rc: 2,
    token: "token-a",
    state: "active",
    agent: null,
  });

  // doctest:L91
  await registryShell(stateDir, "session_registry_fail_launch launch-seam token-a setup-failed");
  const failed = JSON.parse((await registryShell(stateDir, [
    "record=$(session_registry_read launch-seam)",
    'session_registry_launch_status_from_record "$record" "$(date +%s)"',
  ].join("; "))).stdout);
  t.check({ state: failed.state, reason: failed.reason, hasFailedAt: Boolean(failed.failedAt) }, {
    state: "failed",
    reason: "setup-failed",
    hasFailedAt: true,
  });

  // doctest:L99
  await registryShell(stateDir, "session_registry_begin_launch launch-seam token-b");
  const retried = JSON.parse((await registryShell(stateDir, "session_registry_launch_status launch-seam")).stdout);
  t.check({ state: retried.state, failedAt: retried.failedAt, reason: retried.reason }, {
    state: "active",
    failedAt: null,
    reason: null,
  });

  // doctest:L104
  await registryShell(stateDir, "session_registry_complete_launch launch-seam token-b '{\"agent\":\"codex\",\"baseSha\":\"abc\"}'");
  const completed = JSON.parse(await readFile(join(stateDir, "workstreams/launch-seam.json"), "utf8"));
  t.check({ agent: completed.agent, baseSha: completed.baseSha, launch: completed.launch ?? null }, {
    agent: "codex",
    baseSha: "abc",
    launch: null,
  });

  // The classifier derives expiry from one stored timestamp. It distinguishes
  // expired, failed, malformed, and absent launch state without waiting.

  // doctest:L114
  const expired = JSON.parse((await registryShell(stateDir, "session_registry_launch_status_from_record '{\"launch\":{\"token\":\"old\",\"startedAt\":\"2026-01-01T00:00:00Z\"}}' 1767229201")).stdout);
  const failedStatus = JSON.parse((await registryShell(stateDir, "session_registry_launch_status_from_record '{\"launch\":{\"token\":\"bad\",\"startedAt\":\"2026-01-01T00:00:00Z\",\"failedAt\":\"2026-01-01T00:01:00Z\",\"failureReason\":\"shell-exit\"}}' 1767225601")).stdout);
  const malformed = JSON.parse((await registryShell(stateDir, "session_registry_launch_status_from_record '{\"launch\":{\"token\":\"bad\"}}' 1767225601")).stdout);
  const absent = JSON.parse((await registryShell(stateDir, "session_registry_launch_status_from_record '{}' 1767225601")).stdout);
  await writeFile(join(stateDir, "workstreams/corrupt.json"), "not json\n");
  const corrupt = JSON.parse((await registryShell(stateDir, "session_registry_launch_status corrupt")).stdout);
  t.check({ expired: expired.state, failed: failedStatus.state, malformed: malformed.state, absent: absent.state, corrupt: corrupt.state }, {
    expired: "expired",
    failed: "failed",
    malformed: "unknown",
    absent: "none",
    corrupt: "none",
  });

  // doctest:L123
  await registryShell(stateDir, "session_registry_begin_launch prunable prune-token; session_registry_fail_launch prunable prune-token setup-failed; session_registry_prune 4102444800");
  const pruned = await registryShell(stateDir, "session_registry_read prunable || printf missing");
  t.check(pruned.stdout, "missing");
});
