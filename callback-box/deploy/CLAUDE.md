# Deploy

Server provisioning and deployment scripts for Hetzner cloud. See `deploy/README.md` for full setup guide.

Key files:
- `deploy.sh` — rsync-based deploy from local working tree
- `create-server.sh` — provision a Hetzner box
- `setup-server.sh` — install software, create `callback` user, clone repos
- `server-ip` — target server IP (not committed)

## Waiting for a deploy to finish

The post-commit hook backgrounds `deploy.sh` and writes its output to `deploy/.last-deploy.log`. To wait for it to finish, poll the log tail — do NOT use a long leading `sleep` (the harness blocks it):

```bash
until tail -3 deploy/.last-deploy.log | grep -qE "Deploy complete|Deploy failed|npm error code"; do sleep 5; done
tail -15 deploy/.last-deploy.log
```

Then confirm the server picked up the new commit:

```bash
ssh root@$(cat deploy/server-ip) 'cat /opt/callback/callback-box/deploy-info.json'
```

