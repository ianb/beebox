---
title: "`git commit -- <pathspec>` + lint-staged silently clobbers concurrent uncommitted edits"
workstream: architectural-review
area: bin
filed-by: agent
discovered-in: worktree-architectural-review — as-ban wave 2, multiple concurrent agents committing to one worktree
resolution: implemented
---

**Resolved** (worktree-fix-bugs, 2026-07-11): implemented option 3.
`.husky/pre-commit` now invokes `pnpm exec lint-staged --no-stash` for both
beebox and beebox-clerk. `--no-stash` is safe here specifically
because both lint-staged configs are check-only eslint (no `--fix`) — there's
no task-written output that the stash/backup was ever protecting, so removing
the backup only removes the failure-path `git reset --hard HEAD` + partial-
restore that did the clobbering. A codex cross-review then caught a second
trap: with `--no-stash` (which implies `--no-revert`), a task FAILURE skips
restoring the unstaged hunks lint-staged hid from partially-staged files — an
upstream bug (missing `return` in `restoreUnstagedChangesSkipped`,
`lint-staged/lib/state.js`), reproduced in a scratch repo (the hunk was
silently dropped). So the hook also passes `--no-hide-partially-staged`:
nothing is ever hidden, eslint sees working-tree content for partially-staged
files (as typecheck already does), verified hunk-safe on the failure path.
Reproduced in a scratch repo:
racing an edit to an unrelated tracked file into the middle of a failing
lint-staged task showed default mode reverting that edit to its
pre-run committed state on the revert-to-original-state path, while
`--no-stash` left it untouched. Path-scoped commits
(`git commit -- <paths>` / `stageAndCommitPaths`) remain the convention for
the attribution-sweep reason (bin/CLAUDE.md, "Multiple agents sharing one
worktree") — this fix removes the second, independent failure mode
(lint-staged's reset-hard) rather than replacing pathspec commits.

The multi-agent convention added after the parallel-agent commit-race issue
(bin/CLAUDE.md: path-scoped commits, `git commit -- <paths>`) turns out to
interact destructively with the lint-staged pre-commit hook when several
agents share one worktree: lint-staged does a stash/backup-restore cycle
around the staged files, and with a pathspec commit running concurrently
with other tracks' uncommitted edits, the restore step silently REVERTED
other files' in-flight working-tree changes. Observed repeatedly on
2026-07-10 (one agent lost 10 of 12 files on a commit; four subagents
independently hit the same class; a sibling's edits were reverted from
underneath it and had to be re-applied from context).

Workaround that held: stage only your own files, then a PLAIN `git commit`
(no pathspec) — equivalent when the staged set is exactly your edits, and
lint-staged-safe. Agents should also `git status` before/after committing
and commit frequently.

To resolve properly, pick one:
1. Update the bin/CLAUDE.md convention to the stage-then-plain-commit form
   (documenting WHY pathspec commits are dangerous here), or
2. Make lint-staged concurrency-safe / skip its stash dance (e.g.
   `--no-stash`, or restrict the hook to staged-file linting without
   backup/restore), then keep pathspec commits, or
3. Both.

Note the tension: the pathspec form was adopted to prevent sweeping OTHER
agents' staged files into your commit. The plain-commit form is only safe
when nothing else is staged — which the stage-only-your-files discipline
mostly ensures, but a true fix should protect against both failure modes at
once (lint-staged `--no-stash` + pathspec may be that combination).
