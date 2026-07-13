# Docker packaging

The container install for callback-box — one box per compose project. The
full walkthrough (local usage, VPS hosting, TLS, Tailscale, auth) is
[`../docs/docker-install.md`](../docs/docker-install.md); this file is a map
of what's in this directory.

| File | What it is |
|---|---|
| `Dockerfile` | Multi-stage build. Build stage packs the engine tarball from the workspace (build context = the **monorepo root**); runtime stage is `node:22-bookworm-slim` + the external tools the agent expects (`pandoc`, `imagemagick`, `poppler-utils`, `git`, `git-lfs`) + the Claude Code CLI + the engine installed from the baked tarball. |
| `entrypoint.sh` | Args → `exec "$@"` (so `docker compose run --rm box <anything>` works literally). No args → v2-box readiness check (marker, package.json, HEAD commit), first-run box-local `pnpm install`, then `cb serve /data/box/content`. |
| `compose.yaml` | The `box` service (loopback-only `127.0.0.1:3210`, `restart: unless-stopped`, bind-mounted box + persistent Claude-credentials volume) and a `caddy` service behind `--profile public` for VPS TLS. |
| `Caddyfile.example` | Two-line reverse proxy for the public profile (`CB_DOMAIN` → `box:3210`). |
| `smoke-docker.sh` | The lifecycle test: build → empty-volume refusal → `cb init` → serve → HTTP probe → teardown, on a non-default port (a scratch compose file, not this dir's). Run it after touching anything here. |
| `smoke-dev-install.sh` | Bare-machine developer-install smoke: follows `../docs/developer-install.md` from a fresh `debian:bookworm` (apt → Node 22 → clone → `pnpm install` → `cb init` → `cb serve` → HTTP probe → `pnpm run doctor`), asserting every doctor check passes except headless "Claude auth". Approximates the clean-clone rollout verification. |
| `smoke-vps-install.sh` | VPS-story smoke via docker-in-docker: inside a privileged `docker:dind` "VPS", runs `../docs/docker-install.md`'s sequence against THIS dir's real `compose.yaml` (build → `cb init` → `up` → HTTP 200 → `--profile public` Caddy → 200 through Caddy). Approximates the real-VPS rollout verification. |

Quick start (from this directory):

```bash
docker compose run --rm box cb init /data/box     # first time only
docker compose run --rm box claude auth login     # first time only
docker compose up -d
open http://localhost:3210/box/
```

Verify changes to this packaging with `./smoke-docker.sh`.
