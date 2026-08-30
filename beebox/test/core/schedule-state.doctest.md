# Schedule State

Functions for managing scheduled script run records, state persistence,
and lock files.

```ts setup
import {
  pruneRecentRuns,
  recordRun,
  recordOutcome,
  normalizeScriptState,
  loadScriptState,
  saveScriptState,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningScripts,
  loadRunningProcedures,
} from "../../src/core/schedule/state.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
import { utimes } from "node:fs/promises";
```

## pruneRecentRuns

Removes run records older than the given window. Returns `undefined` when all records are pruned (so the field can be omitted from JSON).

No runs returns undefined:

```ts
pruneRecentRuns(undefined, { windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z") })
=> undefined

pruneRecentRuns([], { windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z") })
=> undefined
```

Recent runs within the window are kept:

```ts
JSON.stringify(pruneRecentRuns(
  [{ ts: "2026-03-01T11:30:00Z", durationMs: 5000 }],
  { windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z") }
))
=> [{"ts":"2026-03-01T11:30:00Z","durationMs":5000}]
```

Old runs outside the window are removed:

```ts
pruneRecentRuns(
  [{ ts: "2026-03-01T10:00:00Z", durationMs: 5000 }],
  { windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z") }
)
=> undefined
```

## recordRun

Appends a run record to the state and prunes old entries. Mutates the state object in place.

```ts setup
function freshState() {
  return { lastRun: null, lastResult: null, lastError: null, lastDurationMs: null, runCount: 0 };
}
```

```ts
const state = freshState();
recordRun(state, {
  record: { ts: "2026-03-01T12:00:00Z", durationMs: 3000 },
  windowMs: 3_600_000,
  now: new Date("2026-03-01T12:00:00Z"),
});
state.recentRuns.length
=> 1

state.recentRuns[0].ts
=> 2026-03-01T12:00:00Z
```

Old records are pruned during recording:

```ts
const state2 = freshState();
state2.recentRuns = [{ ts: "2026-03-01T10:00:00Z", durationMs: 1000 }];
recordRun(state2, {
  record: { ts: "2026-03-01T12:00:00Z", durationMs: 2000 },
  windowMs: 3_600_000,
  now: new Date("2026-03-01T12:00:00Z"),
});
state2.recentRuns.length
=> 1

state2.recentRuns[0].ts
=> 2026-03-01T12:00:00Z
```

## recordOutcome

The single outcome-recording path for all triggers (tick, wakeup, webapp).
Failures track `consecutiveFailures` and leave `lastSuccess` untouched;
a success resets the failure count, stamps `lastSuccess`, and clears the
health-alert latch.

```ts
const st = normalizeScriptState({});
recordOutcome(st, {
  result: "failure", error: "boom", durationMs: 100, sleepAffected: false,
  windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z"),
});
recordOutcome(st, {
  result: "failure", error: "boom again", durationMs: 100, sleepAffected: false,
  windowMs: 3_600_000, now: new Date("2026-03-01T13:00:00Z"),
});
st.alertedAt = "2026-03-01T13:01:00Z";
st.alertedFor = "failing";
print(`consecutiveFailures: ${st.consecutiveFailures}`);
print(`lastResult: ${st.lastResult}, lastError: ${st.lastError}`);
print(`lastSuccess: ${st.lastSuccess}`);
=>
consecutiveFailures: 2
lastResult: failure, lastError: boom again
lastSuccess: null

recordOutcome(st, {
  result: "success", error: null, durationMs: 200, sleepAffected: false,
  windowMs: 3_600_000, now: new Date("2026-03-01T14:00:00Z"),
});
print(`consecutiveFailures: ${st.consecutiveFailures}`);
print(`lastSuccess: ${st.lastSuccess}`);
print(`latch: ${st.alertedAt}, ${st.alertedFor}`);
print(`runCount: ${st.runCount}, recentRuns: ${st.recentRuns.length}`);
=>
consecutiveFailures: 0
lastSuccess: 2026-03-01T14:00:00.000Z
latch: null, null
runCount: 3, recentRuns: 2
```

(The 12:00 failure has aged out of the one-hour run window by 14:00 —
`runCount` is lifetime, `recentRuns` is windowed.)

## normalizeScriptState

State files written before the health fields existed get a best-effort
backfill: a last-succeeded state inherits `lastSuccess` from `lastRun`,
a last-failed state counts as one failure.

```ts
const oldSuccess = normalizeScriptState({ lastRun: "2026-03-01T06:00:00Z", lastResult: "success" });
print(`lastSuccess: ${oldSuccess.lastSuccess}, consecutiveFailures: ${oldSuccess.consecutiveFailures}`);
const oldFailure = normalizeScriptState({ lastRun: "2026-03-01T06:00:00Z", lastResult: "failure" });
print(`lastSuccess: ${oldFailure.lastSuccess}, consecutiveFailures: ${oldFailure.consecutiveFailures}`);
=>
lastSuccess: 2026-03-01T06:00:00Z, consecutiveFailures: 0
lastSuccess: null, consecutiveFailures: 1
```

## loadScriptState / saveScriptState

### Loading nonexistent state returns empty

```ts
const box = await makeTmpBox();
const state = await loadScriptState(box.root, "nonexistent");
print(`lastRun: ${state.lastRun}`);
print(`lastResult: ${state.lastResult}`);
print(`lastDurationMs: ${state.lastDurationMs}`);
print(`runCount: ${state.runCount}`);
=>
lastRun: null
lastResult: null
lastDurationMs: null
runCount: 0
```

