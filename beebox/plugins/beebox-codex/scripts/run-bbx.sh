#!/usr/bin/env bash

# Codex plugin hooks do not inherit a package manager's node_modules/.bin on
# PATH. Resolve the Bee Box CLI from the workspace (an installed box or this
# monorepo) while preserving stdin for the hook payload.

set -euo pipefail

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
