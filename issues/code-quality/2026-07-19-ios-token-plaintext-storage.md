---
title: "iOS stores the mobile device token in plaintext JSON, not the Keychain"
area: callback-box
filed-by: agent
discovered-in: worktree-mobile-token-handshake — mapping the iOS auth surface
---

`ios-app/CallbackBox/Storage/PairedBoxStore.swift:12-16` persists the whole `StoreSnapshot`
— including every paired box's `authToken` — as plaintext JSON:

```swift
let supportDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
storageURL = supportDirectory.appendingPathComponent("paired-boxes.json")
```

`save()` (`:140-153`) `JSONEncoder`-encodes it and writes with `.atomic`. There is **no
Keychain usage anywhere in the iOS target** — `Keychain`, `kSec*`, and `SecItem` all return
zero matches across every `.swift` file.

So the durable device token — which has no expiry, only `revokedAt` (`core/mobile/pairing.ts`
`MobileDevice`) — sits unencrypted in the app container, readable from a device backup or by
anything that can reach the container.

This is storage-at-rest, orthogonal to the token-on-the-wire work in
`../../callback-box/docs/plans/mobile-token-handshake.md`, which deliberately left it alone
rather than mixing two threat models in one diff. It was previously noted as "Token in
plaintext, not Keychain (OPEN, iOS I6)" in `callback-box/docs/mobile-contract.md` §9; this
files it as a tracked item.

The fix is a Keychain-backed store for the token field with the JSON file keeping the
non-secret box metadata, plus a migration for already-paired devices (read the plaintext
token once, write it to the Keychain, strip it from the JSON). `kSecAttrAccessibleAfterFirstUnlock`
is probably the right accessibility class — background uploads (`CaptureUploadCoordinator`)
need the token while the device is locked.

Related: device tokens still have no `expiresAt` — see
`2026-07-19-mobile-device-token-no-expiry.md`.
