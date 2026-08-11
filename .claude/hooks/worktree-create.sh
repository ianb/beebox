#!/usr/bin/env bash
# Claude Code WorktreeCreate hook — an ADAPTER, not the implementation.
#
# The worktree logic itself lives in `bin/workstreams create`
# (bin/lib/worktree-create.sh). It used to live here, which made repo-wide logic
# look like Claude Code's property: `bin/launch-worktree-session --agent codex`
# had to synthesize hook JSON and pipe it into this file to reach it. Now every
# frontend calls the CLI and this file only translates the hook's calling
# convention into CLI arguments.
#
# Stdin: JSON with at least one of { name, worktree_path, base_ref }.
# Stdout: the final worktree path (required for Claude Code to use it).
# Stderr: all log output.
# Non-zero exit aborts worktree creation.

set -euo pipefail

input=$(cat)
mkdir -p "$HOME/.cache/callback-box"
printf '%s\n' "$input" > "$HOME/.cache/callback-box/last-worktree-create-input.json"

name=$(printf '%s' "$input" | jq -r '.name // .worktree_name // empty')
requested_path=$(printf '%s' "$input" | jq -r '.worktree_path // .worktreePath // .path // empty')
base_ref=$(printf '%s' "$input" | jq -r '.base_ref // .baseRef // "main"')

if [ -z "$name" ] && [ -n "$requested_path" ]; then
  name=$(basename "$requested_path")
fi
if [ -z "$name" ]; then
  echo "[worktree-create] FATAL: stdin lacks worktree_path/worktreePath/path/name. Raw input:" >&2
  printf '%s\n' "$input" >&2
  exit 1
fi

# Resolve the CLI from the checkout this hook lives in. Failing loudly matters:
# a silent fallback to some other copy of the logic is how two implementations
# start to coexist, which is the exact thing this adapter exists to prevent.
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cli="$repo/bin/workstreams"
if [ ! -x "$cli" ]; then
  echo "[worktree-create] FATAL: no executable $cli — cannot create a worktree" >&2
  exit 1
fi

# NOTE: --path is deliberately NOT forwarded. Claude Code proposes
# <repo>/.claude/worktrees/<name>, and the whole point of this hook is to
# override that (callback-box's file:../personal-vibe-check dep only resolves
# when the worktree is a sibling of the monorepo). `bin/workstreams create`
# chooses the location; we accept it.
exec "$cli" create "$name" --base-ref "$base_ref"
