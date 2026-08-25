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

**Confirmed by reproduction, and it is worse than the listing mismatch above.**
A box with `*.jpg` gitignored, a stamped-current `store/`, and a new
`store/photos/holiday.jpg`:

```
create children: b.md,notes/      # bootstrap (readdir) — correct
needsWork=false                   # store/ never dirties when photos/ appears
update children: (store not dirty)
```

Detection itself is git-only. The directory is not merely absent from
`children` — it never triggers a refresh, so its parent's MAP.md omits it
indefinitely, until some unrelated tracked change dirties the parent, at which
point the git-derived `children` still omits it. Boxes gitignore media, so
"a directory holding only ignored files" is an ordinary box, not a corner case.

Observed on a deployed box: a directory vanished from its parent's map on
2026-08-06 and reappeared on 2026-08-11 once it had tracked content. The agent
that dropped it had spent nine consecutive turns checking `ls`, `cb ls`,
`git ls-tree`, `git check-ignore`, and `find` against that very directory before
deferring to the brief — it noticed the discrepancy and had no way to act on it.

Patching `children` alone does not fix this, and neither does unioning the
git listing with on-disk directories: `prev` would still come from a commit
that never contained the ignored dir, so it would read as "added" on every run
and the directory would be permanently dirty.

The fix that follows from the reproduction is to **store the listing in
`.cb-maps-state.json` and diff the current on-disk listing against the stored
one**, instead of diffing two commits. That makes `children`, `added`, and
`deleted` all disk-derived and mutually consistent, and it retires the
`asOf`-unresolvable recovery path entirely — the path that regenerated six
directories at once after a history rewrite and produced the confusing
2026-08-06 diff.

**This crosses a migration boundary** (`MapStateEntry` gains a field; live
boxes hold the old shape) so it is a developer's call, not an agent's. It may
not need a migration script: an entry with no stored listing can be read as
"prior listing unknown" and regenerated once, which is self-healing at the cost
of one extra full regeneration per directory — affordable, given a whole-box
refresh measured at 25 turns.

Related: [refresh-maps max-turns throughput](../closed/code-quality/2026-07-19-refresh-maps-max-turns-throughput.md),
where this surfaced.
