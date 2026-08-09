#!/usr/bin/env bash
# Claude Code WorktreeRemove hook — an ADAPTER over the shared teardown lib.
#
# Claude Code removes the git worktree itself here; this hook only cleans up
# what the worktree owns OUTSIDE its own directory — the box clone, the router's
# processes for it, and the browse/log/pid cache state. That is exactly
# `wt_remove_satellites` in bin/lib/worktree-teardown.sh, which this file used to
# carry its own copy of.
#
# It deliberately does NOT call `bin/workstreams remove`: that removes the git
# worktree and deletes the branch, and here Claude Code owns the worktree
# removal and the branch may still hold unmerged commits.
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

name_from_input=$(printf '%s' "$input" | jq -r '.name // .worktree_name // empty')
path_from_input=$(printf '%s' "$input" | jq -r '.worktree_path // .worktreePath // .path // empty')

if [ -n "$name_from_input" ]; then
  NAME="$name_from_input"
elif [ -n "$path_from_input" ]; then
  NAME=$(basename "$path_from_input")
else
  echo "[worktree-remove] no name/path in input; nothing to do."
  exit 0
fi

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck source=../../bin/lib/worktree-teardown.sh
. "$repo/bin/lib/worktree-teardown.sh"
WT_LOG_LABEL="WorktreeRemove"
WT_SAY_PREFIX="[worktree-remove] "

echo "[worktree-remove] name=$NAME"
wt_log "event: name=$NAME name_in='$name_from_input' path_in='$path_from_input'"

# Private-issues shadow worktree. Runs BEFORE the worktree dir disappears;
# harmless if it already has (the CLI fails closed and this never blocks).
# Claude Code's own clean-check is blind to the private repo, which is why this
# can't refuse; with the symlink topology it doesn't need to — Claude Code's
# removal only deletes the mount symlink.
WT_PATH="${path_from_input:-$WT_ROOT/$NAME}"
wt_remove_private_issues "$WT_PATH"

wt_remove_satellites "$NAME"
wt_trash_reap
