# Deploy

Server provisioning and deployment scripts for Hetzner cloud. See `deploy/README.md` for full setup guide.

Key files:
- `deploy.sh` — commit-based deploy: builds the requested ref in a persistent
  build checkout (`<main-repo-root>/.deploy-checkout`, a detached git worktree)
  and rsyncs FROM there — never from anyone's working tree. `--ref <ref>`
  selects the commit (default HEAD); concurrent runs collapse latest-wins.
- `add-box.sh` — add a box to the live server: clone, `bbx init`, access +
  secrets, register with the hub (`bbx hub add-box` → `hub.json`) and the
  scheduler (`bbx boxes add` → `boxes.json`), restart both units, then canary
  the new slug. Preflight-validates the slug before it clones; `--dry-run`
  prints the plan without touching anything.
- `create-server.sh` — provision a Hetzner box
- `setup-server.sh` — install software, create `beebox` user, clone repos
- `server-ip` — target server IP (not committed)
- `prod-ssh` — SSH to prod as root for diagnostics and administration
- `prod-curl` / `prod-browse` — inspect the authenticated production app

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
until tail -3 deploy/.last-deploy.log | grep -qE "Deploy complete|Deploy interrupted|Deploy failed|ERR_PNPM|ELIFECYCLE"; do sleep 5; done
tail -15 deploy/.last-deploy.log
```

Then confirm the server picked up the new commit:

```bash
deploy/prod-ssh 'cat /opt/beebox/beebox/deploy-info.json'
```

The production diagnostic tools resolve `server-ip` from the current checkout
first, then from the main checkout via Git's common directory. `deploy.sh` is
deliberately different: it requires a local `deploy/server-ip` so deployment
remains main-checkout-only.
