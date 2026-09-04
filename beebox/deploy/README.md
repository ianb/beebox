# Deploy

> **This is not how you install a Bee Box.** The supported install-and-update
> path — local or on a VPS, with TLS — is the container flow in
> [`../docs/docker-install.md`](../docs/docker-install.md). Read that one.
>
> What lives here is *one operator's* pipeline: rsync a built commit to a
> long-lived Ubuntu VPS that serves many boxes behind nginx and systemd, then
> converge and health-check them. It is in the repo because it is real, it is
> exercised daily, and the multi-box convergence it does has no container
> equivalent yet — not because it is the recommended shape.

Nothing here runs until you opt in. `deploy/target.env` (gitignored; copy
[`target.env.example`](./target.env.example)) names the server, and its
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
- **Cloudflare API token** (optional): Needs Zone DNS Edit and Zone Settings Edit for `ianbicking.org`

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

## Scripts

### `deploy.sh` — Deploy a commit to the server

The everyday deploy (also fired automatically by the root husky
`post-commit`/`post-merge` hooks on `main`). It deploys a git COMMIT, never a
working tree: the requested ref is checked out into a persistent build
checkout (`<main-repo-root>/.deploy-checkout`, a detached git worktree shared
by all worktrees of the repo), gitignored build artifacts there are cleaned,
the frontend and CLI bundle are built, and the result is rsynced to
`/opt/beebox` followed by a frozen workspace install, a per-box convergence
pass (migration sweep + generated-docs refresh), service restart, and
healthcheck. `deploy-info.json` on the server
therefore records exactly what shipped.

Per-box convergence runs in the at-rest window before the restart, two steps
each: `bbx migrate --sweep` converges card shape and box configuration, then
`bbx docs refresh` regenerates the box's agent docs, card rules, and managed
skills when the shipped engine has moved past what wrote them (otherwise a box
nobody chats with keeps the old ones indefinitely). Both print only boxes that
did something or need attention, skip a dirty box for the next deploy to retry,
and never fail the deploy; see [`../docs/migrations.md`](../docs/migrations.md).

The healthcheck has two depths, both diag-key-gated and run on the server's
localhost (see [`../docs/health-checks.md`](../docs/health-checks.md)): it polls
the hub's `/healthz` for up to 180s and **fails the deploy** unless the verdict
is `ok` (the hub is up and no box is crash-looping), then hits `/healthz/canary`
to cold-start one real box and confirm it serves — so a child-only startup
failure (e.g. a native-module ABI mismatch that leaves the hub itself green)
fails the deploy instead of shipping silently. The 180s window replaces an old
30s poll that raced the hub's cold boot; the endpoints now require the bearer
key, so an unauthenticated external monitor gets 401.

```bash
./deploy/deploy.sh                 # deploy HEAD of this checkout
./deploy/deploy.sh --ref <sha>     # deploy (or roll back to) any commit
./deploy/deploy.sh --skip-restart  # sync + build without restarting services
```

Concurrent deploys collapse latest-wins: a run that finds another deploy in
progress records its request and exits; the running deploy chains to the
newest request when it finishes. Hook-triggered runs each log to
`deploy/.deploy-logs/`, with `deploy/.last-deploy.log` symlinked to the newest
(see `deploy/CLAUDE.md` for the wait/poll pattern).

The hook records its requested SHA synchronously before launching through
`bin/lib/detach.ts`, so an agent command ending cannot kill the deploy by
process group. That ordered hook request stays authoritative: a late-starting
older child cannot overwrite newer intent.

### `hetzner/create-server.sh` — Create a new server from scratch

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

### `hetzner/setup-server.sh` — Provision a bare server (runs remotely)

