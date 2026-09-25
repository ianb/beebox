# Deploy

> **This is not how you install a Bee Box.** The supported install-and-update
> path, local or on a VPS, is the container flow in
> [`../docs/install/docker.md`](../docs/install/docker.md).

What lives here is one operator's pipeline: rsync a built commit to a
long-lived Ubuntu VPS that serves many boxes behind nginx and systemd, then
converge and health-check them. The server it builds and runs is documented
under [`../docs/server.md`](../docs/server.md); this file is a map of the
directory.

Nothing here runs until you opt in. `deploy/target.env` (gitignored; copy
[`target.env.example`](./target.env.example)) names the server, and its
presence is the switch: without it the commit hooks ship nothing and say
nothing, and every script below refuses with the setup steps.

| File | What it is |
|---|---|
| `deploy.sh` | Deploy a commit: build in the persistent detached checkout, stage on the server, activate under the maintenance controller, converge boxes, health-check. [Deploying](../docs/server/deploying.md). |
| `hetzner/create-server.sh`, `hetzner/setup-server.sh` | Example provisioners for the one host shape `deploy.sh` ships to. Neither runs on deploy. [Provisioning](../docs/server/provisioning.md). |
| `add-box.sh` | Add a box to the live server in one command. [Boxes](../docs/server/boxes.md). |
| `prod-ssh`, `prod-curl`, `prod-browse` | Reach the production server and the authenticated app as the owner. [Operations](../docs/server/operations.md). |
| `deploy-target.sh`, `target.env.example` | Load the deploy target; the template for it. |
| `deploy-outcome.sh`, `notify-macos` | Record a deploy's outcome; the macOS notifier `BBX_DEPLOY_NOTIFY` can name. |
| `claude-update.sh` | The nightly Claude Code updater the server's timer runs. |
| `nginx/`, `systemd/`, `server-bin/` | The nginx site, the unit drop-ins, and the root helpers a deploy installs. |
