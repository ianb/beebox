#!/usr/bin/env bash
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────
REPO_BASE="git@github.com:ianb"
REPOS=(callback-box)
INSTALL_DIR="/opt/callback"
CB_USER="callback"
CB_HOME="/home/$CB_USER"
BOX_DIR="$CB_HOME/boxes/test1"
NODE_MAJOR=24

echo "=== Callback Box Server Setup ==="

# ── System packages ─────────────────────────────────────────────────
echo "Installing system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# qpdf is the scan-upload PDF structure validator (src/core/scan/validate.ts).
# Without it the scan routes refuse PDFs with a 503 rather than quarantine
# unvalidated bytes, so it is a hard requirement, not a nice-to-have.
apt-get install -y -qq git git-lfs curl nginx build-essential ca-certificates gnupg poppler-utils pandoc imagemagick python3-openpyxl xlsx2csv qpdf ffmpeg

# Ubuntu 24.04 ships ImageMagick 6 (`convert`); homebrew + IM7 use `magick`.
# Symlink so scripts written for `magick` work on prod without branching.
if ! command -v magick >/dev/null 2>&1 && command -v convert >/dev/null 2>&1; then
  ln -sf "$(command -v convert)" /usr/local/bin/magick
fi

# ── Node.js via NodeSource ──────────────────────────────────────────
echo "Installing Node.js $NODE_MAJOR..."
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
echo "Node.js $(node -v)"

# Enable corepack so pnpm is available (ships with Node 24, no install needed).
corepack enable pnpm
echo "pnpm $(pnpm -v)"

# AVIF encoding for page renders and figures needs no system package: `sharp`
# ships a prebuilt libvips with AVIF (libheif/aom) support, verified below so a
# platform without a prebuild fails here rather than at the first scan.

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

# ── uv + Docling (document extraction) ──────────────────────────────
# `cb scan-import`'s document mode shells out to `uvx docling` (see
# src/services/docling.ts). uv is installed for the callback user because
# that is who runs the box children, and uv caches its environments and
# Docling caches its model weights under the invoking user's home — one
# install serves every box on the host, since they all run as this user.
# This runs after the clone because the pinned version is read out of the
# checkout, and after the user exists because everything here runs as them.
echo "Installing uv for $CB_USER..."
su - "$CB_USER" -c 'command -v uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh'
su - "$CB_USER" -c 'grep -q "/.local/bin" ~/.bashrc || echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.bashrc'

