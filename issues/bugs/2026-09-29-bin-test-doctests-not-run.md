---
title: "Doctests under bin/test are run by no suite"
workstream: unattached
area: dev-tooling
labels: [testing, doctest]
filed-by: agent
discovered-by: agent
discovered-in: worktree-doctest-usability — adding a test for a bin/ helper
---

The layout moves on 2026-09-27 (commit `079410e97`) moved about 28 doctests
from `beebox/test/dev/` to `bin/test/` and `bin/test/lib/`. No tap config
includes the new location: `beebox/.taprc` includes only `test/**` and
`src/frontend/test/**`, the root `package.json` `test` script runs
`node --test bin/*.test.ts schedules/*/*.test.ts`, and no other `.taprc` names
`bin/`.

The files still pass when run by hand from `beebox/` (for example
`pnpm exec tap ../bin/test/confirm-tested.doctest.md`, 4 of 4, on
2026-09-29). But neither `pnpm test`, `pnpm test:changed`, nor the hourly full
suite runs them, so a regression in `bin/` tooling that they cover goes
unseen.

`bin/CLAUDE.md` says new root-infrastructure tests belong in
`beebox/test/dev/*.doctest.md`, while the layout check requires a test there to
name a module in `beebox/src/dev`. A `bin/` helper therefore has no location
that is both allowed and run.
