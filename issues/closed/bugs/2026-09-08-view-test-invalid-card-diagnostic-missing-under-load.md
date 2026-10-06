---
title: "`view test` can miss an invalid selected card under parallel test load"
workstream: test-suite-health
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-paper-cards — final changed-test verification
priority: important
resolution: implemented
---

**Closed 2026-10-06 (test-suite-health, `2379efcf3`).** The doctest execs the prebuilt CLI, which loads `dist/exports/*` and `dist/view-widgets/*` at runtime. `bundle.ts` renamed only `dist/cli.mjs` atomically and wrote the rest in place, and the suite rebuilds the bundle mid-run (`hub.e2e.doctest.md`). With a bundle-rebuild loop running beside it, the invalid-card case failed 1 run in 8 (`--allow-invalid-cards` exited 1). After every output was staged and renamed: 16/16. The exact original signature (exit 0, no card named) was not reproduced; a partly read `dist/exports/cards.js` during schema loading fits it, but that is unconfirmed. The full-suite logs since 2026-09-05 hold one failure of this file, a 1,043 s timeout on a stalled host.

`test/cli/commands/view-test-command.doctest.md` (moved to `beebox/test/cli/commands/view/command.test-command.doctest.md`) failed during a parallel
`test:changed` run. The case at line 275 creates
`_content/inbox/Bad.bogus.card`, selects it through the view dependency glob,
and runs `view test list`.

The loaded run took 27.7 seconds for this case. The command returned exit code
0 instead of 1. Its standard error did not name `Bad.bogus.card`. The following
`--allow-invalid-cards` assertion still passed.

An immediate isolated run with
`pnpm exec tap test/cli/commands/view-test-command.doctest.md` (moved to `beebox/test/cli/commands/view/command.test-command.doctest.md`) passed all 20
assertions. The complete file took 19.0 seconds. The invalid-card case took
about 2.7 seconds.

This observation does not establish the cause. Determine why the invalid card
was absent from the command result under parallel load before changing the
test or its timeout.
