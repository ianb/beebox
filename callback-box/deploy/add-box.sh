#!/usr/bin/env bash
set -euo pipefail

# Add a box to the server: clone its repo, register with the scheduler,
# seed access + connector secrets, and restart so it's served.
#
# Usage (run locally):
#   ./deploy/add-box.sh <repo> [box-name] [--allow EMAIL]... [--secrets-from BOX]
#
#   <repo>           GitHub URL, SSH URL, or owner/repo shorthand
#   [box-name]       directory/slug override (default: repo basename)
#   --allow EMAIL    grant an extra user access (repeatable). The owner
#                    always has access; this is only for ADDITIONAL users.
#                    Written to config/box.json, new boxes only — never
#                    clobbers an existing config.
#   --secrets-from BOX  copy config/connectors/*.secret.json from another
#                    box (e.g. the shared Mistral key). Avoids the
#                    "API key not configured" health warning.
#
#   ./deploy/add-box.sh ianb/box-birch birch --allow user@gmail.com --secrets-from personal
#
# Re-running on an existing box pulls latest + re-inits (idempotent); it
# leaves access config untouched (edit box.json by hand to change access).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CB_USER="callback"
CB_HOME="/home/$CB_USER"
BOXES_DIR="$CB_HOME/boxes"

# ── Parse arguments ─────────────────────────────────────────────────
REPO=""
BOX_NAME=""
ALLOW_EMAILS=()
SECRETS_FROM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow)
      [[ $# -ge 2 ]] || { echo "Error: --allow needs an email"; exit 1; }
      ALLOW_EMAILS+=("$2"); shift 2 ;;
    --secrets-from)
      [[ $# -ge 2 ]] || { echo "Error: --secrets-from needs a box name"; exit 1; }
      SECRETS_FROM="$2"; shift 2 ;;
    -*)
      echo "Error: unknown flag '$1'"; exit 1 ;;
    *)
      if [[ -z "$REPO" ]]; then REPO="$1"
      elif [[ -z "$BOX_NAME" ]]; then BOX_NAME="$1"
      else echo "Error: unexpected argument '$1'"; exit 1; fi
      shift ;;
  esac
done

if [[ -z "$REPO" ]]; then
  echo "Usage: $0 <repo> [box-name] [--allow EMAIL]... [--secrets-from BOX]"
  exit 1
fi

# Normalize owner/repo shorthand to an SSH URL
if [[ "$REPO" =~ ^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+$ ]]; then
  REPO="git@github.com:${REPO}.git"
fi

[[ -n "$BOX_NAME" ]] || BOX_NAME=$(basename "$REPO" .git)
BOX_PATH="$BOXES_DIR/$BOX_NAME"

# Comma-join allowed emails for the remote python one-liner.
ALLOW_CSV=""
if [[ ${#ALLOW_EMAILS[@]} -gt 0 ]]; then
  ALLOW_CSV=$(IFS=,; echo "${ALLOW_EMAILS[*]}")
fi

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

# ── Provision the box on the server ─────────────────────────────────
# NOTE: this is an UNQUOTED heredoc — local vars ($BOX_PATH, $ALLOW_CSV,
# ...) expand here before sending. Keep it free of backticks and bare
# $(...) (they'd run locally); use \$ for anything the remote evaluates.
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

# Access config: only write for a brand-new box, never clobber an
# existing one (re-deploys keep their hand-tuned access).
if [[ -n "$ALLOW_CSV" ]]; then
  if [[ -f "$BOX_PATH/config/box.json" ]]; then
    echo "Access: box.json exists — leaving it unchanged (add by hand: $ALLOW_CSV)"
  else
    python3 -c "import json; json.dump({'allowedEmails': '$ALLOW_CSV'.split(',')}, open('$BOX_PATH/config/box.json','w'), indent=2)"
    echo "Access: wrote config/box.json (allowedEmails: $ALLOW_CSV)"
  fi
fi

# Seed connector secrets from a reference box (the shared Mistral key,
# etc.) so transcription and connectors work without a manual copy.
if [[ -n "$SECRETS_FROM" ]]; then
  mkdir -p "$BOX_PATH/config/connectors"
  if cp $BOXES_DIR/$SECRETS_FROM/config/connectors/*.secret.json "$BOX_PATH/config/connectors/" 2>/dev/null; then
    chmod 600 "$BOX_PATH/config/connectors/"*.secret.json
    echo "Secrets: copied from '$SECRETS_FROM'"
  else
    echo "Secrets: none found on '$SECRETS_FROM' (nothing copied)"
  fi
fi

# Re-chown everything (cb init / the writes above ran as root in places).
chown -R $CB_USER:$CB_USER "$BOX_PATH"

# Register with the shared box manifest (used by both serve and scheduler).
su - $CB_USER -c "cb boxes add '$BOX_PATH'" 2>/dev/null && echo "Registered with manifest" || echo "Already in manifest"

# Restart services LAST, so they pick up the box, its access config, and
# its secrets in a single restart. (cb serve reads ~/.config/cb/boxes.json
# at startup — no unit rewrite needed.)
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
