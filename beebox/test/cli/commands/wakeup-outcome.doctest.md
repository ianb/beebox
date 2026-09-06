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
const healthy = { connectorErrors: 0, reactorOk: true, reactorSkipped: false, jobsProcessed: 1, jobsRemaining: 0 };
```

## The outcome round-trips out of captured output

```ts
const output = ["[Running connectors]", line(healthy), "[Pushing to remote]"].join("\n");
JSON.stringify(parseWakeupOutcome(output))
=> {"connectorErrors":0,"reactorOk":true,"reactorSkipped":false,"jobsProcessed":1,"jobsRemaining":0}
```

The last line wins, so output containing an earlier nested run reads the run
that just finished:

```ts
const first = line({ ...healthy, jobsProcessed: 9 });
const second = line(healthy);
parseWakeupOutcome([first, second].join("\n")).jobsProcessed
=> 1
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
  outcome: { connectorErrors: 3, reactorOk: true, reactorSkipped: false, jobsProcessed: 1, jobsRemaining: 0 },
})
=> true
```

A failed reactor cycle IS this worker's problem, even when the process exits
zero:

```ts
wakeupSatisfiedScanPromote({
  exitOk: true,
  outcome: { connectorErrors: 0, reactorOk: false, reactorSkipped: false, jobsProcessed: 0, jobsRemaining: 1 },
})
=> false
```

Jobs left queued are not a failure. The reactor skips low-priority work every
run, so a queued backfill job is routine — reading it as failure is what made
the loop look justified.

```ts
wakeupSatisfiedScanPromote({
  exitOk: true,
  outcome: { connectorErrors: 0, reactorOk: true, reactorSkipped: false, jobsProcessed: 0, jobsRemaining: 5 },
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
  outcome: { connectorErrors: 0, reactorOk: true, reactorSkipped: true, jobsProcessed: 0, jobsRemaining: 1 },
})
=> false
```
