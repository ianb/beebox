# Schedule State

Pure functions for managing scheduled script run records. `pruneRecentRuns` removes old entries from a time window. `recordRun` appends a run and prunes in one step.

```ts setup
import { pruneRecentRuns, recordRun } from "../src/core/schedule-state.js";
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
