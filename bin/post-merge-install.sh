#!/usr/bin/env bash
# Synchronize this checkout's dependencies when a merge changes the lockfile.
set -uo pipefail

repo_dir="${1:?usage: post-merge-install.sh <repo-dir> [old-ref] [new-ref]}"
old_ref="${2:-ORIG_HEAD}"
new_ref="${3:-HEAD}"

if [ "$new_ref" = "WORKTREE" ]; then
  git -C "$repo_dir" diff --quiet "$old_ref" -- pnpm-lock.yaml 2>/dev/null
else
  git -C "$repo_dir" diff --quiet "$old_ref" "$new_ref" -- pnpm-lock.yaml 2>/dev/null
fi
diff_status=$?
if [ "$diff_status" -eq 0 ]; then
  exit 0
fi
if [ "$diff_status" -ne 1 ]; then
  echo "[post-merge] ⚠ Could not compare pnpm-lock.yaml; synchronizing dependencies conservatively." >&2
else
  echo "[post-merge] pnpm-lock.yaml changed; synchronizing this checkout..."
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[post-merge] ⚠ pnpm is not available; install pnpm, then run pnpm install in this checkout." >&2
  exit 1
fi
if (cd "$repo_dir" && pnpm install --frozen-lockfile); then
  echo "[post-merge] Dependencies synchronized."
  exit 0
fi

echo "[post-merge] ⚠ pnpm install failed; the merge completed, but local commands may fail. Run pnpm install in this checkout after fixing the reported error." >&2
exit 1
