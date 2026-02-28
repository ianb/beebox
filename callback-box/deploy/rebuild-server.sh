#!/usr/bin/env bash
set -euo pipefail

# Pull latest code and rebuild on the server.
# Run locally: ./deploy/rebuild-server.sh
# Or on server directly: /root/rebuild.sh

INSTALL_DIR="/opt/callback"

echo "=== Pulling latest code ==="
for repo in cardworks callback-dropbox callback-box; do
  echo "  $repo..."
  cd "$INSTALL_DIR/$repo" && git pull --ff-only
done

echo "=== Rebuilding cardworks ==="
cd "$INSTALL_DIR/cardworks"
npm install --no-audit --no-fund
npm run build

echo "=== Rebuilding callback-dropbox ==="
cd "$INSTALL_DIR/callback-dropbox"
npm install --no-audit --no-fund
npm run build

echo "=== Rebuilding callback-box ==="
cd "$INSTALL_DIR/callback-box"
npm install --no-audit --no-fund

echo "=== Rebuilding frontend ==="
cd "$INSTALL_DIR/callback-box/src/frontend"
npm install --no-audit --no-fund
npm run build

echo "=== Restarting services ==="
systemctl restart callback-serve callback-scheduler

echo "=== Done ==="
systemctl is-active callback-serve || true
systemctl is-active callback-scheduler || true
