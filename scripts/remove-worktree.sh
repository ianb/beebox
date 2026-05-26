#!/usr/bin/env bash
# Tear down a worktree created by new-worktree.sh.
#
# Usage:
#   scripts/remove-worktree.sh <name>
#
# Removes:
#   ../callback-mono-<name>     worktree
#   branch <name>               (force-deleted; warns if unmerged)
#   ~/src/boxes/test1-<name>    cloned test box

set -euo pipefail

NAME="${1:?usage: remove-worktree.sh <name>}"
MONO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREE_PATH="$MONO_ROOT/../callback-mono-$NAME"
BOX_DEST="$HOME/src/boxes/test1-$NAME"

if [ -d "$WORKTREE_PATH" ]; then
  echo "Removing worktree $WORKTREE_PATH..."
  git -C "$MONO_ROOT" worktree remove --force "$WORKTREE_PATH"
else
  echo "(no worktree at $WORKTREE_PATH)"
fi

if git -C "$MONO_ROOT" show-ref --verify --quiet "refs/heads/$NAME"; then
  echo "Deleting branch $NAME..."
  git -C "$MONO_ROOT" branch -D "$NAME"
fi

if [ -d "$BOX_DEST" ]; then
  echo "Removing box $BOX_DEST..."
  rm -rf "$BOX_DEST"
else
  echo "(no box at $BOX_DEST)"
fi

echo "Done."
