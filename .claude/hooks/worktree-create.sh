#!/usr/bin/env bash
# Claude Code WorktreeCreate hook.
#
# Replaces the default `git worktree add` with logic that also:
#   - clones ~/src/boxes/test1 to ~/src/box-worktrees/test1-<name>/
#     (kept outside the monorepo so the box doesn't inherit monorepo CLAUDE.md)
#   - writes <worktree>/callback-box/.env with hash-derived unique ports
#     and BOXES pointing at the cloned box
#   - runs pnpm install in callback-box
#
# Stdin: JSON { worktree_path, base_ref, isolation, session_id, cwd, ... }
# Stdout: the final worktree path (required for Claude Code to use it)
# Stderr: all log output
# Non-zero exit aborts worktree creation.

set -euo pipefail

# All logs go to stderr; only the final path goes to stdout.
exec 3>&1 1>&2

input=$(cat)
worktree_path=$(printf '%s' "$input" | jq -r '.worktree_path')
base_ref=$(printf '%s' "$input"   | jq -r '.base_ref // "main"')
NAME=$(basename "$worktree_path")
new_branch="worktree-$NAME"

BOX_SRC="$HOME/src/boxes/test1"
BOX_DEST="$HOME/src/box-worktrees/test1-$NAME"

echo "[worktree-create] name=$NAME base=$base_ref path=$worktree_path"

# Port allocation: hash the worktree name into a stable offset.
# Slots in [3220, 4220), step 10 => 100 slots, ~1% same-name-pair collision.
hash=$(printf '%s' "$NAME" | shasum -a 256 | cut -c1-8)
slot=$(( 0x$hash % 100 ))
FRONTEND_PORT=$(( 3220 + slot * 10 ))
BACKEND_PORT=$(( FRONTEND_PORT + 1 ))

# 1. Create the worktree (hook replaces default git logic, so we do it).
mkdir -p "$(dirname "$worktree_path")"
git worktree add -b "$new_branch" "$worktree_path" "$base_ref"

# 2. Clone the test box if it doesn't already exist (idempotent).
mkdir -p "$(dirname "$BOX_DEST")"
if [ ! -d "$BOX_DEST" ]; then
  if [ -d "$BOX_SRC" ]; then
    echo "[worktree-create] cloning $BOX_SRC -> $BOX_DEST"
    git clone --quiet "$BOX_SRC" "$BOX_DEST"
  else
    echo "[worktree-create] warning: $BOX_SRC not found; BOXES will be unset"
    BOX_DEST=""
  fi
else
  echo "[worktree-create] reusing existing box $BOX_DEST"
fi

# 3. Write .env in callback-box.
env_file="$worktree_path/callback-box/.env"
{
  echo "FRONTEND_PORT=$FRONTEND_PORT"
  echo "BACKEND_PORT=$BACKEND_PORT"
  [ -n "$BOX_DEST" ] && echo "BOXES=$BOX_DEST"
} > "$env_file"
echo "[worktree-create] wrote $env_file"

# 4. pnpm install in callback-box.
echo "[worktree-create] running pnpm install in callback-box..."
(cd "$worktree_path/callback-box" && pnpm install)

echo "[worktree-create] done. frontend=http://localhost:$FRONTEND_PORT/ backend=http://localhost:$BACKEND_PORT"

# Required: print the worktree path on stdout so Claude Code uses it.
printf '%s\n' "$worktree_path" >&3
