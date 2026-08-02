#!/usr/bin/env bash
# Smoke test for the install story (docs/plans/scan-uploader-pairing.md
# Track C): from a CLEAN clone of the monorepo, the documented sequence
#
#   pnpm install --filter "scan-uploader..."
#   pnpm --filter scan-uploader build
#
# must produce a dist/scan-uploader.mjs that runs SELF-CONTAINED (from a bare
# directory with no node_modules in reach).
#
# Measured 2026-08-01: the workspace's `node-linker=hoisted` (.npmrc,
# necessarily workspace-wide) means the filtered install still materializes
# the full hoisted tree (~1.3 GB incl. better-sqlite3/sharp) — filtering does
# NOT make the install lighter here, it only scopes which projects' scripts
# run. The story's value is that it works verbatim from a clean clone; the
# lightweight path for additional machines is copying the self-contained
# bundle (see README "Setup").
#
# Uses a fresh temp clone AND a fresh pnpm store; downloads real packages —
# expect several minutes. Run from anywhere inside the repo:
#
#   bash scan-uploader/smoke-install.sh
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
WORK=$(mktemp -d -t scan-uploader-smoke)
trap 'rm -rf "$WORK"' EXIT
echo "workdir: $WORK"

echo "--- clone (local, depth 1)"
git clone --quiet --depth 1 "file://$ROOT" "$WORK/clone"
cd "$WORK/clone"

echo "--- filtered install (fresh store)"
pnpm install --filter "scan-uploader..." --store-dir "$WORK/store" \
  > "$WORK/install.log" 2>&1 \
  || { tail -20 "$WORK/install.log"; echo "FAIL: filtered install errored"; exit 1; }

echo "--- build"
pnpm --filter scan-uploader build > "$WORK/build.log" 2>&1 \
  || { tail -20 "$WORK/build.log"; echo "FAIL: build errored"; exit 1; }
[ -f scan-uploader/dist/scan-uploader.mjs ] || { echo "FAIL: dist/scan-uploader.mjs missing"; exit 1; }

echo "--- self-containment: run the bundle from a bare directory"
mkdir "$WORK/bare"
cp scan-uploader/dist/scan-uploader.mjs "$WORK/bare/"
cd "$WORK/bare"
node scan-uploader.mjs --help > help.out
grep -q "configure" help.out || { echo "FAIL: --help does not mention configure"; exit 1; }
node scan-uploader.mjs configure --help > configure-help.out 2>&1 \
  || { echo "FAIL: configure --help errored"; exit 1; }

echo "PASS: clean clone -> filtered install -> build -> self-contained run"
