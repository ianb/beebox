---
title: "Docker + compose as the generic VPS install path (replaces deploy genericization)"
workstream: unknown
needs: [design]
design: ../../../research/openclaw-hermes/deep-installation.md
resolution: implemented
---

The public server-hosting story should be a Dockerfile + docker-compose
example + one generic VPS guide, written fresh — rather than parametrizing the
personal `callback-box/deploy/` scripts (Track C of
`callback-box/docs/plans/source-available-release.md`, currently deferred
because of the live-deployment transition-state problem). A new Docker path
sidesteps that problem entirely: the Hetzner/Cloudflare scripts stay honestly
personal and the public doc never mentions them.

Why Docker specifically fits callback-box: beyond the field-standard argument
(native modules — `better-sqlite3` etc. — prebuilt in the image), our image
also bakes in the external binaries the agent expects on PATH (`pandoc`,
`imagemagick`, `poppler-utils`, `git-lfs`), which no comparable project even
carries.

Shape (2025–2026 field consensus, per the research doc):

- compose: `cb hub` service (`restart: unless-stopped`) + Caddy for automatic
  TLS; boxes directory and `~/.claude` (or `CLAUDE_CONFIG_DIR`) volume-mounted
- loopback/Tailscale-only variant documented first-class (zero open ports)
- headless Claude auth documented: `claude setup-token` on a laptop →
  `CLAUDE_CODE_OAUTH_TOKEN` on the server, or the Track F explicit API key
  once it lands
- update = `docker compose pull` + restart
- the client-connection story (URL, Google OAuth env vars, PWA install) lives
  IN the guide — Hermes's open remote-onboarding gap (their #36970) is the
  cautionary tale

Trigger: fast-follow after the source-available cut ships; gate on someone
actually wanting to self-host on a server, same as the original Track C
deferral.
