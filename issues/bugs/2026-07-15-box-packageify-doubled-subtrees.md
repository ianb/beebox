---
title: "box-packageify migration created doubled subtrees in some boxes"
filed-by: agent
discovered-in: main session — investigating a test box's stuck refresh-maps health flag
area: callback-box
---

The v1→v2 `box-packageify` migration (`scripts/migrate/box-packageify.ts`,
registered in `src/core/migrations.ts`; ran ~2026-07-04) **duplicated some
subtrees into themselves** on at least two local boxes. On disk you get a path
where a mid-tree segment repeats — schematically `store/<X>/store/<X>/…` — a real,
git-tracked directory that is a (partial) copy of the box's `store/<X>/` subtree
nested one level in.

**Proven origin, not speculation:** for an affected box, the doubled path is
**absent at the migration commit's parent** (`git ls-tree <migrate-commit>^` → 0
entries) and **present at the migration commit** itself. So the migration
introduced it; it did not pre-exist.

**Scope (local):** two boxes affected (a test box and a review box); the primary
personal boxes scanned clean. Detection scan (structure only, no content):

```py
# for each box's content root, walk dirs and flag any whose relative path has a
# repeated consecutive path-segment run (parts[i:i+L] == parts[i+L:i+2L]).
# Exclude .git / node_modules / .callback-box / procedure/runs, and note that
# scenario fixtures legitimately nest box/box — those are false positives.
```

**Why it matters — it silently wedges `refresh-maps` forever** (see the sibling
[refresh-maps non-convergence bug](../closed/bugs/2026-07-15-refresh-maps-wedges-on-unresolvable-dir.md)):
the doubled dirs don't exist at the map-state `asOf` ref, so the precheck flags
them dirty on every run and validation never passes. Any box the migration
corrupted has a permanently-failing refresh-maps.

**The migrator can't be fixed** — `box-packageify` is now a retired tombstone (the
conversion logic was removed once all boxes were v2), so it won't run again and
there's no code to patch. The exact trigger is unrecoverable from the removed
code; it correlates loosely with a nested directory named like a v1 top-level dir
(`store`) inside the affected subtree, but not deterministically (a clean box has
one too). This is a **data-repair** item, not a code fix.

**Cleanup is NOT a blind `git rm` of the doubled path — the copies diverge.**
Verified on the affected boxes: the doubled subtree is *not* a pure duplicate —
it holds files (e.g. per-directory `CLAUDE.md`) that have **no identical twin at
the de-doubled real path**, and in one box the doubled dirs are untracked-on-disk
(never committed). So repairing a box means, per doubled subtree: compare each
file's blob against its de-doubled twin, decide which copy is canonical (they may
have diverged), then remove the redundant one — with a human in the loop for any
non-identical file. `MAP.md` is regenerable and can be dropped freely.

**Prod is likely at risk** — the same migration ran on the deployed boxes around
the same date. A read-only structural scan of prod (the detector above) should be
run to see whether any prod box carries the same corruption and a silently-broken
refresh-maps.
