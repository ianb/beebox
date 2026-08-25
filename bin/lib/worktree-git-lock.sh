#!/usr/bin/env bash
# Kernel-owned locks for worktree lifecycle. SOURCE this file; don't execute it.
#
# Two scopes intentionally use separate descriptors:
#   - fd 198: one workstream name's complete create/setup operation
#   - fd 199: this repository's Git worktree-administration transaction
#
# `lockf` is native on macOS and `flock` is standard in Linux CI. Both locks
# belong to the open file descriptor, so process exit (including SIGKILL)
# releases them. The persistent lock file is only an inode and a diagnostic;
# its existence never means a lock is held.

WT_GIT_ADMIN_LOCK_TIMEOUT_SECONDS="${WT_GIT_ADMIN_LOCK_TIMEOUT_SECONDS:-120}"
WT_GIT_SETUP_LOCK_TIMEOUT_SECONDS="${WT_GIT_SETUP_LOCK_TIMEOUT_SECONDS:-1800}"

wt_git_lock_wait() {
  local lock_path="$1" lock_fd="$2" timeout="$3" rc owner

  if command -v lockf >/dev/null 2>&1; then
    if lockf -s -t 0 "$lock_fd"; then
      return 0
    fi
  elif command -v flock >/dev/null 2>&1; then
    if flock -E 75 -n "$lock_fd"; then
      return 0
    fi
  else
    echo "worktree-lock: neither lockf nor flock is available; refusing unlocked Git worktree mutation" >&2
    return 1
  fi

  # Operation-owned readiness for concurrency tests. Production never sets
  # this; unlike a sleep, the marker proves the contender reached contention.
  if [ -n "${WT_GIT_LOCK_OBSERVER_DIR:-}" ]; then
    mkdir -p "$WT_GIT_LOCK_OBSERVER_DIR"
    printf '%s\n' "$$" > "$WT_GIT_LOCK_OBSERVER_DIR/$(basename "$lock_path").waiting"
  fi

  if command -v lockf >/dev/null 2>&1; then
    if lockf -s -t "$timeout" "$lock_fd"; then
      return 0
    else
      rc=$?
    fi
  elif flock -E 75 -w "$timeout" "$lock_fd"; then
    return 0
  else
    rc=$?
  fi

  owner=$(cat "$lock_path" 2>/dev/null || true)
  if [ "$rc" -eq 75 ]; then
    echo "worktree-lock: timed out after ${timeout}s acquiring $lock_path (last owner ${owner:-unknown})" >&2
  else
    echo "worktree-lock: failed acquiring $lock_path (status $rc; last owner ${owner:-unknown})" >&2
  fi
  return "$rc"
}

wt_git_lock_common_dir() {
  git -C "$WT_MONO" rev-parse --path-format=absolute --git-common-dir 2>/dev/null
}

wt_git_setup_state_file() {
  local name="$1" common
  common=$(wt_git_lock_common_dir) || return 1
  printf '%s/callback-worktree-setup-%s.state\n' "$common" "$name"
}

wt_git_setup_lock_acquire() {
  local name="$1" timeout="${2:-$WT_GIT_SETUP_LOCK_TIMEOUT_SECONDS}" common lock_path
  common=$(wt_git_lock_common_dir) || {
    echo "worktree-lock: cannot resolve Git common directory for $WT_MONO" >&2
    return 1
  }
  lock_path="$common/callback-worktree-setup-$name.lock"
  exec 198>>"$lock_path" || return 1
  if ! wt_git_lock_wait "$lock_path" 198 "$timeout"; then
    exec 198>&-
    return 1
  fi
  printf '%s\n' "$$" > "$lock_path"
}

wt_git_setup_lock_release() {
  exec 198>&-
}

wt_git_admin_lock_acquire() {
  local common lock_path
  common=$(wt_git_lock_common_dir) || {
    echo "worktree-lock: cannot resolve Git common directory for $WT_MONO" >&2
    return 1
  }
  lock_path="$common/callback-worktree-admin.lock"
  exec 199>>"$lock_path" || return 1
  if ! wt_git_lock_wait "$lock_path" 199 "$WT_GIT_ADMIN_LOCK_TIMEOUT_SECONDS"; then
    exec 199>&-
    return 1
  fi
  printf '%s\n' "$$" > "$lock_path"
}

wt_git_admin_lock_release() {
  exec 199>&-
}
