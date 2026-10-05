---
title: "Doctests under bin/test are run by no suite"
workstream: doctest-usability
area: dev-tooling
labels: [testing, doctest]
filed-by: agent
discovered-by: agent
discovered-in: worktree-doctest-usability — adding a test for a bin/ helper
resolution: implemented
---

Fixed: `beebox/.taprc` includes `../bin/test/**/*.doctest.md`, so the 29 files run in beebox's suite (and its home/secret isolation, which they were written under), the hourly full suite, and `test:changed` (the test graph now maps `bin/` sources to them; 977 entrypoints, 0 unresolved). Running them exposed two left broken by the move — `doc-lifecycle-check` and `smoke-browse` resolved paths one directory too high — both fixed; all 208 checks pass. `bin/CLAUDE.md` now says where these tests go.

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
