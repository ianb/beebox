# Server provisioning

Creating and setting up the host: what it needs, the two provisioners, what ends up where, the systemd units, DNS and HTTPS.

## What it is

> **This is not how you install a Bee Box.** The supported install-and-update
> path — local or on a VPS, with TLS — is the container flow in
> [`../docs/docker-install.md`](../install/docker.md). Read that one.
>
> What lives here is *one operator's* pipeline: rsync a built commit to a
> long-lived Ubuntu VPS that serves many boxes behind nginx and systemd, then
> converge and health-check them. It is in the repo because it is real, it is
> exercised daily, and the multi-box convergence it does has no container
> equivalent yet — not because it is the recommended shape.

Nothing here runs until you opt in. `deploy/target.env` (gitignored; copy
[`target.env.example`](../../deploy/target.env.example)) names the server, and its
presence is the switch: without it the commit hooks ship nothing and say
nothing, and every script below refuses with the setup steps. The example
deployment described throughout (`box.example.com`, `/opt/beebox`,
`/home/beebox`, the unit names) is that one operator's; most of it is
configurable in `target.env`, and the rest is what
`hetzner/setup-server.sh` happens to build.

## Prerequisites

For the `hetzner/` provisioners only. `deploy.sh` itself needs nothing but SSH
to an already-provisioned host.

