---
title: "wt_remove_now silently continues to branch deletion when the trash-mv fails"
workstream: seam
area: bin
filed-by: agent
discovered-in: "worktree-seam — cross-model review follow-up on the worktree control surface"
priority: normal
---

`bin/lib/worktree-teardown.sh` `wt_remove_now`:

```sh
if mv "$worktree_path" "$WT_TRASH/wt-$name-$(date +%s)" 2>/dev/null; then
  wt_say "trashed worktree $worktree_path"
fi
git worktree prune 2>/dev/null || true

if [ -n "$keep_branch" ]; then
  wt_say "kept branch $branch (unmerged work; \`git worktree add\` to resume)"
elif [ -n "$branch" ] && git branch -D "$branch" >/dev/null 2>&1; then
  wt_say "deleted branch $branch"
fi
```

If the `mv` fails (permissions, a file busy/in-use on the worktree tree, disk
full, cross-device edge case, whatever), nothing reports it — the `if` has no
`else`, and `2>/dev/null` swallows the error text. Execution falls straight
through to `git worktree prune` and `git branch -D`. Net effect: the branch is
deleted while the worktree directory is still sitting on disk, undetected,
with no distinguishing signal — the same `wt_say`/log output as a clean
removal. Violates `docs/engineering-principles.md` §4 (resilient AND never
silent): a failure here doesn't need to prevent the branch cleanup, but it
must not vanish.

This is pre-existing behavior in the shared lib — `session-end.sh` and the
`codex-exit` hook already ran this path before the worktree-control-surface
refactor. What changed: `bin/workstreams sweep` now reaches it too, and sweep
runs unattended at every session start *and* end (`.claude/hooks/auto-sweep.sh`
+ `SessionEnd`), so the blast radius of a silent `mv` failure widened from "one
interactive teardown" to "every session boundary, for every worktree sweep
touches."

**Fix sketch:** report the failure (`wt_say`/`wt_log` at minimum) and skip the
`git branch -D` when the `mv` did not succeed — the recoverable state (worktree
dir + branch both still present) is strictly better than the current failure
mode (branch gone, directory orphaned with no marker).

Deliberately not fixed in the worktree-seam branch that surfaced it — flagged
to the boxholder twice during that work and not requested there; scope was
kept to the control-surface refactor itself.
