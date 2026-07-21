---
title: "Hub mobile-auth wall check is presence-only, not verified (S1)"
area: callback-box
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
resolution: implemented
---

**Closed (implemented).** The presence-only gate is gone: `hasMobileAuth` in
`src/hub/hub-server.ts` now calls `verifyMobileRequest`
(`src/core/mobile/request-auth.ts`), which validates the bearer against the
device store / the `cb_mobile` cookie against its per-box HMAC. Both the HTTP
catch-all and the WS-upgrade path reject an unverified request BEFORE
`resolveEndpoint`, so a bogus `Bearer x` no longer cold-starts a box or reveals
slug validity. The verification landed in commit 44da6cef ("auth: harden
against Codex review findings"); this closure adds the explicit no-enumeration
proof — a bogus credential on a real slug answers identically to an unknown slug
— in `test/hub/hub-server-auth.doctest.md`.


`hasMobileAuthAttempt` in `callback-box/src/hub/hub-server.ts` decides whether to let a request past
the hub's pre-upgrade auth wall by checking only that an `Authorization: Bearer …` header OR a
`?mobileToken=` query param is *present* — it never validates the token against the box's device
store. This gate is used both on the HTTP catch-all and on the WebSocket upgrade path to bypass the
wall before the box itself re-verifies.

Concrete failure: an attacker who knows (or guesses) a valid box slug can send any request with
`Bearer x` or `?mobileToken=x` and the hub will cold-start the box to resolve the endpoint before the
box's own auth hook 401s the bogus token. That's an unauthenticated box-wake plus an existence oracle
(you learn whether a slug is valid/live from the response even without a real token) — paid for on
every guess, since idle boxes cold-start.

Note `listMobileAuthorizedBoxes` in the same file does real verification for the `/api/boxes` listing
— only the wall-bypass gate is presence-only. This finding was first raised in the 2026-07-09 review
and remains open as of 2026-07-17.

Fix direction: verify the token against the device store (or at minimum a fast HMAC/format check)
before letting the request reach `resolveEndpoint`, rather than deferring all verification to the box.
