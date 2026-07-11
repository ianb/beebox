#!/usr/bin/env bash
# Claude Code WorktreeCreate hook.
#
# Replaces the default `git worktree add` with logic that also:
#   - OVERRIDES the worktree location: Claude Code defaults to
#     <repo>/.claude/worktrees/<name>/, but we put it at
#     ~/src/callback-worktrees/<name>/ instead. Reason: callback-box has a
#     file: dep on personal-vibe-check at file:../personal-vibe-check. The
#     relative path only resolves correctly when the worktree is a sibling
#     of the monorepo root (same depth as main checkout).
#   - clones ~/src/boxes/test1 to ~/src/box-worktrees/<name>/test1/
#     (URL slug = basename = "test1" for every worktree, so links like
#     /<wt>/test1/... swap cleanly across worktrees — true whether the clone
#     is a legacy box or a v2 package, see box-entry.ts)
#     (kept outside the monorepo so the box doesn't inherit monorepo CLAUDE.md)
#   - for a v2 (package-layout) clone, points its "callback-box" dependency
#     at THIS worktree's own engine checkout (pnpm.overrides link:) and
#     installs the box's own node_modules — see Track G in
#     docs/implemented-plans/boxes-as-packages-v2.md. Legacy clones are untouched.
#   - runs pnpm install at the worktree root (root husky), callback-box, and
#     callback-box/src/frontend. After this the worktree is ready for the
#     dev router to serve.
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
mkdir -p "$HOME/.cache/callback-box"
printf '%s\n' "$input" > "$HOME/.cache/callback-box/last-worktree-create-input.json"

