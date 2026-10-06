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

bbx_bin=""
if [ -n "${BBX_BIN:-}" ] && [ -x "$BBX_BIN" ]; then
  bbx_bin="$BBX_BIN"
fi

search_dir="$PWD"
while [ -z "$bbx_bin" ] && [ "$search_dir" != "/" ]; do
  for candidate in "$search_dir/node_modules/.bin/bbx" "$search_dir/beebox/bin/bbx" "$search_dir/node_modules/beebox/bin/bbx"; do
    if [ -x "$candidate" ]; then
      bbx_bin="$candidate"
      break
    fi
  done
  search_dir=$(dirname "$search_dir")
done

if [ -z "$bbx_bin" ] && command -v bbx >/dev/null 2>&1; then
  bbx_bin=$(command -v bbx)
fi

if [ -z "$bbx_bin" ]; then
  if [ "${1:-}" = "validate" ] && [ "${2:-}" = "--hook" ]; then
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Bee Box validation hook could not find bbx in this box."}}'
    exit 0
  fi
  echo "Bee Box plugin: cannot find bbx from workspace $PWD" >&2
  exit 127
fi

# Codex currently drops stderr from a PostToolUse hook that exits 2. Translate
# validation failures into its model-visible additionalContext channel.
if [ "${1:-}" != "validate" ] || [ "${2:-}" != "--hook" ]; then
  exec "$bbx_bin" "$@"
fi

hook_stdout=$(mktemp)
hook_stderr=$(mktemp)
trap 'rm -f "$hook_stdout" "$hook_stderr"' EXIT
status=0
"$bbx_bin" "$@" >"$hook_stdout" 2>"$hook_stderr" || status=$?
if [ "$status" -eq 0 ]; then
  cat "$hook_stdout"
  exit 0
fi
# JavaScript template strings must reach Node without shell expansion.
# shellcheck disable=SC2016
node -e '
  const fs = require("node:fs");
  const [stdoutFile, stderrFile, status] = process.argv.slice(1);
  const output = fs.readFileSync(stderrFile, "utf8").trim() || fs.readFileSync(stdoutFile, "utf8").trim();
  const label = status === "2" ? "Bee Box validation errors; fix the edited file:" : `Bee Box validation hook crashed (exit ${status}):`;
  const feedback = `${label}\n${(output || "No diagnostic output").slice(0, 8000)}`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: feedback } }) + "\n");
' "$hook_stdout" "$hook_stderr" "$status"