- **hcloud CLI**: `brew install hcloud`
- **Hetzner API token**: Create at [Hetzner Cloud Console](https://console.hetzner.cloud/), then `hcloud context create beebox`
- **SSH key**: `ssh-keygen -t ed25519` (default path `~/.ssh/id_ed25519`)
- **SSH agent**: `ssh-add` (needed for GitHub access on the server via agent forwarding)
- **Cloudflare API token** (optional): Needs Zone DNS Edit and Zone Settings Edit for the zone that holds `box.example.com`

## Setup

`deploy/target.env` (gitignored) — the deploy target. At minimum:

```
BBX_DEPLOY_HOST=203.0.113.10
```

`target.env.example` lists the rest: SSH user, install dir, service account and
home, hub port, the public URL `prod-browse` needs, and `BBX_DEPLOY_NOTIFY` (a
command run on deploy failure — `deploy/notify-macos` is the macOS one).

`deploy/.env` (gitignored), for the `hetzner/` provisioners:

```
CLOUDFLARE_API_TOKEN=your-token-here
```

## Creating the host (`hetzner/create-server.sh`)

One example provisioner, kept because `deploy.sh` needs a host of this exact
shape. Destroys any existing server, creates a fresh Hetzner VPS, provisions
it, and sets up DNS. The server name, region, domain, and zone are constants at
the top of the script — the boxholder's. Edit before running.

```bash
./deploy/hetzner/create-server.sh
```

What it does:
1. Deletes existing `beebox` server if present (cleans up stale SSH keys)
2. Ensures your SSH key is registered with Hetzner
3. Creates a cpx21 (3 vCPU, 4GB RAM) in Ashburn
4. Updates Cloudflare DNS for `box.example.com` (if token provided)
5. Sets Cloudflare SSL to Flexible
6. Uploads and runs `hetzner/setup-server.sh` on the server

## Setting up the host (`hetzner/setup-server.sh`)

Installs everything on Ubuntu 24.04:
- System packages (git, Node.js 24, nginx)
- Clones and builds: beebox
- Symlinks `bbx` CLI to `/usr/local/bin/`
- Installs Claude Code CLI (native installer — auto-updates in background)
- Creates systemd services for the box server and scheduler
- Installs the nginx site file `nginx/beebox.conf` (port 80 → the hub)

**Known gap:** this script still generates the pre-hub `beebox-serve` unit
(one process serving every box off `~/.config/beebox/boxes.json`), not `bbx hub` +
per-box `bbx@<box>.service` units. The live server has since been switched
over to the hub by hand (see "Systemd units" below and
`docs/implemented-plans/boxes-as-packages-v2.md`'s "Post-cutover state" section); a fresh
`hetzner/create-server.sh` run today would need the same by-hand steps repeated
until this script catches up.

**This script does not run on deploy.** `deploy.sh` never invokes it, so a
change to the systemd units here reaches a live server only on a re-provision
or by hand. The nginx site file is the exception: it lives in
`nginx/beebox.conf`, and every deploy runs `server-bin/bbx-nginx-site`, which
makes it the only enabled site, runs `nginx -t` whether or not anything
changed, and reloads nginx when it did. A configuration that fails the test is
restored and fails the deploy before anything stops. Edit the file in the repo,
never on the server. Any other enabled site is moved to
`/etc/nginx/pre-deploy-owned/` with a timestamp; that is where production's
hand-made `callback` site went.

## Server layout

Services run as the **`beebox` user** (User/Group in systemd unit files), not root.
`/opt/beebox/` is root-owned and read-only to that user; `/home/beebox/` is its own.

```
/opt/beebox/              # Source code
  beebox/
/home/beebox/boxes/       # Box data (each is a git repo)
  test1/
  hearth/
/home/beebox/.config/beebox/hub.json   # Hub routing table (slug -> box path)
/home/beebox/.env         # Environment variables (API keys)
/home/beebox/.claude/.credentials.json  # Claude Code OAuth credentials (beebox:beebox, 0600)
/home/beebox/.local/bin/claude  # Claude Code (native install, auto-updates)
/usr/local/bin/bbx           # CLI symlink
/usr/local/bin/codex         # Workspace-pinned Codex CLI symlink
/usr/local/sbin/bbx-host-apt # Root wrapper for box package installs (deploy installs it)
/etc/sudoers.d/beebox-host-apt  # Lets the beebox user run only that wrapper
/var/log/beebox/host-apt.log # One JSON line per box install attempt
/usr/local/sbin/bbx-deploy-window  # Deploy page + downtime record (deploy installs it)
/usr/local/sbin/bbx-nginx-site     # Installs the repo nginx site (deploy installs it)
/run/beebox-deploy/deploy-in-progress.html  # Present only while a deploy has the services down
/var/lib/beebox-deploy/windows.tsv  # One line per deploy window: opened, down, closed, outcome
/etc/nginx/sites-available/beebox  # From deploy/nginx/beebox.conf (deploy installs it)
```

### Box package installs

A box agent installs a distro package with `bbx host install <pkg> --why ...`.
The command records the need in the box's `_config/host-packages.json`, then
runs `bbx-host-apt` through sudo. The wrapper installs only additive,
service-free packages from the distro sources. `deploy.sh` installs the
wrapper and the sudoers entry on every deploy, so `setup-server.sh` needs no
copy. After a server rebuild, `bbx host sync` in each box reinstalls what the
box recorded. Policy and threat model: `server-bin/bbx-host-apt` and
`docs/implemented-plans/box-host-packages.md`. After changing the wrapper, run
`server-bin/bbx-host-apt.smoke.sh`.

## Systemd units

The live server runs `bbx hub` (see `src/cli/commands/hub.ts`) in place of the
old single shared `beebox-serve` process — one hub process routes
`/<slug>/...` to per-box children, each spawned via that box's own `bbx serve`
(so each box can pin its own engine version independently). The scheduler is
unaffected by this change and still runs as a separate unit.

- `beebox-hub` — the hub: reads `hub.json`, spawns/routes/health-checks each
  box's own `bbx serve` child.
- `beebox-scheduler` — scheduler daemon for periodic tasks (still reads
  `~/.config/beebox/boxes.json`, the older manifest — see
  `docs/implemented-plans/boxes-as-packages-v2.md`'s "H4 deletions" for why retiring that
  manifest is deferred, not forgotten).

```bash
# Check status
systemctl status beebox-hub
systemctl status beebox-scheduler

# View logs
journalctl -u beebox-hub -f
journalctl -u beebox-scheduler -f

# Restart after config changes (hub.json doesn't hot-reload — a box add/remove needs this)
systemctl restart beebox-hub
```

### Git-drain drop-in (`deploy/systemd/git-drain.conf`)

Both units need `KillMode=mixed` and `TimeoutStopSec=60`. Without them systemd
signals every process in the cgroup on stop, so a `git` a box child is running
gets killed by systemd rather than by us — and a `git` SIGKILLed mid-index-write
leaves a `.git/index.lock` no process owns, which blocks every writer in that
box until a human deletes it. With `mixed`, only the main process is signalled
and it drains its own git spans before exiting.

**`deploy.sh` reconfirms this on every deploy** — it reinstalls every `.conf`
in `deploy/systemd/` into both `beebox-hub.service.d/` and
`beebox-scheduler.service.d/`, and `daemon-reload`s only when something
changed, immediately before the restart. The drop-in directory is the seam that
lets a deploy own a unit SETTING without owning the unit itself, which matters
because `setup-server.sh` still emits the pre-hub unit shape (see the Known gap
above). Anything a future deploy must guarantee about the units belongs here as
another `.conf`, not as a by-hand step someone repeats and then forgets.

Verify with `systemctl show beebox-hub -p KillMode -p TimeoutStopUSec`.

### Production-safe webapp defaults

Security-sensitive webapp behavior fails closed when configuration is absent:
tRPC never sends server stacks, Fastify always serves the built-frontend CSP,
and `/api/external` plus mock TTS are disabled unless a development launcher
sets the strict opt-in `BBX_DEV_SURFACES=1`. The production systemd units and
shared `.env` must not set that flag.

`NODE_ENV` is not a webapp security control and is not forwarded to box engine
children. Do not add it to the production unit or shared `.env`; child tools
and package managers can interpret it independently.

**Rollback lever:** the old `beebox-serve.service` unit is stopped and
disabled, not deleted — it stays on disk as `beebox-serve-disabled-on-disk`
(masked, not purged) so a bad hub rollout can be rolled back with
`systemctl disable --now beebox-hub && systemctl enable --now beebox-serve`.
**Never run both at once** — two engines serving the same box against its
one `events.db` is a corrupting state, not just a wasteful one (the plan's
Failure modes section calls this out as an accepted, operator-driven risk
during any cutover window).

**`BBX_CLI_PREBUILT` loose end:** `bin/bbx` skips its dev-mode staleness
rebuild check when this env var is set — the old `beebox-serve` and
scheduler units set it so they never pay (or risk failing) a tsx rebuild at
boot. The per-box `bbx@<box>`-style units the hub spawns need the same
treatment, and `setup-server.sh` needs to actually generate them with it set;
neither has been verified end-to-end yet.

## DNS and HTTPS

- DNS: `box.example.com` → server IP (Cloudflare proxied, auto-managed by `hetzner/create-server.sh`)
- HTTPS: Handled by Cloudflare (SSL mode: Flexible — HTTPS to Cloudflare, HTTP to origin)
