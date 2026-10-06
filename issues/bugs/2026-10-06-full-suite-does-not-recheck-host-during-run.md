---
title: "The full suite does not re-check the host during a run and cannot stop as deferred"
workstream: unattached
area: monorepo
labels: [full-suite, schedules, host-load]
filed-by: agent
discovered-by: agent
discovered-in: worktree-test-suite-health — splitting the mid-run abort out of the swap-gate fix
priority: normal
---

`schedules/full-suite/run.ts` checks the host once, in `waitForQuietHost`,
before it creates the checkout. A host that thrashes after the run starts
(another worktree's suite, an agent burst) is only noticed at the end, when
`batchSlowdown` marks the run untrusted and its verdicts are withheld. The run
has by then spent its whole duration on results nobody can use.

The start gate and a machine-wide full-run lock were fixed in
[the swap-exhausted gate issue](../closed/bugs/2026-09-25-full-suite-starts-with-swap-exhausted.md).
That fix is a one-time check by design; mid-run abort was left out of scope.

## What to decide

- Where the check lives: `runTier` runs `pnpm … tap` through
  `bin/test-ledger.ts`, so a poller in `run.ts` has to signal the tap process
  group (`terminateChild` in `bin/child-signals.ts` already does this for the
  wrapper's own signals) and let the wrapper release its slot and lock.
- Which signals count: the same ones as `hostBlockers` (memory pressure at
  warn or above, free swap under the floor, pageout rate), with some
  hysteresis so one noisy 5-second sample does not kill a 30-minute run.
- What a stopped run reports: the existing `deferred` condition with the
  partial results discarded (no verdicts, no `markComplete`), so the same
  pinned commit is retried on the next tick.
