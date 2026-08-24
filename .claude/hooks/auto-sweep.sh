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
#
# Re-invokes ITSELF with `--run` inside a detached process group; the parent
# returns immediately, so a caller is never blocked by a sweep. Output folds
# into the same lifecycle log as the per-worktree hook decisions.
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
LOCK="$HOME/.cache/callback-box/sweep.lock"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# ── Parent: hand the sweep to a process group of its own, then return ───
#
# `( … ) & disown` is NOT detachment — see bin/lib/detach.mjs. The sweep this
# hook launches must outlive the session whose exit triggered it, and under the
# old form it did not: SessionEnd sweeps were the only ones that ever went
# missing from the log, and they went missing whether or not the hook itself
# succeeded.
if [ "${2:-}" != "--run" ]; then
  node "$REPO/bin/lib/detach.mjs" "$HOOK_DIR/auto-sweep.sh" "$trigger" --run \
    >/dev/null 2>&1 || echo "$(stamp) auto-sweep trigger=$trigger DETACH-FAILED" >> "$LOG"
  exit 0
fi

# ── Child: one sweep at a time ─────────────────────────────────────────
#
# Concurrent sweeps are pure contention: each walks every worktree running git,
# and they collide with each other and with whatever the triggering hook is
# doing in its own worktree. Skip rather than queue — a sweep that does not run
# now runs at the next session start or end, and there is always a next one.
#
# `mkdir` is the atomic primitive (macOS has no flock(1)). The pid inside lets a
# lock left behind by a killed sweep be reclaimed rather than wedging every
# later one.
if ! mkdir "$LOCK" 2>/dev/null; then
  holder=$(cat "$LOCK/pid" 2>/dev/null || echo "")
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    echo "$(stamp) auto-sweep trigger=$trigger SKIPPED (sweep $holder already running)" >> "$LOG"
    exit 0
  fi
  echo "$(stamp) auto-sweep trigger=$trigger reclaiming stale lock (holder='$holder')" >> "$LOG"
  rm -rf "$LOCK" 2>/dev/null || true
  if ! mkdir "$LOCK" 2>/dev/null; then
    echo "$(stamp) auto-sweep trigger=$trigger SKIPPED (could not take lock)" >> "$LOG"
    exit 0
  fi
fi
echo "$$" > "$LOCK/pid" 2>/dev/null || true

# A killed sweep used to leave a START with nothing after it, which reads
# identically to one still running — the ambiguity that hid the detachment bug
# for weeks. SIGKILL still cannot be caught, so a START with neither END nor
# INTERRUPTED now means exactly that, which is itself the diagnosis.
on_signal() {
  echo "$(stamp) auto-sweep trigger=$trigger INTERRUPTED sig=$1" >> "$LOG"
  rm -rf "$LOCK" 2>/dev/null || true
  exit 143
}
trap 'on_signal TERM' TERM
trap 'on_signal HUP' HUP
trap 'on_signal INT' INT
trap 'rm -rf "$LOCK" 2>/dev/null || true' EXIT

{
  echo "$(stamp) auto-sweep trigger=$trigger START"
  "$REPO/bin/workstreams" sweep 2>&1 | sed 's/^/  /'
  echo "$(stamp) auto-sweep trigger=$trigger END"
} >> "$LOG" 2>&1
exit 0
