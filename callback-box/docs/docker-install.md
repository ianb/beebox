# Docker install (local + VPS)

Run a callback-box in a container. The same image and `compose.yaml` serve a
box locally as a developer install and, unchanged, on a cheap VPS as the cloud
install. Everything lives in `callback-box/docker/`.

The image bakes in the host requirements that make a from-source install
fiddly: Node 24, the four system binaries the agent expects (`pandoc`,
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

> **Status: not yet exercised end-to-end.** The smoke harness
> (`docker/smoke-docker.sh`, `docker/smoke-vps-install.sh`) does not cover
> this path. Live proof is tracked in
> [`issues/features/2026-07-19-installation-remaining-work.md`](../../issues/features/2026-07-19-installation-remaining-work.md)
> item 2 — treat the steps below as unverified until that item records a run.

To reach the box privately over a [tailnet](https://tailscale.com/) with
nothing exposed to the public internet, `cb tailscale` drives the whole
setup — the box keeps its normal loopback mapping, and Tailscale Serve
fronts it with TLS. Which topology applies depends on where `cb` runs:

**Host-daemon (from-source or VPS-host install, `cb` on the same machine as
`tailscaled`):**

1. [Install Tailscale](https://tailscale.com/download) on the host and run
   `tailscale up`.
2. Run `cb tailscale setup --target 3210` (`--target <port>` is required — the
   port the box is served on). It inspects the real Tailscale and serve state
   and tells you the single next step — logging in, approving the machine,
   enabling tailnet HTTPS — looping until the box is reachable at
   `https://<host>.<tailnet>.ts.net/`. `cb tailscale status --target 3210`
   is the read-only version of the same inspection; `cb tailscale stop
   --target 3210` removes the mapping.

   Run `cb tailscale setup` as the SAME OS account the box server runs as (the
   service account in prod, not root or an admin). The exposure intent that
   backs the startup guard is recorded in that account's home
   (`~/.config/cb/tailscale-exposure.json`, or `CB_TAILSCALE_EXPOSURE_FILE`); a
   setup run under a different user records the guard where the server never
   reads it.

   On the host-daemon path this is fully guarded: setup refuses to expose a
   server currently running with `CB_ALLOW_UNAUTHENTICATED` (fail closed —
   Tailscale membership is never treated as authentication), and once a target
   is recorded as exposed, restarting it in open mode refuses at startup until
   you run `cb tailscale stop`.

**Docker container (`cb` runs inside the container, which has no
`tailscaled`):** `cb tailscale setup` cannot drive a host daemon it can't
reach — run inside the container it reports `binary-absent` (the generic
"install Tailscale, then `tailscale up`" step), which is your cue to use the
sidecar topology below rather than configure Tailscale in-container. The
supported shape is Tailscale's own
[sidecar container](https://tailscale.com/kb/1282/docker): a `tailscale`
service holding the tailnet identity (`TS_AUTHKEY`) and a serve config
(`TS_SERVE_CONFIG`) that proxies to the box service over the compose
network, added alongside — not instead of — the existing services. The box
service keeps its `127.0.0.1:3210:3210` mapping unchanged; only the sidecar
is tailnet-facing. Follow Tailscale's compose example there for the
`TS_AUTHKEY` and `TS_SERVE_CONFIG` shape.

**The sidecar path has NO cb-side guard, by construction.** The sidecar
applies `TS_SERVE_CONFIG` directly; `cb tailscale setup` never runs, no
exposure intent is written, and the box process reads a different container
filesystem than any place setup could record one — so neither setup's
open-mode refusal nor the startup guard protects it. Keeping the box loopback
only (`127.0.0.1:3210:3210`) with authentication ON is the operator's
responsibility on this topology: never set `CB_ALLOW_UNAUTHENTICATED` on a box
the sidecar fronts, since restarting that container in open mode exposes an
unauthenticated box through the still-running sidecar with nothing to stop it.

### Box login (on by default)

The box requires a login. Create the first (owner) account with
`docker compose run --rm box cb auth create-user`, or open the first-run setup
URL the server prints to its log. This uses the built-in local password method —
no external service. Credentials are scrypt-hashed in `~/.cb-auth.json` (mode
0600) inside the box volume.

**Google OAuth (optional additional method).** To also allow Google sign-in
(e.g. from more than one device), set a Google OAuth client:

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
