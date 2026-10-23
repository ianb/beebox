---
title: "A worktree clone's keep branch carries the setup commit, so teardown pins the clone or fails the rebase"
workstream: unattached
area: router
filed-by: agent
discovered-by: agent
resolution: implemented
discovered-in: worktree-risky-merge-review — adversarial review of the merges since 2026-10-08
---

Resolved. A throwaway clone pair reproduced both effects: a keep holding only the setup commit read as `keepUnmerged` with a `keep-unmerged` pin, and `workstream_preserve_keep` refused removal after a later lockfile edit. `workstream_keep_merged` in `bin/lib/workstream-box-state.sh` now tests the keep tip with the setup commit (found by its message prefix) ignored: every other commit must be an ancestor of source `main` or patch-equivalent to a commit on it (`git cherry`). When the rebase that drops the setup commit conflicts, preservation aborts it, prints a note, and pushes keep unrebased. Tests in `bin/test/lib/workstream-box-state.test.ts` cover both.

`bin/lib/worktree-create.sh` step 6 commits "Worktree setup: link the beebox
engine…" in the box clone (commits 64729ef7d and 3494775c6). Every `keep`
branch made in that clone therefore contains the setup commit, which is never
in the source box's `main`.

Two consequences in `bin/lib/workstream-box-state.sh`:

- `workstream_box_state` and `workstream_cull_pin_reason` test
  `merge-base --is-ancestor keep main`. It is false because of the setup
  commit, so the clone reports `keepUnmerged` and the `keep-unmerged` cull pin,
  even when the real work on `keep` was merged into the source box. A clone
  whose `keep` holds only the setup commit is pinned the same way and pushed as
  a `keep/<name>-<date>` branch at every teardown, though it holds nothing of
  its own.
- `workstream_preserve_keep` rebases `keep` to drop the setup commit. Setup
  touches `package.json` and `pnpm-lock.yaml`. A box agent that later runs
  `pnpm add` in the clone edits both, so the rebase conflicts and teardown
  refuses removal ("preserve it by hand") with no automated way forward.

Unproven by a run. Running `workstream_preserve_keep` against a throwaway clone
with a setup commit and a later lockfile edit would prove the conflict. Fix
options: run the ancestor test on the keep tip with the setup commit stripped
(or by patch equivalence), and on a rebase conflict push the unrebased keep,
setup commit included, since that commit only adds a gitignored link and a
lockfile.
