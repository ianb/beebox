#!/usr/bin/env bash
#
# VPS-story smoke test, via docker-in-docker.
#
# Executable approximation of the "real VPS run of the compose file" rollout
# verification in docs/plans/installation-story.md. A privileged `docker:dind`
# container stands in for a fresh VPS: it runs its own Docker daemon, and
# inside it we follow docs/docker-install.md's VPS walkthrough as literally as
# feasible:
#
#   clone the repo → `docker compose build` (a full ~2GB image build INSIDE
#   dind — several minutes, by design) → `bbx init` → `up -d` → HTTP 200 through
#   the compose port mapping → then the public profile: copy Caddyfile.example,
#   `docker compose --profile public up -d`, and prove Caddy reverse-proxies to
#   the box (HTTP 200 through Caddy).
#
# ── What this PROVES ─────────────────────────────────────────────────────────
#   - the compose build succeeds from a clean clone on a fresh daemon
#   - the entrypoint's init → box-local-install → serve lifecycle
#   - the box answers 200 through the loopback compose mapping
#   - the real Caddyfile.example reverse-proxies to box:3210 (200 through Caddy)
#
# ── What this does NOT prove (needs a human + real infra) ────────────────────
#   - real ACME / Let's Encrypt issuance: BBX_DOMAIN=localhost makes Caddy use
#     its INTERNAL self-signed CA (probed with `curl -k`), NOT a public cert
#   - real DNS (an A/AAAA record pointing at the VPS)
#   - ports 80/443 reachable from the public internet
#   - the Tailscale-only variant
#   - interactive `claude auth login` (serving a box needs no login; running an
#     agent does)
#
# Clone mechanics mirror smoke-dev-install.sh: a worktree's `.git` points at a
# host-absolute gitdir, so we stage a self-contained clone on the host, mount
# it read-only into the dind container, and clone from THAT inside.
#
# Fallback: if the inner dind daemon never comes up (a privileged-container
# limitation on some hosts), set SMOKE_VPS_HOST_DAEMON=1 to run the same
# compose sequence against the HOST daemon from this script instead — second
# best (no fresh-VPS isolation), but it still exercises the guide's commands.
# The script says loudly which path it took.
#
# Quiet on success (one "ok |" line per step); loud with the failing step's
# output on failure. Nonzero exit on any assertion failure.
set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -P "$SCRIPT_DIR/../.." && pwd)"
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
DIND_IMAGE="${SMOKE_VPS_DIND_IMAGE:-docker:27-dind}"
CONTAINER="beebox-vps-smoke"

WORK_DIR="$(mktemp -d)"
STAGE="$WORK_DIR/beebox-mono-src"
INNER="$WORK_DIR/inner.sh"

START=$(date +%s)

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "smoke-vps-install: staging a self-contained clone of '$BRANCH'..."
git clone -q -b "$BRANCH" "$REPO_ROOT" "$STAGE"

# ── The VPS walkthrough, run inside dind (POSIX sh — dind is Alpine) ──────────
cat > "$INNER" <<'INNER_EOF'
set -eu
STEPLOG=/tmp/step.log

step() {
  desc="$1"; shift
  if "$@" > "$STEPLOG" 2>&1; then
    echo "  ok  | $desc"
  else
    code=$?
    echo "  FAIL| $desc (exit $code)" >&2
    echo "  ---- last 80 lines of output ----" >&2
    tail -n 80 "$STEPLOG" >&2
    exit 1
  fi
}

# curl for probing (Alpine dind has git but not curl).
step "apk add curl (dind probe tool)" apk add --no-cache curl

step "git clone (file-protocol, stranger's clone of '$BRANCH')" \
  git clone -b "$BRANCH" /repo-src /root/beebox-mono

cd /root/beebox-mono/beebox/docker
mkdir -p data/box
# Bind-mount UID reconciliation (docker-install.md "Ownership note"): the image
# runs as UID 1000, but dind operates as root, so the auto-created bind dir is
# root-owned and the container can't write it (EACCES). Own it as 1000 to match
# the image's `node` user — the same reconciliation a VPS operator running as
# root would apply (chown, or the guide's `user:` compose override). This is a
# container-environment quirk, not a repo bug.
chown -R 1000:1000 data/box

echo "  ... | docker compose build (full ~2GB image inside dind — several minutes)"
step "docker compose build box" docker compose build box

# -T disables TTY allocation; without it `run` also grabs stdin (harmless here
# since the script is exec'd by path, not piped, but explicit is safer).
step "docker compose run --rm box bbx init /data/box" \
  docker compose run --rm -T box bbx init /data/box

step "docker compose up -d" docker compose up -d

