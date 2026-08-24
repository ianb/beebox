---
title: "`exec-with-timeout` doctest flakes when the process is cold: a 60ms awake timeout does not fire within 150ms"
workstream: unattached
area: callback-box
labels: [testing, flake]
filed-by: agent
discovered-by: agent
discovered-in: full suite run on the codex-chat-labels worktree (2026-08-20)
---

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
