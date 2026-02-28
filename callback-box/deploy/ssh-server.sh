#!/usr/bin/env bash
# SSH into the callback-box server (with agent forwarding)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -f "$SCRIPT_DIR/server-ip" ]]; then
  SERVER_IP=$(cat "$SCRIPT_DIR/server-ip")
else
  SERVER_IP=$(hcloud server ip callback-box 2>/dev/null)
  if [[ -z "$SERVER_IP" ]]; then
    echo "Error: No server IP found. Run create-server.sh first."
    exit 1
  fi
fi

exec ssh -A "root@$SERVER_IP" "$@"
