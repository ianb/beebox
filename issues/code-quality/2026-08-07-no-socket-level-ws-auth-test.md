---
title: "No socket-level integration test for WS tRPC subscription auth"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — todo-security breakdown for the security-overview.md report
---

The tRPC WebSocket adapter (`useWSS`, the per-box plugin) hands `createContext`
(`beebox/src/webapp/trpc/context.ts`) a raw `http.IncomingMessage`. The
raw-`Cookie`-header identity fallback that `createContext` relies on is covered
only at the **resolver** level by `test/webapp/ws-auth.doctest.md` — no test
opens a real WebSocket, upgrades a tRPC subscription, and asserts the resolved
identity end to end.

`test/hub/`'s `rawUpgradeRequest` helpers look adjacent, but they assert only the
HTTP upgrade **status code** against a Fastify-**decorated** request, so they
never exercise the raw-`IncomingMessage` path this fallback exists for. The
consequence: a regression that broke `createContext`'s wiring to the identity
resolver — as opposed to the resolver logic itself — would pass the whole suite.

Add a doctest-tier harness that opens a real WS connection against
`makeTestServer()`, drives a subscription (e.g. `events.subscribe`), and asserts
auth is enforced through the actual upgrade path (accepted when the cookie is
valid, rejected/closed when absent), not against a synthetic request object.

## Field observation (2026-08-09)

The predicted symptom happened and cost two debugging sessions. A browse-driven
browser with a missing/expired `bbx_session` loads pages that look normal, but
every tRPC WS upgrade is silently destroyed (`bin/router.ts` upgrade handler
calls `socket.destroy()` on deny — no status, no close frame), so realtime is
dead with **zero client-side signal**: no `[events-sub]` error, no console
warning, `wsLink` just backs off and retries forever. This masked the
first-message-redirect reproduction (see
[new-chat-first-message-blank-until-agent-works](../closed/bugs/2026-08-08-new-chat-first-message-blank-until-agent-works.md)).
When adding the socket-level test, also consider whether the router/box should
refuse the upgrade with a readable 401 response (as the hub already does)
rather than a bare TCP reset, and/or whether the client should surface a
persistent-reconnect-failure signal after N attempts.

Broken out of `beebox/docs/todo-security.md` ("No true socket-level WS-auth
integration test"), where it was recorded as a residual accepted for now — this
makes it a tracked coverage gap. Feeds the internal-security-practices section of
the [agent-maintained security report](../closed/features/2026-07-20-agent-maintained-security-report.md).
