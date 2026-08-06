# Deploy

Scripts for provisioning and managing a Hetzner cloud server running callback-box. This doc
describes one example deployment (`box.example.com`) — the paths, domain, and service names
below are specific to it, not something callback-box requires.

## Prerequisites

- **hcloud CLI**: `brew install hcloud`
- **Hetzner API token**: Create at [Hetzner Cloud Console](https://console.hetzner.cloud/), then `hcloud context create callback`
- **SSH key**: `ssh-keygen -t ed25519` (default path `~/.ssh/id_ed25519`)
- **SSH agent**: `ssh-add` (needed for GitHub access on the server via agent forwarding)
- **Cloudflare API token** (optional): Needs Zone DNS Edit and Zone Settings Edit for `ianbicking.org`

## Setup

Create `deploy/.env` (gitignored):

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
`/opt/callback` followed by a frozen workspace install, service restart, and
healthcheck. `deploy-info.json` on the server therefore records exactly what
shipped.

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

### `create-server.sh` — Create a new server from scratch

Destroys any existing server, creates a fresh Hetzner VPS, provisions it, and sets up DNS.

```bash
./deploy/create-server.sh
```

What it does:
1. Deletes existing `callback-box` server if present (cleans up stale SSH keys)
2. Ensures your SSH key is registered with Hetzner
3. Creates a cpx21 (3 vCPU, 4GB RAM) in Ashburn
4. Updates Cloudflare DNS for `box.example.com` (if token provided)
5. Sets Cloudflare SSL to Flexible
6. Uploads and runs `setup-server.sh` on the server

### `setup-server.sh` — Provision a bare server (runs remotely)

Installs everything on Ubuntu 24.04:
- System packages (git, Node.js 22, nginx)
- Clones and builds: callback-box
- Symlinks `cb` CLI to `/usr/local/bin/`
- Installs Claude Code CLI (native installer — auto-updates in background)
- Creates systemd services for the box server and scheduler
- Configures nginx reverse proxy (port 80 → the box server's port)

**Known gap:** this script still generates the pre-hub `callback-serve` unit
(one process serving every box off `~/.config/cb/boxes.json`), not `cb hub` +
per-box `cb@<box>.service` units. The live server has since been switched
over to the hub by hand (see "Systemd units" below and
`docs/implemented-plans/boxes-as-packages-v2.md`'s "Post-cutover state" section); a fresh
`create-server.sh` run today would need the same by-hand steps repeated
until this script catches up.

**This script does not run on deploy.** `deploy.sh` never invokes it, so any
change to the nginx config or systemd units here reaches a live server only on
a re-provision — or by applying the equivalent change by hand. The most recent
such change is `proxy_buffering off;` in the app proxy location (added
2026-08-01 for tRPC streamed batches); an existing server needs that line added
to `/etc/nginx/sites-available/callback` followed by `nginx -t && systemctl
reload nginx`. Without it the client still works, it just loses the
progressive-delivery benefit.

### `add-box.sh` — Add a box to the server

Clones a box repo, registers it, and restarts the serving process.

```bash
# Using owner/repo shorthand
./deploy/add-box.sh ianb/hearth

# Using full SSH URL
./deploy/add-box.sh git@github.com:ianb/hearth.git

# With custom local name
./deploy/add-box.sh ianb/hearth my-family
```

Each box is served at `https://box.example.com/<box-name>/`.

**Known gap:** this script still targets the pre-hub shape — it clones the
box, runs `cb init`, writes `config/box.json`, and restarts
`callback-serve`/`callback-scheduler`. On the live hub-based server, adding a
box additionally means writing an entry to `hub.json` and restarting the hub
(see [`docs/adding-a-box.md`](../docs/adding-a-box.md)); this script doesn't
do that yet. Until it's updated, add a box by hand: clone + `cb init` as this
script does, then edit `hub.json` and restart the hub.

### `rebuild.sh` — Pull latest code and rebuild

Pulls callback-box, rebuilds, and restarts services.

```bash
./deploy/rebuild.sh
```

### `prod-ssh` — SSH into the production server

```bash
# Interactive shell
./deploy/prod-ssh

# Run a command
./deploy/prod-ssh systemctl status cb-hub
```

Uses agent forwarding (`-A`) so your local SSH key works for GitHub operations on the server.
In a worktree, the command falls back to the main checkout's gitignored
`deploy/server-ip`; a non-empty local copy takes precedence. This fallback is
for diagnostics only: `deploy.sh` intentionally requires `server-ip` in the
invoking checkout.

### Production app diagnostics

`prod-curl` and `prod-browse` authenticate as the configured owner
(`CB_OWNER_EMAIL`) to inspect production behind the OAuth wall. This grants no
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
in the local isolated browser profile and also requires the production base URL
in gitignored `deploy/public-url`; from a worktree it falls back to the main
checkout's copy just like `server-ip`. Never print or persist either cookie or
URL in tracked files.

## Server layout

```
/opt/callback/              # Source code
  callback-box/
/home/callback/boxes/       # Box data (each is a git repo)
  test1/
  hearth/
/home/callback/.config/cb/hub.json   # Hub routing table (slug -> box path)
/home/callback/.env         # Environment variables (API keys)
/home/callback/.local/bin/claude  # Claude Code (native install, auto-updates)
/usr/local/bin/cb           # CLI symlink
/usr/local/bin/cb-rebuild   # Rebuild shortcut
```

## Systemd units

The live server runs `cb hub` (see `src/cli/commands/hub.ts`) in place of the
old single shared `callback-serve` process — one hub process routes
`/<slug>/...` to per-box children, each spawned via that box's own `cb serve`
(so each box can pin its own engine version independently). The scheduler is
unaffected by this change and still runs as a separate unit.

- `cb-hub` — the hub: reads `hub.json`, spawns/routes/health-checks each
  box's own `cb serve` child.
- `callback-scheduler` — scheduler daemon for periodic tasks (still reads
  `~/.config/cb/boxes.json`, the older manifest — see
  `docs/implemented-plans/boxes-as-packages-v2.md`'s "H4 deletions" for why retiring that
  manifest is deferred, not forgotten).

```bash
# Check status
systemctl status cb-hub
systemctl status callback-scheduler

# View logs
journalctl -u cb-hub -f
journalctl -u callback-scheduler -f

# Restart after config changes (hub.json doesn't hot-reload — a box add/remove needs this)
systemctl restart cb-hub
```

**Rollback lever:** the old `callback-serve.service` unit is stopped and
disabled, not deleted — it stays on disk as `callback-serve-disabled-on-disk`
(masked, not purged) so a bad hub rollout can be rolled back with
`systemctl disable --now cb-hub && systemctl enable --now callback-serve`.
**Never run both at once** — two engines serving the same box against its
one `events.db` is a corrupting state, not just a wasteful one (the plan's
Failure modes section calls this out as an accepted, operator-driven risk
during any cutover window).

**`CB_CLI_PREBUILT` loose end:** `bin/cb` skips its dev-mode staleness
rebuild check when this env var is set — the old `callback-serve` and
scheduler units set it so they never pay (or risk failing) a tsx rebuild at
boot. The per-box `cb@<box>`-style units the hub spawns need the same
treatment, and `setup-server.sh` needs to actually generate them with it set;
neither has been verified end-to-end yet.

## Environment variables (`/home/callback/.env`)

Claude auth is **not** an env var here: `ANTHROPIC_API_KEY` is deliberately
stripped (`src/cli/bootstrap.ts`, `src/core/script-env.ts`) so a stray key
can't silently take over billing. The server authenticates via subscription
login instead — run `claude auth login` as the `callback` user
(`su - callback -c 'claude auth login'`) once after `setup-server.sh`
installs the CLI, then it persists in `~/.claude/` for that user.

```
# Required
PUBLIC_URL=https://box.example.com

# Systemd doesn't source .bashrc, so PATH must include the native
# Claude Code install location for the callback user.
PATH=/home/callback/.local/bin:/usr/local/bin:/usr/bin:/bin

# Auth is ON by default (local password login + first-run setup). Google OAuth
# is an OPTIONAL additional method, enabled only when these are set.
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
CB_PUBLIC_URL=https://box.example.com

# Local credential store for password login. Optional — defaults to
# ~/.cb-auth.json (i.e. /home/callback/.cb-auth.json). Created 0600 by the
# first-run setup page or `cb auth create-user`. Never commit it.
# CB_AUTH_FILE=/home/callback/.cb-auth.json

# Google tokens — centralized file shared across all boxes (chmod 600)
CB_GOOGLE_TOKENS_FILE=/home/callback/.google-tokens.json

# Web Push (optional — enables browser/PWA push notifications)
# Generate once with: npx web-push generate-vapid-keys
CB_VAPID_PUBLIC_KEY=...
CB_VAPID_PRIVATE_KEY=...
# VAPID contact (optional — defaults to PUBLIC_URL). A mailto: or https: URI.
CB_VAPID_SUBJECT=mailto:you@example.com

# Optional
THINKING_OPENAI_API_KEY=sk-...
CALLBACK_MISTRAL_API_KEY=...
```

After editing `.env`, restart services: `systemctl restart cb-hub callback-scheduler`

### Web Push (VAPID) keys

Push notifications need a single server-wide VAPID keypair (not per-box). The setup
script does **not** seed these — add them as an explicit step:

1. Generate once: `npx web-push generate-vapid-keys`
2. Add `CB_VAPID_PUBLIC_KEY` and `CB_VAPID_PRIVATE_KEY` to `/home/callback/.env`
   (private key stays server-only; it's excluded from the deploy rsync).
3. Restart **both** services so the server (serves the public key) and the
   scheduler/finalize (sends pushes) pick them up:
   `systemctl restart callback-serve callback-scheduler`

Subscriptions are stored server-side at `~/.local/share/cb/push-subscriptions.json`
(gitignored, never committed). Boxholders enable push per-device from a box's Admin
page; on iOS the app must first be added to the Home Screen.

## Authentication

Authentication is **on by default** — every box requires a logged-in identity, with no
"auth happens to be off" state to fall into. Two login methods:

- **Local password** (always available, no external service). The first account is the
  boxholder/owner; create it on the server with `cb auth create-user` (interactive prompt or
  `--password-file`), or open the first-run setup URL the hub prints to its log on first boot
  (`First-run setup: <url>/auth/setup?token=…` — the token expires 15 minutes after boot and
  the page self-disables once an account exists). Credentials are scrypt-hashed in the local
  store (`CB_AUTH_FILE`, default `~/.cb-auth.json`, mode 0600).
- **Google OAuth** (optional additional method, enabled by the `GOOGLE_OAUTH_*` env below).

The hub terminates login and forwards the authenticated identity to each box child over a
trusted internal header (`x-cb-authenticated-email`, verified by a per-boot `CB_HUB_SECRET`
— see `src/webapp/auth.ts`); each box still runs its own per-box authorization check
independently (next section).

> **No unauthenticated mode.** Authentication is structurally always-on — the old
> `CB_ALLOW_UNAUTHENTICATED` operator opt-out was removed (2026-07). No CLI flag, env var, or
> config field serves a box open; the only unauthenticated servers that can exist are
> test-constructed ones (an in-process `openAccess` construction option, used only by tests).

### Enabling Google OAuth (optional)

1. Go to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials?project=callback-box)
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add authorized redirect URI: `https://box.example.com/auth/callback`
4. Add to `/home/callback/.env`:
   ```
   GOOGLE_OAUTH_CLIENT_ID=...
   GOOGLE_OAUTH_CLIENT_SECRET=...
   CB_PUBLIC_URL=https://box.example.com
   ```
5. Restart services: `systemctl restart cb-hub`

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
cd /home/callback/boxes/hearth/config/connectors/
echo '{"botToken":"...","webhookSecret":"..."}' > telegram.secret.json
```

## DNS and HTTPS

- DNS: `box.example.com` → server IP (Cloudflare proxied, auto-managed by `create-server.sh`)
- HTTPS: Handled by Cloudflare (SSL mode: Flexible — HTTPS to Cloudflare, HTTP to origin)
