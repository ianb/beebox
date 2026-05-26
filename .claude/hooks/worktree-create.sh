#!/usr/bin/env bash
# Claude Code WorktreeCreate hook.
#
# Replaces the default `git worktree add` with logic that also:
#   - OVERRIDES the worktree location: Claude Code defaults to
#     <repo>/.claude/worktrees/<name>/, but we put it at
#     ~/src/callback-worktrees/<name>/ instead. Reason: callback-box and
#     cardworks have file: deps on personal-vibe-check at file:../../personal-vibe-check.
#     The relative path only resolves correctly when the worktree is a
#     sibling of the monorepo root (same depth as main checkout). Putting
#     the worktree under .claude/worktrees/ adds 2 extra path levels and
#     breaks the dep resolution.
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

# Loud failure: surface line + exit code on any error so a half-created
# worktree doesn't get handed back to Claude Code as if it succeeded.
trap 'rc=$?; echo "[worktree-create] FAILED at line $LINENO (exit $rc). Worktree may be partially set up at $worktree_path." >&2; exit $rc' ERR

# All logs go to stderr; only the final path goes to stdout.
exec 3>&1 1>&2

input=$(cat)
# Log the raw input so we can adjust to whatever schema Claude Code actually
# emits (the docs at code.claude.com don't perfectly match every version).
mkdir -p "$HOME/.cache/callback-mono"
printf '%s\n' "$input" > "$HOME/.cache/callback-mono/last-worktree-create-input.json"

# Try common field-name variants; fall back to fail loudly rather than carry
# on with "null".
requested_path=$(printf '%s' "$input" | jq -r '.worktree_path // .worktreePath // .path // empty')
base_ref=$(printf '%s'       "$input" | jq -r '.base_ref // .baseRef // "main"')
name_from_input=$(printf '%s' "$input" | jq -r '.name // .worktree_name // empty')

if [ -n "$name_from_input" ]; then
  NAME="$name_from_input"
elif [ -n "$requested_path" ]; then
  NAME=$(basename "$requested_path")
else
  echo "[worktree-create] FATAL: stdin lacks worktree_path/worktreePath/path/name. Raw input:" >&2
  cat "$HOME/.cache/callback-mono/last-worktree-create-input.json" >&2
  exit 1
fi

new_branch="worktree-$NAME"

# Override the location: ignore Claude Code's requested path; put the worktree
# as a sibling of the monorepo so file: deps to ../../personal-vibe-check resolve.
worktree_path="$HOME/src/callback-worktrees/$NAME"

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

# 4. Build cardworks first, then pnpm install in callback-box.
# (cardworks is a file: dep with node-linker=hoisted, so pnpm copies dist/
# into callback-box/node_modules/cardworks/ at install time — it must exist.)
# Also install root husky so .husky/_/ exists in the worktree (otherwise
# core.hooksPath points to a missing dir and git hooks don't fire).
echo "[worktree-create] installing root husky..."
(cd "$worktree_path" && pnpm install)

echo "[worktree-create] building cardworks..."
(cd "$worktree_path/cardworks" && pnpm install && pnpm build)

echo "[worktree-create] running pnpm install in callback-box..."
(cd "$worktree_path/callback-box" && pnpm install)

echo "[worktree-create] running pnpm install in callback-box/src/frontend..."
(cd "$worktree_path/callback-box/src/frontend" && pnpm install)

echo "[worktree-create] done. frontend=http://localhost:$FRONTEND_PORT/ backend=http://localhost:$BACKEND_PORT"

# Required: print the worktree path on stdout so Claude Code uses it.
printf '%s\n' "$worktree_path" >&3
