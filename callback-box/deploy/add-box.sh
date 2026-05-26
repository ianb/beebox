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
CB_USER="callback"
CB_HOME="/home/$CB_USER"
BOXES_DIR="$CB_HOME/boxes"

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

# Clone/pull as root (su drops the SSH agent socket, breaking agent
# forwarding), then chown to the callback user.
# Mark as safe.directory so root can operate on callback-owned repos.
git config --global --add safe.directory "$BOX_PATH"

if [[ -d "$BOX_PATH" ]]; then
  echo "Box already exists at $BOX_PATH, pulling latest..."
  cd "$BOX_PATH" && git pull --ff-only
else
  echo "Cloning $REPO to $BOX_PATH..."
  mkdir -p "$BOXES_DIR"
  git clone "$REPO" "$BOX_PATH"
fi

# Run cb init to ensure all standard directories exist (e.g., people/)
# and agent docs are up to date. Run as callback user so files get
# correct ownership. Must chown first so callback can write.
chown -R $CB_USER:$CB_USER "$BOX_PATH"
echo "Running cb init to update box structure..."
su - $CB_USER -c "cd '$BOX_PATH' && cb init . --skip-git" 2>&1 || echo "Warning: cb init failed (non-fatal)"
# Re-chown in case cb init created files as root (shouldn't happen, but safe)
chown -R $CB_USER:$CB_USER "$BOX_PATH"

# Register with the shared box manifest (used by both serve and scheduler).
su - $CB_USER -c "cb boxes add '$BOX_PATH'" 2>/dev/null && echo "Registered with manifest" || echo "Already in manifest"

# Restart services so they pick up the new box from the manifest.
# (No unit rewrite needed — `cb serve` reads ~/.config/cb/boxes.json
# at startup.)
systemctl restart callback-serve callback-scheduler

echo ""
echo "Box '$BOX_NAME' added."
echo "  Path: $BOX_PATH"
echo "  URL:  https://box.example.com/$BOX_NAME"
echo "  Services restarted."

# Wait for server to be ready, then run health check
sleep 2
HEALTH=\$(curl -sf "http://localhost:3210/$BOX_NAME/api/health" 2>/dev/null)
if [ -z "\$HEALTH" ]; then
  echo "  Health check: could not reach server (may still be starting)"
elif echo "\$HEALTH" | grep -q '"status":"healthy"'; then
  echo "  Health check: OK"
else
  echo "  Health check: issues detected"
  # Show failed check messages
  echo "\$HEALTH" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data.get('checks', []):
    if not c.get('ok'):
        sev = 'ERROR' if c.get('severity') == 'error' else 'WARN'
        print(f'    [{sev}] {c[\"message\"]}')
" 2>/dev/null || echo "    (could not parse health response)"
fi
REMOTE
