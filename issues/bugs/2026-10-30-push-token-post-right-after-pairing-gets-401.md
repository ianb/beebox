---
title: "A newly paired phone's push registration is refused, so the box says it cannot notify anyone"
workstream: unattached
area: beebox
labels: [ios, notifications, pairing]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder paired a phone to a production box, and the box still said it could not notify him, 2026-10-30"
---

The boxholder paired the iOS app to a production box. The box's Settings
still said it could not notify him. Every notification afterward was logged
`skipped: no-audience` on both the `apns` and `web-push` channels.

Evidence, from the production nginx log and box files (read-only):

- `POST /<box>/api/pairing/redeem` returned 200, then in the same second
  `POST /<box>/api/pairing/push-token` returned **401** with a 29-byte body.
- The same phone's push-token posts to four other boxes, a few seconds
  earlier, returned 204.
- The device record in the box's `.beebox/mobile-devices.secret.json` has no
  `apns` registration. The other boxes' records have one.
- APNs keys are configured on the host, so the channel itself works.
- A later `POST /<box>/api/pairing/session` with the same bearer returned 204.
  The device token is valid. Only the first post, made right after redeem,
  was refused.

The 29-byte body is not the push-token handler's own 401 text
(`beebox/src/webapp/routes/pairing.ts:86`), so the rejection probably comes
from the box auth preHandler before the handler runs. Possible causes: a
cached device list that does not yet include the device redeem just
created, or the phone sending a credential other than the redeemed token.

The phone does not recover by itself soon enough. `PushRegistrar`
(`ios-app/BeeBox/Services/PushRegistrar.swift`) leaves the box unrecorded in
its ledger, so it posts again on a later sync: the next app launch or
foreground. Until then the box has no way to reach the boxholder, and
nothing tells either side why.

Fix directions:
- Make the bearer valid as soon as redeem returns. Find the stale path.
- On the phone, retry a failed registration with backoff, rather than
  waiting for the next launch.
- In Settings, say "your phone is paired but not registered for
  notifications" instead of the generic cannot-notify text.

2026-10-31 (retrospective 20261031-234313): prevention is part of the fix.
`beebox/test/webapp/routes/pairing.push-token.test.ts` redeems through
`redeemMobilePairingTicket` directly, so it skips the HTTP path. Add a test that
calls `POST /api/pairing/redeem`, posts a push token at once with the returned
bearer, and asserts 204.
