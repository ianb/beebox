#!/usr/bin/env bash
# Trigger a detached `bin/workstreams sweep`, gated + logged.
#
# WHY THIS EXISTS: worktree auto-cleanup must NOT depend on the SessionEnd hook
# correctly identifying a finishing session as its worktree — it can't when a
# /finish ends in main context (the session's cwd + transcript are the main
# checkout, so session-end.sh logs `skip:not-a-worktree-session` and never
# cleans; see worktree-cleanup.log). A triggered sweep removes merged + clean +
# inactive worktrees regardless of how their session ended. Called from:
#   - SessionStart hook   → the sweep trigger. Catches /finish-in-main-context,
#                           tab-close, and orphaned-session cases at the next
#                           session start.
#   - SessionEnd hook      → same trigger, so a long-lived main session doesn't
#                           accumulate finished worktrees all day.
#   - bin/codex-session-end → codex fires no hooks; its launcher-driven teardown
#                           calls this for parity.
# NOT wired to .husky/post-merge: sweep's `git worktree prune` is not
# concurrency-safe against the deploy that post-merge also launches (it
# corrupts the deploy's .deploy-checkout). Re-adding needs a shared worktree
# lock first.
#
# Safe to auto-run: `bin/workstreams sweep` removes a worktree only when it is
# fully merged into main, clean (no non-deletion dirt), AND has no active
# `claude`/`codex` session (checked via `ps -axo pid=,comm=` + `--worktree`
# argv + real process cwd — NOT pgrep, which misses native-installed Claude
# Code entirely; see bin/CLAUDE.md).
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
REPO="$(cd "$HOOK_DIR/../.." 2>/dev/null && pwd || echo "")"
[ -n "$REPO" ] || exit 0

# Only the MAIN checkout sweeps. A worktree session's SessionStart runs the
# worktree's own copy of this script; gate it out so we don't fan a sweep off
# every worktree session start.
case "$REPO" in *"/callback-worktrees/"*) exit 0 ;; esac

trigger="${1:-manual}"
LOG="$HOME/.cache/callback-box/worktree-cleanup.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

auto_sweep_remove_launchd_job() {
  local label="$1"
  [ -n "$label" ] || return 0
  launchctl remove "$label" >/dev/null 2>&1 || true
}

auto_sweep_worker() {
  local label="$1" worker_trigger="$2" lock="$HOME/.cache/callback-box/auto-sweep.lock"
  local request="$HOME/.cache/callback-box/auto-sweep.requested" status=0 rc
  if [ -n "$label" ]; then
    # Labels are generated from digits/dots plus a fixed prefix. Bind it now:
    # the function-local variable is out of scope when the shell's EXIT trap
    # runs after worker mode returns.
    trap "auto_sweep_remove_launchd_job '$label'" EXIT
  fi
  exec 197>>"$lock" || {
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-sweep trigger=$worker_trigger LOCK-FAILED open" >> "$LOG"
    return 1
  }
  if command -v lockf >/dev/null 2>&1; then
    lockf -s -t "${AUTO_SWEEP_LOCK_TIMEOUT_SECONDS:-1800}" 197 || rc=$?
  elif command -v flock >/dev/null 2>&1; then
    flock -E 75 -w "${AUTO_SWEEP_LOCK_TIMEOUT_SECONDS:-1800}" 197 || rc=$?
  else
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-sweep trigger=$worker_trigger LOCK-FAILED no-lock-tool" >> "$LOG"
    return 1
  fi
  if [ "${rc:-0}" -ne 0 ]; then
    if [ "$rc" -eq 75 ]; then
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-sweep trigger=$worker_trigger LOCK-TIMEOUT" >> "$LOG"
    else
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-sweep trigger=$worker_trigger LOCK-FAILED status=$rc" >> "$LOG"
    fi
    return "$rc"
  fi

  # Every trigger writes the marker before submitting its worker. One queued
  # worker consumes all requests that arrived before it acquired; later queued
  # workers observe no marker and exit without a redundant sweep.
  if [ ! -f "$request" ]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-sweep trigger=$worker_trigger COALESCED no-request" >> "$LOG"
    exec 197>&-
    return 0
  fi
  rm -f "$request"

  {
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-sweep trigger=$worker_trigger START"
    # The worker shell owns fd 197. The sweep and its detached trash reapers
    # must not inherit it, or they hold the whole-sweep lock after this worker
    # has finished waiting for the sweep command.
    "$REPO/bin/workstreams" sweep 197>&- 2>&1 | sed 's/^/  /' || status=$?
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-sweep trigger=$worker_trigger END status=$status"
  } >> "$LOG" 2>&1
  exec 197>&-
  return "$status"
}

if [ "$trigger" = "--run-detached" ]; then
  auto_sweep_worker "${2:-}" "${3:-unknown}"
  exit $?
fi

# `&`/`disown` is not detachment from a non-interactive hook host: Claude can
# still wait on or cancel the descendant process group. launchd crosses that
# boundary. A submitted command is daemon-like by default, so worker mode
# removes its unique label after logging END to prevent a restart.
script="$REPO/.claude/hooks/auto-sweep.sh"
label="com.callback-box.auto-sweep.$(date +%s).$$"
request="$HOME/.cache/callback-box/auto-sweep.requested"
: > "$request"
env_args=(/usr/bin/env "HOME=$HOME" "PATH=$PATH")
for env_name in CALLBACK_STATE_DIR CALLBACK_WORKTREE_ROOT CALLBACK_BOX_ROOT CALLBACK_BOX_SRC CALLBACK_EXHIBITS_ROOT CALLBACK_COMMENTS_ROOT AUTO_SWEEP_LOCK_TIMEOUT_SECONDS; do
  if [ -n "${!env_name:-}" ]; then
    env_args+=("$env_name=${!env_name}")
  fi
done

if command -v launchctl >/dev/null 2>&1; then
  if launchctl submit -l "$label" -o /dev/null -e /dev/null -- \
      "${env_args[@]}" "$script" --run-detached "$label" "$trigger"; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-sweep trigger=$trigger SUBMITTED label=$label" >> "$LOG"
    exit 0
  fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-sweep trigger=$trigger SUBMIT-FAILED launchctl" >> "$LOG"
  exit 1
fi

if command -v setsid >/dev/null 2>&1; then
  setsid "${env_args[@]}" "$script" --run-detached "" "$trigger" </dev/null >/dev/null 2>&1 &
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-sweep trigger=$trigger SUBMITTED setsid" >> "$LOG"
  exit 0
fi

nohup "${env_args[@]}" "$script" --run-detached "" "$trigger" </dev/null >/dev/null 2>&1 &
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-sweep trigger=$trigger SUBMITTED nohup" >> "$LOG"
exit 0
