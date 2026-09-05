---
title: "Durable mobile device token rides in the ?mobileToken= URL query (S2)"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — beebox/docs/plans/ios-companion-review-2026-07-17.md
resolution: implemented
---

**Closed 2026-07-19** — implemented in `worktree-mobile-token-handshake`, designed in
`../../../beebox/docs/implemented-plans/mobile-token-handshake.md`. The query-param carrier is gone: the
durable token is header-only, and a short-lived per-box signed cookie (`bbx_mobile`) carries
navigations and WebSocket upgrades. All three `mobileTokenFromUrl` copies are deleted. The
hub's presence-only mobile gate (risk S1) was replaced with real verification in the same
change. Token expiry itself was deferred — see
`../../code-quality/2026-07-19-mobile-device-token-no-expiry.md`.

---

Both the web frontend and the iOS app put the long-lived mobile device token directly into a URL
query parameter rather than only a header:

- Web: `getWebSocketUrl` in `beebox/src/frontend/src/lib/api-core.ts` appends
  `?mobileToken=<token>` when building the tRPC WebSocket URL.
- iOS: `ChatWebView.authenticatedChatURL` in `ios-app/BeeBox/Views/ChatWebView.swift` appends
  the same `?mobileToken=<token>` to the initial `/chat` navigation, to satisfy the hub's pre-upgrade
  auth gate before the localStorage-injected token is available.

Because device tokens never expire (see `MobileDevice` in `beebox/src/core/mobile/pairing.ts` —
no `expiresAt`, only `revokedAt`), a token that leaks into hub/nginx access logs, `Referer` headers, or
WebKit history is replayable indefinitely until someone notices and manually revokes the device. The
lack of expiry compounds the leak surface rather than bounding it.

Consumed at three call sites that would all need to change together:
`beebox/src/hub/hub-server.ts`, `beebox/src/webapp/server-box-scope.ts`, and
`beebox/src/webapp/server-root.ts` (all read `?mobileToken=` via a duplicated
`mobileTokenFromUrl` parser — see the related code-quality issue for that duplication).

Fix direction: scope the URL query param to a short-lived, single-use handshake token distinct from
the durable device token (the durable token stays in the `Authorization` header / localStorage-injected
channel only). Was first raised in the 2026-07-09 review and remains open.
