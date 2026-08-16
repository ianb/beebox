#!/usr/bin/env bash
# Shared worktree location derivation. SOURCE this file; don't execute it.
#
#   . "<repo>/bin/lib/worktree-paths.sh"
#
# Every piece of worktree tooling needs the same five locations, and until this
# file they each hardcoded `$HOME/src/...` (the WorktreeCreate/Remove hooks,
# session-end, auto-sweep, `bin/workstreams sweep`). A developer whose checkout
# lives anywhere else got worktrees that silently missed every lifecycle hook.
# See issues/code-quality/2026-08-01-derive-public-worktree-paths.md.
#
# Sets:
#   WT_MONO       the MAIN checkout (never a linked worktree)
#   WT_PARENT     the directory the main checkout sits in
#   WT_ROOT       where worktrees are created
#   WT_BOX_ROOT   where each worktree's box clone is created
#   WT_BOX_SRC    the source box cloned into each new worktree
#   WT_EXHIBITS_ROOT  per-workstream exhibit stores (exhibits-store.sh)
#   WT_STATE_DIR  router/agent cache + state
#
# WHAT IS DERIVED AND WHAT IS CONVENTION. The *parent* is derived — resolved
# through `git rev-parse --git-common-dir`, so a copy of this file inside a
# linked worktree still resolves the main checkout. The *basenames* under it
# (`callback-worktrees`, `box-worktrees`, `boxes`) are convention, because
# nothing in git knows them: the main checkout is `callback-box` but its
# worktrees live in `callback-worktrees`, which is not derivable from anything.
# This is the same split `bin/private-issues` makes. Each is env-overridable for
# a developer who wants a different layout, and for isolated testing.
#
# FAILS CLOSED. If the main checkout cannot be resolved, this refuses rather
# than falling back to `$HOME/src/callback-box`. A wrong-but-plausible root is
# the exact harm the issue above describes — lifecycle hooks operating on a tree
# that isn't the one in play — and it is invisible when it happens.

WT_STATE_DIR="${CALLBACK_STATE_DIR:-$HOME/.cache/callback-box}"

# wt_paths_init [<path-inside-a-checkout>]
#
# Resolves every location above. With no argument, anchors on this file's own
# location, which is inside whichever checkout sourced it — correct for a hook,
# a worktree's copy, and the main checkout alike. Pass an explicit path when the
# caller knows which checkout it means (the launcher, teardown from a temp cwd).
#
# Returns non-zero and prints to stderr when the checkout can't be resolved.
wt_paths_init() {
  local anchor="${1:-}"
  if [ -z "$anchor" ]; then
    anchor=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd || true)
  fi
  if [ -z "$anchor" ]; then
    echo "worktree-paths: cannot resolve an anchor directory" >&2
    return 1
  fi

  # --git-common-dir is the point of this: from a LINKED worktree it names the
  # main checkout's .git, where a plain --show-toplevel would name the worktree.
  local common
  common=$(git -C "$anchor" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  if [ -z "$common" ]; then
    echo "worktree-paths: '$anchor' is not inside a git checkout — refusing to guess a monorepo root" >&2
    return 1
  fi
  WT_MONO=$(dirname "$common")

  # A checkout without callback-box/ is not this monorepo. Refusing here turns a
  # would-be silent wrong-tree operation into an error at the first call.
  if [ ! -d "$WT_MONO/callback-box" ]; then
    echo "worktree-paths: resolved monorepo '$WT_MONO' has no callback-box/ — refusing" >&2
    return 1
  fi

  WT_PARENT=$(dirname "$WT_MONO")
  WT_ROOT="${CALLBACK_WORKTREE_ROOT:-$WT_PARENT/callback-worktrees}"
  WT_BOX_ROOT="${CALLBACK_BOX_ROOT:-$WT_PARENT/box-worktrees}"
  WT_BOX_SRC="${CALLBACK_BOX_SRC:-$WT_PARENT/boxes/test1}"
  WT_EXHIBITS_ROOT="${CALLBACK_EXHIBITS_ROOT:-$WT_PARENT/workstream-exhibits}"

  # The roots feed paths that get deleted, so an override must not be able to
  # aim them at data that is not a worktree's to lose. The source box is the
  # one that would hurt: `CALLBACK_BOX_ROOT=<dir holding the real boxes>` plus a
  # worktree whose name matches a real box makes teardown trash that box.
  case "$WT_BOX_SRC" in
    "$WT_BOX_ROOT"|"$WT_BOX_ROOT"/*)
      echo "worktree-paths: box root '$WT_BOX_ROOT' contains the source box '$WT_BOX_SRC' — refusing" >&2
      return 1 ;;
  esac
  case "$WT_MONO" in
    "$WT_ROOT"|"$WT_ROOT"/*)
      echo "worktree-paths: worktree root '$WT_ROOT' contains the main checkout '$WT_MONO' — refusing" >&2
      return 1 ;;
  esac
  return 0
}

# wt_paths_valid_name <name>
#
# A worktree name is a single path segment, matching what
# bin/launch-worktree-session accepts. EVERY caller that turns a name into a
# path must check this first: `<root>/$name` with an unchecked name is a path
# traversal into a destructive command — `remove ../boxes/test1` resolves
# outside WT_ROOT entirely, passes an `-d` existence check, and trashes whatever
# is there.
wt_paths_valid_name() {
  case "$1" in
    ""|*/*|.|..) return 1 ;;
  esac
  [[ "$1" =~ ^[a-zA-Z0-9_-]+$ ]]
}
