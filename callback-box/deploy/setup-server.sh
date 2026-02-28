#!/usr/bin/env bash
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────
REPO_BASE="git@github.com:ianb"
REPOS=(cardworks callback-dropbox callback-box)
INSTALL_DIR="/opt/callback"
BOX_DIR="/root/boxes/test1"
NODE_MAJOR=22

echo "=== Callback Box Server Setup ==="

# ── System packages ─────────────────────────────────────────────────
echo "Installing system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git git-lfs curl nginx build-essential ca-certificates gnupg

# ── Node.js via NodeSource ──────────────────────────────────────────
echo "Installing Node.js $NODE_MAJOR..."
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
echo "Node.js $(node -v), npm $(npm -v)"

# ── Git config ───────────────────────────────────────────────────────
git config --global user.email "callback-box@box.example.com"
git config --global user.name "Callback Box"

# ── GitHub SSH setup ─────────────────────────────────────────────────
echo "Adding GitHub to known hosts..."
mkdir -p ~/.ssh
ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null

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
npm install --no-audit --no-fund
npm run build

echo "Building callback-dropbox..."
cd "$INSTALL_DIR/callback-dropbox"
npm install --no-audit --no-fund
npm run build

echo "Installing callback-box..."
cd "$INSTALL_DIR/callback-box"
npm install --no-audit --no-fund

echo "Building frontend..."
cd "$INSTALL_DIR/callback-box/src/frontend"
npm install --no-audit --no-fund
npm run build

# ── Symlink cb CLI ──────────────────────────────────────────────────
echo "Symlinking cb CLI..."
ln -sf "$INSTALL_DIR/callback-box/bin/cb" /usr/local/bin/cb
cb --help >/dev/null 2>&1 && echo "cb CLI is working" || echo "WARNING: cb CLI test failed"

# ── Install Claude Code CLI ─────────────────────────────────────────
echo "Installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code

# ── Create test box ─────────────────────────────────────────────────
echo "Creating test box at $BOX_DIR..."
mkdir -p "$BOX_DIR"
cd "$BOX_DIR"
if [[ ! -f .cb-box ]]; then
  git init
  cb init .
  git add -A && git commit -m "Initial box setup"
fi

# ── Environment file ────────────────────────────────────────────────
if [[ ! -f /root/.env ]]; then
  echo "Creating /root/.env with placeholders..."
  cat > /root/.env <<'ENVEOF'
# Required
ANTHROPIC_API_KEY=sk-ant-REPLACE_ME
PUBLIC_URL=https://box.example.com

# Optional
# THINKING_OPENAI_API_KEY=sk-REPLACE_ME
# CALLBACK_MISTRAL_API_KEY=REPLACE_ME
ENVEOF
else
  echo "/root/.env already exists, not overwriting"
fi

# ── Systemd: callback-serve ─────────────────────────────────────────
echo "Creating systemd services..."
BOXES_DIR="/root/boxes"
BOX_DIRS=$(find "$BOXES_DIR" -maxdepth 1 -mindepth 1 -type d | sort | tr '\n' ' ')

cat > /etc/systemd/system/callback-serve.service <<EOF
[Unit]
Description=Callback Box Web Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cb serve --host 0.0.0.0 --port 3210 $BOX_DIRS
WorkingDirectory=$BOXES_DIR
EnvironmentFile=/root/.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# ── Systemd: callback-scheduler ────────────────────────────────────
# Register all boxes with the scheduler
for box in $BOX_DIRS; do
  cb scheduler add "$box" 2>/dev/null || true
done

cat > /etc/systemd/system/callback-scheduler.service <<EOF
[Unit]
Description=Callback Box Scheduler
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cb scheduler start
EnvironmentFile=/root/.env
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable callback-serve callback-scheduler
systemctl start callback-serve callback-scheduler

# ── Nginx reverse proxy ────────────────────────────────────────────
echo "Configuring nginx..."
cat > /etc/nginx/sites-available/callback <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

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
