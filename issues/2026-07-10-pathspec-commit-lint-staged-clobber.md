---
area: bin
filed-by: agent
discovered-in: worktree-architectural-review — as-ban wave 2, multiple concurrent agents committing to one worktree
---

# `git commit -- <pathspec>` + lint-staged silently clobbers concurrent uncommitted edits

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
