---
title: "doc-check --fix leaves a moved plan's old path in test comments"
workstream: unattached
area: beebox
labels: [doc-check, finish, tooling]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261025-233625
---

When finish moves a plan to `docs/implemented-plans/`, `doc-check --fix`
rewrites links in docs and some source comments but skips tests. The finish
agent file says to `git grep` the old basename, and each finish then edits the
remaining paths by hand with `sed`.

Coding feedback: front-door/20261026T033535Z-landed.md,
journey-walks-late-oct/20261023T173229Z-landed.md,
perf-easy-wins/20261024T165655Z-landed.md.

Directions named in the entries: let `--fix` rewrite repo paths in test files
too, or print the remaining old-basename matches after a move.
