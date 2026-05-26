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
if [ -z "$cwd" ] || [ ! -d "$cwd" ]; then
  exit 0
fi

# Only act inside a callback-mono worktree, not the main checkout itself.
case "$cwd" in
  "$HOME/src/callback-worktrees/"*) ;;
  *) exit 0 ;;
esac

cd "$cwd" || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ -z "$branch" ] || [ "$branch" = "main" ] || [ "$branch" = "HEAD" ]; then
  echo "[session-end] branch=$branch, not eligible for auto-cleanup"
  exit 0
fi

ahead=$(git rev-list --count main..HEAD 2>/dev/null || echo "?")
dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d " ")

if [ "$ahead" != "0" ] || [ "$dirty" != "0" ]; then
  echo "[session-end] worktree '$branch' not fully merged (ahead=$ahead, dirty=$dirty) — leaving alone"
  exit 0
fi

name=$(basename "$cwd")
MONO="$HOME/src/callback-mono"

echo "[session-end] worktree '$branch' is fully merged into main and clean — cleaning up"

# Tell the dev router to stop this worktree's processes immediately so
# there's nothing left binding the cloned-box files when we delete them.
if curl -fsS -m 5 "http://127.0.0.1:3210/__router/stop/$name" >/dev/null 2>&1; then
  echo "[session-end]   told router to stop $name"
fi

# Remove the cloned box (test1-$name).
BOX_DEST="$HOME/src/box-worktrees/test1-$name"
if [ -d "$BOX_DEST" ]; then
  rm -rf "$BOX_DEST"
  echo "[session-end]   removed $BOX_DEST"
fi

# Move out of the worktree dir before removing it, otherwise `git worktree
# remove` complains.
cd "$MONO"

# Remove the worktree directory.
if git worktree remove --force "$cwd" 2>/dev/null; then
  echo "[session-end]   removed worktree $cwd"
fi

# Delete the branch.
if git branch -D "$branch" >/dev/null 2>&1; then
  echo "[session-end]   deleted branch $branch"
fi

echo "[session-end] done"
