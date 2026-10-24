#!/usr/bin/env bash
#
# ONE EXAMPLE PROVISIONER, NOT THE INSTALL PATH; see docs/install/docker.md for
# the supported install.
#
# Runs once, as root, after cloud-init has finished (hetzner/cloud-init.yaml
# installed the packages, toolchain and users) and before the first
# deploy/deploy.sh. create-server.sh uploads and runs it. It covers the root
# steps between the two that cloud-config does not express: GitHub host keys,
# git identity, the hub's .env skeleton, Claude Code retention and its nightly
# updater, and the Docling model pre-fetch.
#
# deploy.sh owns everything repo-shaped: /opt/beebox ownership, the hub,
# scheduler and per-box units, sudoers, helpers, and the nginx site. Nothing
# here creates a box. Re-running is safe: every step checks before it writes.
#
# Usage: provision.sh [repo-checkout-path]   (default /opt/beebox/beebox)
set -euo pipefail

BBX_USER="beebox"
BBX_HOME="/home/$BBX_USER"
CHECKOUT="${1:-/opt/beebox/beebox}"
UPDATE_SCRIPT="/opt/beebox/beebox/deploy/claude-update.sh"
GIT_EMAIL="beebox@box.example.com"
GIT_NAME="Bee Box"

echo "=== Bee Box provision ==="

if ! id -u "$BBX_USER" &>/dev/null || ! [[ -x /usr/local/bin/claude ]]; then
  echo "Error: cloud-init has not finished (no $BBX_USER user or /usr/local/bin/claude)." >&2
  echo "Run: cloud-init status --wait" >&2
  exit 1
fi

# ── GitHub known_hosts ──────────────────────────────────────────────
# cloud-init puts GitHub's key in /etc/ssh/ssh_known_hosts; these per-user
# files cover tools that read only the user file.
add_github_key() {
  local home="$1" owner="$2"
  install -d -m 0700 -o "$owner" -g "$owner" "$home/.ssh"
  touch "$home/.ssh/known_hosts"
  if ! grep -q '^github.com ' "$home/.ssh/known_hosts"; then
    ssh-keyscan -t ed25519 github.com >> "$home/.ssh/known_hosts" 2>/dev/null
  fi
  chown "$owner:$owner" "$home/.ssh/known_hosts"
  chmod 0644 "$home/.ssh/known_hosts"
}
echo "Adding GitHub to known hosts..."
add_github_key /root root
add_github_key "$BBX_HOME" "$BBX_USER"

# ── Git identity for the beebox user ────────────────────────────────
# (root and the system level got theirs from cloud-init.)
su - "$BBX_USER" -c "git config --global user.email '$GIT_EMAIL'"
su - "$BBX_USER" -c "git config --global user.name '$GIT_NAME'"

# ── Environment file ────────────────────────────────────────────────
# The hub's own environment (EnvironmentFile= on the hub unit). The hub derives
# the box units' /etc/beebox/box.env from it.
ENV_FILE="$BBX_HOME/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Creating $ENV_FILE with placeholders..."
  cat > "$ENV_FILE" <<'ENVEOF'
# Required
PUBLIC_URL=https://box.example.com

# PATH must include the Claude Code install location so systemd services
# (which don't source .bashrc) can find the `claude` binary.
PATH=/usr/local/bin:/usr/bin:/bin

# Connector credentials do NOT go here. They live in the machine secret store:
#   bbx engine secrets set <name>      (mistral, deepgram, openai, openai-thinking, gemini, ...)
#   bbx engine secrets grant <box> <name>
# See docs/secrets.md.

# Optional — Google sign-in for the fleet login surface. This pair IS env
# configuration: login runs before any box exists, so it cannot use a per-box
# grant. A box's own Google connectors read the store instead.
# GOOGLE_OAUTH_CLIENT_ID=REPLACE_ME
# GOOGLE_OAUTH_CLIENT_SECRET=REPLACE_ME
ENVEOF
  chown "$BBX_USER:$BBX_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  echo "$ENV_FILE already exists, not overwriting"
fi

