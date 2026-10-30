# Server provisioning

Creating and setting up the host: what it needs, the provisioners, what ends up where, the systemd units, DNS and HTTPS.

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
`hetzner/cloud-init.yaml` and `hetzner/provision.sh` happen to build.

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
6. Passes `hetzner/cloud-init.yaml` as user data, waits for cloud-init to finish, then uploads and runs `hetzner/provision.sh`

Then run `deploy/deploy.sh` from a checkout whose `target.env` names the server, and `deploy/add-box.sh` for each box.

## Setting up the host (`hetzner/cloud-init.yaml`, `hetzner/provision.sh`)

`cloud-init.yaml` is `#cloud-config` user data. On first boot of Ubuntu 24.04 it installs:
- System packages (git, nginx, poppler, pandoc, ImageMagick, qpdf, ffmpeg, ...)
- Node.js 24 with pnpm (corepack), uv, fclones
- Claude Code (native installer, copied to `/usr/local/bin/claude`)
- Users `beebox` (hub) and `beebox-sched` (scheduler), group `beebox-boxes`
- The tmpfiles rules for `/run/beebox`, `/var/lib/beebox`, `/var/cache/beebox`, `/var/log/beebox` and `/etc/beebox`, and `/etc/beebox/box.env`

`provision.sh` runs once as root after cloud-init finishes and before the first deploy: GitHub host keys, git identity, the `/home/beebox/.env` skeleton, Claude Code transcript retention, the nightly `claude-update` timer, and the Docling model pre-fetch into `/var/cache/beebox/hf` (skipped, with a message, until the first deploy provides the tree; pass the checkout path as `$1`). `setup-server.sh` is a retired stub that exits 1.

**Neither runs on deploy.** `deploy.sh` owns everything repo-shaped: the tree under `/opt/beebox`, the hub, scheduler and box units, sudoers, the helpers, and the nginx site. The nginx site file lives in
`nginx/beebox.conf`, and every deploy runs `server-bin/bbx-nginx-site`, which
makes it the only enabled site, runs `nginx -t` whether or not anything
changed, and reloads nginx when it did. A configuration that fails the test is
restored and fails the deploy before anything stops. Edit the file in the repo,
never on the server. Any other enabled site is moved to
`/etc/nginx/pre-deploy-owned/` with a timestamp; that is where production's
hand-made `callback` site went.

## Server layout

One Linux user and one set of systemd units per box
([design](../implemented-plans/per-box-units.md)). Nothing runs as root except the deploy,
the scheduler's one wrapper, and the nightly Claude Code update. The accounts:

- `bbx-<slug>` — one per box, UID 2000–2999, in group `beebox-boxes`. Owns
  the box and runs its engine and its scheduler passes. No sudo, no login file.
- `beebox` — the hub. Routes requests to the boxes' sockets and holds no box
  secret. It is in `beebox-boxes` for the shared caches (cloud-init puts it
  there); that group guards no box file, since each box's home is private to
  the box's own user and group.
- `beebox-sched` — the scheduler daemon. Its one sudo grant is
  `bbx-box-run <slug> scheduler-pass`, which runs a pass as that box's user.

`/opt/beebox/` is root-owned and read-only to every account; each box's home
is private to its user (`0751` at the top so the hub can read the one file the
box publishes, `0700` inside).

```
/opt/beebox/                       # Source code
  beebox/
/var/lib/beebox/<slug>/            # A box user's home (0751, bbx-<slug>)
  box/                             #   the box itself (a git repo)
  .config/beebox/secrets.json      #   the box's own secret store (its grants only)
  .claude/                         #   Claude Code state for that box's agent
/var/lib/beebox-sched/.config/beebox/boxes.json  # Scheduler manifest (which boxes get passes)
/home/beebox/.config/beebox/hub.json   # Hub routing table (slug -> socket)
/home/beebox/.config/beebox/secrets.json  # Master secret store; add-box.sh exports a box's share
/home/beebox/.env                  # The hub's environment; the hub derives the box units' file from it
/etc/beebox/box.env                # Environment every box unit and scheduler pass loads (hub-written)
/run/beebox/<slug>.sock            # The box's socket (systemd-owned)
/run/beebox/<slug>.hub-secret      # The hub's per-box secret for this boot
/var/cache/beebox/{uv,hf}          # Shared caches, group beebox-boxes
/usr/local/bin/claude              # Claude Code (a copy the nightly updater refreshes)
/usr/local/bin/uv                  # uv, for box scripts
/usr/local/bin/bbx                 # CLI symlink (deploy installs it)
/usr/local/bin/codex               # Workspace-pinned Codex CLI symlink
/usr/local/sbin/bbx-box-run        # The scheduler's root wrapper (deploy installs it)
/etc/sudoers.d/beebox-sched        # Lets beebox-sched run only that wrapper
/usr/local/sbin/bbx-host-apt       # Root wrapper for distro package installs (deploy installs it)
/var/log/beebox/host-apt.log       # One JSON line per package install attempt
/usr/local/sbin/bbx-deploy-window  # Deploy page + downtime record (deploy installs it)
/usr/local/sbin/bbx-nginx-site     # Installs the repo nginx site (deploy installs it)
/run/beebox-deploy/deploy-in-progress.html  # Present only while a deploy has the services down
/var/lib/beebox-deploy/windows.tsv  # One line per deploy window: opened, down, closed, outcome
/etc/nginx/sites-available/beebox  # From deploy/nginx/beebox.conf (deploy installs it)
```

