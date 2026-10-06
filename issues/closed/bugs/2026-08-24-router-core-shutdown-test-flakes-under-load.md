---
title: "router-core's shutdown-supersedes-start test flakes when the suite is loaded"
workstream: test-suite-health
area: router
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-scheduled-task-voice — while adding bin/schedules lint (Track E)
resolution: implemented
---

**Closed 2026-10-06 (test-suite-health, `644ba2339`).** Captured once in about 250 runs of `workstreams-app/test/router/core.teardown.test.ts`: `0 !== 2` probes in the first two tests of the file (the issue's shape, in a neighbour). Cause: `awaitProbes` in `core-harness.ts` ticked `setImmediate` at most 100 times while cold start awaited real fs I/O, so a slow fs returned no probes. Shrinking the budget to 3 ticks reproduced it in three tests every run. The wait is now bounded by a 10 s wall-clock deadline: 200/200 runs under 4 CPU hogs, and the router suite 186/186 three times.

`bin/router-core.test.ts` "shutdown supersedes an in-flight start: it self-cleans
instead of publishing after teardown" failed once during a full `pnpm test` run
on 2026-08-24 (`0 !== 2` at `bin/router-core.test.ts:616`), and passed on a
re-run and in isolation.

What changed around it: `bin/schedules-lint.test.ts` (Track E of
scheduled-workstreams) shells out to real shellcheck and eslint, which took the
root suite from ~13s to ~85s and loads the machine while the router tests run.
The router test appears to depend on timing that holds on an idle machine.

Not the schedules test's bug to fix — the assertion is the one making a timing
assumption. Worth pinning the sequencing (or the fake clock) rather than
loosening the assertion.
