---
title: "router-core's shutdown-supersedes-start test flakes when the suite is loaded"
workstream: unattached
area: router
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-scheduled-task-voice — while adding bin/schedules lint (Track E)
---

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
