#!/usr/bin/env bash
# Shared advisory mutex serializing git-worktree mutations (add / remove /
# prune / checkout) across everything that touches them: the deploy's build
# checkout, the WorktreeCreate/SessionEnd hooks, and `bin/worktrees sweep`.
#
# WHY: concurrent `git worktree` commands corrupt the shared `.git/worktrees/`
# bookkeeping. Observed repeatedly as the deploy's `.deploy-checkout` dying
# (`fatal: .git/index: ... Not a directory`) when a worktree session was being
# spun up, or a post-merge sweep ran, at the same instant. git offers no lock
# for this and macOS has no `flock`, so we use an atomic `mkdir` lock.
#
# SEMANTICS — deliberately best-effort, never blocking:
#   - `cb_worktree_lock <who>` waits up to CB_WT_LOCK_WAIT sec for the lock. If
#     it can't get it (a stuck holder), it logs and PROCEEDS WITHOUT the lock
#     rather than deadlocking — the callers' own retry/backoff is the backstop.
#     So a broken lock can never wedge worktree creation or a deploy.
#   - A stale lock is reclaimed two ways: its owner PID is dead, or the lock is
#     older than 2 min (any real git-worktree span finishes in seconds).
#   - `cb_worktree_unlock` releases only if THIS shell holds it (idempotent).
#
# Usage (source, then bracket the git-worktree span as tightly as possible):
#   . "<repo>/bin/git-worktree-lock.sh"
#   cb_worktree_lock "deploy"
#   ...git worktree add/remove/prune/checkout...
#   cb_worktree_unlock
# The lock is keyed to a fixed cache path (one working set per machine);
# override with CB_WORKTREE_LOCK for isolated tests.

CB_WT_LOCK_DIR="${CB_WORKTREE_LOCK:-$HOME/.cache/callback-box/git-worktree.lock}"
CB_WT_LOCK_WAIT="${CB_WT_LOCK_WAIT:-120}"
_CB_WT_LOCK_HELD=0

cb_worktree_lock() {
  local who="${1:-?}" waited=0 holder hpid
  mkdir -p "$(dirname "$CB_WT_LOCK_DIR")" 2>/dev/null || true
  while ! mkdir "$CB_WT_LOCK_DIR" 2>/dev/null; do
    holder="$(cat "$CB_WT_LOCK_DIR/owner" 2>/dev/null || true)"
    hpid="${holder%% *}"
    # Reclaim a stale lock: dead owner PID, or older than 2 minutes.
    if { [ -n "$hpid" ] && ! kill -0 "$hpid" 2>/dev/null; } \
      || [ -n "$(find "$CB_WT_LOCK_DIR" -maxdepth 0 -mmin +2 2>/dev/null)" ]; then
      rm -rf "$CB_WT_LOCK_DIR" 2>/dev/null || true
      continue
    fi
    if [ "$waited" -ge "$CB_WT_LOCK_WAIT" ]; then
      echo "cb_worktree_lock: proceeding WITHOUT lock for '$who' after ${CB_WT_LOCK_WAIT}s (held by ${holder:-unknown})" >&2
      _CB_WT_LOCK_HELD=0
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  printf '%s %s\n' "$$" "$who" > "$CB_WT_LOCK_DIR/owner" 2>/dev/null || true
  _CB_WT_LOCK_HELD=1
  return 0
}

cb_worktree_unlock() {
  [ "$_CB_WT_LOCK_HELD" = 1 ] || return 0
  rm -rf "$CB_WT_LOCK_DIR" 2>/dev/null || true
  _CB_WT_LOCK_HELD=0
}
