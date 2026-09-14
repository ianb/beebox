---
title: "The one-root migration cannot map a symlink that targets CLAUDE.md, so a stock v2 box refuses to convert"
workstream: unattached
area: beebox
labels: [git]
filed-by: agent
discovered-by: agent
discovered-in: worktree-full-embrace-annex — converting the last manifest-scheme box
---

`content/CLAUDE.md` has no v3 destination. `mapV2Path` classifies it as
`merge-claude-md` (`src/core/migrations/one-root-move-plan.ts:165`), which
merges its text into the tracked root `CLAUDE.md` rather than moving the file.
The symlink resolver requires its target to have a **move** mapping, so any
symlink pointing at `CLAUDE.md` resolves to nothing and the migration refuses:

```
One-root conversion failed and was rolled back: _content/AGENTS.md: symlink
target "CLAUDE.md" resolves to <box>/content/CLAUDE.md, which has no v3 mapping
(directory-level or exact) — refusing to migrate rather than leave it dangling.
Reconcile by hand, then re-run.
```

`content/AGENTS.md -> CLAUDE.md` appears to be stock: the v2 package root
carries the same `AGENTS.md -> CLAUDE.md` pair. If it is stock, no v2 box can
convert without a hand edit first.

The rollback is clean — the box returned to its prior commit with a clean
working tree, which is the behaviour this reports as correct.

Observed on `~/src/boxes/about` on 2026-09-14. Worked around by deleting
`content/AGENTS.md` before re-running; the root `AGENTS.md -> CLAUDE.md`
symlink survives the conversion and serves the same purpose.

The tension: refusing a dangling symlink is right, and merging the two
`CLAUDE.md` files is right. The gap is that `merge-claude-md` never records
where the merged file went, so nothing that points at it can be resolved. A
symlink whose target is merged could reasonably be dropped, or re-pointed at
the merge destination — that choice is the work.

Discovered alongside
[a duplicated asset ignore block the same migration appends](2026-09-14-one-root-migration-duplicates-asset-ignore-block.md).
