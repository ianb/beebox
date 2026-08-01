---
title: "bin/browse cannot reach an authenticated dev page — the agent-token path is broken end to end"
area: router
filed-by: agent
discovered-in: worktree-browse-back-url — verifying the browse back-button fix in a real browser
resolution: implemented
---

**Closed 2026-07-31.** Fixed not by making the agent token work through the
hub — a Codex review showed that would promote a 0600 file secret to a
credential valid at the public prod front door — but by adding an opt-in
`CB_BROWSE_API_KEY` (`callback-box/src/core/browse-key.ts`), absent by default
and delivered to the browser as a cookie so it also covers the WebSocket
upgrade. Design and what building it changed:
`callback-box/docs/implemented-plans/agent-token-browser-auth.md`.

Defect 3 below (the mobile-bootstrap hard-401) is NOT fixed — it is sidestepped,
because `bin/browse` now sends no `Authorization` header. The trigger is still
too broad; see the note at the end.

`bin/browse open /<any authenticated page>` lands on the login page (or a bare
`Mobile session bootstrap failed.`), so an agent cannot drive the local dev app
at all. The agent-token mechanism `bin/browse` documents is dead in three
independent places. Fixing only one does not help.

## Defect 1 — wrong token path (fixed 2026-07-31)

`bin/browse` read the token from the box PACKAGE root
(`<box>/.callback-box/agent-token`). The token actually lives under the box's
OPERATIONAL root, which in the v2 package shape is `<box>/content/`
(`core/agent/token.ts` is called with the content dir; `bin/box-entry.ts`
resolves the same `contentDir`). The file therefore never existed at the path
`bin/browse` probed, so `BROWSE_AGENT_TOKEN` was never set and every browse ran
unauthenticated — silently, because "no token file yet" is a documented
non-error.

Fixed in this worktree: `bin/browse` now prefers `<box>/content/.callback-box/`
and falls back to the package root for legacy (shapeVersion 1) boxes.

## Defect 2 — `cb hub` has no agent-bearer rung

With the token attached, an `/api/` request now passes the ROUTER gate
(`bin/router-auth-deps.ts:133` verifies the agent bearer against
`entry.contentDir`) and then dies at the hub with `{"error":"Not
authenticated"}`. `hub-server.ts:462` gates on `hasMobileAuth(...) ||
decideHubAuth(...)`, and `hasMobileAuth` calls only `verifyMobileRequest` — it
never checks the agent bearer. The box's own wall
(`server-box-scope.ts:89`) WOULD accept it, but the request never gets there.

So the router and the box agree the agent token is valid box-scoped auth, and
the hub sitting between them does not.

## Defect 3 — a bearer navigation is forced through mobile pairing

`mobileBootstrapTarget` (`bin/router-mobile-bootstrap.ts:24`) treats ANY
authorized GET document navigation into a box that carries an `Authorization`
header as a mobile-pairing bootstrap. It POSTs the bearer to
`/api/pairing/session`; the agent token is not a mobile device token, so the
exchange returns non-204 and the router hard-fails the navigation with a 401
`Mobile session bootstrap failed.` (`bin/router.ts:532`).

The result is worse than no token: attaching a valid agent bearer turns a
would-be login redirect into a hard 401 page.

## Fix direction

Not obvious, hence this is filed rather than fixed. Two candidates:

1. Give the hub an agent-bearer rung (mirror `router-auth-deps.ts:133`) AND
   make `mobileBootstrapTarget` skip the bootstrap when the bearer verifies as
   the box agent token — the request is already box-authorized, so it needs no
   session exchange. This keeps `bin/browse`'s documented design.
2. Decide the agent token is loopback-only by design and give `bin/browse` a
   different credential path (a real pairing/device token, or a scripted login).

Either way the live dev router only picks up `bin/router*.ts` changes after a
main-merge plus a `pnpm dev` restart, so this needs the boxholder in the loop.

## Impact

Any issue whose verification says "check it in a real browser" is currently
un-verifiable by an agent on the local dev app. That includes the browse
history work in
[browse-back-button-url-not-updated](2026-07-22-browse-back-button-url-not-updated.md).

## Still open: defect 3's trigger is too broad

`mobileBootstrapTarget` fires on any GET to a non-`/api` box path carrying any
`Authorization` header — it is not restricted to document navigations despite
being justified by "a navigation gets the Vite HTML shell". Any future non-device
bearer the gate accepts will hit the same hard 401. Worth narrowing to a real
navigation (`Sec-Fetch-Mode: navigate`), and worth reconsidering whether a failed
best-effort exchange should fail a request the gate already authorized.
