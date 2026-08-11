---
title: "iOS device token stored as plaintext JSON, not Keychain"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
resolution: implemented
---

**Closed 2026-08-07 by 571bb83f.** Paired-device tokens now migrate to a shared
Keychain access group using `AfterFirstUnlockThisDeviceOnly`; token-free paired-box metadata and
the selected-box snapshot preserve only non-secret state. Migration tests, a simulator build, and
the generated app/extension entitlements verified the shared access group.

`PairedBox.authToken` is persisted as plaintext JSON in `Library/Application Support/paired-boxes.json`
(written via `PairedBoxStore.save` in `ios-app/CallbackBox/Storage/PairedBoxStore.swift`, an atomic
`Data.write`). There's no Keychain usage anywhere in the app, no `CODE_SIGN_ENTITLEMENTS`, and no
`FileProtection` applied to the file. This departs from the Keychain plan stated in the original
Track-C design.

Concrete failure: the durable, non-expiring mobile device token (see the related `?mobileToken=` URL
issue for why it's especially sensitive) is readable by anything with filesystem access to the app's
container — a jailbreak, a backup-extraction tool, or any local device-forensics flow — with no OS-level
protection at rest.

First raised (as I6) in the 2026-07-09 review; still open as of 2026-07-17.

Fix direction: move `authToken` storage to Keychain (with an appropriate accessibility class), migrating
existing plaintext entries on first launch after the change.

**2026-07-19 (worktree-mobile-token-handshake):** re-confirmed while mapping the iOS auth surface —
`Keychain`/`kSec*`/`SecItem` still return zero matches across every `.swift` file. One constraint for
whoever picks this up: the accessibility class can't be `WhenUnlocked`. `CaptureUploadCoordinator`
performs background uploads that need the token while the device is locked, so it has to be at least
`kSecAttrAccessibleAfterFirstUnlock`. Note the `?mobileToken=` URL issue this cross-references is now
closed — the token is off the wire, which shrinks the exposure but doesn't touch storage at rest.
Related: [device tokens still never expire](../../code-quality/2026-07-19-mobile-device-token-no-expiry.md).
