---
title: "Pre-commit checks read the working tree, so another agent's unstaged edits fail a path-scoped commit"
workstream: tooling-burndown
area: bin
labels: [hooks, worktrees]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
resolution: implemented
---

**Closed 2026-10-29:** fixed on the tooling-burndown branch ("Pre-commit
checks run in a snapshot of the commit index"; plan
[staged-commit-checks](../../../beebox/docs/implemented-plans/staged-commit-checks.md)).
The hook syncs a persistent copy of the commit index
(`bin/staged-snapshot.ts`) and runs every check there, so a path-scoped commit
passes with another agent's unstaged deletion, rename, half-written `.ts`, and
unregistered doc on disk, and a staged type error is still blocked. The old
hook failed the same clean commit with ENOENT in layout-check.

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
land" now says the hooks read the whole working tree. Its priority may be
stale now that it recurs.

**2026-10-22 (retrospective 20261022-232146):** Four more sessions. The layout
check threw ENOENT on a path-limited commit when a rename or deletion sat
outside the committed set, and parallel workers' typecheck and layout-check
runs failed on siblings' half-written files. One agent's commit message landed
on another agent's files. Coding feedback:
bug-burndown-4/20261020T125850Z-implemented.md,
bug-burndown-4/20261020T201148Z-implemented.md,
journey-walks-late-oct/20261022T211450Z-implemented.md,
risky-merge-review/20261022T221012Z-implemented.md. Root `AGENTS.md` now says
workers report check failures only in their own files and the committer
reruns the checks.

**2026-10-25 (retrospective 20261025-233625):** Two more sessions. The layout
check crashed on a cached path deleted by a parallel worker, blocking another
track's commit; a whole-package typecheck failed on a sibling agent's mid-edit
file, and a `git add` with one bad pathspec aborted so the commit took only
another agent's staged renames. Coding feedback:
dup-sweep-frontend/20261023T200509Z-implemented.md,
risky-merge-review/20261023T052627Z-implemented.md.
