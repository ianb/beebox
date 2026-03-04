# Schedule State

Functions for managing scheduled script run records, state persistence,
and lock files.

```ts setup
import {
  pruneRecentRuns,
  recordRun,
  loadScriptState,
  saveScriptState,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningScripts,
} from "../src/core/schedule-state.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import * as fs from "node:fs/promises";
```

## pruneRecentRuns

Removes run records older than the given window. Returns `undefined` when all records are pruned (so the field can be omitted from JSON).

No runs returns undefined:

```
pruneRecentRuns(undefined, { windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z") })
=> undefined

pruneRecentRuns([], { windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z") })
=> undefined
```

Recent runs within the window are kept:

```
JSON.stringify(pruneRecentRuns(
  [{ ts: "2026-03-01T11:30:00Z", durationMs: 5000 }],
  { windowMs: 3_600_000, now: new Date("2026-03-01T12:00:00Z") }
))
=> [{"ts":"2026-03-01T11:30:00Z","durationMs":5000}]
```

Old runs outside the window are removed:

```
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
  return { lastRun: null, lastResult: null, lastError: null, runCount: 0 };
}
```

```
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

```
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

## loadScriptState / saveScriptState

### Loading nonexistent state returns empty

```
const box = await makeTmpBox();
const state = await loadScriptState(box.root, "nonexistent");
print(`lastRun: ${state.lastRun}`);
print(`lastResult: ${state.lastResult}`);
print(`runCount: ${state.runCount}`);
=>
lastRun: null
lastResult: null
runCount: 0
```

``` cleanup
await box.cleanup();
```

### Save then load round-trips

```
const box = await makeTmpBox();
const saved = {
  lastRun: "2025-01-15T06:00:00Z",
  lastResult: "success",
  lastError: null,
  runCount: 3,
  recentRuns: [{ ts: "2025-01-15T06:00:00Z", durationMs: 1500 }],
};
await saveScriptState({ boxRoot: box.root, scriptName: "test-script", state: saved });
const loaded = await loadScriptState(box.root, "test-script");
print(`lastRun: ${loaded.lastRun}`);
print(`lastResult: ${loaded.lastResult}`);
print(`runCount: ${loaded.runCount}`);
print(`recentRuns: ${loaded.recentRuns.length}`);
=>
lastRun: 2025-01-15T06:00:00Z
lastResult: success
runCount: 3
recentRuns: 1
```

``` cleanup
await box.cleanup();
```

## Lock files

### Acquire and load shows running script

```
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

``` cleanup
await releaseScriptLock({ boxRoot: box.root, scriptName: "my-script" });
await box.cleanup();
```

### Release removes from running

```
const box = await makeTmpBox();
await acquireScriptLock({ boxRoot: box.root, scriptName: "temp", triggeredBy: "test" });
await releaseScriptLock({ boxRoot: box.root, scriptName: "temp" });
const running = await loadRunningScripts(box.root);
running.size
=> 0
```

``` cleanup
await box.cleanup();
```

### Lock with lock-group

```
const box = await makeTmpBox();
await acquireScriptLock({ boxRoot: box.root, scriptName: "grouped", triggeredBy: "schedule", lockGroup: "agents" });
const running = await loadRunningScripts(box.root);
const lock = running.get("grouped");
print(`lockGroup: ${lock.lockGroup}`);
=>
lockGroup: agents
```

``` cleanup
await releaseScriptLock({ boxRoot: box.root, scriptName: "grouped" });
await box.cleanup();
```

### Stale lock (dead PID) is cleaned up

```
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

``` cleanup
await box.cleanup();
```

### No state directory returns empty map

```
const box = await makeTmpBox();
const running = await loadRunningScripts(box.root);
running.size
=> 0
```

``` cleanup
await box.cleanup();
```