Installs everything on Ubuntu 24.04:
- System packages (git, Node.js 22, nginx)
- Clones and builds: beebox
- Symlinks `bbx` CLI to `/usr/local/bin/`
- Installs Claude Code CLI (native installer — auto-updates in background)
- Creates systemd services for the box server and scheduler
- Configures nginx reverse proxy (port 80 → the box server's port)

**Known gap:** this script still generates the pre-hub `beebox-serve` unit
(one process serving every box off `~/.config/beebox/boxes.json`), not `bbx hub` +
per-box `bbx@<box>.service` units. The live server has since been switched
over to the hub by hand (see "Systemd units" below and
`docs/implemented-plans/boxes-as-packages-v2.md`'s "Post-cutover state" section); a fresh
`hetzner/create-server.sh` run today would need the same by-hand steps repeated
until this script catches up.

**This script does not run on deploy.** `deploy.sh` never invokes it, so any
change to the nginx config or systemd units here reaches a live server only on
a re-provision — or by applying the equivalent change by hand. The most recent
such change is `proxy_buffering off;` in the app proxy location (added
2026-08-01 for tRPC streamed batches); an existing server needs that line added
to `/etc/nginx/sites-available/beebox` followed by `nginx -t && systemctl
reload nginx`. Without it the client still works, it just loses the
progressive-delivery benefit.

### `add-box.sh` — Add a box to the server

The whole process, in one command: clone the box repo, `bbx init` it, seed
access + connector secrets, register it with **both** manifests, restart the
services, and verify the new box actually serves. There is no by-hand
`hub.json` step.

```bash
# Using owner/repo shorthand
./deploy/add-box.sh ianb/hearth

# Using full SSH URL
./deploy/add-box.sh git@github.com:ianb/hearth.git

# With custom local name (this is also the URL slug)
./deploy/add-box.sh ianb/hearth my-family

# See what it would do, without changing anything (read-only on the server)
./deploy/add-box.sh ianb/hearth --dry-run
```

**A brand-new box** (no repo yet) uses `--create`, which scaffolds the box with
`bbx init`, pushes it to a private GitHub repo, and then adds it exactly as
above:

```bash
./deploy/add-box.sh --create hearth --allow someone@example.com --secrets-from lighthouse

# Into a repo you already made in the web UI (it must still be empty):
./deploy/add-box.sh --create hearth --repo ianb/hearth
```

The repo defaults to `<your gh login>/<box-name>` and is created private. An
existing **empty** repo is adopted; one that already has commits is refused,
because pushing a fresh scaffold over it would either do nothing or clobber it
— add that one with the plain form instead. The scaffold happens in a temp
directory and is not kept locally: the box's homes are its repo and the server.
Needs the `gh` CLI, authenticated.

Each box is served at `https://box.example.com/<box-name>/`.

The box name doubles as the URL slug, so it must be lowercase letters, digits,
and hyphens. Two manifests are written, and both are live:

- `~/.config/beebox/hub.json` — the hub's routing table (which slug serves which
  box). Written by `bbx hub add-box`, which validates the resulting config with
  the hub's own loader *before* replacing the file, so a reserved slug
  (`healthz`/`auth`/`webhook`/`api`) or a second slug for an already-registered
  box fails with nothing changed.
- `~/.config/beebox/boxes.json` — the scheduler's box list. Written by
  `bbx boxes add`.

Neither hot-reloads, so the script restarts `beebox-hub` and
`beebox-scheduler`. It then drives the hub's canary for the new slug, which
cold-starts the box and requires the box's own `/healthz` to answer through the
hub — so a successful run means the box process really came up and served, not
just that files were written. (It is a loopback check: nginx, TLS, the public
URL, and per-user access are not exercised.)

**Order of operations:** every argument's shape is validated, and the hub edit
is `--dry-run`ed against the live config, *before* anything is cloned — which
is where the failures this script used to hit at the very end now surface. It
is not a transaction, though: a failure in the clone, the `bbx init`, the
manifests, or the restart leaves the earlier steps done. The script names the
step that failed, and re-running is safe.

Re-running is idempotent: pull + re-init, both manifest steps no-op, access
config left alone.

**The box's push credential is set up too.** A GitHub deploy key attaches to
exactly one repo, so each box gets its own, reached through a per-box ssh host
alias (`IdentitiesOnly yes` keeps ssh from offering every key and tripping
GitHub's max-auth-attempts limit):

```
Host github.com-box-<name>
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_box_<name>
  IdentitiesOnly yes
```

`add-box.sh` creates the key if absent, writes that stanza, and points the box's
`origin` at `git@github.com-box-<name>:owner/repo.git`. Registering the public
key on GitHub is the step it cannot do for you on the plain path, so the script
ends by printing the key and the instruction — **including "Allow write
access"**, without which the box fetches but never pushes.

That last part matters more than it looks: a box with no usable push credential
works in every visible way — it serves, agents run, commits land locally — and
simply never reaches its remote, with nothing saying so. Admin → Backup reports
the symptom per box (see `src/core/box/backup-status.ts`).

On `--create`, where `gh` is already authenticated and already making the repo,
the key is registered automatically with write access. It is **sticky**: the
check is on the key material rather than a title, so a re-run finds the box's
key already present and does nothing, and a key an operator added by hand under
a different title still counts. The script never rotates or replaces a
credential on its own — a silent re-register is indistinguishable from the
orphaned-key failure this exists to prevent, so replacing one means removing the
old key on GitHub and re-running deliberately. Note gh's own caveat: a key added
through `gh` is tied to its auth token, and de-authorizing the GitHub CLI later
removes the key.

A non-GitHub remote is left alone — the alias convention is a GitHub deploy-key
mechanism, and rewriting a remote for another host would only break it.

`--dry-run` still needs a `bbx` on the server that has `bbx hub add-box` — i.e.
a deploy from 2026-08 or later. On an older build the preflight fails with an
unknown-command error.

### `prod-ssh` — SSH into the production server

```bash
# Interactive shell
./deploy/prod-ssh

# Run a command
./deploy/prod-ssh systemctl status beebox-hub
```

Uses agent forwarding (`-A`) so your local SSH key works for GitHub operations on the server.
In a worktree, the command falls back to the main checkout's gitignored
`deploy/target.env`; a non-empty local copy takes precedence. This fallback is
for diagnostics only: `deploy.sh` intentionally requires `target.env` in the
invoking checkout.

### Production app diagnostics

`prod-curl` and `prod-browse` authenticate as the configured owner
(`BBX_OWNER_EMAIL`) to inspect production behind the OAuth wall. This grants no
new access: both commands require the boxholder's existing root SSH key, and
must never be modified to mint a session for another identity without the
boxholder's express, in-the-moment permission.

```bash
# Fetch HTML or an API response; extra arguments pass through to remote curl.
./deploy/prod-curl /test1/ -sI

# Open the rendered app in bin/browse's clean browser profile.
./deploy/prod-browse /test1/
bin/browse screenshot --slug prod
```

`prod-curl` keeps the signed session cookie on the server. `prod-browse` puts it
in the local isolated browser profile and also requires `BBX_DEPLOY_PUBLIC_URL`
in `deploy/target.env`; from a worktree it falls back to the main checkout's
copy like everything else there. Never print or persist either cookie or URL in
tracked files.

## Server layout

```
/opt/beebox/              # Source code
  beebox/
/home/beebox/boxes/       # Box data (each is a git repo)
  test1/
  hearth/
/home/beebox/.config/beebox/hub.json   # Hub routing table (slug -> box path)
/home/beebox/.env         # Environment variables (API keys)
/home/beebox/.local/bin/claude  # Claude Code (native install, auto-updates)
/usr/local/bin/bbx           # CLI symlink
/usr/local/bin/codex         # Workspace-pinned Codex CLI symlink
```

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

## Environment variables (`/home/beebox/.env`)

Claude auth is **not** an env var here: `ANTHROPIC_API_KEY` is deliberately
stripped (`src/cli/bootstrap.ts`, `src/core/script-env.ts`) so a stray key
can't silently take over billing. The server authenticates via subscription
login instead — run `claude auth login` as the `beebox` user
(`su - beebox -c 'claude auth login'`) once after `setup-server.sh`
installs the CLI, then it persists in `~/.claude/` for that user.

Codex authentication uses the same service-account custody boundary and its
own CLI-managed store under `~/.codex/`. Bee Box deliberately does not reuse a
transcription/search API key or copy a developer's credentials. After the
workspace install creates `/usr/local/bin/codex`, the box owner normally starts
the provider-supported device flow from **Admin → Codex**. Bee Box displays the
short-lived verification URL and code while Codex owns token persistence and
refresh. For recovery when the web UI is unavailable, the equivalent operator
commands are:

```bash
su - beebox -c 'codex login --device-auth'
su - beebox -c 'codex login status'
```

The direct `@openai/codex` and `@openai/codex-sdk` dependencies are pinned to
the same version. Login, plugin management, and history resolve the direct
package runtime; SDK turns keep the SDK's version-matched vendored binary so
its bundled tools remain available. The symlink exists for operator commands.

```
# Required
PUBLIC_URL=https://box.example.com

# Systemd doesn't source .bashrc, so PATH must include the native
# Claude Code install location for the Bee Box user.
PATH=/home/beebox/.local/bin:/usr/local/bin:/usr/bin:/bin

# Auth is ON by default (local password login + first-run setup). Google OAuth
# is an OPTIONAL additional method, enabled only when these are set.
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
BBX_PUBLIC_URL=https://box.example.com

# Local credential store for password login. Optional — defaults to
# ~/.bbx-auth.json (i.e. /home/beebox/.bbx-auth.json). Created 0600 by the
# first-run setup page or `bbx auth create-user`. Never commit it.
# BBX_AUTH_FILE=/home/beebox/.bbx-auth.json

# Google tokens — centralized file shared across all boxes (chmod 600)
BBX_GOOGLE_TOKENS_FILE=/home/beebox/.google-tokens.json

# Web Push (optional — enables browser/PWA push notifications)
# Generate once with: npx web-push generate-vapid-keys
BBX_VAPID_PUBLIC_KEY=...
BBX_VAPID_PRIVATE_KEY=...
# VAPID contact (optional — defaults to PUBLIC_URL). A mailto: or https: URI.
BBX_VAPID_SUBJECT=mailto:you@example.com

# Optional
THINKING_OPENAI_API_KEY=sk-...
BBX_MISTRAL_API_KEY=...
```

After editing `.env`, restart services: `systemctl restart beebox-hub beebox-scheduler`

### Web Push (VAPID) keys

Push notifications need a single server-wide VAPID keypair (not per-box). The setup
script does **not** seed these — add them as an explicit step:

1. Generate once: `npx web-push generate-vapid-keys`
2. Add `BBX_VAPID_PUBLIC_KEY` and `BBX_VAPID_PRIVATE_KEY` to `/home/beebox/.env`
   (private key stays server-only; it's excluded from the deploy rsync).
3. Restart **both** services so the server (serves the public key) and the
   scheduler/finalize (sends pushes) pick them up:
   `systemctl restart beebox-serve beebox-scheduler`

Subscriptions are stored server-side at `~/.local/share/beebox/push-subscriptions.json`
(gitignored, never committed). Boxholders enable push per-device from a box's Admin
page; on iOS the app must first be added to the Home Screen.

## Authentication

Authentication is **on by default** — every box requires a logged-in identity, with no
"auth happens to be off" state to fall into. Two login methods:

- **Local password** (always available, no external service). The first account is the
  boxholder/owner; create it on the server with `bbx auth create-user` (interactive prompt or
  `--password-file`), or open the first-run setup URL the hub prints to its log on first boot
  (`First-run setup: <url>/auth/setup?token=…` — the token expires 15 minutes after boot and
  the page self-disables once an account exists). Credentials are scrypt-hashed in the local
  store (`BBX_AUTH_FILE`, default `~/.bbx-auth.json`, mode 0600).
- **Google OAuth** (optional additional method, enabled by the `GOOGLE_OAUTH_*` env below).

After the local owner account exists, the owner can create a 15-minute,
single-use invite from a box's Admin page. An invite can be pinned to a known
email or left open for its recipient to enter one; accepting it creates a
member account with the recipient's own password and grants access only to that
box. Open invites cannot claim an existing local user, the owner identity, or
an email already authorized for another box. Signed-in local users change their
own password from Settings. If a member forgets it, the owner can create a
15-minute reset link beside that member in the box's Allowed Users list; the
member chooses the new password, and all of their existing sessions are revoked.
Owner recovery still requires `bbx auth set-password` on the host. Local password and Google sign-in share one
case-insensitive email identity, so a verified Google login with the same email
uses the same account and box access.

Invite and password-reset capabilities are stored only as SHA-256 hashes in a mode-0600 sibling
of the global credential store (`BBX_AUTH_FILE.invites.json`). If
`BBX_AUTH_FILE` is overridden, the hub passes the same path to every child;
credential and capability state therefore remain fleet-global.
The capability file upgrades from version 1 to version 2 on its next mutation.
Rolling back to a release that predates password resets requires restoring the
pre-upgrade capability file (or removing it, which invalidates outstanding links).

The hub terminates login and forwards the authenticated identity to each box child over a
trusted internal header (`x-bbx-authenticated-email`, verified by a per-boot `BBX_HUB_SECRET`
— see `src/webapp/auth.ts`); each box still runs its own per-box authorization check
independently (next section).

> **No unauthenticated mode.** Authentication is structurally always-on — the old
> `BBX_ALLOW_UNAUTHENTICATED` operator opt-out was removed (2026-07). No CLI flag, env var, or
> config field serves a box open; the only unauthenticated servers that can exist are
> test-constructed ones (an in-process `openAccess` construction option, used only by tests).

### Enabling Google OAuth (optional)

1. Go to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials?project=beebox)
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add authorized redirect URI: `https://box.example.com/auth/callback`
4. Add to `/home/beebox/.env`:
   ```
   GOOGLE_OAUTH_CLIENT_ID=...
   GOOGLE_OAUTH_CLIENT_SECRET=...
   BBX_PUBLIC_URL=https://box.example.com
   ```
5. Restart services: `systemctl restart beebox-hub`

### Per-box access control

Each box can restrict access to specific email addresses via `config/box.json`:

```json
{
  "allowedEmails": ["ian@ianbicking.org", "someone@example.com"]
}
```

**This is fail-closed, not open**: a missing or empty `allowedEmails` means *owner-only*
access — **not** "any authenticated user can access the box." (`src/webapp/box-access.ts` is
the source of truth; the owner is always allowed and is never listed here.) To open a box to
someone beyond the owner, list their email explicitly.

Webhooks (`/webhook/<box>/`) remain unauthenticated so external services (Telegram, etc.) still work.

## Adding connector secrets

Per-box secrets go in each box's `config/connectors/` directory:

```bash
# SSH in and create secrets
./deploy/prod-ssh
cd /home/beebox/boxes/hearth/config/connectors/
echo '{"botToken":"...","webhookSecret":"..."}' > telegram.secret.json
```

## DNS and HTTPS

- DNS: `box.example.com` → server IP (Cloudflare proxied, auto-managed by `hetzner/create-server.sh`)
- HTTPS: Handled by Cloudflare (SSL mode: Flexible — HTTPS to Cloudflare, HTTP to origin)
