#!/usr/bin/env bash
set -euo pipefail

# Deploy from local working tree to server via rsync.
# Syncs all three repos, builds frontend locally first, restarts services.
# Usage: ./deploy/deploy.sh [--skip-frontend] [--skip-restart]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MONO_DIR="$(cd "$REPO_DIR/.." && pwd)"
SERVER_IP=$(cat "$SCRIPT_DIR/server-ip")
INSTALL_DIR="/opt/callback"

SKIP_FRONTEND=false
SKIP_RESTART=false
for arg in "$@"; do
  case "$arg" in
    --skip-frontend) SKIP_FRONTEND=true ;;
    --skip-restart) SKIP_RESTART=true ;;
  esac
done

RSYNC_OPTS=(-az --delete
  --exclude node_modules
  --exclude .git
  --exclude '*.secret.json'
  --exclude '*.state.json'
  --exclude '.last-deploy.log'
  --exclude '.env'
  --exclude '.thinking/'
  --exclude '.claude/'
  --exclude 'deploy-info.json'
  --exclude 'deploy-history.json'
)

# Reconcile local node_modules to the committed lockfile before any local
# build. A just-merged dependency change (added/removed dep) otherwise builds
# the frontend/cardworks against stale modules and fails — this has bitten the
# auto-deploy repeatedly. Frozen so it's deterministic and never rewrites the
# lockfile; a no-op when already in sync.
echo "Reconciling local deps..."
(cd "$MONO_DIR" && HUSKY=0 pnpm install --frozen-lockfile --silent)

# Build frontend locally (fast — already has node_modules)
if [[ "$SKIP_FRONTEND" != true ]]; then
  echo "Building frontend..."
  cd "$REPO_DIR/src/frontend" && pnpm --silent build
fi

# Build the CLI bundle locally before syncing. dist/ is rsynced (not excluded),
# and while the server runs cb via tsx (not the bundle), it DOES need
# dist/cards/index.js on disk: box-local schema files import `callback-box/cards`,
# which package.json `exports` maps to ./dist/cards/index.js (a plain-JS build of
# the card-primitive layer, emitted by build-cli.mjs alongside dist/cli.mjs). If
# that file is missing or stale on the server, every box-local schema fails to
# load. Building here keeps dist/ in lockstep with the source we rsync.
echo "Building CLI bundle (dist/cli.mjs + dist/cards)..."
cd "$REPO_DIR" && node scripts/build-cli.mjs >/dev/null

# Sync monorepo packages. These are pnpm workspace members linked via
# `workspace:*` deps, so they must all be present alongside callback-box on the
# server for the root `pnpm install` to resolve. personal-vibe-check and
# agent-doctest are devDeps of callback-box (the server install is non-prod
# because the runtime uses tsx, itself a devDep).
# browse/agent-browser-typed are deliberately NOT synced — they're dev-only
# tooling and a partial workspace installs fine (pnpm ignores absent members).
for repo in personal-vibe-check agent-doctest callback-box; do
  local_path="$MONO_DIR/$repo/"
  if [[ ! -d "$local_path" ]]; then
    echo "  $repo: not found at $local_path, skipping"
    continue
  fi
  echo "Syncing $repo..."
  rsync "${RSYNC_OPTS[@]}" "$local_path" "root@$SERVER_IP:$INSTALL_DIR/$repo/"
done

# Sync the workspace root itself. With workspace deps, /opt/callback becomes the
# pnpm workspace root: the single root lockfile + manifest + .npmrc + patches
# drive one reproducible `pnpm install --frozen-lockfile` from there (below).
# These are individual files, so no --delete (it would nuke the synced subdirs).
echo "Syncing workspace root..."
rsync -az \
  "$MONO_DIR/package.json" \
  "$MONO_DIR/pnpm-workspace.yaml" \
  "$MONO_DIR/.npmrc" \
  "$MONO_DIR/pnpm-lock.yaml" \
  "root@$SERVER_IP:$INSTALL_DIR/"
rsync -az --delete "$MONO_DIR/patches/" "root@$SERVER_IP:$INSTALL_DIR/patches/"

# Install deps if package-lock changed (compare hash)
echo "Checking dependencies..."
ssh -A "root@$SERVER_IP" bash -s <<'REMOTE'
  set -e
  # Bootstrap pnpm on demand. corepack ships with Node 22; this is idempotent
  # and a no-op if pnpm is already on PATH.
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "  Bootstrapping pnpm via corepack..."
    corepack enable pnpm
  fi
  # One-time migration: personal-vibe-check moved from /opt/personal-vibe-check
  # (when it was an external sibling repo) to /opt/callback/personal-vibe-check
  # (now a monorepo sibling). Once the new path is populated and the deploy is
  # confirmed working, the old dir is dead weight. Remove it idempotently.
  if [[ -d /opt/callback/personal-vibe-check && -d /opt/personal-vibe-check ]]; then
    echo "  Removing stale /opt/personal-vibe-check (superseded by /opt/callback/personal-vibe-check)..."
    rm -rf /opt/personal-vibe-check
  fi
  # One-time cleanup: the cardworks package was removed (absorbed into
  # callback-box/src/cards). The deploy no longer syncs it, so an old
  # /opt/callback/cardworks just lingers — drop it idempotently.
  if [[ -d /opt/callback/cardworks ]]; then
    echo "  Removing stale /opt/callback/cardworks (package removed)..."
    rm -rf /opt/callback/cardworks
  fi
  # One-time cutover from the old per-subdir installs to a single workspace
  # install. Before this change each subdir had its own isolated node_modules;
  # the workspace uses a hoisted node_modules at the root. Remove the legacy
  # per-package trees once (keyed on the root node_modules not yet existing) so
  # nothing stale shadows the hoisted layout — the exact class of bug this
  # migration fixes. After the first workspace deploy this branch is skipped.
  if [[ ! -d /opt/callback/node_modules ]]; then
    echo "  First workspace deploy: clearing legacy per-package node_modules..."
    rm -rf /opt/callback/cardworks/node_modules \
           /opt/callback/personal-vibe-check/node_modules \
           /opt/callback/agent-doctest/node_modules \
           /opt/callback/callback-box/node_modules \
           /opt/callback/callback-box/src/frontend/node_modules
  fi
  # Reconcile the whole workspace to the synced lockfile in one frozen install
  # from the workspace root. --frozen-lockfile makes the server resolution match
  # dev byte-for-byte (and fails loudly if the lockfile is stale rather than
  # silently resolving something new). HUSKY=0 skips husky's hook install (no
  # .git on the server) so it doesn't print a spurious ".git can't be found".
  # patch-package still runs via the root postinstall to patch eslint-config-agent.
  cd /opt/callback
  echo "  Reconciling workspace deps (frozen)..."
  HUSKY=0 pnpm install --frozen-lockfile
