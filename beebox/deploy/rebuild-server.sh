#!/usr/bin/env bash
set -euo pipefail

# Pull latest code and rebuild on the server.
# Run locally: ./deploy/rebuild-server.sh
# Or on server directly: /root/rebuild.sh

INSTALL_DIR="/opt/beebox"

echo "=== Pulling latest code ==="
for repo in beebox; do
  echo "  $repo..."
  cd "$INSTALL_DIR/$repo" && git pull --ff-only
done

echo "=== Rebuilding beebox ==="
cd "$INSTALL_DIR/beebox"
pnpm install

# Rebuild the CLI bundle + dist/cards. The server runs bbx via tsx, but
# box-local schemas import `beebox/cards`, which package.json `exports`
# maps to ./dist/cards/index.js (gitignored, emitted by build-cli.ts). Without
# this, a pull that changed src/cards/ leaves dist/cards stale or missing and
# every box-local schema fails to load. (deploy.sh builds this before rsync;
# this rebuild path must too.)
echo "=== Rebuilding CLI bundle (dist/cli.mjs + dist/cards) ==="
node scripts/build-cli.ts

echo "=== Rebuilding frontend ==="
cd "$INSTALL_DIR/beebox/src/frontend"
pnpm install
pnpm build

echo "=== Restarting services ==="
systemctl restart beebox-hub beebox-scheduler

echo "=== Done ==="
systemctl is-active beebox-hub || true
systemctl is-active beebox-scheduler || true
