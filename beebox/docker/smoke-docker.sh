#!/usr/bin/env bash
#
# Container lifecycle test — the Docker path's done-when.
#
# Builds the image, then exercises the entrypoint contract end-to-end against
# a scratch box on a throwaway compose project:
#   1. no-args on an empty volume  → nonzero exit + the init recovery message
#   2. `bbx init /data/box`         → succeeds (scaffolds + commits the box)
#   3. `up -d` (no-args serve)     → box-local install + serve, HTTP 200 HTML
#   4. `down -v`                   → clean teardown
#
# Quiet on success (a handful of "ok:" lines); on failure it dumps the failing
# step's captured output and exits nonzero.
#
# A non-3210 host port (override with SMOKE_HOST_PORT) keeps it from colliding
# with the shared local dev router.
set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -P "$SCRIPT_DIR/../.." && pwd)"
IMAGE_TAG="beebox:smoke-test"
PROJECT_NAME="beebox-smoke"
HOST_PORT="${SMOKE_HOST_PORT:-33210}"

WORK_DIR="$(mktemp -d)"
LOG_DIR="$WORK_DIR/logs"
mkdir -p "$LOG_DIR" "$WORK_DIR/data/box"

# Scratch compose project: the prebuilt image, a test host port, and a
# bind-mounted scratch box. No .claude volume — init/serve don't need auth.
cat > "$WORK_DIR/compose.yaml" <<EOF
services:
  box:
    image: $IMAGE_TAG
    ports:
      - "127.0.0.1:$HOST_PORT:3210"
    volumes:
      - ./data/box:/data/box
EOF

dc() { docker compose -p "$PROJECT_NAME" -f "$WORK_DIR/compose.yaml" "$@"; }

cleanup() {
  local code=$?
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
  exit "$code"
}
trap cleanup EXIT

fail() {
  local msg="$1" log="${2:-}"
  echo "FAIL: $msg" >&2
  if [[ -n "$log" && -f "$log" ]]; then
    echo "---- captured output ($log) ----" >&2
    tail -n 60 "$log" >&2
    echo "--------------------------------" >&2
  fi
  exit 1
}

# ── Build ────────────────────────────────────────────────────────────────
echo "smoke: building image (this takes a few minutes on a cold cache)..."
if ! docker build -f "$REPO_ROOT/beebox/docker/Dockerfile" -t "$IMAGE_TAG" "$REPO_ROOT" \
      > "$LOG_DIR/build.log" 2>&1; then
  fail "image build" "$LOG_DIR/build.log"
fi
echo "smoke: ok — image built ($IMAGE_TAG)"

# ── 1. no-args on an empty box volume → nonzero + init message ───────────
set +e
dc run --rm box > "$LOG_DIR/empty.log" 2>&1
empty_code=$?
set -e
if [[ "$empty_code" -eq 0 ]]; then
  fail "no-args on empty volume should exit nonzero, got 0" "$LOG_DIR/empty.log"
fi
if ! grep -q "bbx init /data/box" "$LOG_DIR/empty.log"; then
  fail "no-args on empty volume should print the 'bbx init /data/box' recovery command" "$LOG_DIR/empty.log"
fi
echo "smoke: ok — empty volume refused with init instructions (exit $empty_code)"

# ── 2. bbx init /data/box → success ───────────────────────────────────────
if ! dc run --rm box bbx init /data/box > "$LOG_DIR/init.log" 2>&1; then
  fail "bbx init /data/box" "$LOG_DIR/init.log"
fi
if [[ ! -f "$WORK_DIR/data/box/content/.beebox/box.json" ]]; then
  fail "bbx init did not create content/.beebox/box.json" "$LOG_DIR/init.log"
fi
echo "smoke: ok — bbx init scaffolded a v2 box"

# ── 3. up -d (no-args serve) → HTTP 200 HTML ─────────────────────────────
if ! dc up -d > "$LOG_DIR/up.log" 2>&1; then
  fail "docker compose up -d" "$LOG_DIR/up.log"
fi

URL="http://127.0.0.1:$HOST_PORT/"
echo "smoke: waiting for $URL (first run installs box deps — up to 3 min)..."
code=""
deadline=$(( $(date +%s) + 180 ))
until [[ "$(date +%s)" -ge "$deadline" ]]; do
  code="$(curl -s -o "$LOG_DIR/body.html" -w '%{http_code}' "$URL" 2>/dev/null || true)"
  [[ "$code" == "200" ]] && break
  sleep 3
done

if [[ "$code" != "200" ]]; then
  dc logs box > "$LOG_DIR/container.log" 2>&1 || true
  fail "expected HTTP 200 from $URL, got '${code:-none}'" "$LOG_DIR/container.log"
fi
if ! grep -qi "<!doctype html\|<html" "$LOG_DIR/body.html"; then
  fail "response from $URL was not HTML" "$LOG_DIR/body.html"
fi
echo "smoke: ok — served HTTP 200 HTML at $URL"

# ── 4. teardown (cleanup trap also covers failure paths) ─────────────────
if ! dc down -v --remove-orphans > "$LOG_DIR/down.log" 2>&1; then
  fail "docker compose down" "$LOG_DIR/down.log"
fi
echo "smoke: ok — clean teardown"
echo "smoke: PASS"
