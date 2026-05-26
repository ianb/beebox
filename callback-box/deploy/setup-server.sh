#!/usr/bin/env bash
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────
REPO_BASE="git@github.com:ianb"
REPOS=(cardworks callback-box)
INSTALL_DIR="/opt/callback"
CB_USER="callback"
CB_HOME="/home/$CB_USER"
BOX_DIR="$CB_HOME/boxes/test1"
NODE_MAJOR=22

echo "=== Callback Box Server Setup ==="

# ── System packages ─────────────────────────────────────────────────
echo "Installing system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git git-lfs curl nginx build-essential ca-certificates gnupg poppler-utils pandoc

# ── Node.js via NodeSource ──────────────────────────────────────────
echo "Installing Node.js $NODE_MAJOR..."
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
echo "Node.js $(node -v)"

# Enable corepack so pnpm is available (ships with Node 22, no install needed).
corepack enable pnpm
echo "pnpm $(pnpm -v)"

# ── Git config (root, for cloning repos) ─────────────────────────────
git config --global user.email "callback-box@box.example.com"
git config --global user.name "Callback Box"

# ── GitHub SSH setup ─────────────────────────────────────────────────
echo "Adding GitHub to known hosts..."
mkdir -p ~/.ssh
ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null

# ── Create callback user ─────────────────────────────────────────────
echo "Creating $CB_USER user..."
if ! id -u "$CB_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$CB_USER"
fi
su - "$CB_USER" -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh'
grep github.com ~/.ssh/known_hosts >> "$CB_HOME/.ssh/known_hosts" 2>/dev/null || true
chown "$CB_USER:$CB_USER" "$CB_HOME/.ssh/known_hosts"
su - "$CB_USER" -c 'git config --global user.email "callback-box@box.example.com"'
su - "$CB_USER" -c 'git config --global user.name "Callback Box"'

# ── Clone repos ─────────────────────────────────────────────────────
echo "Cloning repositories..."
mkdir -p "$INSTALL_DIR"
for repo in "${REPOS[@]}"; do
  if [[ -d "$INSTALL_DIR/$repo" ]]; then
    echo "  $repo: already exists, pulling..."
    cd "$INSTALL_DIR/$repo" && git pull --ff-only
  else
    echo "  $repo: cloning..."
    git clone "$REPO_BASE/$repo.git" "$INSTALL_DIR/$repo"
  fi
done

# ── Install and build in dependency order ───────────────────────────
echo "Building cardworks..."
cd "$INSTALL_DIR/cardworks"
pnpm install
pnpm build

echo "Installing callback-box..."
cd "$INSTALL_DIR/callback-box"
pnpm install

echo "Building frontend..."
cd "$INSTALL_DIR/callback-box/src/frontend"
pnpm install
pnpm build

# ── Symlink cb CLI ──────────────────────────────────────────────────
echo "Symlinking cb CLI..."
ln -sf "$INSTALL_DIR/callback-box/bin/cb" /usr/local/bin/cb
cb --help >/dev/null 2>&1 && echo "cb CLI is working" || echo "WARNING: cb CLI test failed"

# ── Install Claude Code CLI ─────────────────────────────────────────
# Native installer auto-updates in the background, unlike npm global
# install. Install for BOTH root (manual admin use) and the callback
# user (service use). Each user manages its own version.
echo "Installing Claude Code CLI (native installer)..."
curl -fsSL https://claude.ai/install.sh | bash
su - "$CB_USER" -c 'curl -fsSL https://claude.ai/install.sh | bash'
# Add native install location to callback user's PATH
su - "$CB_USER" -c 'grep -q "/.local/bin" ~/.bashrc || echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.bashrc'

# ── Code directory permissions ───────────────────────────────────────
echo "Setting read permissions on $INSTALL_DIR for $CB_USER..."
chmod -R o+rX "$INSTALL_DIR"

# ── Create test box ─────────────────────────────────────────────────
echo "Creating test box at $BOX_DIR..."
su - "$CB_USER" -c "mkdir -p '$BOX_DIR'"
cd "$BOX_DIR"
if [[ ! -f .cb-box ]]; then
  su - "$CB_USER" -c "cd '$BOX_DIR' && git init && cb init . && git add -A && git commit -m 'Initial box setup'"
fi

# ── Environment file ────────────────────────────────────────────────
ENV_FILE="$CB_HOME/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Creating $ENV_FILE with placeholders..."
  cat > "$ENV_FILE" <<'ENVEOF'
# Required
PUBLIC_URL=https://box.example.com

# PATH must include the native Claude Code install location so systemd
# services (which don't source .bashrc) can find the `claude` binary.
PATH=/home/callback/.local/bin:/usr/local/bin:/usr/bin:/bin

