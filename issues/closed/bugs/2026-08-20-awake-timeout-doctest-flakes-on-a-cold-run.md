---
title: "`exec-with-timeout` doctest flakes when the process is cold: a 60ms awake timeout does not fire within 150ms"
workstream: test-suite-health
area: beebox
labels: [testing, flake]
filed-by: agent
discovered-by: agent
discovered-in: full suite run on the codex-chat-labels worktree (2026-08-20)
priority: normal
resolution: implemented
---

**Closed 2026-10-06 (test-suite-health, `dec1a12a4`).** Decision: the code does not under-count; the test raced a tight wall-clock budget. `startAwakeTimeout` treats any tick gap at or above `sleepGapMs` as sleep and credits one period, by design, so an event-loop stall that long (a cold tsx compile, a loaded host) made the 150 ms sleep expire first. `adc26a7d0` (2026-09-04) widened the gap from 60 to 200 ms, and the ledger shows 0 failures in 299 runs since. The firing example now uses a 5 s gap and waits with `eventually`. The sleep-detection example asserts `wall - awake >= 140ms`, which holds however slow its sleeps run. 13/13 runs, 10 of them under 12 CPU hogs.

`test/lib/exec-with-timeout.doctest.md:29` starts a 60ms `startAwakeTimeout`
with a 10ms poll period, sleeps 150ms, and asserts the timeout fired. It
sometimes does not fire. The next example then throws
`Cannot read properties of null (reading 'awakeMs')`, so one flake reports as
two failures.

Observed 2026-08-20: 1 failure in 4 consecutive runs of the file alone, plus
one failure in a full-suite run. The test ledger records 4 failures over 210
runs, 2 of them classified as flakes — so this is long-standing, not new.

The margin is small: the assertion allows 150ms of wall clock for a 60ms timer
whose accumulator advances on a 10ms interval. A cold `tsx` compile, a loaded
machine, or a delayed first tick eats it. The failing run is always the first
in a batch, which fits.

Not yet investigated: whether the awake-time accumulator itself under-counts on
a cold start (a real bug in `src/lib/awake-timeout.ts`) or whether the test
budget is simply too tight for a shared machine. Decide that before widening
the sleep — widening it hides the first case.

Related: `issues/exploration/2026-08-08-run-less-of-the-test-suite.md`.
