---
name: cb-guide-api
description: Explains how HTTP endpoints are added in callback-box and the tRPC-vs-raw-Fastify decision. Use when adding an endpoint, procedure, subscription, or route, or wiring the frontend to the backend. Triggers include "add an endpoint", "new API", "add a route", "call this from the frontend", "add a subscription". Instructional (a cb-guide-* skill) — full checklist in docs/adding-api-endpoints.md.
---

# Adding API endpoints: the decision, then the checklist

A guide skill: the decision rule and the gotchas. The step-by-step
checklist lives in `callback-box/docs/adding-api-endpoints.md` — follow
it once you know which shape you're building.

## The decision rule

**tRPC by default.** Add a procedure under `src/webapp/trpc/routers/`,
validate input with Zod, call via `trpc.<router>.<procedure>`.
Real-time/streaming is also tRPC: **subscriptions over the WebSocket**
(`events.subscribe` for the global event bus, `events.turnStream` for
the resumable per-turn chat stream; the client's `splitLink` in
`lib/trpc.ts` routes subscriptions through `wsLink`).

**Raw Fastify routes** (`src/webapp/routes/`) only for what doesn't fit
the tRPC request/response shape: file upload/download, OAuth redirects,
webhooks, and the `/chat/send` POST. Older raw routes are tech debt —
migrate when you touch the area.

## Gotchas that bite

- Route doctests: `makeTestServer()` prefixes every URL with `/test`;
  use `rootRequest()` for root-level routes.
- A box's `.claude/settings.json` permissions do NOT gate engine-spawned
  agents (`bypassPermissions` is hardcoded) — don't design an endpoint
  assuming box-level permission enforcement.
- Anything the endpoint reads from env: hub-spawned children get a
  fail-closed allowlist (`src/hub/child-env.ts`) — add the var there or
  it silently disappears in prod/dev-hub.
- Browser console errors surface server-side via `debugLog.submit` →
  `.callback-box/client-debug.log` — check it when the frontend call
  misbehaves (`docs/client-debug-log.md`).
