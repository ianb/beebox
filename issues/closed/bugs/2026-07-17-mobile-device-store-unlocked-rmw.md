---
title: "Mobile device-store read-modify-write is unlocked and non-atomic (S3)"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — beebox/docs/plans/ios-companion-review-2026-07-17.md
resolution: implemented
---

**Resolved** in worktree `open-source-readiness` (strict option). Confirmed the race is genuinely
cross-process: `bbx hub` verifies a mobile bearer (stamping `lastUsedAt`) before proxying to the
per-box `bbx serve` child, which verifies it again and can revoke it — two processes writing
`mobile-devices.secret.json`. Every device-store mutation (`resolveMobileTokenIdentity`,
`redeemMobilePairingTicket`, `revokeMobileDevice`) now runs through the cross-process `file-lock.ts`
primitive (`withDeviceStoreLock`, read-inside-lock) and `writeDeviceStore` lands via temp-file +
fsync + atomic rename — mirroring the sibling credential store `webapp/local-users.ts`. Those
functions (and their callers up through the box/hub/capture auth gates and the tRPC context) became
`async`. Tests: `test/core/mobile/pairing-store-concurrency.doctest.md`; doc: `docs/mobile-contract.md`
§ S3.

`verifyMobileToken` in `beebox/src/core/mobile/pairing.ts` does a plain read → mutate
`lastUsedAt` → write-back on every mobile-authenticated request, with no `withCardLock` or file lock
around the sequence. `revokeMobileDevice` in the same module does its own read-modify-write. The two
can race: an in-flight `verifyMobileToken` call (started before a revocation) can write back a stale
device record and silently clobber a concurrent revocation, leaving a device the owner just revoked
still valid.

Separately, `writeDeviceStore` in the same module is a bare `writeFileSync` — no temp-file+rename. A
crash or process kill mid-write can corrupt `<boxRoot>/.beebox/mobile-devices.secret.json`,
losing every paired device's record at once.

Fix direction: serialize device-store read-modify-write cycles the same way other card-like state in
the box is protected (e.g. `withCardLock` or an equivalent mutex), and switch `writeDeviceStore` to
write-to-temp + atomic rename. First raised in the 2026-07-09 review; remains open.
