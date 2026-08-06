#!/usr/bin/env bash
# Pull latest and rebuild on the server (runs locally, executes remotely)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/prod-ssh" /root/rebuild-server.sh
