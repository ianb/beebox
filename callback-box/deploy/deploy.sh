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

# Build frontend locally (fast — already has node_modules)
if [[ "$SKIP_FRONTEND" != true ]]; then
  echo "Building frontend..."
  cd "$REPO_DIR/src/frontend" && npm run build --silent
fi

# Sync all three repos
for repo in cardworks callback-box; do
  local_path="$MONO_DIR/$repo/"
  if [[ ! -d "$local_path" ]]; then
    echo "  $repo: not found at $local_path, skipping"
    continue
  fi
  echo "Syncing $repo..."
  rsync "${RSYNC_OPTS[@]}" "$local_path" "root@$SERVER_IP:$INSTALL_DIR/$repo/"
done

# personal-vibe-check lives outside the monorepo but is a file: dep of
# callback-box, so it must be present at /opt/personal-vibe-check on the
# server. Its own prepare script (husky) runs during npm pack, so it needs
# its own node_modules installed too.
PVC_LOCAL="$MONO_DIR/../personal-vibe-check/"
if [[ -d "$PVC_LOCAL" ]]; then
  echo "Syncing personal-vibe-check..."
  rsync "${RSYNC_OPTS[@]}" "$PVC_LOCAL" "root@$SERVER_IP:/opt/personal-vibe-check/"
fi

# Install deps if package-lock changed (compare hash)
echo "Checking dependencies..."
ssh -A "root@$SERVER_IP" bash -s <<'REMOTE'
  set -e
  cd /opt/personal-vibe-check
  if [[ ! -d node_modules ]] || ! npm ls --depth=0 &>/dev/null 2>&1; then
    echo "  Installing personal-vibe-check deps..."
    npm install --no-audit --no-fund --legacy-peer-deps
  fi
  cd /opt/callback/callback-box
  if [[ ! -d node_modules ]] || ! npm ls --depth=0 &>/dev/null 2>&1; then
    echo "  Installing callback-box deps..."
    npm install --no-audit --no-fund
  fi
REMOTE

# Write deploy info (git hashes + timestamp).
# Build the JSON via node so JSON.stringify escapes subjects correctly —
# commit subjects can contain quotes, backslashes, etc. that break naive
# shell interpolation. Values come through env vars to avoid any shell
# expansion in the node script body.
echo "Writing deploy info..."
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CARDWORKS_HASH=""
CARDWORKS_SUBJECT=""
CALLBACK_BOX_HASH=""
CALLBACK_BOX_SUBJECT=""
if [[ -d "$MONO_DIR/cardworks/.git" ]]; then
  CARDWORKS_HASH=$(cd "$MONO_DIR/cardworks" && git rev-parse --short HEAD)
  CARDWORKS_SUBJECT=$(cd "$MONO_DIR/cardworks" && git log -1 --format=%s)
fi
if [[ -d "$MONO_DIR/callback-box/.git" ]]; then
  CALLBACK_BOX_HASH=$(cd "$MONO_DIR/callback-box" && git rev-parse --short HEAD)
  CALLBACK_BOX_SUBJECT=$(cd "$MONO_DIR/callback-box" && git log -1 --format=%s)
fi
DEPLOY_INFO=$(DEPLOYED_AT="$DEPLOYED_AT" \
  CARDWORKS_HASH="$CARDWORKS_HASH" CARDWORKS_SUBJECT="$CARDWORKS_SUBJECT" \
  CALLBACK_BOX_HASH="$CALLBACK_BOX_HASH" CALLBACK_BOX_SUBJECT="$CALLBACK_BOX_SUBJECT" \
  node -e '
const out = { deployedAt: process.env.DEPLOYED_AT, commits: {} };
if (process.env.CARDWORKS_HASH) {
  out.commits.cardworks = { hash: process.env.CARDWORKS_HASH, subject: process.env.CARDWORKS_SUBJECT };
}
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
fi

echo "Deploy complete."
