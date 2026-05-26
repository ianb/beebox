#!/usr/bin/env bash
# Create a parallel worktree with its own cloned test box and an .env that
# picks unique ports.
#
# Usage:
#   scripts/new-worktree.sh <name>
#
# Creates:
#   ../callback-mono-<name>            new worktree on branch <name>
#   ~/src/boxes/test1-<name>           git-cloned copy of test1
#   ../callback-mono-<name>/callback-box/.env   ports + BOXES pointing at the clone
#
# Cleanup with scripts/remove-worktree.sh <name>.

set -euo pipefail

NAME="${1:?usage: new-worktree.sh <name>}"
MONO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREE_PATH="$MONO_ROOT/../callback-mono-$NAME"
BOX_SRC="$HOME/src/boxes/test1"
BOX_DEST="$HOME/src/boxes/test1-$NAME"

if [ -e "$WORKTREE_PATH" ]; then
  echo "error: $WORKTREE_PATH already exists" >&2
  exit 1
fi
if [ -e "$BOX_DEST" ]; then
  echo "error: $BOX_DEST already exists" >&2
  exit 1
fi
if [ ! -d "$BOX_SRC" ]; then
  echo "error: source box $BOX_SRC not found" >&2
  exit 1
fi

# Port offset: count existing worktrees (including main) and bump by 10.
N=$(git -C "$MONO_ROOT" worktree list | wc -l | tr -d ' ')
FRONTEND_PORT=$((3210 + N * 10))
BACKEND_PORT=$((3211 + N * 10))

echo "Creating worktree at $WORKTREE_PATH (branch: $NAME)..."
git -C "$MONO_ROOT" worktree add -b "$NAME" "$WORKTREE_PATH"

echo "Cloning test box: $BOX_SRC -> $BOX_DEST..."
git clone --quiet "$BOX_SRC" "$BOX_DEST"

echo "Writing $WORKTREE_PATH/callback-box/.env..."
cat > "$WORKTREE_PATH/callback-box/.env" <<EOF
FRONTEND_PORT=$FRONTEND_PORT
BACKEND_PORT=$BACKEND_PORT
BOXES=$BOX_DEST
EOF

cat <<EOF

Done.
  worktree:    $WORKTREE_PATH
  branch:      $NAME
  box:         $BOX_DEST
  frontend:    http://localhost:$FRONTEND_PORT/
  backend:     http://localhost:$BACKEND_PORT/

Next steps:
  cd $WORKTREE_PATH/callback-box
  npm install
  overmind start

To tear down: $MONO_ROOT/scripts/remove-worktree.sh $NAME
EOF
