#!/usr/bin/env bash
# Create a parallel worktree with its own cloned test box and an .env that
# picks unique ports, then run pnpm install in callback-box.
#
# Usage:
#   scripts/new-worktree.sh <name>
#
# Creates:
#   ~/src/callback-worktrees/<name>/             new worktree on branch <name>
#   ~/src/box-worktrees/test1-<name>/            git-cloned copy of test1
#                                                (kept outside the monorepo so the
#                                                 box doesn't inherit monorepo CLAUDE.md)
#   ~/src/callback-worktrees/<name>/callback-box/.env
#                                                ports + BOXES pointing at the clone
#
# Port allocation: scans .env files of existing worktrees and picks the lowest
# unused multiple-of-10 offset (main=3210/3211, then 3220/3221, 3230/3231, ...).
# Safe across worktree create/remove cycles.
#
# Cleanup with scripts/remove-worktree.sh <name>.

set -euo pipefail

NAME="${1:?usage: new-worktree.sh <name>}"
MONO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREE_ROOT="$HOME/src/callback-worktrees"
BOX_ROOT="$HOME/src/box-worktrees"
WORKTREE_PATH="$WORKTREE_ROOT/$NAME"
BOX_SRC="$HOME/src/boxes/test1"
BOX_DEST="$BOX_ROOT/test1-$NAME"

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

mkdir -p "$WORKTREE_ROOT" "$BOX_ROOT"

# Find first unused FRONTEND_PORT offset. Scan every worktree's .env, collect
# used FRONTEND_PORTs, then pick the lowest 3220+10k that isn't taken. Main
# (no .env) implicitly uses 3210.
used_ports=" 3210 "  # main worktree
while IFS= read -r line; do
  # `git worktree list --porcelain` emits "worktree <path>" lines
  case "$line" in
    "worktree "*)
      wt_path="${line#worktree }"
      env_file="$wt_path/callback-box/.env"
      if [ -f "$env_file" ]; then
        port=$(grep -E '^FRONTEND_PORT=' "$env_file" | head -1 | cut -d= -f2 | tr -d ' \r')
        [ -n "$port" ] && used_ports+="$port "
      fi
      ;;
  esac
done < <(git -C "$MONO_ROOT" worktree list --porcelain)

FRONTEND_PORT=3220
while [[ "$used_ports" == *" $FRONTEND_PORT "* ]]; do
  FRONTEND_PORT=$((FRONTEND_PORT + 10))
done
BACKEND_PORT=$((FRONTEND_PORT + 1))

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

echo "Running pnpm install in callback-box..."
(cd "$WORKTREE_PATH/callback-box" && pnpm install)

cat <<EOF

Done.
  worktree:    $WORKTREE_PATH
  branch:      $NAME
  box:         $BOX_DEST
  frontend:    http://localhost:$FRONTEND_PORT/
  backend:     http://localhost:$BACKEND_PORT/

Start the dev servers:
  cd $WORKTREE_PATH/callback-box && overmind start

To tear down: $MONO_ROOT/scripts/remove-worktree.sh $NAME
EOF
