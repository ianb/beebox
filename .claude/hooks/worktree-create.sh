#!/usr/bin/env bash
# Claude Code WorktreeCreate hook.
#
# Replaces the default `git worktree add` with logic that also:
#   - OVERRIDES the worktree location: Claude Code defaults to
#     <repo>/.claude/worktrees/<name>/, but we put it at
#     ~/src/callback-worktrees/<name>/ instead. Reason: callback-box and
#     cardworks have file: deps on personal-vibe-check at file:../personal-vibe-check.
#     The relative path only resolves correctly when the worktree is a
#     sibling of the monorepo root (same depth as main checkout).
#   - clones ~/src/boxes/test1 to ~/src/box-worktrees/<name>/test1/
#     (URL slug = basename = "test1" for every worktree, so links like
#     /<wt>/test1/... swap cleanly across worktrees)
#     (kept outside the monorepo so the box doesn't inherit monorepo CLAUDE.md)
#   - runs pnpm install at the worktree root (root husky), in cardworks (and
#     builds it), callback-box, and callback-box/src/frontend. After this the
#     worktree is ready for the dev router to serve.
#
# The dev router lazy-spawns Vite + Fastify per worktree on first request, so
# we don't start any dev server here. Ports are also allocated dynamically by
# the router — no need to write a .env file with FRONTEND_PORT/BACKEND_PORT.
# A .env file is still respected by the router if you create one (BOXES line
# overrides the default ~/src/box-worktrees/<name>/test1/), but not required.
#
# Stdin: JSON with at least one of { name, worktree_path }.
# Stdout: the final worktree path (required for Claude Code to use it).
# Stderr: all log output.
# Non-zero exit aborts worktree creation.

set -euo pipefail

trap 'rc=$?; echo "[worktree-create] FAILED at line $LINENO (exit $rc). Worktree may be partially set up at ${worktree_path:-unknown}." >&2; exit $rc' ERR

exec 3>&1 1>&2

input=$(cat)
mkdir -p "$HOME/.cache/callback-mono"
printf '%s\n' "$input" > "$HOME/.cache/callback-mono/last-worktree-create-input.json"

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
worktree_path="$HOME/src/callback-worktrees/$NAME"
BOX_SRC="$HOME/src/boxes/test1"
BOX_DEST="$HOME/src/box-worktrees/$NAME/test1"

echo "[worktree-create] name=$NAME base=$base_ref path=$worktree_path"

# 1. Create (or re-attach to) the worktree.
mkdir -p "$(dirname "$worktree_path")"
if git worktree list --porcelain | grep -qxF "worktree $worktree_path"; then
  echo "[worktree-create] worktree already registered at $worktree_path — resume, skipping setup"
  printf '%s\n' "$worktree_path" >&3
  exit 0
elif git show-ref --verify --quiet "refs/heads/$new_branch"; then
  echo "[worktree-create] branch $new_branch already exists — attaching without -b"
  git worktree add "$worktree_path" "$new_branch"
else
  git worktree add -b "$new_branch" "$worktree_path" "$base_ref"
fi

# 2. Clone the test box if it doesn't already exist (idempotent).
mkdir -p "$(dirname "$BOX_DEST")"
if [ ! -d "$BOX_DEST" ]; then
  if [ -d "$BOX_SRC" ]; then
    echo "[worktree-create] cloning $BOX_SRC -> $BOX_DEST"
    git clone --quiet "$BOX_SRC" "$BOX_DEST"
    # Carry over gitignored connector secrets (deepgram, gmail, google,
    # dropbox, etc.). The source box gitignores config/connectors/*.secret.*
    # so git clone leaves them behind, breaking transcription and external
    # syncs in the worktree until the user manually copies them.
    if [ -d "$BOX_SRC/config/connectors" ]; then
      mkdir -p "$BOX_DEST/config/connectors"
      copied=0
      for f in "$BOX_SRC"/config/connectors/*.secret.*; do
        [ -e "$f" ] || continue
        cp "$f" "$BOX_DEST/config/connectors/"
        copied=$((copied + 1))
      done
      if [ "$copied" -gt 0 ]; then
        echo "[worktree-create] copied $copied connector secret(s) from source box"
      fi
    fi
  else
    echo "[worktree-create] warning: $BOX_SRC not found; router will fall back to defaults"
  fi
else
  echo "[worktree-create] reusing existing box $BOX_DEST"
fi

# 3. pnpm install at every level. Root first so .husky/_/ exists (git hooks
# fire). cardworks build before callback-box because callback-box's
# node_modules/cardworks/ is populated from cardworks/dist/ at install time
# (node-linker=hoisted).
echo "[worktree-create] installing root husky..."
(cd "$worktree_path" && pnpm install)

echo "[worktree-create] building cardworks..."
(cd "$worktree_path/cardworks" && pnpm install && pnpm build)

echo "[worktree-create] running pnpm install in callback-box..."
(cd "$worktree_path/callback-box" && pnpm install)

echo "[worktree-create] running pnpm install in callback-box/src/frontend..."
(cd "$worktree_path/callback-box/src/frontend" && pnpm install)

echo "[worktree-create] running pnpm install in browse..."
(cd "$worktree_path/browse" && pnpm install)

# 4. Write .claude/settings.local.json so the agent's shell sees the worktree's
# own cb on PATH. Per-worktree because each worktree has its own absolute
# callback-box/bin path. Claude Code's env block doesn't substitute ${PATH},
# so we have to expand it at write time. settings.local.json is gitignored.
echo "[worktree-create] writing .claude/settings.local.json with PATH override..."
mkdir -p "$worktree_path/.claude"
cat > "$worktree_path/.claude/settings.local.json" <<EOF
{
  "env": {
    "PATH": "$worktree_path/callback-box/bin:$PATH"
  }
}
EOF

# 5. Refresh box hooks: the cloned box's .git/hooks/pre-commit and
# .claude/settings.json have the source box's cb path baked in (often the
# pre-migration ~/src/callback path). Re-run cb init against the cloned
# box from the WORKTREE's cb so its hooks point at the worktree's cb.
# Idempotent (cb init is "initialize or update").
if [ -d "$BOX_DEST" ]; then
  echo "[worktree-create] refreshing box hooks (worktree's cb -> $BOX_DEST)..."
  "$worktree_path/callback-box/bin/cb" init "$BOX_DEST" >/dev/null
fi

echo "[worktree-create] done. open http://localhost:3210/$NAME/ when the router is running"

# Required: print the worktree path on stdout so Claude Code uses it.
printf '%s\n' "$worktree_path" >&3
