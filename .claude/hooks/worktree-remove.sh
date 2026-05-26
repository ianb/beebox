#!/usr/bin/env bash
# Claude Code WorktreeRemove hook.
#
# Companion to worktree-create.sh. Removes the cloned test box at
# ~/src/box-worktrees/test1-<name>/. Claude Code handles git worktree removal
# itself; we only clean up the sibling box.
#
# Stdin: JSON { worktree_path, session_id, cwd, ... }
# Failures are non-blocking; exit code is logged in debug mode only.

set -euo pipefail
exec 1>&2  # everything to stderr; no stdout expected

input=$(cat)
worktree_path=$(printf '%s' "$input" | jq -r '.worktree_path')
NAME=$(basename "$worktree_path")
BOX_DEST="$HOME/src/box-worktrees/test1-$NAME"

echo "[worktree-remove] name=$NAME path=$worktree_path"

if [ -d "$BOX_DEST" ]; then
  echo "[worktree-remove] removing box $BOX_DEST"
  rm -rf "$BOX_DEST"
else
  echo "[worktree-remove] no box at $BOX_DEST (already gone)"
fi
