#!/usr/bin/env bash

# Codex plugin hooks do not inherit a package manager's node_modules/.bin on
# PATH. Resolve the Bee Box CLI from the workspace (an installed box or this
# monorepo) while preserving stdin for the hook payload.

set -euo pipefail

# Every command this script runs for a hook needs a box. A Codex session in a
# checkout that is not a box (the beebox monorepo itself, or any worktree of
# it) would otherwise fail `validate` on EVERY edit with a Node stack trace and
# exit 1 — reported to the session as "Hook failed", once per tool call, with
# nothing the session can do about it. Absent a box, the hook has no work: say
# nothing and succeed.
box_dir="$PWD"
while [ "$box_dir" != "/" ]; do
  if [ -e "$box_dir/.beebox" ]; then
    break
  fi
  box_dir=$(dirname "$box_dir")
done
if [ "$box_dir" = "/" ]; then
  exit 0
fi

if [ -n "${BBX_BIN:-}" ] && [ -x "$BBX_BIN" ]; then
  exec "$BBX_BIN" "$@"
fi

search_dir="$PWD"
while [ "$search_dir" != "/" ]; do
  if [ -x "$search_dir/node_modules/.bin/bbx" ]; then
    exec "$search_dir/node_modules/.bin/bbx" "$@"
  fi
  if [ -x "$search_dir/beebox/bin/bbx" ]; then
    exec "$search_dir/beebox/bin/bbx" "$@"
  fi
  if [ -x "$search_dir/node_modules/beebox/bin/bbx" ]; then
    exec "$search_dir/node_modules/beebox/bin/bbx" "$@"
  fi
  search_dir=$(dirname "$search_dir")
done

if command -v bbx >/dev/null 2>&1; then
  exec bbx "$@"
fi

echo "Bee Box plugin: cannot find bbx from workspace $PWD" >&2
exit 127
