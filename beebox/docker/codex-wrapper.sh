#!/bin/sh
# `codex` for operators: beebox's own pinned Codex (the package
# src/services/codex-binary.ts resolves). See the Dockerfile.
set -eu
entry="$(node -e 'console.log(require.resolve("@openai/codex/bin/codex.js", { paths: [require("fs").realpathSync("/app/node_modules/beebox")] }))')"
exec node "$entry" "$@"
