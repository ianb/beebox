---
title: "`box-install.test.ts` is red on main since the per-box-user deploy change"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — full suite after the Agent SDK 0.3.309 / Codex 0.164.0 bump
labels: [test-failure]
resolution: implemented
---

**Closed (implemented, 2026-10-30):** Re-reviewed 2026-10-30: box-install.test.ts passes in the 2026-10-30 full-suite run on main at badbabebc.

`beebox/test/deploy/box-install.test.ts` fails on current main with 7
failures. The test runs `deploy/server-bin/bbx-box-install` against a temporary
boxes root with stubbed `sudo`, `pnpm` and `box-engine-link`. It still expects
the stubs to run as the single `beebox` user:

- "A box with no install on record is installed once and then left alone":
  exit 1 where 0 was expected; the logged calls `link a as=beebox`,
  `install a ci=true` and `verify a as=beebox` are missing; then
  `ENOENT … utime '<tmp>/boxes/a/node_modules/.bbx-install-stamp'` because no
  stamp was written.
- A second example: exit 1, `link a as=beebox` and `verify a as=beebox`
  missing.

`b3bef5f26` ("Deploy, scheduler, migration and provisioning for one user and
unit per box", 2026-10-24) changed `bbx-box-install`. The test was not
updated with it. The test builds its own fixtures and reads no repo manifest,
so the dependency bump that surfaced it is not involved.

Either the test's stubs and expected calls follow the per-box user, or the
helper keeps a path the test can drive; the owner of the per-box-units change
decides which. Until then a real regression in the reinstall check (the
`.bbx-install-stamp` logic this test guards) would go unseen.

Reproduce: `pnpm -C beebox test` (2026-10-25: 12,906 pass, 7 fail, 2 skip), or
the file alone from `beebox/`:
`node --import tsx --import ./test/helpers/isolate-user-home.ts --import @ianbicking/tap-check/tap test/deploy/box-install.test.ts`.


## 2026-10-27: not reproduced on main

On main at `0d5d7a877`, the file passes on its own (exit 0, no failures). `0f5c09f44` ("one user and one unit per box is the only layout") was the last change to the test and to `bbx-box-install`. Close as fixed.
