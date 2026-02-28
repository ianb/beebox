#!/usr/bin/env bash
# Pull latest and rebuild on the server (runs locally, executes remotely)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/ssh-server.sh" /root/rebuild-server.sh
