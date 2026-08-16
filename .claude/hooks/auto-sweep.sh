#!/usr/bin/env bash
# Trigger a background `bin/workstreams sweep`, gated + logged.
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
set -u

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

# Detached + backgrounded so it never blocks a merge or a session start. Output
# folds into the same lifecycle log, so auto-sweep runs are visible right
# alongside the per-worktree hook decisions.
(
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-sweep trigger=$trigger START"
  "$REPO/bin/workstreams" sweep 2>&1 | sed 's/^/  /'
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-sweep trigger=$trigger END"
) >> "$LOG" 2>&1 &
disown 2>/dev/null || true
exit 0
