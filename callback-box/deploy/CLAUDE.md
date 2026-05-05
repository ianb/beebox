# Deploy

Server provisioning and deployment scripts for Hetzner cloud. See `deploy/README.md` for full setup guide.

Key files:
- `deploy.sh` — rsync-based deploy from local working tree
- `create-server.sh` — provision a Hetzner box
- `setup-server.sh` — install software, create `callback` user, clone repos
- `server-ip` — target server IP (not committed)
