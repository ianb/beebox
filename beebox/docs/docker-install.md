# Docker install (local + VPS)

Run a beebox in a container. The same image and `compose.yaml` serve a
box locally as a developer install and, unchanged, on a cheap VPS as the cloud
install. Everything lives in `beebox/docker/`.

The image bakes in the host requirements that make a from-source install
fiddly: Node 24, the system binaries the agent expects (`pandoc`,
`imagemagick`/`magick`, `poppler-utils`, the Excel reader `python3-openpyxl` +
`xlsx2csv`, plus `git`/`git-lfs`), the native
Claude Code CLI, and the beebox engine itself. You supply a box (a git
repo you own, bind-mounted at `./data/box`) and a Claude login.

Authentication is Claude **subscription login** (`claude auth login`), the same
as everywhere else in this project. `ANTHROPIC_API_KEY` is ignored by design.

## Prerequisites

- Docker with Compose v2 (`docker compose version` ≥ 2.24 — the `env_file`
  `required: false` form is used).
- A clone of this repo (the image is built from source; there is no published
  image yet).

All commands below run from `beebox/docker/`.

## Local

```bash
cd beebox/docker

# 1. Build the image and initialize a box into ./data/box (one time).
docker compose run --rm box bbx init /data/box

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
nonzero and prints the exact `bbx init` command to run — it never serves an
empty volume.

### PWA install

Once the box is open in Chrome/Edge/Safari, use the browser's "Install app" /
"Add to Home Screen" to get a standalone window and (with VAPID keys set) push
notifications. See `.env.example` for `BBX_VAPID_*`.

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

Copy `.env.example` (in the repo, one level up) to `beebox/docker/.env`
and set what you need. For a public deployment set at least:

```bash
PUBLIC_URL=https://box.example.com   # your domain
BBX_DOMAIN=box.example.com            # used by the Caddy profile
```

### Public domain + automatic TLS (Caddy)

1. Point an A/AAAA record for your domain at the VPS.
2. Copy the Caddy config and set the domain:

   ```bash
   cp Caddyfile.example Caddyfile
   # BBX_DOMAIN in .env is substituted into it at runtime
   ```

3. Bring up the box **and** the Caddy front door:

   ```bash
   docker compose run --rm box bbx init /data/box     # once
   docker compose run --rm box claude auth login      # once
   docker compose --profile public up -d
   ```

Caddy binds 80/443, fetches a Let's Encrypt certificate for `BBX_DOMAIN`
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
nothing exposed to the public internet, `bbx tailscale` drives the whole
setup — the box keeps its normal loopback mapping, and Tailscale Serve
fronts it with TLS. Which topology applies depends on where `bbx` runs:

**Host-daemon (from-source or VPS-host install, `bbx` on the same machine as
`tailscaled`):**

1. [Install Tailscale](https://tailscale.com/download) on the host and run
   `tailscale up`.
2. Run `bbx tailscale setup` — it auto-detects the hub port from the hub config
   (`~/.config/beebox/hub.json`); pass `--target <port>` only for a
   non-standard/standalone `bbx serve`. It inspects the real Tailscale and serve
   state and tells you the single next step — logging in, approving the machine,
   enabling tailnet HTTPS — looping until the box is reachable at
   `https://<host>.<tailnet>.ts.net/`. `bbx tailscale status` is the read-only
   version of the same inspection; `bbx tailscale stop` removes the mapping.

   Run `bbx tailscale setup` as the SAME OS account the box server runs as (the
   service account in prod, not root or an admin). The exposure record it writes
   (`~/.config/beebox/tailscale-exposure.json`, or `BBX_TAILSCALE_EXPOSURE_FILE`) is
   bookkeeping for `bbx tailscale status`/`stop` — drift detection and scoped
   teardown of the serve mapping. It does NOT gate server startup (there is no
   unauthenticated mode left to guard); a setup run under a different user just
   records the mapping where `status`/`stop` won't find it.

   On the host-daemon path setup still fails closed: it refuses to expose a
   server that doesn't report an authenticated posture at its `/auth/me`
   (Tailscale membership is never treated as authentication). Current `bbx
   serve`/`bbx hub` are always authenticated — there is no unauthenticated mode
   anymore — so this refusal is a guard against pointing setup at the wrong port
   or at a legacy/foreign server.

**Docker container (`bbx` runs inside the container, which has no
`tailscaled`):** `bbx tailscale setup` cannot drive a host daemon it can't
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

**The sidecar path has NO bbx-side guard, by construction.** The sidecar
applies `TS_SERVE_CONFIG` directly; `bbx tailscale setup` never runs and no
exposure intent is written, so setup's posture refusal never gets a chance to
inspect this topology. Authentication is always on, so the box behind the
sidecar still requires a login — but keep the box loopback only
(`127.0.0.1:3210:3210`) so the sidecar stays the only tailnet-facing path, and
rely on the box's own always-on auth wall as the protection here.

### Exposing a local dev environment

The steps above are for a single deployed box (`bbx serve`/`bbx hub`). A
from-source checkout running the shared dev router (`pnpm dev`, monorepo
root) is a different target: `bbx tailscale setup --target <router-port>`
(the router's port, e.g. `3210`) exposes the *whole* router — every worktree
and box it's serving — over the tailnet through one authenticated front door,
rather than a single box. Setup verifies the router's auth gate is actually
live (an anonymous request over Serve must get a `401`) before recording the
exposure, and refuses to expose an ungated router. See `bin/CLAUDE.md` for the
router's auth model and `docs/implemented-plans/expose-dev-router.md` for the
full design.

### Box login (on by default)

The box requires a login. Create the first (owner) account with
`docker compose run --rm box bbx auth create-user`, or open the first-run setup
URL the server prints to its log. This uses the built-in local password method —
no external service. Credentials are scrypt-hashed in `~/.beebox-auth.json` (mode
0600) inside the box volume.

Once that owner exists, use a box's Admin page to create a 15-minute,
single-use member invite. It can be pinned to an email or left open for the
recipient to enter one, and the recipient sets their own password. Signed-in
local users can change their password from Settings. If a member forgets it,
the owner can issue a reset link beside that member in Allowed Users; the member
chooses the replacement and their existing sessions are revoked. Owner recovery
still uses `bbx auth set-password` in the container. Invites, resets, and credentials
are global to this installation, while each accepted invite grants access only
to the box that issued it.

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
2. Put it in `beebox/docker/.env`:

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

`beebox/docker/smoke-docker.sh` builds the image and runs the full
lifecycle (empty-volume refusal → `bbx init` → serve → HTTP 200 → teardown) on a
throwaway compose project and a non-3210 host port. Run it after changing
anything under `beebox/docker/`.