# Pre-fetch exactly the model weights document mode uses, so the first scanned
# PDF does not hang for minutes downloading them. OCR weights are deliberately
# NOT fetched: extraction runs with do_ocr=False (the scanner supplies the text
# layer), and textless PDFs go to the Gemini photo flow instead — see
# docs/plans/scanner-ingest-docling-decisions.md (D1, D11). `layout` covers
# reading order; `tableformer` covers both fast and accurate table modes.
# The version comes from the one place that holds it, so this can never pin a
# different Docling than the extractor asks `uvx` for.
DOCLING_VERSION="$(sed -n 's/^export const DOCLING_VERSION = "\([^"]*\)";$/\1/p' "$INSTALL_DIR/callback-box/src/services/docling-version.ts")"
if [[ -z "$DOCLING_VERSION" ]]; then
  echo "Could not read DOCLING_VERSION from src/services/docling-version.ts" >&2
  exit 1
fi
echo "Pre-fetching Docling $DOCLING_VERSION models (layout + tableformer)..."
su - "$CB_USER" -c "export PATH=\"\$HOME/.local/bin:\$PATH\"; uvx --from docling==$DOCLING_VERSION docling-tools models download layout tableformer"

# ── Install and build ───────────────────────────────────────────────
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

# ── Verify AVIF encoding ────────────────────────────────────────────
# Document mode re-encodes every page render and figure to AVIF via sharp. A
# libvips build without AVIF would fail on the first scanned PDF instead, so
# prove it here.
echo "Verifying sharp AVIF encoding..."
cd "$INSTALL_DIR/callback-box"
node -e 'const S=require("sharp");if(!S.format.heif.output.file){console.error("sharp has no AVIF output support");process.exit(1)}S({create:{width:8,height:8,channels:3,background:{r:0,g:0,b:0}}}).avif().toBuffer().then(()=>console.log("sharp AVIF encoding OK")).catch(e=>{console.error(e.message);process.exit(1)})'

# ── Install Claude Code CLI ─────────────────────────────────────────
# Native installer auto-updates in the background, unlike npm global
# install. Install for BOTH root (manual admin use) and the callback
# user (service use). Each user manages its own version.
echo "Installing Claude Code CLI (native installer)..."
curl -fsSL https://claude.ai/install.sh | bash
su - "$CB_USER" -c 'curl -fsSL https://claude.ai/install.sh | bash'
# Add native install location to callback user's PATH
su - "$CB_USER" -c 'grep -q "/.local/bin" ~/.bashrc || echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.bashrc'

# Transcript retention. Claude Code prunes ~/.claude/projects/**/*.jsonl on a
# timer whose default is 30 days. Transcripts are the raw material the nightly
# chat review mines into husk cards (docs/chat-review.md) — once one expires the
# conversation is unrecoverable, so a session not reviewed inside the window is
# never reviewable. 60 days doubles the margin for a box that goes quiet.
echo "Setting Claude Code transcript retention for $CB_USER..."
su - "$CB_USER" -c 'mkdir -p ~/.claude && python3 - <<'"'"'PY'"'"'
import json, os, pathlib
p = pathlib.Path(os.path.expanduser("~/.claude/settings.json"))
d = json.loads(p.read_text()) if p.exists() else {}
d["cleanupPeriodDays"] = 60
p.write_text(json.dumps(d, indent=2) + "\n")
PY'


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
# KillMode=mixed + an explicit stop timeout: with systemd's default
# (control-group) the stop signal goes to EVERY process in the cgroup, so a
# `git` a box child is running is signalled by systemd rather than by us, and
# the SIGKILL that follows can land mid-index-write — which leaves a
# `.git/index.lock` no process owns and every writer in that box then fails on.
# `mixed` sends SIGTERM to the main process only and lets it drain its own
# children (see drainBoxGitLocks / BOX_KILL_GRACE_MS); TimeoutStopSec is the
# backstop, set above the in-process grace so systemd escalates only if our own
# teardown failed.
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
KillMode=mixed
TimeoutStopSec=60
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
KillMode=mixed
TimeoutStopSec=60
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# ── Quiet-hour recycle of callback-serve ───────────────────────────
# The web server hot-reloads box-local schema edits by cache-busting the
# dynamic import (Node never frees the old module), so its memory creeps a
# little between restarts. A daily restart at a low-traffic hour reclaims it.
# cb-wait-quiet (shared with deploy.sh) waits, bounded and best-effort, for all
# boxes to be at rest first so the restart doesn't kill an active chat/script.
cat > /usr/local/bin/cb-wait-quiet <<EOF
#!/usr/bin/env bash
# Best-effort: wait up to ~3 min for all boxes to be at rest (no running
# scripts/procedures or active chat turns) before the caller restarts
# callback-serve. Always exits 0 — the wait is advisory, never a hard block.
set -u
DEADLINE=\$(( \$(date +%s) + 180 ))
while true; do
  if su - $CB_USER -c 'CB_CLI_PREBUILT=1 /usr/local/bin/cb activity' >/tmp/cb-activity.out 2>&1; then
    echo "cb-wait-quiet: at rest"; exit 0
  fi
  if [ "\$(date +%s)" -ge "\$DEADLINE" ]; then
    echo "cb-wait-quiet: still busy after wait cap, proceeding:"
    sed 's/^/  /' /tmp/cb-activity.out
    exit 0
  fi
  sleep 10
done
EOF
chmod +x /usr/local/bin/cb-wait-quiet

cat > /etc/systemd/system/callback-serve-recycle.service <<'EOF'
[Unit]
Description=Daily quiet-hour recycle of callback-serve (reclaims schema hot-reload memory)

[Service]
Type=oneshot
# Wait (best-effort) for at-rest, then restart only callback-serve — chat lives
# there, and the scheduler doesn't accumulate the hot-reload leak.
ExecStart=/bin/bash -c '/usr/local/bin/cb-wait-quiet; systemctl restart callback-serve'
EOF

cat > /etc/systemd/system/callback-serve-recycle.timer <<'EOF'
[Unit]
Description=Run callback-serve-recycle daily at a low-traffic hour

[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true

[Install]
WantedBy=timers.target
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
systemctl enable callback-serve callback-scheduler claude-update.timer callback-serve-recycle.timer
systemctl start callback-serve callback-scheduler claude-update.timer callback-serve-recycle.timer

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
        # The tRPC client uses httpBatchStreamLink: the server writes each
        # procedure's result as a JSONL line the moment it resolves, so a fast
        # query renders without waiting for a slow batch-mate. nginx buffers
        # proxied responses by default, which would re-couple the batch by
        # holding every line until the response completed. There is only this
        # one location (everything is proxied to the hub), so the whole app
        # opts out; responses here are dynamic API/HTML, never large static
        # files where buffering would earn its keep.
        proxy_buffering off;
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
