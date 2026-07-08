#!/usr/bin/env bash
set -euo pipefail

# Deploy from local working tree to server via rsync.
# Syncs all three repos, builds frontend locally first, restarts services.
# Usage: ./deploy/deploy.sh [--skip-frontend] [--skip-restart]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MONO_DIR="$(cd "$REPO_DIR/.." && pwd)"

# Surface failures. This usually runs backgrounded from the post-commit hook,
# with stdout/err going to deploy/.last-deploy.log that nobody watches — so on
# any non-zero exit, echo a "Deploy failed" line (the poll pattern in
# deploy/CLAUDE.md keys off it) AND fire a desktop notification. Skipped when run
# interactively — you already see the output. terminal-notifier is optional.
LOG_HINT="callback-box/deploy/.last-deploy.log"
notify() {  # $1=title  $2=message
  [ -t 1 ] && return 0
  command -v terminal-notifier >/dev/null 2>&1 &&
    terminal-notifier -title "$1" -message "$2" -group callback-deploy >/dev/null 2>&1 || true
}
trap 'rc=$?; if [ "$rc" -ne 0 ]; then echo "Deploy failed (exit $rc)"; notify "❌ callback-box deploy FAILED" "exit $rc — see $LOG_HINT"; fi' EXIT

# The deploy target IP lives in a gitignored file; a repo move or fresh clone
# leaves it behind — which is exactly how a run of silent no-op deploys just
# happened. Fail loud and actionable instead of a bare "cat: No such file".
if [ ! -s "$SCRIPT_DIR/server-ip" ]; then
  echo "deploy: $SCRIPT_DIR/server-ip is missing or empty — it holds the deploy" >&2
  echo "  target IP and is gitignored (never committed). Restore it from a backup," >&2
  echo "  or:  echo <SERVER_IP> > $SCRIPT_DIR/server-ip" >&2
  exit 1
fi
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
  # rsync runs as root over ssh, and -a preserves the sender's (local dev
  # machine's) numeric uid/gid by default. Without this, /opt/callback ends
  # up owned by the deploying laptop's local uid — harmless for reads, but
  # `callback` (the account every box's `pnpm install` runs as, via the
  # `link:/opt/callback/callback-box` dependency — see docs/box-layout.md)
  # can't chmod a bin file it doesn't own, so pnpm's redundant "make sure
  # this bin is executable" step during `_linkBins` throws EPERM and the
  # whole install exits nonzero even though every real package resolved.
  # --chown isn't available in the local macOS rsync (openrsync, no 3.1+
  # extensions) — --no-owner --no-group plus an explicit chown pass below
  # is the portable equivalent.
  --no-owner --no-group
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
# the frontend/cards package against stale modules and fails — this has bitten the
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
rsync -az --no-owner --no-group \
  "$MONO_DIR/package.json" \
  "$MONO_DIR/pnpm-workspace.yaml" \
  "$MONO_DIR/.npmrc" \
  "$MONO_DIR/pnpm-lock.yaml" \
  "root@$SERVER_IP:$INSTALL_DIR/"
rsync -az --delete --no-owner --no-group "$MONO_DIR/patches/" "root@$SERVER_IP:$INSTALL_DIR/patches/"

# --no-owner/--no-group above leave everything owned by root (the ssh
# connection user) rather than the sender's uid — still wrong for `callback`,
# whose `pnpm install` (this box and every box's) needs to own the files it
# might chmod. One pass over the whole tree after every sync is simpler and
# more robust than trying to get every rsync invocation's ownership right.
echo "Fixing ownership..."
ssh "root@$SERVER_IP" "chown -R callback:callback $INSTALL_DIR"

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

# Reconcile each v2-shape (package-layout) box's own node_modules against its
# package.json. `cb init`/`box-packageify` scaffold a package.json declaring
# react/react-dom/typescript direct deps (view-metadata compilation needs a
# real, box-owned react — see src/webapp/views/compiler.ts and
# src/core/box/package.ts) but deliberately don't install them (Track F of
# docs/implemented-plans/boxes-as-packages-v2.md has no real registry yet for
# the `callback-box` dependency itself). Left uninstalled, every view in the
# box silently degrades to a "Failed to compile" stub with no bound card
# type and no visible error — see the box-family incident this fixed.
# Runs after every deploy (not just once) because a box's package.json can
# change independently — an agent `pnpm add`s a view dependency, or a fresh
# `box-packageify` runs — between deploys.
echo "Reconciling box package installs..."
ssh "root@$SERVER_IP" bash -s <<'REMOTE'
  set -e
  for box in /home/callback/boxes/*/; do
    pj="$box/package.json"
    [[ -f "$pj" ]] || continue   # shapeVersion 1 (legacy) boxes have none — skip
    name=$(basename "$box")

    # The callback-box dependency ships as a bare semver range (meaningless —
    # there's no registry for it yet), which makes a plain `pnpm install` fail
    # outright trying to resolve it. Normalize it to `link:`, pointing at this
    # same server install, idempotently (a no-op once already rewritten).
    node -e "
      const fs = require('fs');
      const p = JSON.parse(fs.readFileSync('$pj', 'utf-8'));
      const want = 'link:/opt/callback/callback-box';
      if (p.dependencies && p.dependencies['callback-box'] !== want) {
        p.dependencies['callback-box'] = want;
        fs.writeFileSync('$pj', JSON.stringify(p, null, 2) + '\n');
      }
    "

    marker="$box/node_modules/react"
    if [[ ! -e "$marker" || "$pj" -nt "$marker" ]]; then
      echo "  $name: installing (package.json newer than last install, or never installed)..."
      if ! sudo -u callback -H bash -lc "cd '$box' && pnpm install"; then
        echo "  $name: pnpm install exited nonzero — check for real dependency errors above" \
             "(a lone EPERM on .bin linking is a known-harmless pnpm quirk, everything else isn't)"
      fi
    fi
  done
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
# Since the monorepo merge there's no per-project callback-box/.git — the repo
# is at $MONO_DIR. Read the deployed commit from the monorepo HEAD. (Kept the
# `commits["callback-box"]` key below for the health endpoint's shape.)
if [[ -d "$MONO_DIR/.git" ]]; then
  CALLBACK_BOX_HASH=$(cd "$MONO_DIR" && git rev-parse --short HEAD)
  CALLBACK_BOX_SUBJECT=$(cd "$MONO_DIR" && git log -1 --format=%s)
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
  # Best-effort: give an active chat turn / running script a bounded chance to
  # finish before we restart, so a deploy doesn't kill active work. cb-wait-quiet
  # polls `cb activity` (installed by setup-server.sh); skip gracefully on
  # servers that predate it.
  echo "Waiting for boxes to be at rest (best-effort)..."
  ssh "root@$SERVER_IP" 'test -x /usr/local/bin/cb-wait-quiet && /usr/local/bin/cb-wait-quiet || echo "  (cb-wait-quiet not installed; re-run setup-server.sh to enable)"'

  echo "Restarting services..."
  ssh "root@$SERVER_IP" 'systemctl restart callback-hub callback-scheduler && echo "Services restarted"'

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
notify "✅ callback-box deployed" "to $SERVER_IP"
echo "Verify externally: curl -H \"Authorization: Bearer \$CB_DIAG_API_KEY\" https://box.example.com/healthz"