probe() {
  # $1 = url, $2 = curl extra args (e.g. -k), $3 = description
  url="$1"; extra="$2"; desc="$3"
  code=""
  deadline=$(( $(date +%s) + 150 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    code="$(curl $extra -s -o /tmp/body -w '%{http_code}' "$url" 2>/dev/null || true)"
    [ "$code" = "200" ] && break
    sleep 3
  done
  if [ "$code" != "200" ]; then
    echo "  FAIL| $desc: expected 200 at $url, got '${code:-none}'" >&2
    echo "  ---- box logs ----" >&2
    docker compose logs box 2>&1 | tail -n 60 >&2
    exit 1
  fi
  echo "  ok  | $desc: GET $url -> 200"
}

# The box is served at /box/ (slug = basename of /data/box). First run installs
# box deps inside the container, so allow generous time.
echo "  ... | waiting for the box (first run installs box deps)"
probe "http://127.0.0.1:3210/box/" "" "box via compose port mapping"

# ── Public profile: the REAL Caddyfile.example, reverse-proxying to the box ──
# BBX_DOMAIN=localhost => Caddy serves TLS from its INTERNAL CA (no public ACME),
# so we probe with `curl -k`. This exercises the shipped Caddyfile.example's
# `reverse_proxy box:3210` line end-to-end.
step "cp Caddyfile.example Caddyfile" cp Caddyfile.example Caddyfile
export BBX_DOMAIN=localhost
step "docker compose --profile public up -d (Caddy front door)" \
  docker compose --profile public up -d

echo "  ... | waiting for Caddy to answer and proxy to the box"
probe "https://localhost/box/" "-k" "box THROUGH Caddy (internal TLS)"

step "docker compose --profile public down -v" \
  docker compose --profile public down -v

echo "  ok  | VPS lifecycle complete inside dind"
INNER_EOF

# ── Host-daemon fallback ─────────────────────────────────────────────────────
run_host_fallback() {
  echo "smoke-vps-install: !! FALLBACK — running the compose sequence against the"
  echo "                   HOST daemon (no fresh-VPS isolation). This still exercises"
  echo "                   docker-install.md's command sequence, but is second-best."
  local proj="beebox-vps-smoke-host"
  local dockerdir="$STAGE/beebox/docker"
  # Non-default host ports so we don't collide with the shared dev router (3210)
  # or privileged 80/443. A compose override remaps just the published ports.
  cat > "$dockerdir/compose.override.yaml" <<'OV'
services:
  box:
    ports: !override
      - "127.0.0.1:33210:3210"
  caddy:
    ports: !override
      - "18080:80"
OV
  local caddyfile="$dockerdir/Caddyfile"
  cat > "$caddyfile" <<'CF'
{
	auto_https off
}
:80 {
	reverse_proxy box:3210
}
CF
  local dc=(docker compose -p "$proj")
  ( cd "$dockerdir"
    set -e
    mkdir -p data/box
    echo "  ... | docker compose build box (host daemon, several minutes)"
    "${dc[@]}" build box
    "${dc[@]}" run --rm box bbx init /data/box
    "${dc[@]}" up -d
    echo "  ... | probing box on host :33210"
    code=""; deadline=$(( $(date +%s) + 180 ))
    until [[ "$(date +%s)" -ge "$deadline" ]]; do
      code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:33210/box/ || true)"
      [[ "$code" == "200" ]] && break; sleep 3
    done
    [[ "$code" == "200" ]] || { echo "FAIL: box not 200 (got ${code:-none})"; "${dc[@]}" logs box | tail -60; "${dc[@]}" down -v; exit 1; }
    echo "  ok  | box via compose port mapping (host): 200"
    BBX_DOMAIN=localhost "${dc[@]}" --profile public up -d
    echo "  ... | probing through Caddy on host :18080"
    code=""; deadline=$(( $(date +%s) + 90 ))
    until [[ "$(date +%s)" -ge "$deadline" ]]; do
      code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/box/ || true)"
      [[ "$code" == "200" ]] && break; sleep 3
    done
    "${dc[@]}" --profile public down -v
    [[ "$code" == "200" ]] || { echo "FAIL: Caddy proxy not 200 (got ${code:-none})"; exit 1; }
    echo "  ok  | box THROUGH Caddy (host): 200"
  )
}

# ── Primary path: privileged dind ────────────────────────────────────────────
if [[ "${SMOKE_VPS_HOST_DAEMON:-}" == "1" ]]; then
  run_host_fallback
  echo "smoke-vps-install: PASS via HOST-DAEMON fallback ($(( $(date +%s) - START ))s)"
  exit 0
fi

echo "smoke-vps-install: starting a privileged dind 'VPS' ($DIND_IMAGE)..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --privileged --name "$CONTAINER" \
  -e DOCKER_TLS_CERTDIR="" \
  -v "$STAGE":/repo-src:ro \
  "$DIND_IMAGE" >/dev/null

echo "smoke-vps-install: waiting for the inner Docker daemon..."
up=0
for _ in $(seq 1 40); do
  if docker exec "$CONTAINER" docker version >/dev/null 2>&1; then up=1; break; fi
  sleep 2
done

if [[ "$up" -ne 1 ]]; then
  echo "smoke-vps-install: inner dind daemon never came up — falling back to the host daemon." >&2
  run_host_fallback
  echo "smoke-vps-install: PASS via HOST-DAEMON fallback ($(( $(date +%s) - START ))s)"
  exit 0
fi

echo "smoke-vps-install: running the VPS walkthrough inside dind..."
# Copy the script IN and exec it by path — do NOT pipe it via `sh -s < inner`.
# `docker compose run`/`up` attach to stdin, and a piped script gets partly
# swallowed (the probe/Caddy steps silently never run). Exec-by-path gives the
# compose commands an empty stdin instead.
docker cp "$INNER" "$CONTAINER":/root/inner.sh >/dev/null
if docker exec -e BRANCH="$BRANCH" "$CONTAINER" sh /root/inner.sh; then
  echo "smoke-vps-install: PASS via dind ($(( $(date +%s) - START ))s)"
else
  echo "smoke-vps-install: FAIL (see the failing step above) ($(( $(date +%s) - START ))s)" >&2
  exit 1
fi
