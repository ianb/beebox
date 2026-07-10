# Deploy

Server provisioning and deployment scripts for Hetzner cloud. See `deploy/README.md` for full setup guide.

Key files:
- `deploy.sh` — commit-based deploy: builds the requested ref in a persistent
  build checkout (`<main-repo-root>/.deploy-checkout`, a detached git worktree)
  and rsyncs FROM there — never from anyone's working tree. `--ref <ref>`
  selects the commit (default HEAD); concurrent runs collapse latest-wins.
- `create-server.sh` — provision a Hetzner box
- `setup-server.sh` — install software, create `callback` user, clone repos
- `server-ip` — target server IP (not committed)

## Rollback

Any commit in history redeploys with one command (full pipeline — build,
frozen install, restart, healthcheck — so a rollback is as safe as a deploy):

```bash
./deploy/deploy.sh --ref <old-sha>
```

`deploy-info.json` records `requestedRef` so rollbacks are recognizable in
`deploy-history.json` on the server.

## Waiting for a deploy to finish

The post-commit hook backgrounds `deploy.sh` and writes each run to its own
file under `deploy/.deploy-logs/`, with `deploy/.last-deploy.log` kept as a
symlink to the newest run — so the poll below always follows the latest deploy
(including a chained latest-wins deploy). Poll the log tail — do NOT use a
long leading `sleep` (the harness blocks it):

```bash
until tail -3 deploy/.last-deploy.log | grep -qE "Deploy complete|Deploy failed|ERR_PNPM|ELIFECYCLE"; do sleep 5; done
tail -15 deploy/.last-deploy.log
```

Then confirm the server picked up the new commit:

```bash
ssh root@$(cat deploy/server-ip) 'cat /opt/callback/callback-box/deploy-info.json'
```