REMOTE

# Write deploy info (git hashes + timestamp).
# Build the JSON via node so JSON.stringify escapes subjects correctly —
# commit subjects can contain quotes, backslashes, etc. that break naive
# shell interpolation. Values come through env vars to avoid any shell
# expansion in the node script body.
echo "Writing deploy info..."
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CALLBACK_BOX_HASH=""
CALLBACK_BOX_SUBJECT=""
if [[ -d "$MONO_DIR/callback-box/.git" ]]; then
  CALLBACK_BOX_HASH=$(cd "$MONO_DIR/callback-box" && git rev-parse --short HEAD)
  CALLBACK_BOX_SUBJECT=$(cd "$MONO_DIR/callback-box" && git log -1 --format=%s)
fi
DEPLOY_INFO=$(DEPLOYED_AT="$DEPLOYED_AT" \
  CALLBACK_BOX_HASH="$CALLBACK_BOX_HASH" CALLBACK_BOX_SUBJECT="$CALLBACK_BOX_SUBJECT" \
  node -e '
const out = { deployedAt: process.env.DEPLOYED_AT, commits: {} };
if (process.env.CALLBACK_BOX_HASH) {
  out.commits["callback-box"] = { hash: process.env.CALLBACK_BOX_HASH, subject: process.env.CALLBACK_BOX_SUBJECT };
}
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
')
ssh "root@$SERVER_IP" "cat > $INSTALL_DIR/callback-box/deploy-info.json" <<< "$DEPLOY_INFO"

# Append to deploy history (keep last 20 entries)
ssh "root@$SERVER_IP" bash -s <<HISTEOF
  HIST_FILE="$INSTALL_DIR/callback-box/deploy-history.json"
  if [[ -f "\$HIST_FILE" ]]; then
    # Prepend new entry, keep last 20
    node -e "
      const fs = require('fs');
      const hist = JSON.parse(fs.readFileSync('\$HIST_FILE', 'utf-8'));
      const entry = JSON.parse(fs.readFileSync('$INSTALL_DIR/callback-box/deploy-info.json', 'utf-8'));
      hist.unshift(entry);
      fs.writeFileSync('\$HIST_FILE', JSON.stringify(hist.slice(0, 20), null, 2));
    "
  else
    node -e "
      const fs = require('fs');
      const entry = JSON.parse(fs.readFileSync('$INSTALL_DIR/callback-box/deploy-info.json', 'utf-8'));
      fs.writeFileSync('\$HIST_FILE', JSON.stringify([entry], null, 2));
    "
  fi
HISTEOF

# Restart services
if [[ "$SKIP_RESTART" != true ]]; then
  echo "Restarting services..."
  ssh "root@$SERVER_IP" 'systemctl restart callback-serve callback-scheduler && echo "Services restarted"'

  # Verify /healthz responds with 200 — proves the process came back up
  # and is actually serving requests, not just that systemctl returned.
  # Runs on the server so it uses localhost + the local CB_DIAG_API_KEY.
  echo "Verifying /healthz..."
  ssh "root@$SERVER_IP" bash -s <<'HEALTHCHECK'
    set -e
    KEY=$(grep -E '^CB_DIAG_API_KEY=' /home/callback/.env 2>/dev/null | cut -d= -f2- || true)
    if [ -z "$KEY" ]; then
      echo "  Skipping: CB_DIAG_API_KEY not set in /home/callback/.env"
      exit 0
    fi
    # Poll for up to 30s. Service typically responds in <2s.
    for i in $(seq 1 30); do
      body=$(curl -s -o /tmp/healthz.out -w '%{http_code}' \
        -H "Authorization: Bearer $KEY" \
        http://localhost:3210/healthz 2>/dev/null || echo "000")
      if [ "$body" = "200" ]; then
        echo "  Healthz OK: $(cat /tmp/healthz.out)"
        rm -f /tmp/healthz.out
        exit 0
      fi
      sleep 1
    done
    echo "  Healthz FAILED after 30s (last status: $body)"
    [ -f /tmp/healthz.out ] && cat /tmp/healthz.out
    rm -f /tmp/healthz.out
    exit 1
HEALTHCHECK
fi

echo "Deploy complete."
echo "Verify externally: curl -H \"Authorization: Bearer \$CB_DIAG_API_KEY\" https://box.example.com/healthz"
