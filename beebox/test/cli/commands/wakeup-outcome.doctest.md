# What a wakeup actually did, as distinct from its exit code

`bbx wakeup`'s exit code comes from the connector step alone
(`wakeup-connectors.ts`: `errorCount > 0 ? 1 : undefined`), so it answers *did
anything on this box go wrong*, not *did the work I asked for succeed*. A
caller that retries on non-zero therefore retries forever on a box with one
permanently broken connector — an expired Google token did exactly that to the
scan promote worker, twelve full agent runs before a person noticed.

This file pins the channel that tells a caller which step failed, and the rule
the scan promote worker judges itself by.

```ts setup
import {
  WAKEUP_OUTCOME_PREFIX,
  parseWakeupOutcome,
} from "../../../src/cli/commands/wakeup-outcome.js";
import { wakeupSatisfiedScanPromote } from "../../../src/core/scan/promote-wakeup.js";

const line = (report) => WAKEUP_OUTCOME_PREFIX + JSON.stringify(report);
const healthy = { connectorErrors: 0, connectors: [], reactorOk: true, reactorSkipped: false, jobsProcessed: 1, jobsRemaining: 0 };
```

## The outcome round-trips out of captured output

```ts
const output = ["[Running connectors]", line(healthy), "[Pushing to remote]"].join("\n");
JSON.stringify(parseWakeupOutcome(output))
=> {"connectorErrors":0,"connectors":[],"reactorOk":true,"reactorSkipped":false,"jobsProcessed":1,"jobsRemaining":0}
```

The last line wins, so output containing an earlier nested run reads the run
that just finished:

```ts
const first = line({ ...healthy, jobsProcessed: 9 });
const second = line(healthy);
parseWakeupOutcome([first, second].join("\n")).jobsProcessed
=> 1
```

## Per-connector entries survive the round trip

The aggregate `connectorErrors` cannot answer "did Drive sync?". A forced
wakeup hands these entries to an agent, which has no other channel: the
per-connector prose the cycle prints is for a person reading a terminal.

```ts
const scoped = {
  ...healthy,
  connectors: [
    { name: "google-drive", success: true, created: 3, updated: 1, pushed: 0, jobs: 2 },
    {
      name: "gmail",
      success: true,
      created: 0,
      updated: 0,
      pushed: 0,
      jobs: 0,
      skipped: { reason: "not-configured", detail: "No Google credential this process can read" },
    },
    { name: "nope", success: false, created: 0, updated: 0, pushed: 0, jobs: 0, error: "Connector not found: nope" },
  ],
};
const back = parseWakeupOutcome(line(scoped));
JSON.stringify(back.connectors.map((c) => [c.name, c.created, c.skipped?.reason ?? c.error ?? "ok"]))
=> [["google-drive",3,"ok"],["gmail",0,"not-configured"],["nope",0,"Connector not found: nope"]]
```

A skipped connector reports `success: true` — nothing failed, and nothing
synced. Reading the flag alone is what makes a service the box never contacted
look up to date.

```ts continue
const entry = parseWakeupOutcome(line(scoped)).connectors[1];
[entry.success, entry.skipped.detail].join(" | ")
=> true | No Google credential this process can read
```

A malformed entry rejects the whole line rather than reaching a caller that
would index into it. An older binary emits no `connectors` at all, which is the
same answer: no information.

```ts
[
  parseWakeupOutcome(line({ ...healthy, connectors: [{ name: "gmail" }] })),
  parseWakeupOutcome(line({ ...healthy, connectors: "google-drive" })),
  parseWakeupOutcome(WAKEUP_OUTCOME_PREFIX + JSON.stringify({ connectorErrors: 0, reactorOk: true, reactorSkipped: false, jobsProcessed: 0, jobsRemaining: 0 })),
].map((r) => JSON.stringify(r)).join(" ")
=> null null null
```

An unknown skip reason is refused too — a caller dispatches on `reason`, so a
value it has no branch for is not a usable skip.

```ts
parseWakeupOutcome(line({
  ...healthy,
  connectors: [{ name: "gmail", success: true, created: 0, updated: 0, pushed: 0, jobs: 0, skipped: { reason: "later", detail: "x" } }],
}))
=> null
```

## Absent or unusable output is "no information", never "fine"

Guessing success here would resurrect the lost-wakeup bug the marker exists to
prevent.

```ts
parseWakeupOutcome("no outcome line here")
=> null
```

```ts
parseWakeupOutcome(WAKEUP_OUTCOME_PREFIX + "{truncated")
=> null
```

A line of the right shape but the wrong types is also no information:

```ts
parseWakeupOutcome(WAKEUP_OUTCOME_PREFIX + JSON.stringify({ reactorOk: "yes" }))
=> null
```

## The scan worker judges itself by the step it depends on

Connector errors are somebody else's problem. The intake drain succeeded, so
the scan is not retried — this is the exact production case: exit code 1, work
done.

```ts
wakeupSatisfiedScanPromote({
  exitOk: false,
  outcome: { connectorErrors: 3, connectors: [], reactorOk: true, reactorSkipped: false, jobsProcessed: 1, jobsRemaining: 0 },
})
=> true
```

A failed reactor cycle IS this worker's problem, even when the process exits
zero:

```ts
wakeupSatisfiedScanPromote({
  exitOk: true,
  outcome: { connectorErrors: 0, connectors: [], reactorOk: false, reactorSkipped: false, jobsProcessed: 0, jobsRemaining: 1 },
})
=> false
```

Jobs left queued are not a failure. The reactor skips low-priority work every
run, so a queued backfill job is routine — reading it as failure is what made
the loop look justified.

```ts
wakeupSatisfiedScanPromote({
  exitOk: true,
  outcome: { connectorErrors: 0, connectors: [], reactorOk: true, reactorSkipped: false, jobsProcessed: 0, jobsRemaining: 5 },
})
=> true
```

With no outcome to read, fall back to the exit code — an older binary or a
crash before the cycle ended.

```ts
[
  wakeupSatisfiedScanPromote({ exitOk: true, outcome: null }),
  wakeupSatisfiedScanPromote({ exitOk: false, outcome: null }),
].join(" ")
=> true false
```

A cycle that skipped because another reactor held the lock did no work at all.
Nothing failed, so `reactorOk` is true — but no job drained, so the marker must
survive and the wakeup must be tried again.

```ts
wakeupSatisfiedScanPromote({
  exitOk: true,
  outcome: { connectorErrors: 0, connectors: [], reactorOk: true, reactorSkipped: true, jobsProcessed: 0, jobsRemaining: 1 },
})
=> false
```

A cycle that never started — another `bbx wakeup` held the per-box cycle lock
(`wakeup-cycle-lock.ts`) — is the same answer one step earlier. Every count is
zero because nothing ran, so the zeros must not read as a clean run.

```ts
wakeupSatisfiedScanPromote({
  exitOk: true,
  outcome: { ...healthy, jobsProcessed: 0, skipped: "wakeup-running" },
})
=> false
```
