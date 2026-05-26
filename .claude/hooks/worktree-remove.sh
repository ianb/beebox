#!/usr/bin/env bash
# Claude Code WorktreeRemove hook.
#
# Companion to worktree-create.sh. Removes the cloned test box at
# ~/src/box-worktrees/test1-<name>/. Claude Code handles git worktree removal
# itself; we only clean up the sibling box.
#
# Stdin: JSON with at least one of { name, worktree_path }. Claude Code 2.1
# sends { name, session_id, cwd, hook_event_name } — the docs at
# code.claude.com/docs/en/hooks list worktree_path/worktreePath; we accept
# either to be schema-tolerant across versions.
#
# Failures are non-blocking; exit code is logged in debug mode only.

set -euo pipefail
exec 1>&2  # everything to stderr; no stdout expected

input=$(cat)
mkdir -p "$HOME/.cache/callback-mono"
printf '%s\n' "$input" > "$HOME/.cache/callback-mono/last-worktree-remove-input.json"

name_from_input=$(printf '%s' "$input" | jq -r '.name // .worktree_name // empty')
path_from_input=$(printf '%s' "$input" | jq -r '.worktree_path // .worktreePath // .path // empty')

if [ -n "$name_from_input" ]; then
  NAME="$name_from_input"
elif [ -n "$path_from_input" ]; then
  NAME=$(basename "$path_from_input")
else
  echo "[worktree-remove] no name/path in input; nothing to do." >&2
  exit 0
fi

BOX_DEST="$HOME/src/box-worktrees/test1-$NAME"
ROUTER_PORT="${ROUTER_PORT:-3210}"
echo "[worktree-remove] name=$NAME"

# Tell the dev router to stop this worktree's processes immediately (rather
# than waiting for its idle timeout). Best-effort — if the router isn't
# running, the call just fails and we move on.
if curl -fsS -m 5 "http://127.0.0.1:$ROUTER_PORT/__router/stop/$NAME" >/dev/null 2>&1; then
  echo "[worktree-remove] told router to stop $NAME"
fi

if [ -d "$BOX_DEST" ]; then
  echo "[worktree-remove] removing box $BOX_DEST"
  rm -rf "$BOX_DEST"
else
  echo "[worktree-remove] no box at $BOX_DEST (already gone)"
fi

# Per-worktree agent-browser state (Chrome profile, daemon socket dir).
# Can grow to hundreds of MB once the browser has been used.
BROWSE_DIR="$HOME/.cache/callback-mono/browse/$NAME"
if [ -d "$BROWSE_DIR" ]; then
  echo "[worktree-remove] removing browse state $BROWSE_DIR"
  rm -rf "$BROWSE_DIR"
fi
