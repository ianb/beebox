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
5. Passes `hetzner/cloud-init.yaml` as user data, waits for cloud-init to finish, then uploads and runs `hetzner/provision.sh`

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

### Box browser

Each box's browser ([plan](../plans/shared-browser.md)) runs in its own network
namespace, so other box users on the host cannot reach its dashboard, stream or
Chrome debugging port, and the browser cannot reach host loopback. Every deploy
runs `server-bin/bbx-browser-install` as root, after the services restart:

- `passt`, for `pasta`, which gives the namespace outbound network only.
- Chrome for Testing under `/opt/beebox-browser/.agent-browser/browsers/`,
  installed by the pinned agent-browser (`install --with-deps`,
  `HOME=/opt/beebox-browser`), and the link `/opt/beebox-browser/chrome` the
  engine reads. It reinstalls when the agent-browser version changes or after 7
  days, and keeps the previous Chrome for a browser still running from it.
- `/opt/beebox-browser/bin/unshare`, a copy of `/usr/bin/unshare` that only
  group `beebox-boxes` may run, and `apparmor/beebox-browser` in
  `/etc/apparmor.d/`. Ubuntu 24.04 lets a program create a user namespace only
  under a profile that grants it; these two profiles grant it to that copy and
  to Chrome, whose own sandbox needs it.
- A check, as one box user under the box sandbox, that `chrome://sandbox` says
  "adequately sandboxed". Chrome without its sandbox runs anyway, so the check
  fails the deploy instead. A host with no box yet skips it.

`cloud-init.yaml` installs `passt` too. The setup was verified on a throwaway
Ubuntu 24.04 host: [linux-verification.md](../../../research/embedded-browser/linux-verification.md).

### Codex sandbox

Codex runs prompt-only procedures and read-only runs in its own sandbox, which
uses bubblewrap. Every deploy runs `server-bin/bbx-codex-sandbox-install` as
root, after the box browser:

- `bubblewrap`, with `/usr/bin/bwrap` set to 0750 `root:beebox-boxes` by
  `dpkg-statoverride`. Codex runs the `bwrap` on PATH before its bundled copy.
- `apparmor/beebox-codex` in `/etc/apparmor.d/`, which grants that `bwrap`
  user namespaces. Without it the sandbox fails on
  `loopback: Failed RTM_NEWADDR: Operation not permitted`.
- A check, as one box user under the box sandbox, that `codex sandbox --
  /bin/true` succeeds. A host with no box yet skips it.

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
- HTTPS: Handled by Cloudflare (SSL mode: Flexible — HTTPS to Cloudflare, HTTP to origin). [Origin TLS](#origin-tls) is the prepared fix and is not active.

## Origin TLS

**Not active.** Production still uses Flexible, and `nginx/beebox.conf` has no 443 listener. To activate this, first apply the changes in [the plan](../unimplemented-plans/origin-tls.md#activation). Install the certificate before the listener lands, or every deploy fails.

When active, Cloudflare connects to nginx on 443 and validates its certificate, set by a Configuration Rule for this hostname. The SSL mode of the zone is not used, because it covers every hostname in the zone.

**The certificate** lives on the server at `/etc/nginx/beebox-tls/origin.pem` and `origin.key`. It is not in git and no deploy writes it. Create it in the Cloudflare dashboard under SSL/TLS, Origin Server, for the production hostname only. The dashboard shows the key once. To install it from the laptop:

```bash
deploy/prod-ssh 'install -d -m 0700 /etc/nginx/beebox-tls'
deploy/prod-ssh 'install -m 0644 /dev/stdin /etc/nginx/beebox-tls/origin.pem' < origin.pem
deploy/prod-ssh 'install -m 0600 /dev/stdin /etc/nginx/beebox-tls/origin.key' < origin.key
```

Then delete the local copy of the key. A missing or mismatched file fails `nginx -t` at the next deploy, before anything stops.

**The firewall** is `hetzner/origin-firewall.sh <server>`, where `<server>` is the name `hcloud server list` shows. It keeps SSH open to everyone and limits 443 to Cloudflare's published ranges. `--allow-http` also allows 80 from Cloudflare. It replaces the firewall's rules on every run, so edit the script, not the Hetzner console. Re-run it when Cloudflare announces a range change; until then, visitors routed through a new range get a 522.

**Cutover order from plain HTTP.** Each step leaves the site up:

1. Record the zone's SSL mode and any rule that matches the hostname. That is the state to return to.
2. Install the certificate as above.
3. Optional: run `origin-firewall.sh <server> --allow-http`. Do not omit the flag here: without it, port 80 closes while Cloudflare still uses it, and the site goes down.
4. Apply the plan's activation changes and deploy them. Verify with the `curl` below.
5. Add a Configuration Rule, last in the list: SSL set to Full (strict), for this hostname and the path `/__origin_tls_probe`. Request that path through the public URL. The hub's 404 proves Cloudflare reached 443. A 521, 522, 525, or 526 means it did not, and only that path is affected.
6. Widen the rule to the whole hostname. Until this step, production traffic is still in plaintext. Verify that the app loads, that chat connects, that a fresh login sets a `Secure` cookie, and that `ss -tn sport = :443` shows connections.
7. Check the edge redirect. Full (strict) follows the visitor's scheme, so a plain HTTP visitor produces a plain HTTP request to the origin unless the edge redirects first. `curl -I http://box.example.com/` must return a 301 to HTTPS.
8. Optional: after the next deploy has ended old connections and `ss -tn sport = :80` shows none, run `origin-firewall.sh <server>` without the flag.

**To return to plain HTTP in an incident:** run `origin-firewall.sh <server> --allow-http` if 80 is closed, then delete the Configuration Rule. A deploy of a ref with no 443 listener is refused unless `BBX_DEPLOY_ALLOW_NO_ORIGIN_TLS=1` is set; set it only after the rule is gone.

To verify the listener, use `curl` on the server. `prod-curl` talks to the hub directly and skips nginx:

```bash
deploy/prod-ssh 'curl -sS -o /dev/null -w "%{http_code}\n" --cacert origin_ca_root.pem --resolve box.example.com:443:127.0.0.1 https://box.example.com/auth/login'
```

Download `origin_ca_root.pem`, [Cloudflare's published root](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/), to the server first; it matches the certificate's key type. `ss -tn sport = :443` shows Cloudflare's connections, and `ss -tn sport = :80` shows any that remain in plaintext.
