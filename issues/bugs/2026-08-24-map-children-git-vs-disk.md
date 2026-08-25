---
title: "refresh-maps derives `children` from git on some paths and disk on others"
workstream: refresh-maps-throughput
filed-by: agent
discovered-in: refresh-maps throughput measurement (worktree-refresh-maps-throughput)
area: callback-box
---

`listMappableDirs` decides which directories deserve a MAP.md by walking the
**filesystem** (`readdir`, filtered by the map ignore patterns). But the
`children` list handed to the agent comes from two different places depending on
which branch of `precheck.ts` fires:

- no MAP.md, or no state entry → `listChildrenOnDisk` (**readdir**)
- recorded `asOf` doesn't resolve → `listChildrenAtCommit(head)` (**git ls-tree**)
- ordinary update → `listChildrenAtCommit(head)` (**git ls-tree**)

A directory whose contents are entirely untracked is visible to the walker — it
counts toward the container and useful-content rules, so its parent qualifies for
a MAP.md — but invisible to `git ls-tree`. On the git-derived paths it silently
drops out of its parent's listing, and the agent, doing exactly what the brief
says, writes a MAP.md without it.

Observed on a deployed box: a directory vanished from its parent's map on
2026-08-06 and reappeared on 2026-08-11 once it had tracked content. The agent
that dropped it had spent nine consecutive turns checking `ls`, `cb ls`,
`git ls-tree`, `git check-ignore`, and `find` against that very directory before
deferring to the brief — it noticed the discrepancy and had no way to act on it.

Not decided: which source is right. Disk matches what the walker already
believes and what a reader of the directory sees, which argues for using it
everywhere. Git is stable against transient working-tree noise, and the update
path needs a listing *at a commit* to diff `added`/`deleted` against — so the
two callers may genuinely want different things, in which case the fix is to
reconcile the walker with whichever the listing uses rather than to unify them.

Related: [refresh-maps max-turns throughput](../code-quality/2026-07-19-refresh-maps-max-turns-throughput.md),
where this surfaced.
