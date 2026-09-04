#!/usr/bin/env bash
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────
SERVER_NAME="beebox"
SERVER_TYPE="cpx21"         # 3 vCPU, 4GB RAM, 80GB SSD (x86, Ashburn)
IMAGE="ubuntu-24.04"
LOCATION="ash"              # Ashburn, US East
SSH_KEY_NAME="beebox"
SSH_KEY_PATH="$HOME/.ssh/id_ed25519.pub"
CF_DOMAIN="box.example.com"
CF_ZONE="ianbicking.org"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Load .env ───────────────────────────────────────────────────────
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a
  # Operator-authored, gitignored, and absent in a fresh clone.
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/.env"
  set +a
fi

# ── Preflight ───────────────────────────────────────────────────────
if ! command -v hcloud &>/dev/null; then
  echo "Error: hcloud CLI not found. Install with: brew install hcloud"
  exit 1
fi

if ! hcloud context active &>/dev/null; then
  echo "Error: No active hcloud context. Run: hcloud context create beebox"
  exit 1
fi

# ── Destroy existing server ─────────────────────────────────────────
if hcloud server describe "$SERVER_NAME" &>/dev/null; then
  OLD_IP=$(hcloud server ip "$SERVER_NAME" 2>/dev/null || true)
  echo "Destroying existing server '$SERVER_NAME'..."
  hcloud server delete "$SERVER_NAME"
  # Remove stale host key to avoid agent forwarding issues on recreate
  if [[ -n "$OLD_IP" ]]; then
    ssh-keygen -R "$OLD_IP" 2>/dev/null || true
  fi
  echo "Waiting a moment for cleanup..."
  sleep 3
fi

# ── Ensure SSH key is registered ────────────────────────────────────
if ! hcloud ssh-key describe "$SSH_KEY_NAME" &>/dev/null; then
  echo "Uploading SSH key '$SSH_KEY_NAME' from $SSH_KEY_PATH..."
  if [[ ! -f "$SSH_KEY_PATH" ]]; then
    echo "Error: SSH key not found at $SSH_KEY_PATH"
    exit 1
  fi
  hcloud ssh-key create --name "$SSH_KEY_NAME" --public-key-from-file "$SSH_KEY_PATH"
fi

# ── Create server ───────────────────────────────────────────────────
echo "Creating server '$SERVER_NAME' ($SERVER_TYPE in $LOCATION)..."
hcloud server create \
  --name "$SERVER_NAME" \
  --type "$SERVER_TYPE" \
  --image "$IMAGE" \
  --location "$LOCATION" \
  --ssh-key "$SSH_KEY_NAME"

SERVER_IP=$(hcloud server ip "$SERVER_NAME")
# Seed the opt-in deploy config, which is what makes this checkout one that
# deploys at all (see deploy/target.env.example). Only the host is written; an
# existing target.env is left alone — it may carry a whole operator's settings.
if [[ -f "$SCRIPT_DIR/target.env" ]]; then
  echo "Server created at $SERVER_IP"
  echo "NOTE: $SCRIPT_DIR/target.env already exists — set BBX_DEPLOY_HOST=$SERVER_IP in it yourself."
else
  printf 'BBX_DEPLOY_HOST=%s\n' "$SERVER_IP" > "$SCRIPT_DIR/target.env"
  echo "Server created at $SERVER_IP (wrote deploy/target.env)"
fi

# ── Update Cloudflare DNS ───────────────────────────────────────────
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "Updating Cloudflare DNS: $CF_DOMAIN → $SERVER_IP..."

  # Get zone ID
  CF_ZONE_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=$CF_ZONE" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'][0]['id'])")

  # Check for existing record
  EXISTING=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records?type=A&name=$CF_DOMAIN" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json")
  RECORD_ID=$(echo "$EXISTING" | python3 -c "import sys,json; r=json.load(sys.stdin)['result']; print(r[0]['id'] if r else '')" 2>/dev/null || true)

  if [[ -n "$RECORD_ID" ]]; then
    # Update existing record
    curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records/$RECORD_ID" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"A\",\"name\":\"$CF_DOMAIN\",\"content\":\"$SERVER_IP\",\"ttl\":1,\"proxied\":true}" >/dev/null
    echo "Updated existing DNS record."
  else
    # Create new record
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"A\",\"name\":\"$CF_DOMAIN\",\"content\":\"$SERVER_IP\",\"ttl\":1,\"proxied\":true}" >/dev/null
    echo "Created new DNS record."
  fi

  # Set SSL mode to Flexible (Cloudflare→origin over HTTP)
  echo "Setting SSL mode to Flexible..."
  curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/settings/ssl" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data '{"value":"flexible"}' >/dev/null
  echo "SSL mode set."
else
  echo "Skipping DNS update (set CLOUDFLARE_API_TOKEN to enable)"
fi

# ── Wait for SSH ────────────────────────────────────────────────────
echo "Waiting for SSH to become available..."
for i in $(seq 1 30); do
  if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes "root@$SERVER_IP" true 2>/dev/null; then
    echo "SSH is ready."
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "Error: SSH did not become available after 30 attempts"
    exit 1
  fi
  sleep 2
done

# ── Upload and run setup script ─────────────────────────────────────
echo "Uploading scripts..."
scp -o StrictHostKeyChecking=no "$SCRIPT_DIR/setup-server.sh" "$SCRIPT_DIR/rebuild-server.sh" "root@$SERVER_IP:/root/"
ssh -o StrictHostKeyChecking=no "root@$SERVER_IP" "chmod +x /root/setup-server.sh /root/rebuild-server.sh && ln -sf /root/rebuild-server.sh /usr/local/bin/bbx-rebuild"

echo "Running setup on server (this will take a few minutes)..."
ssh -A -o StrictHostKeyChecking=no "root@$SERVER_IP" "chmod +x /root/setup-server.sh && /root/setup-server.sh"

# ── Done ────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "  Server ready!"
echo "  IP:   $SERVER_IP"
echo "  SSH:  ssh root@$SERVER_IP"
echo "  Web:  http://$SERVER_IP"
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
echo "  DNS:  https://$CF_DOMAIN (proxied via Cloudflare)"
fi
echo ""
echo "  Next steps:"
echo "    1. Edit /root/.env on the server with your API keys"
echo "    2. Restart services: systemctl restart beebox-serve beebox-scheduler"
echo "════════════════════════════════════════════════════"
