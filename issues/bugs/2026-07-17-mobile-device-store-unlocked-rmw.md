---
title: "Mobile device-store read-modify-write is unlocked and non-atomic (S3)"
area: callback-box
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
---

`verifyMobileToken` in `callback-box/src/core/mobile/pairing.ts` does a plain read → mutate
`lastUsedAt` → write-back on every mobile-authenticated request, with no `withCardLock` or file lock
around the sequence. `revokeMobileDevice` in the same module does its own read-modify-write. The two
can race: an in-flight `verifyMobileToken` call (started before a revocation) can write back a stale
device record and silently clobber a concurrent revocation, leaving a device the owner just revoked
still valid.

Separately, `writeDeviceStore` in the same module is a bare `writeFileSync` — no temp-file+rename. A
crash or process kill mid-write can corrupt `<boxRoot>/.callback-box/mobile-devices.secret.json`,
losing every paired device's record at once.

Fix direction: serialize device-store read-modify-write cycles the same way other card-like state in
the box is protected (e.g. `withCardLock` or an equivalent mutex), and switch `writeDeviceStore` to
write-to-temp + atomic rename. First raised in the 2026-07-09 review; remains open.