# ── Claude Code transcript retention ────────────────────────────────
# Claude Code prunes ~/.claude/projects/**/*.jsonl on a timer whose default is
# 30 days. Transcripts are the raw material the nightly chat review mines into
# husk cards (docs/chat/review.md); once one expires the conversation is
# unrecoverable. 60 days doubles the margin for a box that goes quiet. This is
# the beebox user's setting; each box user's config dir gets its own.
echo "Setting Claude Code transcript retention for $BBX_USER..."
su - "$BBX_USER" -c 'mkdir -p ~/.claude && python3 - <<'"'"'PY'"'"'
import json, os, pathlib
p = pathlib.Path(os.path.expanduser("~/.claude/settings.json"))
d = json.loads(p.read_text()) if p.exists() else {}
d["cleanupPeriodDays"] = 60
p.write_text(json.dumps(d, indent=2) + "\n")
PY'

# ── Nightly Claude Code self-update ─────────────────────────────────
# Claude Code's built-in auto-updater only fires during interactive-ish
# sessions, so server-side short-lived invocations drift behind. The wrapper
# (deploy/claude-update.sh) runs as root: it updates root's native install and
# re-copies it to /usr/local/bin/claude, the one binary every user runs.
#
# Observability: the wrapper logs start/ok/FAIL lines to
# /var/log/beebox/claude-update.log and to syslog on failure; OnFailure= fires
# claude-update-failure.service so the journal records a failure even when the
# wrapper itself cannot run. ExecStart runs the script from the deployed tree,
# so a deploy picks up edits with no extra step.
echo "Installing the claude-update timer..."
install -d -m 0755 /var/log/beebox
touch /var/log/beebox/claude-update.log

cat > /etc/systemd/system/claude-update.service <<EOF
[Unit]
Description=Update Claude Code CLI
After=network-online.target
Wants=network-online.target
OnFailure=claude-update-failure.service

[Service]
Type=oneshot
User=root
Environment=PATH=/root/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$UPDATE_SCRIPT
EOF

cat > /etc/systemd/system/claude-update-failure.service <<'EOF'
[Unit]
Description=Record Claude Code update failure (belt-and-suspenders)

[Service]
Type=oneshot
ExecStart=/usr/bin/logger -t claude-update -p daemon.err "claude-update.service failed -- wrapper did not record a line; see journalctl -u claude-update.service"
EOF

cat > /etc/systemd/system/claude-update.timer <<'EOF'
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
# Until the first deploy puts the script at $UPDATE_SCRIPT, a run would fail;
# the timer fires at 04:00, after which that deploy has happened.
systemctl enable --now claude-update.timer

# ── Docling model pre-fetch ─────────────────────────────────────────
# `bbx scan-import`'s document mode shells out to `uvx docling` (see
# src/services/docling/core.ts). uv is system-wide (cloud-init); every box user
# shares HF_HOME=/var/cache/beebox/hf, so the weights are fetched once, as root.
# Pre-fetch exactly the model weights document mode uses, so the first scanned
# PDF does not hang for minutes downloading them. OCR weights are deliberately
# NOT fetched: extraction runs with do_ocr=False (the scanner supplies the text
# layer), and textless PDFs go to the Gemini photo flow instead; see
# docs/plans/scanner-ingest-docling-decisions.md (D1, D11). `layout` covers
# reading order; `tableformer` covers both fast and accurate table modes.
# The version comes from the one place that holds it, so this can never pin a
# different Docling than the extractor asks `uvx` for.
VERSION_FILE="$CHECKOUT/src/services/docling/version.ts"
if [[ ! -f "$VERSION_FILE" ]]; then
  echo "Skipping the Docling model pre-fetch: $VERSION_FILE not found."
  echo "The first deploy provides the tree; then re-run: provision.sh /opt/beebox/beebox"
else
  DOCLING_VERSION="$(sed -n 's/^export const DOCLING_VERSION = "\([^"]*\)";$/\1/p' "$VERSION_FILE")"
  if [[ -z "$DOCLING_VERSION" ]]; then
    echo "Could not read DOCLING_VERSION from $VERSION_FILE" >&2
    exit 1
  fi
  echo "Pre-fetching Docling $DOCLING_VERSION models (layout + tableformer)..."
  HF_HOME=/var/cache/beebox/hf UV_CACHE_DIR=/var/cache/beebox/uv UV_TORCH_BACKEND=cpu \
    uvx --from "docling==$DOCLING_VERSION" docling-tools models download layout tableformer
  # tmpfiles set the directory modes; root wrote the files into them.
  chgrp -R beebox-boxes /var/cache/beebox/hf /var/cache/beebox/uv
  chmod -R g+rX,o+rX /var/cache/beebox/hf
fi

echo "=== Provision done ==="
echo "Next: edit $ENV_FILE, then run deploy/deploy.sh from a checkout whose target.env names this server."
