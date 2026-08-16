#!/usr/bin/env bash
# Exhibit store lifecycle. SOURCE this file; don't execute it.
#
# The store is the third persistence class (docs/plans/workstream-exhibits.md,
# Track A): per-workstream directories at WT_EXHIBITS_ROOT/<name>, OUTSIDE
# git and OUTSIDE every worktree, mounted into each checkout as a gitignored
# symlink at <checkout>/exhibits. Deleting a worktree therefore only ever
# deletes a symlink — the private-issues topology, minus the git repo.
#
# Callers must have sourced worktree-paths.sh and run wt_paths_init (every
# current caller already does). All functions log to stderr and never print
# to stdout — wt_create's stdout is a contract (one line, the path).
#
# Marker discipline (same posture as bin/private-issues pi_repo_valid): the
# store root must carry .workstream-exhibits before anything symlinks to or
# writes under it. A same-named unrelated directory is refused, not adopted.

EXHIBITS_MARKER=".workstream-exhibits"

wt_exhibits_say() { echo "[exhibits-store] $*" >&2; }

# wt_exhibits_ensure_root — create WT_EXHIBITS_ROOT with its marker, or
# validate an existing one. Refuses (non-zero) an unmarked existing directory.
wt_exhibits_ensure_root() {
  if [ -z "${WT_EXHIBITS_ROOT:-}" ]; then
    wt_exhibits_say "FATAL: WT_EXHIBITS_ROOT unset (wt_paths_init not run?)"
    return 1
  fi
  if [ -e "$WT_EXHIBITS_ROOT" ]; then
    if [ ! -f "$WT_EXHIBITS_ROOT/$EXHIBITS_MARKER" ]; then
      wt_exhibits_say "REFUSING: $WT_EXHIBITS_ROOT exists without $EXHIBITS_MARKER — not adopting an unrelated directory"
      return 1
    fi
    return 0
  fi
  mkdir -p "$WT_EXHIBITS_ROOT" || return 1
  : > "$WT_EXHIBITS_ROOT/$EXHIBITS_MARKER" || return 1
  wt_exhibits_say "created store root $WT_EXHIBITS_ROOT"
}

# wt_exhibits_rescue <worktree_path> <name>
#
# <worktree_path>/exhibits is a REAL directory (a failed mount followed by
# something writing into the tree). Move its entries into the store so a
# later trash-mv of the tree cannot take exhibit content with it, then remove
# the emptied directory. Fails closed: any entry that cannot move refuses the
# whole rescue (the caller must then refuse its own destructive step).
wt_exhibits_rescue() {
  local worktree_path="$1" name="$2" mount_path entry dest
  mount_path="$worktree_path/exhibits"
  [ -d "$mount_path" ] && [ ! -L "$mount_path" ] || return 0
  wt_exhibits_ensure_root || return 1
  dest="$WT_EXHIBITS_ROOT/$name"
  mkdir -p "$dest" || return 1
  for entry in "$mount_path"/* "$mount_path"/.[!.]*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    if [ -e "$dest/$(basename "$entry")" ]; then
      wt_exhibits_say "REFUSING rescue: $dest/$(basename "$entry") already exists"
      return 1
    fi
    mv "$entry" "$dest/" || { wt_exhibits_say "REFUSING rescue: mv failed for $entry"; return 1; }
  done
  rmdir "$mount_path" || return 1
  wt_exhibits_say "rescued real exhibits/ contents into $dest"
}

# wt_exhibits_mount <worktree_path> <name>
#
# Ensure the store dir for <name> exists and <worktree_path>/exhibits is a
# symlink to it. Self-heals: an existing symlink is repointed, a real
# directory is rescued first. Runs on both fresh-create and resume.
wt_exhibits_mount() {
  local worktree_path="$1" name="$2" mount_path store_dir
  case "$name" in
    apps)
      # Reserved: /apps/<name> URLs and the store/apps data namespace belong
      # to committed apps (plan Track C); a workstream named "apps" would
      # collide with both.
      wt_exhibits_say "REFUSING: 'apps' is a reserved store namespace"
      return 1
      ;;
  esac
  wt_exhibits_ensure_root || return 1
  store_dir="$WT_EXHIBITS_ROOT/$name"
  mkdir -p "$store_dir" || return 1
  mount_path="$worktree_path/exhibits"
  if [ -d "$mount_path" ] && [ ! -L "$mount_path" ]; then
    wt_exhibits_rescue "$worktree_path" "$name" || return 1
  fi
  ln -sfn "$store_dir" "$mount_path" || return 1
  wt_exhibits_say "mounted $mount_path -> $store_dir"
}
