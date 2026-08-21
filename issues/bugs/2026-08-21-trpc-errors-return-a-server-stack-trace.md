---
title: "tRPC error responses carry a server stack trace, and the deploy never sets NODE_ENV=production"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — reading a 403 from the settings page in the browser network panel
---

A tRPC error response body includes a full server stack trace with absolute
filesystem paths, readable in the browser. Observed on a `FORBIDDEN`
("Owner access required") from `pairing.devices` on the settings page.

The router is created with no error formatter
(`callback-box/src/webapp/trpc/trpc.ts:4`), so tRPC's default applies: it puts
`stack` in `error.data` whenever `process.env.NODE_ENV !== "production"`.

The part that needs checking is what that env var is on a deployed box. Nothing
in `callback-box/deploy/` sets it: the systemd units take their environment from
`$CB_HOME/.env` (`deploy/setup-server.sh:212`, `:238`) and the generated `.env`
template has no `NODE_ENV` line (`deploy/setup-server.sh:171-183`). Three
behaviours key off the same variable and would all take their dev branch if it
is unset in production:

- tRPC error stacks, above.
- `GET /api/external`, which reads allowlisted files OUTSIDE the box root, is
  registered when `NODE_ENV !== "production"`
  (`callback-box/src/webapp/routes/api.ts:73`). `docs/security-report.md:107`
  records this endpoint as "never mounted on a deployed server" on the strength
  of that guard.
- The CSP header mode (`callback-box/src/webapp/server.ts:158`).

First step is to read the running server's environment and confirm whether
`NODE_ENV` is set there; the repo cannot answer it.
