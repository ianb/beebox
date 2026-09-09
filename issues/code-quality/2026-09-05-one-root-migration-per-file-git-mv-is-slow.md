---
title: "one-root migration: per-file git mv makes big annexed boxes take hours"
workstream: unattached
area: beebox
labels: [box-shape]
filed-by: agent
discovered-by: agent
discovered-in: "worktree-box-layout-criteria — fleet migration: a media-heavy box spent 2+ hours in the move phase"
---

`executeMoves` (`src/core/migrations/one-root-move-plan.ts`) runs one
`git mv` subprocess per planned file. On a media-heavy annexed box
(thousands of attach files), each call pays git's startup plus index
rewrite, and the move phase alone ran multiple hours; small boxes convert
in minutes. The fleet migration is one-shot so this was tolerated, but the
migrator remains in the tree for stragglers (soft-launch users' boxes,
restored backups) and hours-long silent phases invite exactly the
kill-mid-run interruptions the rollback machinery then has to absorb (two
such interrupted runs happened during the fleet migration; both recovered).

Fix directions:

- Batch: one `git mv` per source DIRECTORY where the whole directory maps
  to one destination (the common case — `store/drive/**` moves as a unit);
  per-file only for stragglers. The mapping table already knows
  directory-level destinations.
- Or: filesystem-rename everything, then a single `git add -A` staging
  pass (git computes renames itself); requires re-verifying the
  tracked/untracked split and journal semantics.
- Progress output: the move phase prints nothing until done; a per-100
  files line would make long runs visibly alive.
