#!/usr/bin/env bash
# Claude Code WorktreeRemove hook.
#
# Companion to worktree-create.sh. Removes the per-worktree box tree at
# ~/src/box-worktrees/<name>/ (which contains test1/ inside it).
# Claude Code handles git worktree removal itself; we only clean up the
# sibling box.
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
mkdir -p "$HOME/.cache/callback-box"
printf '%s\n' "$input" > "$HOME/.cache/callback-box/last-worktree-remove-input.json"

# Shared append-only lifecycle log (see session-end.sh for rationale).
WORKTREE_LOG="$HOME/.cache/callback-box/worktree-cleanup.log"
wlog() { printf '%s pid=%s WorktreeRemove %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$*" >> "$WORKTREE_LOG" 2>/dev/null || true; }

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

BOX_DEST="$HOME/src/box-worktrees/$NAME"
ROUTER_PORT="${ROUTER_PORT:-3210}"
echo "[worktree-remove] name=$NAME"
wlog "event: name=$NAME name_in='$name_from_input' path_in='$path_from_input'"

# Private-issues shadow worktree: remove iff merged + strictly clean, else
# preserve as an orphan (it lives outside this worktree — Claude Code's
# removal only deletes the mount symlink — and every sweep re-reports it).
# Claude Code's own clean-check is blind to the private repo, which is why
# this can't refuse; with the symlink topology it doesn't need to. Runs
# before the worktree dir disappears; harmless if it already has (the CLI
# fails closed and we || true it — this hook is non-blocking).
WT_PATH="${path_from_input:-$HOME/src/callback-worktrees/$NAME}"
PI_CLI="$WT_PATH/bin/private-issues"
[ -x "$PI_CLI" ] || PI_CLI="$HOME/src/callback-box/bin/private-issues" # worktree predates the CLI
if [ -x "$PI_CLI" ]; then
  pi_result=$("$PI_CLI" remove-if-safe "$WT_PATH" 2>/dev/null || echo "error")
  echo "[worktree-remove] private-issues: $pi_result"
  wlog "private-issues result=$pi_result name=$NAME"
fi

# Tell the dev router to stop this worktree's processes immediately (rather
# than waiting for its idle timeout). Best-effort — if the router isn't
# running, the call just fails and we move on.
if curl -fsS -X POST -m 5 "http://127.0.0.1:$ROUTER_PORT/__router/stop/$NAME" >/dev/null 2>&1; then
  echo "[worktree-remove] told router to stop $NAME"
fi

if [ -d "$BOX_DEST" ]; then
  # Rename-then-background-delete: boxes run 100MB+; a synchronous rm here
  # risks the hook timeout killing us mid-delete (see session-end.sh).
  TRASH="$HOME/.cache/callback-box/trash"
  mkdir -p "$TRASH"
  echo "[worktree-remove] trashing box $BOX_DEST"
  mv "$BOX_DEST" "$TRASH/box-$NAME-$(date +%s)"
  # git-annex locks its object tree read-only. Make it writable in the
  # detached cleanup before removing it, or macOS leaves annex remnants.
  nohup sh -c 'chmod -R u+w "$1" 2>/dev/null || true; rm -rf "$1"' sh "$TRASH" >/dev/null 2>&1 &
  disown 2>/dev/null || true
else
  echo "[worktree-remove] no box at $BOX_DEST (already gone)"
fi

# Per-worktree agent-browser state (Chrome profile, daemon socket dir).
# Can grow to hundreds of MB once the browser has been used.
BROWSE_DIR="$HOME/.cache/callback-box/browse/$NAME"
if [ -d "$BROWSE_DIR" ]; then
  echo "[worktree-remove] removing browse state $BROWSE_DIR"
  rm -rf "$BROWSE_DIR"
fi

# Router log + PID file. These survive `bin/worktrees panic` and similar
# cleanups since neither targets cache state directly.
LOG_FILE="$HOME/.cache/callback-box/logs/$NAME.log"
PID_FILE="$HOME/.cache/callback-box/pids/$NAME.json"
[ -f "$LOG_FILE" ] && rm -f "$LOG_FILE" && echo "[worktree-remove] removed $LOG_FILE"
[ -f "$PID_FILE" ] && rm -f "$PID_FILE" && echo "[worktree-remove] removed $PID_FILE"
