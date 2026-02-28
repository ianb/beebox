# Deploy

Scripts for provisioning and managing a Hetzner cloud server running callback-box.

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
- Clones and builds: cardworks → callback-dropbox → callback-box
- Symlinks `cb` CLI to `/usr/local/bin/`
- Installs Claude Code CLI
- Creates systemd services for web server and scheduler
- Configures nginx reverse proxy (port 80 → 3210)

### `add-box.sh` — Add a box to the server

Clones a box repo, registers it with the scheduler, and updates the serve service.

```bash
# Using owner/repo shorthand
./deploy/add-box.sh ianb/hearth

# Using full SSH URL
./deploy/add-box.sh git@github.com:ianb/hearth.git

# With custom local name
./deploy/add-box.sh ianb/hearth my-family
```

Each box is served at `https://box.example.com/<box-name>/`.

### `rebuild.sh` — Pull latest code and rebuild

Pulls all three repos (cardworks, callback-dropbox, callback-box), rebuilds, and restarts services.

```bash
./deploy/rebuild.sh
```

### `ssh-server.sh` — SSH into the server

```bash
# Interactive shell
./deploy/ssh-server.sh

# Run a command
./deploy/ssh-server.sh systemctl status callback-serve
```

Uses agent forwarding (`-A`) so your local SSH key works for GitHub operations on the server.

## Server layout

```
/opt/callback/              # Source code
  cardworks/
  callback-dropbox/
  callback-box/
/root/boxes/                # Box data (each is a git repo)
  test1/
  hearth/
/root/.env                  # Environment variables (API keys)
/usr/local/bin/cb           # CLI symlink
/usr/local/bin/cb-rebuild   # Rebuild shortcut
```

## Systemd services

- `callback-serve` — Web server serving all boxes in `/root/boxes/`
- `callback-scheduler` — Scheduler daemon for periodic tasks

```bash
# Check status
systemctl status callback-serve
systemctl status callback-scheduler

# View logs
journalctl -u callback-serve -f
journalctl -u callback-scheduler -f

# Restart after config changes
systemctl restart callback-serve callback-scheduler
```

## Environment variables (`/root/.env`)

```
# Required
ANTHROPIC_API_KEY=sk-ant-...
PUBLIC_URL=https://box.example.com

# Auth (optional — enables Google OAuth when set)
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
CB_PUBLIC_URL=https://box.example.com

# Optional
THINKING_OPENAI_API_KEY=sk-...
CALLBACK_MISTRAL_API_KEY=...
```

After editing `.env`, restart services: `systemctl restart callback-serve callback-scheduler`

## Authentication (Google OAuth)

Auth is opt-in. When `GOOGLE_OAUTH_CLIENT_ID` is set, all box access requires login.

### Setup

1. Go to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials?project=callback-box)
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add authorized redirect URI: `https://box.example.com/auth/callback`
4. Add to `/root/.env`:
   ```
   GOOGLE_OAUTH_CLIENT_ID=...
   GOOGLE_OAUTH_CLIENT_SECRET=...
   CB_PUBLIC_URL=https://box.example.com
   ```
5. Restart services: `systemctl restart callback-serve`

### Per-box access control

Each box can restrict access to specific email addresses via `config/box.json`:

```json
{
  "allowedEmails": ["ian@ianbicking.org", "someone@example.com"]
}
```

If `allowedEmails` is empty or missing, any authenticated user can access the box.

Webhooks (`/webhook/<box>/`) remain unauthenticated so external services (Telegram, etc.) still work.

## Adding connector secrets

Per-box secrets go in each box's `config/connectors/` directory:

```bash
# SSH in and create secrets
./deploy/ssh-server.sh
cd /root/boxes/hearth/config/connectors/
echo '{"botToken":"...","webhookSecret":"..."}' > telegram.secret.json
```

## DNS and HTTPS

- DNS: `box.example.com` → server IP (Cloudflare proxied, auto-managed by `create-server.sh`)
- HTTPS: Handled by Cloudflare (SSL mode: Flexible — HTTPS to Cloudflare, HTTP to origin)
