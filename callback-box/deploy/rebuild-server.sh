#!/usr/bin/env bash
set -euo pipefail

# Pull latest code and rebuild on the server.
# Run locally: ./deploy/rebuild-server.sh
# Or on server directly: /root/rebuild.sh

INSTALL_DIR="/opt/callback"

echo "=== Pulling latest code ==="
for repo in cardworks callback-box; do
  echo "  $repo..."
  cd "$INSTALL_DIR/$repo" && git pull --ff-only
done

echo "=== Rebuilding cardworks ==="
cd "$INSTALL_DIR/cardworks"
pnpm install
pnpm build

echo "=== Rebuilding callback-box ==="
cd "$INSTALL_DIR/callback-box"
pnpm install

echo "=== Rebuilding frontend ==="
cd "$INSTALL_DIR/callback-box/src/frontend"
pnpm install
pnpm build

echo "=== Restarting services ==="
systemctl restart callback-serve callback-scheduler

echo "=== Done ==="
systemctl is-active callback-serve || true
systemctl is-active callback-scheduler || true
