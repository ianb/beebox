#!/usr/bin/env bash
# Rebuild this checkout's `dist/cli.mjs` when the CLI bundle's sources land.
#
# Invoked by the monorepo root post-commit / post-merge hooks, in EVERY
# checkout — not just main. The bundle is per-checkout dev state: the deploy
# builds its own copy inside `.deploy-checkout` and never touches this one, so
# a worktree's dev server is as entitled to a fresh bundle as main's.
#
# ## Why the hook, when `bin/cb` already self-heals
#
# Every `cb` invocation in a dev checkout rebuilds a stale bundle
# (`callback-box/bin/cb`), and a running box child polls the bundle's stat
# identity once a second and re-execs when it changes
# (`src/webapp/server.ts`, `src/lib/dev-bundle-reload.ts`). Those two halves
# never met: the poll had no producer. Nothing wrote a new bundle on its own,
# so the only thing that closed the loop was somebody happening to run `cb` (or
# `pnpm test`) for an unrelated reason. Until then the box child kept serving
# code from before the merge while the app looked entirely normal — which is
# how a landed-and-deployed fix reads as "the fix didn't work".
#
# This is the producer. The existing drain → exit 75 → supervisor relaunch
# chain does the rest, so a merge now reaches the running server on its own.
#
# ## Why it gates on paths rather than just always building
#
# The build is ~250ms, but rewriting the bundle changes its stat identity, and
# every box child in the checkout then drains and re-execs. A docs-only merge
# must not cycle live servers. So: rebuild only when an actual bundle input
# moved.
#
# Usage:
#   auto-build-cli.sh                     # diff just the tip commit (HEAD)   — post-commit
#   auto-build-cli.sh <from> <to>         # diff a range, e.g. ORIG_HEAD HEAD — post-merge
#   auto-build-cli.sh <from> WORKTREE     # a squash merge, which changes the
#                                         # index and worktree without moving
#                                         # HEAD (same convention as
#                                         # bin/post-merge-install.sh)

set -e

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# What `scripts/build-cli.ts` actually bundles, as two pathspec groups.
#
# Two rather than one because a git pathspec cannot re-include a subdirectory
# of an excluded path — exclusions are applied after every include, so
# `src ':(exclude)src/frontend' src/frontend/.../view-widgets` silently drops
# the view-widgets entry. Asked as two questions, both get answered.
#
# Group 1 is the backend, minus `src/frontend` (Vite hot-reloads the app) —
# the same shape as `bin/cb`'s staleness scan and the router's backend-source
# token. Group 2 is the one part of the frontend that IS a bundle input: the
# view-widgets node entry build-cli.ts compiles into `dist/view-widgets/` for
# `cb view` and for external boxes.
BACKEND=(
  callback-box/src
  ':(exclude)callback-box/src/frontend'
  callback-box/package.json
  callback-box/scripts/build-cli.ts
)
VIEW_WIDGETS=(callback-box/src/frontend/src/components/view-widgets)

changed_in() {
  if [ "${2:-}" = "WORKTREE" ]; then
    git -C "$REPO_DIR" diff --name-only "$1" -- "${@:3}" 2>/dev/null || true
  elif [ -n "$1" ] && [ -n "${2:-}" ]; then
    git -C "$REPO_DIR" diff --name-only "$1" "$2" -- "${@:3}" 2>/dev/null || true
  else
    git -C "$REPO_DIR" diff-tree --no-commit-id --name-only -r HEAD -- "${@:3}" 2>/dev/null || true
  fi
}

changed=$(
  changed_in "${1:-}" "${2:-}" "${BACKEND[@]}"
  changed_in "${1:-}" "${2:-}" "${VIEW_WIDGETS[@]}"
)

[ -z "$changed" ] && exit 0

# Foreground, unlike the clerk build and the deploy: it is a quarter of a
# second, and a backgrounded build racing the box child's one-second poll would
# offer it a half-written bundle to re-exec on.
echo "[cli-build] callback-box CLI sources changed; rebuilding dist/cli.mjs..."
( cd "$REPO_DIR/callback-box" && node scripts/build-cli.ts >/dev/null )
echo "[cli-build] Rebuilt — running box children reload themselves within ~1s (once their chats go idle)."
