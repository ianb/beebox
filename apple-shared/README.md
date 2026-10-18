# BeeBoxShared

The Swift code the iOS app (`../ios-app/`) and the Mac app (`../mac-app/`)
share: the `beebox://pair` link parser, the pairing redeem call, the http host
policy for pairing links, the single-use ticket guard, and the Keychain store
for per-box credentials. Platform-neutral only: no UIKit, no AppKit.

Wire shapes follow [the mobile contract](../beebox/docs/mobile-contract.md);
the tests read its shared fixtures under
`../beebox/test/mobile-contract/fixtures/`, so run them from this checkout.

```sh
swift test --disable-swift-testing   # or bin/apple-test from the repo root
```

Code moves here when its second caller exists. Each app keeps its own
paired-box record and store: the iPhone's carries phone-only state (sessions,
the device lock, the extension snapshot).
