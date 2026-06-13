#!/usr/bin/env bash
# Rebuild the callback-clerk extension when its sources land on main.
#
# Invoked by the monorepo root post-commit / post-merge hooks (which gate
# on branch == main). Only rebuilds when files under callback-clerk/
# actually changed in the relevant commit range — most main updates touch
# only callback-box, and rebuilding the extension for those is pointless.
# Runs the build in the background, logging to callback-clerk/.last-build.log,
# so it never blocks or spams the committing shell (same pattern as deploy.sh).
#
# Usage:
#   auto-build.sh                 # diff just the tip commit (HEAD)        — post-commit
#   auto-build.sh <from> <to>     # diff a range, e.g. ORIG_HEAD HEAD      — post-merge

set -e

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

if [ -n "$1" ] && [ -n "$2" ]; then
  changed=$(git -C "$REPO_DIR" diff --name-only "$1" "$2" -- callback-clerk/ 2>/dev/null || true)
else
  changed=$(git -C "$REPO_DIR" diff-tree --no-commit-id --name-only -r HEAD -- callback-clerk/ 2>/dev/null || true)
fi

[ -z "$changed" ] && exit 0

echo "[clerk-build] callback-clerk changed; rebuilding extension..."
( cd "$REPO_DIR/callback-clerk" && pnpm build ) &>"$REPO_DIR/callback-clerk/.last-build.log" &
disown
echo "[clerk-build] Build started in background (log: callback-clerk/.last-build.log)"
