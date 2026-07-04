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
`docs/plans/boxes-as-packages-v2.md`'s "Post-cutover state" section); a fresh
`create-server.sh` run today would need the same by-hand steps repeated
until this script catches up.

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

### `ssh-server.sh` — SSH into the server

```bash
# Interactive shell
./deploy/ssh-server.sh

# Run a command
./deploy/ssh-server.sh systemctl status cb-hub
```

Uses agent forwarding (`-A`) so your local SSH key works for GitHub operations on the server.

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
  `docs/plans/boxes-as-packages-v2.md`'s "H4 deletions" for why retiring that
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

```
# Required
ANTHROPIC_API_KEY=sk-ant-...
PUBLIC_URL=https://box.example.com

# Systemd doesn't source .bashrc, so PATH must include the native
# Claude Code install location for the callback user.
PATH=/home/callback/.local/bin:/usr/local/bin:/usr/bin:/bin

# Auth (optional — enables Google OAuth when set)
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
CB_PUBLIC_URL=https://box.example.com

# Google tokens — centralized file shared across all boxes (chmod 600)
CB_GOOGLE_TOKENS_FILE=/home/callback/.google-tokens.json

# Optional
THINKING_OPENAI_API_KEY=sk-...
CALLBACK_MISTRAL_API_KEY=...
```

After editing `.env`, restart services: `systemctl restart cb-hub callback-scheduler`

## Authentication (Google OAuth)

Auth is opt-in. When `GOOGLE_OAUTH_CLIENT_ID` is set, all box access requires login. The hub
terminates login and forwards the authenticated identity to each box child over a trusted
internal header (`x-cb-authenticated-email`, verified by a per-boot secret — see
`src/webapp/auth.ts`); each box still runs its own per-box authorization check independently
(next section).

### Setup

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
./deploy/ssh-server.sh
cd /home/callback/boxes/hearth/config/connectors/
echo '{"botToken":"...","webhookSecret":"..."}' > telegram.secret.json
```

## DNS and HTTPS

- DNS: `box.example.com` → server IP (Cloudflare proxied, auto-managed by `create-server.sh`)
- HTTPS: Handled by Cloudflare (SSL mode: Flexible — HTTPS to Cloudflare, HTTP to origin)
