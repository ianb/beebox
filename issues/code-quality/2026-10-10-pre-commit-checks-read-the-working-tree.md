---
title: "Pre-commit checks read the working tree, so another agent's unstaged edits fail a path-scoped commit"
workstream: unattached
area: bin
labels: [hooks, worktrees]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
---

Several pre-commit checks scan files on disk rather than the staged index. A
path-scoped commit then fails on edits it does not include: an unstaged
deletion trips an ENOENT or retired-name check, the layout check reads HEAD's
file list while deletions sit unstaged, and the whole-package typecheck fails
on another agent's half-edited file.

Coding feedback: test-cleanup/20261008T124517Z-implemented.md,
test-cleanup/20261008T154311Z-implemented.md,
exhibits-rethink/20261010T185211Z-implemented.md,
plugins-planning/20261010T223439Z-review-adjudicated.md.
`bin/AGENTS.md` now says one agent commits for parallel work; checks that read
staged content would remove the need.
