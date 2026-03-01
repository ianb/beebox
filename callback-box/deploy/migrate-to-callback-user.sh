#!/usr/bin/env bash
set -euo pipefail

# One-time migration: switch services from root to a dedicated "callback" user.
# Run on the server as root: bash /opt/callback/callback-box/deploy/migrate-to-callback-user.sh

INSTALL_DIR="/opt/callback"
OLD_BOXES="/root/boxes"
NEW_HOME="/home/callback"
NEW_BOXES="$NEW_HOME/boxes"

echo "=== Migrating to callback user ==="

# ── Stop services ────────────────────────────────────────────────────
echo "Stopping services..."
systemctl stop callback-serve callback-scheduler 2>/dev/null || true

# ── Create user ──────────────────────────────────────────────────────
if id -u callback &>/dev/null; then
  echo "User 'callback' already exists"
else
  echo "Creating user 'callback'..."
  useradd -m -s /bin/bash callback
fi

# ── Move boxes ───────────────────────────────────────────────────────
if [[ -d "$OLD_BOXES" ]] && [[ ! -d "$NEW_BOXES" ]]; then
  echo "Moving boxes from $OLD_BOXES to $NEW_BOXES..."
  mv "$OLD_BOXES" "$NEW_BOXES"
elif [[ -d "$OLD_BOXES" ]] && [[ -d "$NEW_BOXES" ]]; then
  echo "Both $OLD_BOXES and $NEW_BOXES exist — merging..."
  cp -rn "$OLD_BOXES/"* "$NEW_BOXES/" 2>/dev/null || true
  echo "WARNING: Old boxes still at $OLD_BOXES — remove manually after verifying"
else
  echo "Boxes already at $NEW_BOXES (or nothing to move)"
  mkdir -p "$NEW_BOXES"
fi
chown -R callback:callback "$NEW_BOXES"

# ── Move .env ────────────────────────────────────────────────────────
if [[ -f /root/.env ]] && [[ ! -f "$NEW_HOME/.env" ]]; then
  echo "Moving /root/.env to $NEW_HOME/.env..."
  cp /root/.env "$NEW_HOME/.env"
  chown callback:callback "$NEW_HOME/.env"
  chmod 600 "$NEW_HOME/.env"
elif [[ -f /root/.env ]]; then
  echo "Updating $NEW_HOME/.env from /root/.env..."
  cp /root/.env "$NEW_HOME/.env"
  chown callback:callback "$NEW_HOME/.env"
  chmod 600 "$NEW_HOME/.env"
fi

# ── Move session secret ─────────────────────────────────────────────
if [[ -f /root/.cb-session-secret ]] && [[ ! -f "$NEW_HOME/.cb-session-secret" ]]; then
  echo "Moving session secret..."
  cp /root/.cb-session-secret "$NEW_HOME/.cb-session-secret"
  chown callback:callback "$NEW_HOME/.cb-session-secret"
  chmod 600 "$NEW_HOME/.cb-session-secret"
fi

# ── Code directory permissions ───────────────────────────────────────
echo "Setting permissions on $INSTALL_DIR..."
chmod -R o+rX "$INSTALL_DIR"

# ── SSH known_hosts for GitHub ───────────────────────────────────────
echo "Setting up SSH for callback user..."
su - callback -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh'
if [[ -f /root/.ssh/known_hosts ]]; then
  grep github.com /root/.ssh/known_hosts >> "$NEW_HOME/.ssh/known_hosts" 2>/dev/null || true
else
  su - callback -c 'ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null'
fi
chown callback:callback "$NEW_HOME/.ssh/known_hosts"

# ── Git config ───────────────────────────────────────────────────────
echo "Configuring git for callback user..."
su - callback -c 'git config --global user.email "callback-box@box.example.com"'
su - callback -c 'git config --global user.name "Callback Box"'

# ── Update systemd services ─────────────────────────────────────────
echo "Updating systemd services..."
BOX_DIRS=$(find "$NEW_BOXES" -maxdepth 1 -mindepth 1 -type d | sort | tr '\n' ' ')

cat > /etc/systemd/system/callback-serve.service <<EOF
[Unit]
Description=Callback Box Web Server
After=network.target

[Service]
Type=simple
User=callback
Group=callback
ExecStart=/usr/local/bin/cb serve --host 0.0.0.0 --port 3210 $BOX_DIRS
WorkingDirectory=$NEW_BOXES
EnvironmentFile=$NEW_HOME/.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/callback-scheduler.service <<EOF
[Unit]
Description=Callback Box Scheduler
After=network.target

[Service]
Type=simple
User=callback
Group=callback
ExecStart=/usr/local/bin/cb scheduler start
WorkingDirectory=$NEW_BOXES
EnvironmentFile=$NEW_HOME/.env
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# ── Re-register boxes with scheduler as callback user ────────────────
echo "Registering boxes with scheduler..."
for box in $BOX_DIRS; do
  su - callback -c "cb scheduler add '$box'" 2>/dev/null || true
done

# ── Restart ─────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl restart callback-serve callback-scheduler

echo ""
echo "=== Migration complete ==="
echo "User: callback"
echo "Home: $NEW_HOME"
echo "Boxes: $NEW_BOXES"
echo "Services:"
systemctl is-active callback-serve || true
systemctl is-active callback-scheduler || true
echo ""
echo "Verify: systemctl show callback-serve --property=User"
