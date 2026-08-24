---
title: "tRPC error responses carry a server stack trace, and the deploy never sets NODE_ENV=production"
workstream: node-env-production
design: ../../callback-box/docs/plans/webapp-production-mode.md
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

The live server uses the manually configured `callback-hub` unit, not the
obsolete `callback-serve` unit that `setup-server.sh` still generates
(`callback-box/deploy/README.md:91-101`, `:243-248`). The hub copies
`NODE_ENV` into every box child only when the hub received it
(`callback-box/src/hub/child-env.ts:42-50`, `:103-119`).

## Production confirmation (2026-08-23)

The boxholder authorized a read-only probe of the running `callback-hub`
process. The probe read `/proc/<MainPID>/environ`, filtered the output to the
single `NODE_ENV` key, and returned:

```
NODE_ENV=<unset>
```

The production children therefore take the development branch today. The
security report's claim that `/api/external` is never mounted on a deployed
server is false for the running deployment.

The route is behind ordinary per-box authentication, but it is not owner-only.
An authorized box member can use the raw file-write route to replace
`config/box.json` with an arbitrary `externalRoots` entry; the external route
reloads those roots on each request. Its denylist covers only `.git`,
`node_modules`, and `.env*`. With `/` or `~` configured as a root, other host
files—including credential stores and sibling-box secrets—are readable. This
makes the live route a host-filesystem disclosure path, not merely an
accidentally mounted commentary helper.

The initial issue also missed a fourth branch. `POST /api/chat/tts` accepts
browser-test mock fields when `NODE_ENV !== "production"`
(`callback-box/src/webapp/routes/chat-audio-routes.ts:115-123`). An authenticated
caller can therefore select fixture audio, delays, chunk sizes, or a
deterministic mock failure on the deployed server.

## Temporary containment (2026-08-23)

With the boxholder's explicit approval, a unit-local systemd drop-in set
`NODE_ENV=production` on `callback-hub`; the shared `.env` and scheduler unit
were not changed or restarted. A filtered inventory confirmed that both the
shared engine and separately pinned engines contain the ambient guard.

After restarting only the hub:

- `callback-hub` and `callback-scheduler` both reported active.
- The hub process reported `NODE_ENV=production`.
- An authenticated canary request to `GET /api/external` returned 404.
- A missing tRPC procedure returned 404 with no `stack` field.

The override is temporary. It also reaches older engines' agent/script
subprocesses, where package managers may interpret it. The durable fix removes
all four security decisions from `NODE_ENV`, stops current engines from
passing it to agent/scripts, upgrades or backports the pinned engines, and
then removes the drop-in.

## Durable implementation draft (2026-08-23)

The linked worktree now defaults development surfaces off and enables them only
with the strict `CB_DEV_SURFACES=1` launcher opt-in. tRPC explicitly disables
response stacks and replaces raw `INTERNAL_SERVER_ERROR` messages, since an
exception message can contain the same absolute paths even without a stack.
Fastify always selects the built-frontend CSP policy; Vite independently owns
its HMR policy. Mock TTS is rejected before provider lookup unless development
surfaces are enabled.

The implementation's focused tests and the full 604-file callback-box suite are
green, but it is not yet a production replacement for the override: the change
must be landed and deployed, and every separately pinned engine must be
upgraded or backported before the temporary `NODE_ENV` bridge and systemd
drop-in can be removed.