```ts cleanup
await box.cleanup();
```

### Save then load round-trips

```ts
const box = await makeTmpBox();
const saved = {
  lastRun: "2025-01-15T06:00:00Z",
  lastResult: "success",
  lastError: null,
  lastDurationMs: 8300,
  runCount: 3,
  recentRuns: [{ ts: "2025-01-15T06:00:00Z", durationMs: 8300 }],
};
await saveScriptState({ boxRoot: box.root, scriptName: "test-script", state: saved });
const loaded = await loadScriptState(box.root, "test-script");
print(`lastRun: ${loaded.lastRun}`);
print(`lastResult: ${loaded.lastResult}`);
print(`lastDurationMs: ${loaded.lastDurationMs}`);
print(`runCount: ${loaded.runCount}`);
print(`recentRuns: ${loaded.recentRuns.length}`);
=>
lastRun: 2025-01-15T06:00:00Z
lastResult: success
lastDurationMs: 8300
runCount: 3
recentRuns: 1
```

```ts cleanup
await box.cleanup();
```

## Lock files

### Acquire and load shows running script

```ts
const box = await makeTmpBox();
await acquireScriptLock({ boxRoot: box.root, scriptName: "my-script", triggeredBy: "schedule" });
const running = await loadRunningScripts(box.root);
print(`running: ${running.size}`);
print(`has my-script: ${running.has("my-script")}`);
const lock = running.get("my-script");
print(`triggeredBy: ${lock.triggeredBy}`);
=>
running: 1
has my-script: true
triggeredBy: schedule
```

```ts cleanup
await releaseScriptLock({ boxRoot: box.root, scriptName: "my-script" });
await box.cleanup();
```

### Release removes from running

```ts
const box = await makeTmpBox();
await acquireScriptLock({ boxRoot: box.root, scriptName: "temp", triggeredBy: "test" });
await releaseScriptLock({ boxRoot: box.root, scriptName: "temp" });
const running = await loadRunningScripts(box.root);
running.size
=> 0
```

```ts cleanup
await box.cleanup();
```

### Lock with lock-group

```ts
const box = await makeTmpBox();
await acquireScriptLock({ boxRoot: box.root, scriptName: "grouped", triggeredBy: "schedule", lockGroup: "agents" });
const running = await loadRunningScripts(box.root);
const lock = running.get("grouped");
print(`lockGroup: ${lock.lockGroup}`);
=>
lockGroup: agents
```

```ts cleanup
await releaseScriptLock({ boxRoot: box.root, scriptName: "grouped" });
await box.cleanup();
```

### Stale lock (dead PID) is cleaned up

```ts
const box = await makeTmpBox();
const stateDir = box.root + "/config/schedules/.state";
await fs.mkdir(stateDir, { recursive: true });
await fs.writeFile(stateDir + "/dead-script.lock", JSON.stringify({
  pid: 99999999,
  startedAt: "2025-01-15T06:00:00Z",
  triggeredBy: "test",
}) + "\n");

const running = await loadRunningScripts(box.root);
running.size
=> 0
```

```ts cleanup
await box.cleanup();
```

### No state directory returns empty map

```ts
const box = await makeTmpBox();
const running = await loadRunningScripts(box.root);
running.size
=> 0
```

```ts cleanup
await box.cleanup();
```

## loadRunningProcedures

Reads `procedure/runs/*/run.procedure-run.card` and reports runs whose
root status is pending or running.

### Reports recent running runs

```ts
const box = await makeTmpBox();
const runDir = box.root + "/procedure/runs/test-run_2026-05-16T1200";
await fs.mkdir(runDir, { recursive: true });
await fs.writeFile(runDir + "/run.procedure-run.card",
  `---\nprocedure: test\nstatus: running\nstarted-at: 2026-05-16T12:00:00Z\nsteps: []\n---\n`);

await loadRunningProcedures(box.root)
=> [
  "test-run_2026-05-16T1200"
]
```

```ts cleanup
await box.cleanup();
```

### Ignores stale run cards (mtime > 1 hour)

A procedure that crashed mid-step leaves its run card at status="running"
forever. To avoid blocking housekeeping on orphan corpses, cards whose
mtime is older than one hour are treated as dead.

```ts
const box = await makeTmpBox();
const runDir = box.root + "/procedure/runs/orphan_2026-03-16T2056";
await fs.mkdir(runDir, { recursive: true });
const cardPath = runDir + "/run.procedure-run.card";
await fs.writeFile(cardPath,
  `---\nprocedure: test\nstatus: running\nstarted-at: 2026-03-16T20:56:00Z\nsteps: []\n---\n`);

// Backdate the run card to two hours ago.
const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
await utimes(cardPath, twoHoursAgo, twoHoursAgo);

await loadRunningProcedures(box.root)
=> []
```

```ts cleanup
await box.cleanup();
```

### Ignores terminal statuses

```ts
const box = await makeTmpBox();
for (const [name, status] of [["completed_run", "completed"], ["failed_run", "failed"]]) {
  const runDir = box.root + "/procedure/runs/" + name;
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(runDir + "/run.procedure-run.card",
    `---\nprocedure: test\nstatus: ${status}\nstarted-at: 2026-05-16T12:00:00Z\nsteps: []\n---\n`);
}

await loadRunningProcedures(box.root)
=> []
```

```ts cleanup
await box.cleanup();
```
