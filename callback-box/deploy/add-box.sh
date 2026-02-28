#!/usr/bin/env bash
set -euo pipefail

# Add a box to the server: clone its repo, register with scheduler,
# and update the serve service to include it.
#
# Usage (run locally):
#   ./deploy/add-box.sh <github-repo-url>
#   ./deploy/add-box.sh git@github.com:ianb/hearth.git
#   ./deploy/add-box.sh ianb/hearth

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOXES_DIR="/root/boxes"

# ── Parse repo argument ─────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <repo> [box-name]"
  echo "  repo: GitHub URL, SSH URL, or owner/repo shorthand"
  echo "  box-name: optional override for the directory name"
  exit 1
fi

REPO="$1"
# Normalize shorthand to SSH URL
if [[ "$REPO" =~ ^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+$ ]]; then
  REPO="git@github.com:${REPO}.git"
fi

# Derive box name from repo URL (or use second arg)
if [[ $# -ge 2 ]]; then
  BOX_NAME="$2"
else
  BOX_NAME=$(basename "$REPO" .git)
fi

BOX_PATH="$BOXES_DIR/$BOX_NAME"

# ── Get server IP ───────────────────────────────────────────────────
if [[ -f "$SCRIPT_DIR/server-ip" ]]; then
  SERVER_IP=$(cat "$SCRIPT_DIR/server-ip")
else
  SERVER_IP=$(hcloud server ip callback-box 2>/dev/null)
fi

if [[ -z "$SERVER_IP" ]]; then
  echo "Error: No server IP found. Run create-server.sh first."
  exit 1
fi

SSH_OPTS="-A -o StrictHostKeyChecking=no"

echo "Adding box '$BOX_NAME' from $REPO..."

# ── Clone the box repo on the server ────────────────────────────────
# shellcheck disable=SC2029
ssh $SSH_OPTS "root@$SERVER_IP" bash -s <<REMOTE
set -euo pipefail

if [[ -d "$BOX_PATH" ]]; then
  echo "Box already exists at $BOX_PATH, pulling latest..."
  cd "$BOX_PATH" && git pull --ff-only
else
  echo "Cloning $REPO to $BOX_PATH..."
  mkdir -p "$BOXES_DIR"
  git clone "$REPO" "$BOX_PATH"
fi

# Register with scheduler
cb scheduler add "$BOX_PATH" 2>/dev/null && echo "Registered with scheduler" || echo "Already registered with scheduler"

# Rebuild the serve service to include all boxes
echo "Updating systemd services..."
BOX_DIRS=\$(find $BOXES_DIR -maxdepth 1 -mindepth 1 -type d | sort | tr '\n' ' ')

cat > /etc/systemd/system/callback-serve.service <<EOF
[Unit]
Description=Callback Box Web Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cb serve --host 0.0.0.0 --port 3210 \$BOX_DIRS
WorkingDirectory=$BOXES_DIR
EnvironmentFile=/root/.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl restart callback-serve callback-scheduler

echo ""
echo "Box '$BOX_NAME' added."
echo "  Path: $BOX_PATH"
echo "  URL:  https://box.example.com/$BOX_NAME"
echo "  Services restarted."
REMOTE
