#!/usr/bin/env bash
# Claude Code SessionEnd hook.
#
# When a session ends, if we're in a callback-mono worktree AND the worktree
# branch is fully merged into main (no commits ahead, no uncommitted
# changes), automatically remove the worktree + branch + cloned box + any
# router state for it. Claude Code's built-in auto-cleanup only fires when
# no commits were made during the session — we extend it to "no commits
# remain unmerged."
#
# Safe by construction: we only act when ahead==0 AND dirty==0. Anything
# else (work not yet merged, uncommitted files) gets left alone.
#
# Stdin: JSON { cwd, session_id, hook_event_name, ... }
# Failures are non-blocking; logged in debug mode only.

set -euo pipefail
exec 1>&2

input=$(cat)
mkdir -p "$HOME/.cache/callback-mono"
printf '%s\n' "$input" > "$HOME/.cache/callback-mono/last-session-end-input.json"

cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')

# Determine the worktree directory. cwd is the obvious signal, but Claude
# Code reports the session's *final* cwd — an agent that cd'd to the main
# checkout (e.g. to run a cross-tree git command) before exiting would
# defeat a cwd-only check and leak the worktree. transcript_path is the
# durable signal: it encodes the directory the session was launched in,
# embedded as `-Users-ianbicking-src-callback-worktrees-<name>` in
# `~/.claude/projects/<encoded-path>/<uuid>.jsonl`.
worktree_path=""
case "$cwd" in
  "$HOME/src/callback-worktrees/"*) worktree_path="$cwd" ;;
esac

if [ -z "$worktree_path" ]; then
  tpath=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
  case "$tpath" in
    *"-src-callback-worktrees-"*)
      name=$(printf '%s' "$tpath" | sed -E 's|.*-src-callback-worktrees-([^/]+)/.*|\1|')
      candidate="$HOME/src/callback-worktrees/$name"
      if [ -d "$candidate" ]; then
        echo "[session-end] cwd is '$cwd'; using worktree '$candidate' derived from transcript_path"
        worktree_path="$candidate"
      fi
      ;;
  esac
fi

if [ -z "$worktree_path" ] || [ ! -d "$worktree_path" ]; then
  exit 0
fi

cd "$worktree_path" || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ -z "$branch" ] || [ "$branch" = "main" ] || [ "$branch" = "HEAD" ]; then
  echo "[session-end] branch=$branch, not eligible for auto-cleanup"
  exit 0
fi

ahead=$(git rev-list --count main..HEAD 2>/dev/null || echo "?")
# Deletion-only entries (` D ` unstaged / `D  ` staged) don't count as dirt:
# a cleanup killed mid-removal (hook timeout) leaves a half-deleted tree
# whose only changes are phantom deletions of tracked files — content that
# all exists in git. Counting those as dirty made one interrupted cleanup
# poison the worktree against every future cleanup. Anything that isn't a
# pure deletion (modified, untracked, renamed, conflicted) still blocks.
dirty=$(git status --porcelain 2>/dev/null | grep -cvE '^( D|D ) ' || true)

if [ "$ahead" != "0" ] || [ "$dirty" != "0" ]; then
  echo "[session-end] worktree '$branch' not fully merged (ahead=$ahead, non-deletion dirty=$dirty) — leaving alone"
  exit 0
fi

# IMPORTANT: derive the name from $worktree_path, not $cwd. When the
# session ends with cwd = main (the original bug that motivated the
# transcript-path fallback above), $cwd is the main checkout, so
# basename($cwd) = "callback-mono" — wrong name, wrong target for the
# removal step below.
name=$(basename "$worktree_path")
MONO="$HOME/src/callback-mono"

echo "[session-end] worktree '$branch' is fully merged into main and clean — cleaning up"

# Tell the dev router to stop this worktree's processes immediately so
# there's nothing left binding the cloned-box files when we delete them.
if curl -fsS -m 5 "http://127.0.0.1:3210/__router/stop/$name" >/dev/null 2>&1; then
  echo "[session-end]   told router to stop $name"
fi

# Deleting ~1GB of worktree + box synchronously here used to blow the hook
# timeout: the kill landed mid-`git worktree remove`, leaving a half-deleted
# but still-registered worktree (the accumulation bug of 2026-06). Instead:
# rename everything into a trash dir (instant), do the cheap git bookkeeping,
# and let a detached background process do the slow delete — it survives
# both this hook and the session.
TRASH="$HOME/.cache/callback-mono/trash"
mkdir -p "$TRASH"
ts=$(date +%s)

# Trash the cloned box tree ($name/, which contains test1/).
BOX_DEST="$HOME/src/box-worktrees/$name"
if [ -d "$BOX_DEST" ]; then
  mv "$BOX_DEST" "$TRASH/box-$name-$ts"
  echo "[session-end]   trashed $BOX_DEST"
fi

# Move out of the worktree dir before removing it.
cd "$MONO"

# Trash the worktree directory, then prune the now-dangling registration.
if mv "$worktree_path" "$TRASH/wt-$name-$ts" 2>/dev/null; then
  echo "[session-end]   trashed worktree $worktree_path"
fi
git worktree prune 2>/dev/null || true

# Delete the branch.
if git branch -D "$branch" >/dev/null 2>&1; then
  echo "[session-end]   deleted branch $branch"
fi

# Slow delete, detached. Clears earlier leftovers too.
nohup rm -rf "$TRASH" >/dev/null 2>&1 &
disown 2>/dev/null || true

# Cache state: browse profile + socket dir, router log, pid file.
# These don't show up in any UI, but they accumulate, and if the session
# ended cleanly there's no reason to leave them behind.
BROWSE_DIR="$HOME/.cache/callback-mono/browse/$name"
LOG_FILE="$HOME/.cache/callback-mono/logs/$name.log"
PID_FILE="$HOME/.cache/callback-mono/pids/$name.json"
[ -d "$BROWSE_DIR" ] && rm -rf "$BROWSE_DIR" && echo "[session-end]   removed $BROWSE_DIR"
[ -f "$LOG_FILE" ]   && rm -f  "$LOG_FILE"   && echo "[session-end]   removed $LOG_FILE"
[ -f "$PID_FILE" ]   && rm -f  "$PID_FILE"   && echo "[session-end]   removed $PID_FILE"

echo "[session-end] done"
