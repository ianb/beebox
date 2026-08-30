---
title: "Mobile-authenticated chat sends attribute to no user"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — beebox/docs/plans/ios-companion-review-2026-07-17.md
resolution: implemented
---

**Resolved** in worktree `open-source-readiness`: `POST /api/chat/send` now falls
back to `resolveMobileSender` (`webapp/routes/chat-helpers.ts`) when there is no
`bbx_session` cookie — resolving the request's mobile identity to the paired
device's `createdBy` email (the strict single-identity option: attribute to the
user who paired the device; a device paired in open mode carries no `createdBy`
and stays unattributed, matching the cookie path). Test:
`test/webapp/routes/chat-mobile-sender.doctest.md`.

Requests authenticated via the mobile device token (bearer or `?mobileToken=`) get `authed: true` in
tRPC's `createContext` (`beebox/src/webapp/server-box-scope.ts`), but `user` stays `null` and
`isOwner` stays `false` — mobile identity is never unified with the owner's session identity. In
practice this means every message sent from the native iOS composer, and every mobile web-session
send, lands in the chat log attributed to nobody rather than to the box owner.

The `ios-companion-app.md` plan already calls identity unification the hardest problem in its
Track-A subplan, and it's still unresolved as of the 2026-07-17 review — this isn't a regression, just
a standing gap worth tracking as its own item since it affects every native send, not just an edge
case.

Fix direction: needs a design decision (single-owner boxes could simply treat any valid mobile token
as the owner; multi-user boxes would need the device record to carry/resolve to a real user identity).
