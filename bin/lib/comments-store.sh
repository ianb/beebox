#!/usr/bin/env bash
# Document-comment store mount. SOURCE this file; don't execute it.
#
# The store holds what the boxholder said about a document, waiting for an
# agent to read it (docs/plans/document-comments.md). It lives at
# WT_COMMENTS_ROOT — outside git and outside every worktree — and is mounted
# into each checkout as a gitignored symlink at <checkout>/comments, so an
# agent can `cat comments/tracked/<path>.comments.yaml` from anywhere without
# knowing where the store is.
#
# TWO DIFFERENCES FROM exhibits-store.sh, whose shape this otherwise copies:
#
#  1. The store is NOT per-workstream. A comment belongs to a document, not to
#     a workstream, so every checkout mounts the same root and the namespaces
#     inside it (tracked/, worktree/<name>/) do the separating. There is no
#     per-name directory to create.
#
#  2. Nothing ever writes THROUGH the mount. bin/comments and the app both
#     derive the store root themselves (fail-closed), exactly as bin/exhibits
#     does, so a broken or missing mount costs a read convenience and never a
#     comment. That is why there is no rescue path here: content cannot end up
#     in a real <checkout>/comments directory by any route this repo owns.
#
# Callers must have sourced worktree-paths.sh and run wt_paths_init. All
# functions log to stderr and never print to stdout — wt_create's stdout is a
# contract (one line, the path).
#
# Marker discipline matches the exhibits store: the root must carry
# .dev-comments before anything symlinks to it, so a same-named unrelated
# directory is refused rather than adopted. bin/lib/comments-store.ts writes
# the same marker; the two must agree.

COMMENTS_MARKER=".dev-comments"

wt_comments_say() { echo "[comments-store] $*" >&2; }

# wt_comments_ensure_root — create WT_COMMENTS_ROOT with its marker, or
# validate an existing one. Refuses (non-zero) an unmarked existing directory.
wt_comments_ensure_root() {
  if [ -z "${WT_COMMENTS_ROOT:-}" ]; then
    wt_comments_say "FATAL: WT_COMMENTS_ROOT unset (wt_paths_init not run?)"
    return 1
  fi
  if [ -e "$WT_COMMENTS_ROOT" ]; then
    if [ ! -f "$WT_COMMENTS_ROOT/$COMMENTS_MARKER" ]; then
      wt_comments_say "REFUSING: $WT_COMMENTS_ROOT exists without $COMMENTS_MARKER — not adopting an unrelated directory"
      return 1
    fi
    return 0
  fi
  mkdir -p "$WT_COMMENTS_ROOT" || return 1
  # The TS side writes the store version here; a bare marker is enough for the
  # mount, and comments-store.ts rewrites it on its own initStore.
  : > "$WT_COMMENTS_ROOT/$COMMENTS_MARKER" || return 1
  wt_comments_say "created store root $WT_COMMENTS_ROOT"
}

# wt_comments_mount <worktree_path>
#
# Ensure <worktree_path>/comments is a symlink to the store root. Self-heals a
# stale symlink by repointing it. Runs on both fresh-create and resume.
#
# A REAL directory at the mount point is refused rather than replaced or
# rescued: nothing in this repo writes through the mount, so a real directory
# means something outside it put files there, and silently deleting or moving
# them is not this function's call to make. The mount is best-effort at every
# call site, so refusing costs a read convenience and nothing else.
wt_comments_mount() {
  local worktree_path="$1" mount_path
  wt_comments_ensure_root || return 1
  mount_path="$worktree_path/comments"
  if [ -e "$mount_path" ] && [ ! -L "$mount_path" ]; then
    wt_comments_say "REFUSING: $mount_path exists and is not a symlink — leaving it alone"
    return 1
  fi
  ln -sfn "$WT_COMMENTS_ROOT" "$mount_path" || return 1
  wt_comments_say "mounted $mount_path -> $WT_COMMENTS_ROOT"
}
