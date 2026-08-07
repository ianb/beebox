---
title: "No socket-level integration test for WS tRPC subscription auth"
area: callback-box
filed-by: agent
discovered-in: main session — todo-security breakdown for the SECURITY.md report
---

The tRPC WebSocket adapter (`useWSS`, the per-box plugin) hands `createContext`
(`callback-box/src/webapp/trpc/context.ts`) a raw `http.IncomingMessage`. The
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

Broken out of `callback-box/docs/todo-security.md` ("No true socket-level WS-auth
integration test"), where it was recorded as a residual accepted for now — this
makes it a tracked coverage gap. Feeds the internal-security-practices section of
the [agent-maintained security report](../features/2026-07-20-agent-maintained-security-report.md).
