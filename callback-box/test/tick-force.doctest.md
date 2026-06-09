# cb tick --force

`cb tick --script <name> --force` re-runs a script on demand: the schedule
(due-ness) and budget gates are bypassed. Gates that protect against real
breakage stay: `enabled: false`, missing connectors, and a live lock-group
holder are still respected — force never preempts running work.

`evaluateSkip` returns a skip reason (`""` = skip silently), or `null`
meaning "run it".

```ts setup
import { evaluateSkip } from "../src/cli/commands/tick-helpers.js";

function makeScript(overrides) {
  return {
    cron: undefined,
    at: undefined,
    rrule: undefined,
    until: undefined,
    notBefore: undefined,
    onWakeup: false,
    once: false,
    enabled: true,
    runs: "echo test",
    description: undefined,
    source: undefined,
    createAfterSuccess: [],
    budget: undefined,
    lockGroup: undefined,
    timeoutMs: undefined,
    requires: undefined,
    ...overrides,
  };
}

function makeCtx(overrides) {
  return {
    boxRoot: "/nonexistent",
    scriptName: "test-script",
    state: { lastRun: "2026-06-09T11:55:00Z", lastResult: "success", lastError: null, lastDurationMs: 1000, runCount: 5 },
    now: new Date("2026-06-09T12:00:00Z"),
    running: new Map(),
    options: {},
    ...overrides,
  };
}
```

A script that isn't due is skipped silently — unless forced:

```
await evaluateSkip(makeCtx({ parsed: makeScript({ notBefore: "1h" }) }))
=> 

await evaluateSkip(makeCtx({ parsed: makeScript({ notBefore: "1h" }), options: { force: true } }))
=> null
```

A spent budget skips the run — unless forced (`onWakeup: true` makes the
script otherwise due):

```
const overBudget = makeCtx({
  parsed: makeScript({ onWakeup: true, budget: { limitMs: 60_000, windowMs: 3_600_000 } }),
  state: { lastRun: null, lastResult: null, lastError: null, lastDurationMs: null, runCount: 1, recentRuns: [{ ts: "2026-06-09T11:50:00Z", durationMs: 120_000 }] },
});
JSON.stringify(await evaluateSkip(overBudget))
=> "  Skipping test-script: budget exceeded (120s used)"

await evaluateSkip({ ...overBudget, options: { force: true } })
=> null
```

`enabled: false` is an explicit user statement — force does not override it:

```
JSON.stringify(await evaluateSkip(makeCtx({ parsed: makeScript({ enabled: false }), options: { force: true } })))
=> "  Skipping test-script: disabled (enabled: false)"
```

A live lock-group holder is never preempted, forced or not (the `running`
map only ever contains live processes — stale locks are cleaned on scan):

```
const held = new Map([["other-script", { pid: 1234, startedAt: "2026-06-09T11:59:00Z", triggeredBy: "schedule", lockGroup: "research" }]]);
JSON.stringify(await evaluateSkip(makeCtx({ parsed: makeScript({ onWakeup: true, lockGroup: "research" }), running: held, options: { force: true } })))
=> "  Skipping test-script: lock-group \"research\" held by other-script"
```
