# Docker install (local + VPS)

Run a callback-box in a container. The same image and `compose.yaml` serve a
box locally as a developer install and, unchanged, on a cheap VPS as the cloud
install. Everything lives in `callback-box/docker/`.

The image bakes in the host requirements that make a from-source install
fiddly: Node 22, the four system binaries the agent expects (`pandoc`,
`imagemagick`/`magick`, `poppler-utils`, plus `git`/`git-lfs`), the native
Claude Code CLI, and the callback-box engine itself. You supply a box (a git
repo you own, bind-mounted at `./data/box`) and a Claude login.

Authentication is Claude **subscription login** (`claude auth login`), the same
as everywhere else in this project. `ANTHROPIC_API_KEY` is ignored by design.

## Prerequisites

- Docker with Compose v2 (`docker compose version` ≥ 2.24 — the `env_file`
  `required: false` form is used).
- A clone of this repo (the image is built from source; there is no published
  image yet).

All commands below run from `callback-box/docker/`.

## Local

```bash
cd callback-box/docker

# 1. Build the image and initialize a box into ./data/box (one time).
docker compose run --rm box cb init /data/box

# 2. Authenticate Claude (one time). Opens a URL + paste-code flow; the
#    credentials persist in a named volume across restarts.
docker compose run --rm box claude auth login

# 3. Start the server.
docker compose up -d

# 4. Open the box.
open http://localhost:3210/box/
```

The box is served at **`/box/`** — the slug is the basename of the box package
directory (`/data/box` → `box`). The operational box is `/data/box/content`;
the entrypoint serves it for you.

The port maps **loopback-only** (`127.0.0.1:3210:3210`) by default, so nothing
outside the host can reach it until you opt in (see [VPS](#vps-cloud-install)).

### First run

On the first `docker compose up`, the entrypoint runs a one-time box-local
`pnpm install` (a v2 box is a package and needs its own dependencies) before
serving. Give it a minute; subsequent starts are immediate. Follow along with
`docker compose logs -f box`.

If you start the server before initializing a box, the container exits
nonzero and prints the exact `cb init` command to run — it never serves an
empty volume.

### PWA install

Once the box is open in Chrome/Edge/Safari, use the browser's "Install app" /
"Add to Home Screen" to get a standalone window and (with VAPID keys set) push
notifications. See `.env.example` for `CB_VAPID_*`.

### Updating

The image is built from source, so an update is a pull + rebuild:

```bash
git pull
docker compose build --pull
docker compose up -d
```

Your box (`./data/box`) and Claude credentials (the named volume) are
untouched by a rebuild.

## VPS (cloud install)

The same compose project runs on any small VPS (a $5/month box is plenty).
Two ways to expose it: a public domain with automatic TLS (Caddy), or a
private tailnet with zero open ports (Tailscale).

Copy `.env.example` (in the repo, one level up) to `callback-box/docker/.env`
and set what you need. For a public deployment set at least:

```bash
PUBLIC_URL=https://box.example.com   # your domain
CB_DOMAIN=box.example.com            # used by the Caddy profile
```

### Public domain + automatic TLS (Caddy)

1. Point an A/AAAA record for your domain at the VPS.
2. Copy the Caddy config and set the domain:

   ```bash
   cp Caddyfile.example Caddyfile
   # CB_DOMAIN in .env is substituted into it at runtime
   ```

3. Bring up the box **and** the Caddy front door:

   ```bash
   docker compose run --rm box cb init /data/box     # once
   docker compose run --rm box claude auth login      # once
   docker compose --profile public up -d
   ```

Caddy binds 80/443, fetches a Let's Encrypt certificate for `CB_DOMAIN`
automatically, and reverse-proxies to the box (WebSocket upgrades included).
The box stays on its loopback mapping inside the compose network — Caddy is the
only public listener. Without `--profile public`, the `caddy` service is not
started at all.

### Tailscale-only (no open ports)

To reach the box privately over a [tailnet](https://tailscale.com/) with
nothing exposed to the public internet:

1. Install Tailscale on the VPS and `tailscale up`.
2. Change the box's port mapping in `compose.yaml` from `127.0.0.1:3210:3210`
   to bind the tailnet IP instead, e.g. `100.x.y.z:3210:3210` (your
   `tailscale ip -4`), and do **not** start the Caddy profile.
3. `docker compose up -d`.

The box is then reachable at `http://<tailnet-ip>:3210/box/` from any device on
your tailnet, with zero ports open to the world. (Add TLS via Tailscale Serve
if you want `https://`.)

### Multi-device login (Google OAuth)

For signing in from more than one device/browser, set a Google OAuth client so
the box can authenticate accounts:

```bash
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

(Same vars as `.env.example`; the box's Google connectors reuse them.)

## Claude auth: interactive vs headless

`docker compose run --rm box claude auth login` is the primary path — an
attached run gives you the URL-and-paste-code flow, and the login persists in
the `claude-auth` named volume.

If interactive login is awkward on a headless server (no easy way to complete
the browser step), use the **token fallback**:

1. On a machine with a browser, run `claude setup-token` and copy the token.
2. Put it in `callback-box/docker/.env`:

   ```bash
   CLAUDE_CODE_OAUTH_TOKEN=...
   ```

3. `docker compose up -d`. The token is passed via the env-file; no interactive
   step needed.

## Data and volumes

- **`./data/box`** — the box package (a git repo you own): cards, config,
  runtime state, and box-authored code. Bind-mounted, so it lives on the host
  and survives everything Docker does. Back this up.
- **`claude-auth`** (named volume) — the Claude login credentials. Survives
  `docker compose down` and rebuilds.

> **Warning:** `docker compose down -v` deletes named volumes, including
> `claude-auth`. You will need to `claude auth login` again. Plain
> `docker compose down` (no `-v`) is safe.

## Ownership note (bind-mount UID)

The container runs as a fixed non-root user (UID 1000) that owns `/app` and
`/data`. The image sets `git config --global --add safe.directory /data/box`,
so git won't complain about the bind-mounted repo even when host and container
UIDs differ. If your host user is not UID 1000 and you hit an ownership error,
override the service user in a compose override (`user: "<uid>:<gid>"`).

## Verifying the whole path

`callback-box/docker/smoke-docker.sh` builds the image and runs the full
lifecycle (empty-volume refusal → `cb init` → serve → HTTP 200 → teardown) on a
throwaway compose project and a non-3210 host port. Run it after changing
anything under `callback-box/docker/`.
