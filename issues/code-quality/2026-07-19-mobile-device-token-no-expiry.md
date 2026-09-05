---
title: "Mobile device tokens still have no expiry or rotation"
workstream: mobile-token-handshake
area: beebox
filed-by: agent
discovered-in: worktree-mobile-token-handshake — deferred from the bbx_mobile cookie work
priority: backlog
---

`MobileDevice` (`beebox/src/core/mobile/pairing.ts`) tracks `revokedAt` but no
`expiresAt`. A paired device's durable token is valid forever unless a human notices and
revokes it.

The bbx_mobile cookie work (`../../beebox/docs/implemented-plans/mobile-token-handshake.md`) removed
the urgent half of this: the token no longer travels in URLs, so it no longer lands in access
logs, `Referer` headers, or WebKit history, and the *session* now expires hourly. What remains
is that the durable token itself — held in the iOS app and in web localStorage — never ages
out.

Deferred from that plan deliberately: adding `expiresAt` is a shape change to
`mobile-devices.secret.json` on boxes that already hold pairings, so it needs a migration per
the `bbx-migration` skill, and a naive rollout would silently un-pair every existing device.

Open questions, none settled:

- What TTL? A phone that's a daily driver shouldn't need re-pairing often; a lost one
  shouldn't stay valid for a year.
- Rotate-on-use (issue a fresh token alongside each renewal) instead of a hard expiry? That
  keeps active devices working indefinitely while bounding a *stolen* token's life — but it
  needs the client to persist the rotated value, which is a contract change on both iOS and
  web (`docs/mobile-contract.md` §2).
- Existing devices: grandfather them with a far-future `expiresAt`, or force one re-pair?

Related: [iOS stores the token as plaintext, not Keychain](../closed/bugs/2026-07-17-ios-token-plaintext-not-keychain.md)
(where the token lives on-device).