# Shared append-only lifecycle log (see session-end.sh for rationale) — the
# create end of the lifecycle, so a lingering worktree can be traced back to
# when/how it was made vs. when its session-end fired.
WORKTREE_LOG="$HOME/.cache/callback-box/worktree-cleanup.log"
wlog() { printf '%s pid=%s WorktreeCreate %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$*" >> "$WORKTREE_LOG" 2>/dev/null || true; }

requested_path=$(printf '%s' "$input" | jq -r '.worktree_path // .worktreePath // .path // empty')
base_ref=$(printf '%s'       "$input" | jq -r '.base_ref // .baseRef // "main"')
name_from_input=$(printf '%s' "$input" | jq -r '.name // .worktree_name // empty')

if [ -n "$name_from_input" ]; then
  NAME="$name_from_input"
elif [ -n "$requested_path" ]; then
  NAME=$(basename "$requested_path")
else
  echo "[worktree-create] FATAL: stdin lacks worktree_path/worktreePath/path/name. Raw input:" >&2
  cat "$HOME/.cache/callback-box/last-worktree-create-input.json" >&2
  exit 1
fi

new_branch="worktree-$NAME"
worktree_path="$HOME/src/callback-worktrees/$NAME"
BOX_SRC="$HOME/src/boxes/test1"
BOX_DEST="$HOME/src/box-worktrees/$NAME/test1"

echo "[worktree-create] name=$NAME base=$base_ref path=$worktree_path"
wlog "event: name=$NAME base=$base_ref path=$worktree_path"

# 1. Create (or re-attach to) the worktree.
mkdir -p "$(dirname "$worktree_path")"
if git worktree list --porcelain | grep -qxF "worktree $worktree_path"; then
  echo "[worktree-create] worktree already registered at $worktree_path — resume, skipping setup"
  wlog "resume: existing worktree reused name=$NAME"
  printf '%s\n' "$worktree_path" >&3
  exit 0
elif git show-ref --verify --quiet "refs/heads/$new_branch"; then
  echo "[worktree-create] branch $new_branch already exists — attaching without -b"
  git worktree add "$worktree_path" "$new_branch"
else
  git worktree add -b "$new_branch" "$worktree_path" "$base_ref"
fi

# 2. Clone the test box if it doesn't already exist (idempotent).
#
# BOX_DEST is either a legacy box (content lives at its root) or a v2
# package (content lives at BOX_DEST/content — see "The box repository" in
# docs/implemented-plans/boxes-as-packages-v2.md). Either way its basename stays
# "test1", so the URL slug matches across worktrees (bin/box-entry.ts
# derives the v2 slug from the PACKAGE root's basename for exactly this
# reason — confirmed against this clone layout).
mkdir -p "$(dirname "$BOX_DEST")"
if [ ! -d "$BOX_DEST" ]; then
  if [ -d "$BOX_SRC" ]; then
    echo "[worktree-create] cloning $BOX_SRC -> $BOX_DEST"
    git clone --quiet "$BOX_SRC" "$BOX_DEST"

    box_content_dir="$BOX_DEST"
    [ -d "$BOX_DEST/content" ] && box_content_dir="$BOX_DEST/content"

    # Carry over gitignored connector secrets (deepgram, gmail, google,
    # dropbox, etc.). The source box gitignores config/connectors/*.secret.*
    # so git clone leaves them behind, breaking transcription and external
    # syncs in the worktree until the user manually copies them. config/
    # lives under content/ for a v2 box, at the root for legacy.
    box_src_content_dir="$BOX_SRC"
    [ -d "$BOX_SRC/content" ] && box_src_content_dir="$BOX_SRC/content"
    if [ -d "$box_src_content_dir/config/connectors" ]; then
      mkdir -p "$box_content_dir/config/connectors"
      copied=0
      for f in "$box_src_content_dir"/config/connectors/*.secret.*; do
        [ -e "$f" ] || continue
        cp "$f" "$box_content_dir/config/connectors/"
        copied=$((copied + 1))
      done
      if [ "$copied" -gt 0 ]; then
        echo "[worktree-create] copied $copied connector secret(s) from source box"
      fi
    fi

    # v2 (package-layout) box: redirect its "callback-box" dependency at
    # THIS worktree's own callback-box checkout via a pnpm.overrides
    # `link:` entry — a live symlink that never installs the target's own
    # deps, revertible without touching `dependencies` (see "Prior art" /
    # Track G in docs/implemented-plans/boxes-as-packages-v2.md). Without this the
    # clone would resolve callback-box from whatever the box's lockfile
    # pins — never this worktree's in-progress engine code, defeating the
    # whole point of a worktree. Legacy clones have no package.json here
    # and are left untouched.
    if [ -f "$BOX_DEST/package.json" ] && jq -e '(.dependencies["callback-box"] // .devDependencies["callback-box"]) != null' "$BOX_DEST/package.json" >/dev/null; then
      echo "[worktree-create] v2 box detected — pointing callback-box at $worktree_path/callback-box"
      tmp_pkg=$(mktemp)
      jq --arg link "link:$worktree_path/callback-box" '.pnpm.overrides["callback-box"] = $link' \
        "$BOX_DEST/package.json" > "$tmp_pkg"
      mv "$tmp_pkg" "$BOX_DEST/package.json"
      echo "[worktree-create] running pnpm install in $BOX_DEST..."
      (cd "$BOX_DEST" && pnpm install)
    fi
  else
    echo "[worktree-create] warning: $BOX_SRC not found; router will fall back to defaults"
  fi
else
  echo "[worktree-create] reusing existing box $BOX_DEST"
fi

# 3. pnpm install. ONE workspace install at the root — never per-subpackage.
# Under pnpm workspaces with node-linker=hoisted, running `pnpm install`
# inside a subpackage walks up to the workspace root anyway, but in
# practice it also seems to wipe the root lockfile in some cases, leaving
# the worktree with node_modules/ populated but node_modules/.bin/ empty
# (which then breaks bin/browse, bin/cb, etc.). Same shape as what
# deploy/deploy.sh does on the server.
echo "[worktree-create] running pnpm install (workspace-wide)..."
(cd "$worktree_path" && pnpm install)

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
