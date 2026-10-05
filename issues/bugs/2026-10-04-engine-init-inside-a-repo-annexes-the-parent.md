---
title: "`bbx engine init` at a path inside another git repository runs `git annex init` on that outer repository"
workstream: unattached
area: beebox
filed-by: agent
discovered-in: worktree-installable-app — a throwaway box for a shutdown reproduction
---

Running `pnpm bbx engine init <path>` with `<path>` under the monorepo's
gitignored `scratch/` directory:

- printed the scaffolded schedule cards, then failed with
  `Error: Command failed: git annex find --anything` /
  `error: pathspec 'scratch/shutdown-repro/box/' did not match any file(s) known to git`;
- left the outer repository annex-initialized: a new `git-annex` branch, a
  `.git/annex/` directory, and `annex.*` / `filter.annex.*` entries in the
  shared `.git/config` (the common dir of every worktree). These were removed
  by hand.

So at least one annex step ran with git resolving the enclosing repository,
which suggests it ran before the box's own repository existed or without
pinning the git dir to the box. Not traced.

Expected: init refuses a target inside another repository (the nested-box
hazard is already guarded for `knowledge-audit --box`), or creates the box's
repository before any git or annex command and runs every command against it.
