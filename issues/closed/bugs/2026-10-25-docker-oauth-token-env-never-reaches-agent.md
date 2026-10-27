---
title: "Docker's `CLAUDE_CODE_OAUTH_TOKEN` env fallback never reaches the agent subprocess"
workstream: box-isolation-followups
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: box-isolation — review round 6 (codex gpt-6-sol) of the long-lived token change
labels: [docker, auth]
resolution: implemented
---

**Closed 2026-10-27 (box-isolation-followups).** Option 1: the Docker doc's
token fallback and the compose comments now point at the `claude-oauth-token`
secret (`bbx secrets set` and `bbx secrets grant /data/box`, or Admin →
Secrets), and say an env-file line does not reach the agent.

`beebox/docs/install/docker.md` ("token fallback") and `beebox/docker/compose.yaml`
tell a headless install to put a `claude setup-token` token in `docker/.env` as
`CLAUDE_CODE_OAUTH_TOKEN`, which compose passes to the hub process. Nothing
forwards it from there: the hub-to-child allowlist
(`src/hub/supervisor/child-env.ts`) and the agent allowlist
(`src/core/script-env/allowlist.ts`) both leave it out by design, so the Claude
CLI the box spawns never sees it. The documented fallback either never worked
or stopped working when the allowlists were introduced; nothing in the repo
records it being exercised. Since 2026-10-25 the status probe also drops an
ambient token (`src/services/claude-cli.ts`), so the Admin page no longer shows
"logged in" for a token the run cannot use.

The supported path is now the `claude-oauth-token` secret
(`src/core/claude-oauth-token.ts`, `docs/server/configuration.md`, "The
long-lived token"): the token in the machine secret store, granted to the box,
injected by the server into first-party runs and the probes.

Resolution options:

1. Rewrite the Docker doc and compose comment to the secret: `docker compose
   run --rm box bbx secrets set claude-oauth-token` and a grant, and drop the
   env-file mention.
2. Also honor the env variable at the hub as a first-time convenience by
   writing it into the store on start. More machinery for one install path;
   the lean is option 1.
