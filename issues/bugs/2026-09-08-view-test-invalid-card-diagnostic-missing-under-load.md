---
title: "`view test` can miss an invalid selected card under parallel test load"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-paper-cards — final changed-test verification
---

`test/cli/commands/view-test-command.doctest.md` failed during a parallel
`test:changed` run. The case at line 275 creates
`_content/inbox/Bad.bogus.card`, selects it through the view dependency glob,
and runs `view test list`.

The loaded run took 27.7 seconds for this case. The command returned exit code
0 instead of 1. Its standard error did not name `Bad.bogus.card`. The following
`--allow-invalid-cards` assertion still passed.

An immediate isolated run with
`pnpm exec tap test/cli/commands/view-test-command.doctest.md` passed all 20
assertions. The complete file took 19.0 seconds. The invalid-card case took
about 2.7 seconds.

This observation does not establish the cause. Determine why the invalid card
was absent from the command result under parallel load before changing the
test or its timeout.