Production keeps `/var/lib/beebox` on a separate volume. A Hetzner snapshot of
the server does not include a volume, so the boxes are backed up only by a
copy taken elsewhere ([deploying](deploying.md#the-box-units)).

A host that was provisioned before this layout cannot be deployed to:
`deploy.sh` and `add-box.sh` refuse when the `beebox-sched` user,
`/var/lib/beebox`, or the `beebox-boxes` group is missing. The one-time
migration script was removed after the last such host migrated (2026-10-25);
provision a new host from `cloud-init.yaml` instead.

### Box package installs

A box agent asks for a distro package with `bbx host install <pkg> --why ...`.
The box has no sudo, so the command only records the need in the box's
`_config/host-packages.json`; the next deploy runs `bbx host sync` for every
box as root, which installs the recorded packages through `bbx-host-apt`. The
wrapper installs only additive, service-free packages from the distro
sources. After a server rebuild the same step reinstalls what every box
recorded. Policy and threat model: `server-bin/bbx-host-apt` and
`docs/implemented-plans/box-host-packages.md`. After changing the wrapper, run
`server-bin/bbx-host-apt.smoke.sh`.

## Systemd units

Every file under `deploy/systemd/` is installed whole on every deploy.

- `beebox-hub` — the hub (`bbx engine hub`, as `beebox`): reads `hub.json`,
  mints one secret per box per boot into `/run/beebox/`, writes
  `/etc/beebox/box.env`, and routes `/<slug>/...` to that box's socket. It
  spawns nothing.
- `beebox-box@<slug>.socket` — systemd listens on `/run/beebox/<slug>.sock`
  and starts the service on the first connection.
- `beebox-box@<slug>.service` — the box's engine (`bbx engine serve`, as
  `bbx-<slug>`, under the `box-sandbox.conf` drop-in). It exits after thirty
  idle minutes and the socket starts it again on demand, so an idle box is
  normally `inactive`.
- `beebox-pass@<slug>.service` — one scheduler pass for one box, as its user.
- `beebox-scheduler` — the scheduler daemon (as `beebox-sched`): reads its
  manifest and starts a `beebox-pass@<slug>` through `bbx-box-run` when a
  box has work due. (The manifest is the older `boxes.json`; see
  `docs/implemented-plans/boxes-as-packages-v2.md`'s "H4 deletions" for why
  retiring it is deferred.)

```bash
# Check status
systemctl status beebox-hub beebox-scheduler
systemctl list-units 'beebox-box@*' 'beebox-pass@*'

# View logs
journalctl -u beebox-hub -f
journalctl -u beebox-box@<slug> -f

# Restart after config changes (hub.json doesn't hot-reload — a box add/remove needs this)
systemctl restart beebox-hub
# Restart one box's engine
systemctl restart beebox-box@<slug>.service
```

`server-bin/box-units.smoke.sh`, run as root on the server, checks the whole
arrangement: ownership, the sandbox, the hub secret's reach, the scheduler's
wrapper.

### Git-drain drop-in (`deploy/systemd/all/git-drain.conf`)

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
because a deploy never re-runs the provisioners. Anything a future deploy must guarantee about the units belongs here as
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

**`BBX_CLI_PREBUILT`:** `bin/bbx` skips its dev-mode staleness rebuild check
when this env var is set, so a unit never pays or risks a tsx rebuild at boot.
The units the deploy installs do not set it; this is unverified end to
end.

## DNS and HTTPS

- DNS: `box.example.com` → server IP (Cloudflare proxied, auto-managed by `hetzner/create-server.sh`)
- HTTPS: Handled by Cloudflare (SSL mode: Flexible — HTTPS to Cloudflare, HTTP to origin)
