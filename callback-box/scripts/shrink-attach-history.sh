#!/usr/bin/env bash
# Rewrite git history to drop binary attachment blobs that are currently
# gitignored (via the **/*.attach/** patterns added by the manifest migration).
#
# DESTRUCTIVE. Rewrites every commit's tree. Use only after:
#   1. `cb attachments migrate` has written manifests for every binary
#   2. `cb attachments untrack-binaries` has dropped the binaries from the index
#   3. The .gitignore patterns are in place and committed
#   4. The current commit + working tree is clean
#
# After running:
#   - `du -sh .git` should drop from ~9.9G to under 1G
#   - All clones become invalid; existing remotes need a force-push
#   - filter-repo removes the `origin` remote as a safety. The script
#     restores it.
#
# Usage:  scripts/shrink-attach-history.sh <box-root>
#
# Requires `git-filter-repo` (brew install git-filter-repo).

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <box-root>" >&2
  exit 64
fi

BOX_ROOT="$1"
if [[ ! -d "$BOX_ROOT/.git" ]]; then
  echo "Error: $BOX_ROOT is not a git repository" >&2
  exit 65
fi

cd "$BOX_ROOT"

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "Error: git-filter-repo not installed. Try: brew install git-filter-repo" >&2
  exit 69
fi

# Safety: working tree must be clean.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree has uncommitted changes. Commit or stash first." >&2
  exit 1
fi

# Save the origin URL so we can restore it post-filter (filter-repo drops it).
ORIGIN_URL="$(git config --get remote.origin.url 2>/dev/null || true)"

echo "Box: $BOX_ROOT"
echo "Origin to restore: ${ORIGIN_URL:-<none>}"
echo "Before: $(du -sh .git | awk '{print $1}')"
echo

# Binary extensions we want to evict from history. Anything in HEAD with
# these extensions stays; only HISTORICAL references at non-HEAD paths get
# dropped. This is the surgical part: we don't want to lose anything that
# still has a place in the current tree.
EXTENSIONS_RE='\.(jpg|jpeg|png|webp|avif|heic|tif|tiff|gif|webm|mp3|m4a|wav|pdf|mp4|mov)$'

# Compute paths currently in HEAD. Filter-repo's path-callback runs in a
# Python subprocess; we pass the snapshot via a temp file.
HEAD_PATHS_FILE="$(mktemp -t shrink-head-paths)"
trap 'rm -f "$HEAD_PATHS_FILE"' EXIT
git ls-tree -r --name-only HEAD > "$HEAD_PATHS_FILE"
echo "HEAD tracks $(wc -l < "$HEAD_PATHS_FILE" | tr -d ' ') paths."

# The callback: drop the path (return None) iff
#   - extension matches one of our binary types, AND
#   - path is NOT currently tracked at HEAD
# Otherwise return the path unchanged.
#
# filter-repo passes paths as bytes; we work in bytes throughout.
PATH_CALLBACK=$(cat <<PYEOF
import re
ext_re = re.compile(br'$EXTENSIONS_RE', re.IGNORECASE)
with open('$HEAD_PATHS_FILE', 'rb') as fh:
    head_paths = set(line.rstrip(b'\n') for line in fh if line.strip())
return None if (ext_re.search(filename) and filename not in head_paths) else filename
PYEOF
)

echo "Running git filter-repo with filename-callback..."
echo "  (this may take a while; progress goes to stderr)"
echo
git filter-repo --force --filename-callback "$PATH_CALLBACK"

# Restore origin if we had one.
if [[ -n "$ORIGIN_URL" ]]; then
  git remote add origin "$ORIGIN_URL"
  echo
  echo "Restored origin: $ORIGIN_URL"
fi

# Repack to actually reclaim disk. filter-repo does gc as part of its run,
# but a final aggressive gc squeezes the last bits.
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Prune the LFS cache. Binary blobs are stored via Git LFS (see
# .gitattributes); filter-repo only removed the *pointers* from history.
# `git lfs prune` removes LFS objects that are no longer referenced by any
# commit. This is where the actual disk reclaim happens for an LFS box.
if command -v git-lfs >/dev/null 2>&1; then
  echo
  echo "Pruning LFS cache..."
  git lfs prune
fi

echo
echo "After: $(du -sh .git | awk '{print $1}')"
echo
echo "Next steps:"
echo "  1. Verify the working tree looks right: ls, cb validate, etc."
echo "  2. To publish: git push --force origin main"
echo "  3. Any other clones are now invalid and must be re-cloned."
