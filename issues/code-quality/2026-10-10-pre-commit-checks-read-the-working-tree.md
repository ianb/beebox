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

**2026-10-19 (retrospective 20261019-230412):** Three more sessions with
parallel workers in one worktree hit it: the layout and doc checks blocked
every commit while one worker had an unregistered or half-finished file, and
`doc-check --fix` ran another worker's uncommitted code. Coding feedback:
bug-burndown-3/20261019T131455Z-implemented.md,
flaky-tests/20261019T025021Z-implemented.md,
turn-feedback/20261019T010859Z-implemented.md. Root `AGENTS.md` "Commit and
land" now says the hooks read the whole working tree.