# Optional
# THINKING_OPENAI_API_KEY=sk-REPLACE_ME
# CALLBACK_MISTRAL_API_KEY=REPLACE_ME
# CALLBACK_DEEPGRAM_API_KEY=REPLACE_ME
# CALLBACK_DEEPGRAM_PROJECT=REPLACE_ME
ENVEOF
  chown "$CB_USER:$CB_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  echo "$ENV_FILE already exists, not overwriting"
fi

# ── Systemd: callback-serve ─────────────────────────────────────────
echo "Creating systemd services..."
BOXES_DIR="$CB_HOME/boxes"
BOX_DIRS=$(find "$BOXES_DIR" -maxdepth 1 -mindepth 1 -type d | sort | tr '\n' ' ')

# Both serve and scheduler consult the same manifest at
# ~/.config/cb/boxes.json. The systemd unit no longer hard-codes box
# paths; `cb serve` reads the manifest at startup, and a future
# `cb boxes add <path>` just requires `systemctl restart callback-serve`
# (no unit rewrite needed).
cat > /etc/systemd/system/callback-serve.service <<EOF
[Unit]
Description=Callback Box Web Server
After=network.target

[Service]
Type=simple
User=$CB_USER
Group=$CB_USER
ExecStart=/usr/local/bin/cb serve --host 0.0.0.0 --port 3210
WorkingDirectory=$BOXES_DIR
EnvironmentFile=$CB_HOME/.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# ── Systemd: callback-scheduler ────────────────────────────────────
# Register all existing boxes in the manifest used by both serve and
# scheduler. Idempotent — re-runs are safe.
for box in $BOX_DIRS; do
  su - "$CB_USER" -c "cb boxes add '$box'" 2>/dev/null || true
done

cat > /etc/systemd/system/callback-scheduler.service <<EOF
[Unit]
Description=Callback Box Scheduler
After=network.target

[Service]
Type=simple
User=$CB_USER
Group=$CB_USER
ExecStart=/usr/local/bin/cb scheduler start
WorkingDirectory=$BOXES_DIR
EnvironmentFile=$CB_HOME/.env
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# ── Systemd: nightly Claude Code self-update ───────────────────────
# Claude Code's built-in auto-updater only fires during interactive-ish
# sessions, so server-side short-lived invocations drift behind.
# This timer runs `claude update` nightly as the callback user.
#
# Observability:
#   - Wrapper script logs to $CB_HOME/claude-update.log (every run writes
#     start/ok or start/FAIL lines, timestamped).
#   - Failure also logs to syslog via `logger -p daemon.err`.
#   - Belt-and-suspenders: OnFailure= fires claude-update-failure.service
#     so even if the wrapper itself can't run, the journal still gets a
#     failure record.
#
# ExecStart runs the script from its checked-out location so normal
# deploys (deploy.sh rsync) pick up any edits with no extra step.
CLAUDE_UPDATE_SCRIPT="$INSTALL_DIR/callback-box/deploy/claude-update.sh"
chmod +x "$CLAUDE_UPDATE_SCRIPT"

# Pre-create the log file with correct ownership.
touch "$CB_HOME/claude-update.log"
chown "$CB_USER:$CB_USER" "$CB_HOME/claude-update.log"

cat > /etc/systemd/system/claude-update.service <<EOF
[Unit]
Description=Update Claude Code CLI
After=network-online.target
Wants=network-online.target
OnFailure=claude-update-failure.service

[Service]
Type=oneshot
User=$CB_USER
Group=$CB_USER
Environment=PATH=$CB_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$CLAUDE_UPDATE_SCRIPT
EOF

cat > /etc/systemd/system/claude-update-failure.service <<EOF
[Unit]
Description=Record Claude Code update failure (belt-and-suspenders)

[Service]
Type=oneshot
User=$CB_USER
Group=$CB_USER
ExecStart=/usr/bin/logger -t claude-update -p daemon.err "claude-update.service failed -- wrapper did not record a line; see journalctl -u claude-update.service"
EOF

cat > /etc/systemd/system/claude-update.timer <<EOF
[Unit]
Description=Nightly Claude Code CLI update

[Timer]
OnCalendar=*-*-* 04:00:00
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable callback-serve callback-scheduler claude-update.timer
systemctl start callback-serve callback-scheduler claude-update.timer

# ── Nginx reverse proxy ────────────────────────────────────────────
echo "Configuring nginx..."
cat > /etc/nginx/sites-available/callback <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:3210;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/callback /etc/nginx/sites-enabled/callback
nginx -t && systemctl restart nginx

# ── Done ────────────────────────────────────────────────────────────
echo ""
echo "=== Setup complete ==="
echo "Services:"
systemctl is-active callback-serve || true
systemctl is-active callback-scheduler || true
echo "Nginx: $(systemctl is-active nginx)"
