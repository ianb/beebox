---
title: "iOS device token stored as plaintext JSON, not Keychain"
area: callback-box
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
---

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
