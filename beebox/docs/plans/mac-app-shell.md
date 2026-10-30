---
title: "Bee Box for Mac as a shell around a box"
status: active
workstream: app-shell
issues:
  - ../../../issues/features/2026-10-07-mac-companion-app.md
  - ../../../issues/bugs/2026-07-17-ios-pairing-flow-robustness.md
---
# Bee Box for Mac as a shell around a box

> **Naming note (2026-10-18):** doctests (`*.doctest.md`) are now `.test.ts` files with `t.check`, in the same directory under the same base name, and `agent-doctest` is now `tap-check/` (`@ianbicking/tap-check`). See `beebox/docs/implemented-plans/retire-doctest.md`.

This plan grows `mac-app/` from a menu-bar launcher for one local VM box into
a shell around any box. The shell has no window of its own: it opens a box's
web app in the default browser, pairs with a remote box through a pasted link
so that its native features hold a credential, and absorbs the folder watching
that `scan-uploader` and its launchd agent do today. Hosting a box locally
becomes one option, not a requirement. A new Swift package holds the code the
iOS app and the Mac app share, and it gives that code tests that run without
a simulator.

**Issues addressed:**
- [Mac companion app](../../../issues/features/2026-10-07-mac-companion-app.md),
  in part: this plan covers pairing, the box menu, the scanner and
  Photos upload, and the local box. Input (global shortcut, voice,
  selections) and the quick-drop entry stay open under that issue.
- [iOS pairing-flow robustness](../../../issues/bugs/2026-07-17-ios-pairing-flow-robustness.md),
  in part: the duplicate redeem and the silent failures. The in-memory ticket
  versus idle-stop race is not addressed (see NOT in scope). That issue stays
  open with a note, so the finish skill must not close it; it is listed so the
  note gets written.
- Related, not addressed: [an unreachable box shows a blank screen](../../../issues/bugs/2026-09-12-ios-unreachable-box-shows-a-blank-screen.md)
  (the Mac has no web view this round, so the overlay does not apply),
  [engine updates without an app release](../../../issues/closed/features/2026-10-10-mac-app-engine-updates-without-app-release.md),
  [device tokens have no expiry](../../../issues/code-quality/2026-07-19-mobile-device-token-no-expiry.md)
  (a Mac adds one more long-lived device token; no change in kind).

## Design

Tracks A–C change no surface a person sees except the iOS pairing error
message, which restores already-decided behavior (the robustness issue asks
for it). Tracks D–G are designed in [mac-app-shell.design.md](mac-app-shell.design.md):
a menu for glancing and opening boxes, and a Preferences window (Boxes with
the pairing sheet, Uploads, General) for setup. No web view. The decisions already made by
the boxholder (anchor issue, "Decisions (boxholder, 2026-10-07)", and
2026-10-17 in this workstream) are the inputs:

- The web app stays in the browser. No web-view window for now (boxholder,
  2026-10-17: "no window at all, only web access"). This narrows the anchor
  issue's "wrap the web app" for this round.
- One shared layer, not two codebases.
- Pairing is by link, copied and pasted. The iPhone does not get a paste
  option (2026-10-17).
- The app can host a box locally, but does not have to. Hosting is off by
  default, and with it off the app downloads nothing for it (boxholder,
  2026-10-17).
- The ScanSnap folder upload and the Photos album export move into the app
  (2026-10-17).
- The Clerk extension and the iOS input shell do not change.

## Smallest fix and budget

The smallest change that delivers "pair the Mac app with a remote box and open
it" is Track D alone: a paste dialog, a box list in the menu, and a copy of the
iOS pairing code. That is about 250 lines, and it creates the second codebase
the boxholder ruled out.

The chosen design, by track (source + test lines, additions plus deletions;
moved code counts on both sides):

| Track | Source | Tests | Notes |
|---|---|---|---|
| A. Shared package, pairing link and redeem | 250 | 250 | iOS adopts it; `project.pbxproj` about 30 |
| B. One command runs Apple tests; finish runs it | 150 | 40 | `bin/` script + preflight group |
| C. Paired-box store moves to the package | 750 (moved) | 150 | `PairedBoxStore`, credential store, `PairedBox`, bearer construction |
| D. Box menu, Preferences, pairing sheet, `beebox:` links | 600 | 150 | no web view |
| E. Scanner folder upload in Swift | 700 | 500 | ports the `scan-uploader` doctest cases |
| F. Photos album export with PhotoKit | 300 | 150 | |
| G. Local box optional, one entry in the menu | 200 | 50 | |
| Docs | about 300 | | contract docs, AGENTS/README |

Total about 4,600 lines: **BIG CHANGE.** The size comes from three things the
boxholder asked for: a shared layer (C is mostly moved code), a Swift
reimplementation of the scan client (E), and a PhotoKit exporter to replace
`osxphotos` (F). Each track ships nothing on its own; the plan lands as one
piece.

The boxholder approved this scale on 2026-10-17 ("Go ahead with the size").

## Stated preferences this plan trades against

- **Shared layer, not two codebases** (anchor issue, boxholder decision). Track C
  moves code that works today. The cost is churn in the iOS app for no iOS
  feature. The gain is that the Mac app does not fork the pairing and storage
  rules.
- **Bias toward strict** (boxholder memory). Pairing confirms before it
  redeems, and an unexpected redeem response is an error. The watcher refuses
  to run on a folder that the launchd agent also watches.
- **Operational simplicity beats per-call cost** (boxholder memory). The scanner
  credential is minted by the app over its device token (Track E), so setup is
  one paste. The other options need a second paste or a server change.
- **Minimize invented concepts** (boxholder memory). The plan reuses `PairedBox`,
  the device token, the scan token, and the scan contract as they are. The one
  new noun is the package itself.
- **`ios-app/AGENTS.md:25`**: *"There are no third-party iOS dependencies."* The
  package is first-party and adds none.
- **`scan-uploader/AGENTS.md`**, "The wire contract is shared with a package that
  shares no code". Track E adds a second client of that contract. It follows
  the same rules: `// WIRE CONTRACT (scan-upload)` breadcrumbs, and
  `SCAN_CONTRACT_VERSION` spelled once more, in Swift.
- **No doctests in new work** (boxholder, 2026-10-17). All new tests are XCTest.

## What already exists

- **Pairing parse and redeem**: `ios-app/BeeBox/Storage/PairedBoxStore.swift:113`
  `func pair(from url: URL) async -> Bool` and `:321` `redeemPairing`. It
  hardcodes `URLSession.shared` and `UIDevice.current.name` (`:328`), so it
  cannot be tested offline. **Reuse**, moved into the package with the transport
  and device label injected.
- **Pairing fixtures**: `beebox/test/mobile-contract/fixtures/pairing-url/`
  (6 cases, including 2 rejections) and `.../redeem/` (request, 200, 401). The
  TypeScript side reads them; no Swift test does. **Reuse** as the spec for
  Track A.
- **Fixture loader**: `MobileContractFixtures` at
  `ios-app/BeeBoxTests/SpeechKeywordsTests.swift:639` walks up from `#filePath`
  to the fixture directory. **Reuse** the same approach in the package's tests.
- **Copy Link**: `beebox/src/frontend/src/components/settings/CompanionPairingSection.tsx:143`
  calls `navigator.clipboard.writeText(ticket.deepLink)`. The link is
  `beebox://pair?baseURL=…&label=…&pairingToken=…` (`:35`). Paste pairing needs
  no web change.
- **Ticket and redeem server side**: `beebox/src/core/mobile/pairing.ts:10`
  `DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000`; `beebox/src/webapp/routes/pairing.ts:35`
  `POST /api/pairing/redeem`. **Reuse unchanged.**
- **Device token reaches tRPC as its pairer**:
  `beebox/src/webapp/server-box-scope.ts:279-280` *"const mobileEmail =
  mobileAuth?.createdBy ?? null; const email = identity.email ?? mobileEmail;"*
  and `:303` *"isOwner: identityIsOpen || (user !== null && user.email ===
  getOwnerEmail())"*. A device the owner paired is the owner on tRPC.
  Live probe on the worktree test box, 2026-10-17: a ticket minted with the
  browse key, redeemed, then `scanTokens.create` with the device token →
  `403 Owner access required`. The probe device had `createdBy: null` (the
  browse key carries no email), so this probe does not test the owner path,
  and the result is inconclusive. Track E's first chunk repeats the probe with
  a device paired from a signed-in owner session before it builds on this. The
  probe device was revoked.
  Precedent for native tRPC calls with the bearer:
  `ios-app/BeeBox/Services/QuickChatAPI.swift:117`.
- **Scan token mint**: `beebox/src/webapp/trpc/routers/scan-tokens.ts:19`
  `create: ownerProcedure .input(z.object({ name: … }))`. **Reuse**: the Mac app
  calls it once with its device token (Track E).
- **Scan client headers and health**: `beebox/src/core/scan/tokens.ts:230-245`
  reads `x-scan-contract`, `x-scan-client-build`, `x-scan-client-built-at`.
  `beebox/src/webapp/trpc/routers/health/checks/scan-uploaders.ts:96-101`: a
  client that sends no built-at gets only the contract test. **Reuse**: the Mac
  client sends the contract and its app version, and no built-at.
- **Scan client logic**: `scan-uploader/src/cli/run-target.ts` (walk → settle →
  identity → hash → check → PUT → restat → disposition), `wire-client.ts`,
  `disposition.ts`, `notify.ts`, `photos-export.ts` (shells out to `osxphotos`).
  Its doctests under `scan-uploader/test/cli/` are the behavior spec. **Rebuild**
  in Swift: the app cannot run Node, and the boxholder asked for the watching
  to move into the app.
- **Web view auth**: `ios-app/BeeBox/Views/ChatWebView.swift:1156-1170` attaches
  `Authorization: Bearer` to the first request, and the box answers with the
  `bbx_mobile` cookie. **Not reused** this round: the Mac opens boxes in the
  browser and has no web view. The bearer header for its own API calls comes
  from `BoxRequest.swift:27`.
- **Local box runtime**: `mac-app/Sources/BeeBoxMac/BoxRuntime.swift` (phases
  `stopped / working / running(URL) / failed`, served on `localhost:3280`).
  `BEEBOX_PORT` overrides the default port (`BoxRuntime.swift:39-45`).
  The menu opens it in the browser: `BeeBoxMacApp.swift:78`
  `Button("Open Box") { NSWorkspace.shared.open(url) }`. **Reuse** unchanged
  behind the shell (Track G).
- **Mac build**: `mac-app/scripts/build-app.sh` runs `swift build -c release`
  and writes Info.plist from a heredoc. A `.package(path:)` dependency builds
  with it (not yet tried).
- **Tests that run Apple code**: none run automatically.
  `bin/finish-preflight-lib.ts:51` lists `"ios-app"` in `NONE_DIRS` ("no
  build/test tooling of their own"); `mac-app/` has no test target; no hook or
  workflow calls `xcodebuild` or `swift test`.

## Prior art (external)

- WKWebView in a non-sandboxed, hardened-runtime macOS app needs no extra
  entitlement (`mac-app/BeeBoxMac.entitlements` has only
  `com.apple.security.virtualization`). Evaluated-only, from Apple's
  hardened-runtime docs: https://developer.apple.com/documentation/security/hardened-runtime
- `NSAllowsLocalNetworking` permits plain http to local addresses; the iOS app
  already sets it (`ios-app/BeeBox/Info.plist:45-48`). The Mac Info.plist gets
  the same key. Adopted (copy of our own setting).
  https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking
- PhotoKit export: `PHAssetResourceManager.writeData(for:toFile:options:)` with
  `isNetworkAccessAllowed = true` downloads iCloud originals. Evaluated-only;
  Track F's first chunk verifies it against a real album before the design
  is fixed. https://developer.apple.com/documentation/photokit/phassetresourcemanager
- `SMAppService.mainApp` registers the app as a login item, which Track E needs
  so that the watcher runs after a reboot. Evaluated-only.
  https://developer.apple.com/documentation/servicemanagement/smappservice
- Local Swift packages in an Xcode project use `XCLocalSwiftPackageReference`
  (Xcode 15 and later). The project file is edited by hand
  (`ios-app/AGENTS.md`, "Xcode project file"), so Track A verifies it with
  `xcodebuild -list` and a build.

## Ontology

- **Shared package** (new): `apple-shared/`, Swift package `BeeBoxShared`, one
  library product. Platform-neutral code only: no UIKit, no AppKit. It is not
  an app and has no UI.
- **Pairing link** (new type for an existing thing): `PairingLink`, the parsed
  `beebox://pair` URL (`baseURL`, `label`, `pairingToken?`, `sessionID?`,
  DEBUG-only `authToken?`). Identified by its URL. It carries a secret (the
  ticket, or in DEBUG a device token), so it is never logged or stored, and
  the pasteboard copy is cleared after a successful redeem. The wire shape is
  `beebox/docs/mobile-contract.md` §1.1.
- **Pairing ticket** (exists, `pairing.ts`): the short-lived single-use token in
  the link. Redeemed once for a device token.
- **Device token** (exists; `PairedBox.authToken`, `PairedBox.swift:8`): the
  durable bearer a paired app holds. One per paired app install, in the
  Keychain.
- **Paired box** (exists, `PairedBox`, `PairedBox.swift:3`): one box an app is
  paired with. Identified by `id`. Deduped by `baseURL` + `sessionID`
  (`PairedBoxStore.addOrSelectBox`).
- **Local box** (exists in `mac-app`, `Paths.boxName`): the box the Mac app hosts
  in its VM. In the shell it is one more paired box whose `baseURL` is the
  runtime's own `running(URL)` value (default `http://localhost:3280/<name>`;
  `BEEBOX_PORT` changes it), marked `hostedLocally`. It is not a second
  kind of box.
- **Scan token** (exists, `scan-tokens.ts`): the scan-only credential. The Mac
  app mints one per paired box it uploads to, named `mac-<host>` (matching
  `SCAN_TOKEN_NAME_PATTERN`), and stores it in the Keychain next to the device
  token.
- **Upload folder** (new in Swift; `TargetConfig` in
  `scan-uploader/src/cli/config.ts`): a watched folder, its paired box, its
  disposition (`keep | archive | trash`), and an optional Photos album. The
  Swift name is `UploadFolder`. It is not the scan token.

## Tracks / scope

### A. Shared package with the pairing link and redeem

- **What**: create `apple-shared/` with `PairingLink.parse(_ url: URL) ->
  PairingLink?` and `PairingRedeemer`. Test both against the shared fixtures
  with `swift test`. Switch `PairedBoxStore.pair(from:)` to use them, and make
  it single-flight and report a typed result.
- **Why this needs to change**: pairing has no tests (it is the least-tested
  surface in the app), and the Mac app needs the same code. A single scan can
  reach `pair(from:)` twice: `BeeBoxApp.swift:91` (`onOpenURL`) and
  `BeeBoxAppDelegate.swift:95` (through `PairingURLInbox`) both pair. A second
  redeem of the single-use ticket fails. All failures return `false` with no
  message (`PairedBoxStore.swift:138-140`).
- **Direction**:
  ```swift
  public struct PairingLink: Equatable, Sendable {
      public let baseURL: URL; public let label: String
      public let pairingToken: String?; public let sessionID: String?
      public let directAuthToken: String?   // set only when parse(allowDirectAuthToken: true)
      public static func parse(_ url: URL, allowDirectAuthToken: Bool) -> PairingLink?
  }
  public protocol HTTPTransport: Sendable {
      func data(for request: URLRequest) async throws -> (Data, URLResponse)
  }
  public struct PairingRedeemer: Sendable {
      public init(transport: any HTTPTransport, userAgent: String)
      public func redeem(baseURL: URL, pairingToken: String, deviceLabel: String) async throws(PairingError) -> String
  }
  public enum PairingError: Error, Equatable { case rejected(status: Int, message: String?), transport(URLError.Code), malformedResponse }
  ```
  The iOS caller passes `#if DEBUG` as `allowDirectAuthToken`, which keeps
  today's rule. `PairedBoxStore` holds the in-flight pairing tokens; a second
  call for a token already in flight, or already redeemed by this process,
  returns `.duplicate` without a
  second POST. `pair(from:)` returns `PairingOutcome` (`paired`, `notAPairingLink`,
  `duplicate`, `failed(PairingFailure)`). `PairBoxView` shows the
  failure text for a scanned code. The deep-link paths (`onOpenURL`, delegate)
  log the failure with `BoxLog` and show it as an alert on the box screen.
- **Vocabulary lock-ins**: directory `apple-shared/`, package and module
  `BeeBoxShared`, `PairingLink`, `PairingRedeemer`, `HTTPTransport`,
  `PairingError`, `PairingOutcome`.
- **First implementation chunk**: package scaffold (swift-tools 6.0,
  `.iOS(.v17)`, `.macOS(.v14)`, Swift 6 language mode), `PairingLink` with
  fixture tests for all 6 `pairing-url` cases, `PairingRedeemer` with tests for
  the 3 `redeem` cases through a fake transport. No iOS change in this chunk.

### B. One command runs the Apple tests, and finish runs it

- **What**: `bin/apple-test` runs `swift test` in `apple-shared/`, and, when
  asked or when `ios-app/` changed, `xcodebuild test` on an available iPhone
  simulator that it picks with `simctl` (no hardcoded name, per
  `ios-app/AGENTS.md`). The finish preflight treats `ios-app/`, `mac-app/` and
  `apple-shared/` as one group whose check is `bin/apple-test`.
- **Why this needs to change**: about 530 iOS test methods exist and nothing
  runs them. `ios-app` sits in `NONE_DIRS` (`bin/finish-preflight-lib.ts:51`),
  and `mac-app` is not listed at all (it falls through to `unknown`).
- **Direction**: `bin/apple-test [--package-only|--ios|--all]`. With no
  argument it runs `swift test` in `apple-shared/` and in `mac-app/` (which
  gains test targets in D and E). Finish passes the
  changed paths with `--changed <path>…`; the iOS simulator run is added when
  they include `ios-app/` or `apple-shared/` (shared code is iOS code). It fails loudly
  when Xcode is not selected (`xcode-select -p` outside `/Applications/Xcode.app`).
  The script is TypeScript with a thin loader, per root `AGENTS.md`.
- **Vocabulary lock-ins**: `bin/apple-test`; preflight check kind `apple`.
- **First implementation chunk**: the script with `--package-only` and `--ios`,
  a `bin/` unit test for its simulator choice and argument handling, and the
  preflight group change with its test in `bin/finish-preflight.test.ts`.

### C. The credential store and the ticket guard move into the package

- **What**: `PairedBoxCredentialStore` (Keychain, now with an optional access
  group) and `PairingTicketLedger` (the in-flight/stored ticket rule) move
  into `BeeBoxShared`. Each app keeps its own paired-box record and store.
- **Why this needs to change**: the Mac app needs the same Keychain handling
  and the same single-use-ticket rule.
- **Direction (revised 2026-10-17, during implementation)**: the first draft
  moved `PairedBox` and `PairedBoxStore` too. Reading the code showed that
  `PairedBox` is used across the iOS app and its share extension, and the
  store carries phone-only behavior (legacy plaintext-token migration, the
  extension snapshot, voice-recording cleanup, the device lock, session ids).
  Moving them would have added an import to most iOS files for no Mac
  benefit. The Mac app has its own small `PairedBox` (`id`, `label`,
  `baseURL`, `hostedLocally`) and `BoxStore` in `mac-app/Sources/BeeBoxMacCore/`.
  What both apps share is the wire contract (link, redeem), the Keychain
  store, the ticket rule, and the http host policy (`PairingTransport`).
- **Vocabulary lock-ins**: `PairingTicketLedger`, `PairingTransport`;
  `PairedBoxCredentialStore.ios`; `MacKeychain`.

### D. The box menu, paste pairing, and `beebox:` links

- **What**: the menu lists the paired boxes. "Open <label>" opens the box's web
  app in the default browser. "Pair with a Box…" opens the pairing sheet in a
  new Preferences window.
  The app registers the `beebox` URL scheme. There is no web-view window
  (boxholder, 2026-10-17).
- **Why this needs to change**: today the app knows only its local box
  (`BeeBoxMacApp.swift:78`) and cannot pair with anything, so it has no
  credential for scan and Photos upload to a remote box.
- **Direction**:
  - The sheet reads the pasteboard when it opens. If the pasteboard holds a
    `beebox://pair` link, the sheet fills it in; otherwise it shows a field.
    The sheet always shows the host, label and scheme and asks "Add this
    box?" before it redeems. This closes the confirmation gap from the
    robustness issue on the Mac.
  - A `beebox://pair` link opened from the browser goes to the same sheet,
    through one entry point.
  - The device label is `Host.current().localizedName`.
  - "Open <label>" opens `<baseURL>/` with `NSWorkspace.shared.open`. The
    browser uses its own login; the device token never goes to the browser.
  - Transport policy: `PairingLink.allowsPlainHTTP` checks the host before the
    redeem. https is accepted anywhere; http only for loopback, `.local`
    names, and private or link-local addresses (10/8, 172.16/12, 192.168/16,
    100.64/10 for Tailscale, 169.254/16, fc00::/7, fe80::/10). Any other http
    link is refused with a message. Table-driven tests cover each range and a
    public IP. The Info.plist sets `NSAllowsLocalNetworking`, as iOS does
    (`ios-app/BeeBox/Info.plist:45-48`); ATS alone is not the boundary,
    because that key permits http to any IP address. The sheet says "not
    encrypted" for http.
  - A paired box whose device token the box refuses (401) shows "Pair again"
    in its menu entry.
  - Pairing is a sheet on Preferences → Boxes (a SwiftUI `Settings` scene with
    Boxes, Uploads and General tabs). The sheet previews the parsed link
    before "Add" and keeps a failure inline. The app activates itself
    (`NSApp.activate`) when Preferences opens, so the window takes keyboard
    focus in an `LSUIElement` app. Its view state (field text → parsed link
    → policy → redeem outcome) is a pure model, tested with `swift test`.
  - The box's pairing section copy changes from "iOS Companion" to
    "Companion apps", naming the Mac link path (design doc, "The box's
    settings page"). Copy only.
- **Vocabulary lock-ins**: menu titles "Pair with a Box…", "Open <label>".
- **First implementation chunk**: written after the design doc; it must not
  start with an open question.

### E. Scanner folder upload in Swift

- **What**: a Swift client of the scan contract in `mac-app` (`ScanSweep`;
  iOS has no folders to watch, so it is not shared), in a library target with
  its own test target so that `swift test` reaches it, driven in the Mac app by an FSEvents stream on each upload
  folder, an interval backstop, and a sweep on wake and at launch.
- **Why this needs to change**: the boxholder asked for the watching to move
  into the app. Today it is a launchd agent running Node from a checkout or a
  copied bundle, set up from the terminal.
- **Direction**:
  - Port `run-target.ts` step for step. The doctests in
    `scan-uploader/test/cli/` (`run-target`, `settle.identity`,
    `settle.retry`, `disposition`, `wire-client`) become a checklist of XCTest
    cases against a fake transport and real temp folders.
  - Identity is `(device, inode, size, mtime ns)` from `stat`, as in
    `identity.ts`.
  - The `trash` disposition uses `FileManager.trashItem`, with no `trash` CLI
    and no AppleScript fallback.
  - Headers are `x-scan-contract: <SCAN_CONTRACT_VERSION>` and
    `x-scan-client-build: mac-<app version>`, with no built-at, so the health
    check applies only the contract test (`scan-uploaders.ts:96-101`).
  - Credential: when the boxholder turns on upload for a paired box, the app
    calls `scanTokens.create` with its device token and keeps the plaintext
    in the Keychain. Anyone with access to the box may mint one, since they can
    already upload through the web app (boxholder, 2026-10-19). Only a device
    recorded against nobody gets FORBIDDEN, and the settings say to pair again.
  - Credential lifecycle:
    - Each mint gets a fresh name, `mac-<host>-<yyyymmdd>-<4 random hex>`,
      and the app records it per box so it can revoke it. A fixed name cannot
      work: `createScanToken` refuses any name already in the store, revoked
      ones included (`beebox/src/core/scan/tokens.ts:144-146`), so a second
      mint after a revoke would always fail. (Found 2026-10-17 during
      implementation; the first draft assumed a revoke freed the name.)
    - If the Keychain write fails after a mint, the app revokes the token at
      once, then reports the failure.
    - Turning upload off or removing the paired box revokes the token
      (`scanTokens.revoke` with the device token) first. Only a successful
      revoke deletes the local credentials. If the revoke fails, the box and
      its credentials stay, the failure is shown, and the person can retry or
      choose "Remove anyway", which says that the token stays on the box under
      its `mac-` name until revoked there. No pending-revocation queue.
    - Revoking the Mac's device on the box does not revoke its scan token.
      The token stays listed under Settings → Scan uploaders by its `mac-`
      name. See Open design questions.
  - Status: each upload folder shows its last sweep time, its counts, and its
    current standing error (missing folder, box unreachable, credential
    refused, Photos permission). Notifications stay limited to new events, as
    in `notify.ts:17-26`, so the standing errors need this place. While any
    folder has a standing error, the menu-bar icon shows a mark and the menu
    names the folder. The status is held in memory; after a restart the first
    sweep fills it.
  - Coexistence: if `~/Library/LaunchAgents/` holds the scan-uploader agent
    for the same folder, the app refuses to watch that folder and says how to
    remove the agent (`bin/scan-uploader schedule uninstall`).
  - Login item: a toggle backed by `SMAppService.mainApp`.
  - Notifications follow `notify.ts`'s two rules: silent on a quiet sweep, and
    only newly observed events.
- **Vocabulary lock-ins**: `UploadFolder`, `ScanSweep`; scan token name
  `mac-<host>-<yyyymmdd>-<hex>`; `x-scan-client-build` value prefix `mac-`.
- **First implementation chunk**: `ScanSweep` over a folder with `keep`, and
  the check/PUT client, tested against the fake transport. No app wiring.

### F. Photos album export with PhotoKit

- **What**: replace `osxphotos` with PhotoKit. For an upload folder with a
  Photos album, the app exports new album assets into the folder as JPEG, and
  the folder sweep uploads them as today.
- **Why this needs to change**: the Photos path needs a Homebrew/uv tool, Full
  Disk Access, and Automation permission (`scan-uploader/README.md`, Photos
  section), and the README says the real library path "has not been verified".
  PhotoKit needs one Photos permission prompt.
- **Direction**:
  - Record exported `localIdentifier`s in a JSON file in Application Support,
    which replaces `osxphotos --update`.
  - Download iCloud originals with `isNetworkAccessAllowed`.
  - Convert HEIC to JPEG with ImageIO.
  - Keep the 10-minute bound from `photos-export.ts:7`.
  - The disposition stays `keep` for these folders, as today.
- **Vocabulary lock-ins**: none beyond `UploadFolder.photosAlbum`.
- **First implementation chunk**: a spike against the boxholder's real album
  with the boxholder present. It checks permission prompting from a
  menu-bar app, iCloud download, and HEIC conversion. The track is
  re-planned from what the spike finds.

### G. The local box: optional, and one entry in the menu

- **What**: hosting becomes a setting. When it is on, the local box is one
  entry in the box menu and opens in the browser as today.
- **Why this needs to change**: the boxholder wants local hosting to be
  optional and "a small amount of code on top" (anchor issue). Today it is the
  app's only function: `applicationDidFinishLaunching` calls `runtime.start()`
  unconditionally (`BeeBoxMacApp.swift:35`), which pulls the vminit and beebox
  images on first launch (`mac-app/README.md`, "What the app uses").
- **Direction**:
  - "Run a box on this Mac" is a setting, off by default. With it off the app
    never constructs the container manager, never pulls an image, and creates
    nothing under `runtime/`. Turning it on starts `BoxRuntime` as today;
    turning it off stops the box and leaves the downloaded image in place. A
    "Remove downloaded box image" item frees the space.
  - Transition: an install that already has a box (`~/BeeBox/<name>/.beebox/box.json`
    exists) starts with the setting on, so an existing local box keeps
    running after the update.
  - The local entry is a `PairedBox` with `hostedLocally = true` and no device
    token; its `baseURL` is the runtime's `running(URL)` value. "Open First-Run
    Setup" stays as today.
  - Scanner upload to the local box needs a device token, so the boxholder
    pairs the local box the same way as a remote one: "Copy Link" on its
    settings page, then "Pair with a Box…".
- **Vocabulary lock-ins**: `PairedBox.hostedLocally`; setting title "Run a box
  on this Mac".
- **First implementation chunk**: the setting and the launch gate, with a test
  that the runtime is not constructed when the setting is off.

## Could this be simpler?

- **Simplest version:** Track D alone, with the pairing and storage code copied
  into `mac-app/`, and keep `scan-uploader`'s launchd agent for scans. About
  250 lines.
  - It fails the boxholder's "build a shared layer… rather than two separate
    codebases".
  - The copied pairing code would be a second untested copy.
- **Simpler credential for scans:** paste a scan token as a second step. That is
  one more manual step per box, against "operational simplicity beats
  per-call cost". Minting over the device token costs no server change
  (verified in What already exists).
- **Simpler Photos:** keep shelling out to `osxphotos` from the app. That keeps
  the uv/pipx install and Full Disk Access, which the move into the app is
  meant to remove. Track F's spike decides whether PhotoKit holds up. If it
  does not, the fallback is to shell out.
- **Not done:** a web-view window, a native bridge on the Mac, a native
  composer, and multiple local boxes. Each is deferred below.

## Subplans

`mac-app-shell.design.md` (bbx-design), before Track D. No other subplans.

## Failure modes

> **Critical gap (today, fixed by A):** a single deep link can redeem twice. The
> second redeem fails silently, and depending on order the box may not be
> added. The single-flight guard and `PairingOutcome` close it.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A pasted link has no `baseURL` or no scheme | A: fixture tests | `parse` returns nil; the sheet says it is not a pairing link | Clear |
| The ticket expired or was used (401) | A: `redeem/error-401` | `PairingError.rejected` with the server message | Clear |
| The box restarted and dropped the in-memory ticket | No | Same 401 path | Clear message, wrong cause; see NOT in scope |
| The redeem response has no `token` | A: new case | `.malformedResponse` | Clear |
| The same link arrives twice at once | A: concurrency test | single-flight by pairing token | Clear (second call is a no-op) |
| The moved store reads the old file or Keychain item wrongly | C: existing 11 tests move | the iOS profile keeps today's paths | Silent if wrong; the tests are the guard |
| The pbxproj package reference is wrong | B: `bin/apple-test --ios` | build fails | Clear |
| A pairing recorded against nobody tries to mint a scan token | E | FORBIDDEN mapped to a settings message | Clear |
| A file changes between check and disposition | E: ported `settle.identity` case | restat before disposition | Clear (left in place) |
| The launchd agent and the app both watch one folder | E | the app refuses that folder | Clear |
| The app is not running when a scan lands | E | sweep at launch; login item | Clear on next launch |
| The FSEvents stream misses an event | E | interval backstop | Silent until the backstop runs (bounded delay) |
| A standing error (folder unmounted, box down) | E | folder status, plus a mark on the menu-bar icon | Clear in the app; not notified |
| The Photos permission is denied | F | export stops; the folder shows the reason | Clear |
| An iCloud original fails to download | F | asset stays unexported and is retried next sweep | Clear in the sweep summary |
| The remote box is unreachable when the app calls it (mint, upload) | D, E | the menu entry and the folder status name the host | Clear |
| Keychain write fails after a scan token mint | E | revoke at once, then report | Clear |
| The paired box is removed with upload on | E | revoke the scan token first | Clear; a failed revoke is shown |
| The Mac's device is revoked on the box, its scan token is not | No | listed by name in Scan uploaders | Visible on the box only; open question |
| The device token is revoked on the box | D, E | 401 → the box shows "Pair again" | Clear |

## Agent-flow / user-flow edge cases

- **Wrong field**: a QR scan and a paste parse through one function. ADDRESSED (A).
- **Stale ref**: a ticket that expired, or one the box dropped on restart.
  ADDRESSED as a clear error (A). The cause is wrong for the restart case;
  DEFERRED (NOT in scope).
- **Two writers**: the launchd agent and the app on one folder. ADDRESSED (E).
- **Hand-edit drift**: the boxholder edits a link by hand. A malformed link is
  rejected with a message (A). A wrong `baseURL` that parses fails at redeem
  with the transport error (A).
- **Fabricated value**: not applicable. No agent writes any of these values;
  they come from the box or the person.
- **Validation error UX**: errors appear to a person in the sheet, not to an
  agent. Covered by the design doc for D.
- **Transition state**: existing iOS installs keep their store file and
  Keychain item, because the iOS profile carries today's values (C). An
  existing scan-uploader install keeps working until the boxholder turns on
  the app's watcher for that folder (E).

## NOT in scope

- **The iOS input shell** (composer, voice, capture): boxholder instruction.
- **Paste pairing on iOS**: boxholder decision, 2026-10-17.
- **A native bridge or composer on the Mac**: input is deferred in the anchor
  issue's scope for this round.
- **Persistent pairing tickets** (the idle-stop race): a server change with its
  own migration question. The Mac paste flow is usually done within a minute
  of copying, which makes the race less likely. A note goes on the robustness
  issue.
- **An external-link confirmation step on iOS**: the Mac gets one (D). iOS
  gets it when its pairing screen is next changed for its own reasons.
- **Removing `scan-uploader`**: it still serves machines without the app and
  non-Mac hosts. Its README gains a pointer to the app.
- **Multiple local boxes**: `mac-app/README.md`: "The app runs one box at a time".
- **Engine image updates**: its own issue (2026-10-10).
- **Clerk**: deferred by the boxholder.
- **The health check's remedy text names `dist/scan-uploader.mjs`**
  (`scan-uploaders.ts:80-82`). It would read wrong for a Mac app client only
  when the contract version is behind. Filed as an issue during E, not fixed
  here.

## Open design questions

- **Revoking the Mac's device does not revoke its scan token (E).** Linking them
  needs a server-side association (the scan token records the device id, and
  `revokeDevice` revokes both): a schema change. Lean: not now. The token is
  visible and revocable by name in Settings → Scan uploaders. Decided
  2026-10-17: accepted ("Scan token lifespan is fine").
- **The Mac app requires macOS 26 even for pairing only.** `mac-app/Package.swift`
  sets `.macOS("26.0")` and `build-app.sh` writes `LSMinimumSystemVersion`
  26.0, because the VM framework needs it. A pairing-only user on an older Mac
  cannot run the shell. Supporting one means putting the VM code behind an
  availability boundary. Decided 2026-10-17: accept the 26 floor. The package's own floor
  (14) changes nothing for users.

## Knowledge audits

None. The work adds no box-agent-facing concept: no card type, tag, or agent
guidance. Dev-facing guidance changes (`ios-app/AGENTS.md`, a new
`apple-shared/AGENTS.md` or README section, `mac-app/README.md`) are short and
are covered by the cross-model review instead.

## What will hold this after it ships

- **`swift test`** is the main tier. In `apple-shared/`: pairing link and
  redeem against the shared fixtures, and the store. In `mac-app/`: the pairing
  sheet state, the hosting gate, and the scan sweep against a fake
  transport and temp folders. It needs no simulator, so it is cheap to run on
  every change. This is the new test tier for Apple code. It replaces nothing
  and sits below the existing simulator tier.
- **iOS XCTest on the simulator** (existing) holds UI-adjacent and bridge
  behavior. It now runs through `bin/apple-test`.
- **Shared fixtures** keep Swift and TypeScript on one wire shape. Track A makes
  Swift read the two families it ignores today.
- **Fakes.** The fake transport is written against the contract docs and the
  fixtures, not the Swift code, so that it does not encode the bug it tests.
  The scan cases are ported from `scan-uploader`'s doctests, which run against
  `fake-scan-server.ts`. The two fakes describe one contract, and a divergence
  between them is a contract-doc question.
- **Testing review recommendation (beyond this plan)**: the bridge handler
  `ChatWebView.userContentController(_:didReceive:)` (`ChatWebView.swift:591`)
  has no direct test, and nor do the routing by message name and the
  origin/main-frame checks. The next change to that file should pull the
  routing into a pure function and test it. File as an issue at Track B.
- **Device-only behavior** (Photos permission, login item, notifications under
  Developer ID signing) is checked by hand once, with the boxholder, and
  recorded as such. A simulator or `swift test` pass is not reported as a
  device check.

## Implementation order

1. A1: package scaffold, `PairingLink`, `PairingRedeemer`, fixture tests (no iOS change).
2. B1: `bin/apple-test --package-only`, preflight group, tests.
3. A2: iOS adopts the package (pbxproj), single-flight, `PairingOutcome`, error display. B1 gains `--ios`; run it.
4. bbx-design: `mac-app-shell.design.md` for D–G; boxholder review.
5. D with C: box menu, Preferences and the pairing sheet, `beebox:` scheme. Each piece of C moves when D
   first needs it (model and bearer first, then the store), with its
   contract-doc anchors.
7. E: `ScanSweep`, then the Mac wiring, the scan token mint, coexistence, login item, notifications; contract doc lists the Swift client.
8. F: spike with the boxholder, then PhotoKit export.
9. G: hosting setting and launch gate, local entry.
10. Docs: `mac-app/README.md`, `ios-app/AGENTS.md`, `scan-uploader/README.md`, `scan-upload-contract.md`; ACKNOWLEDGEMENTS not needed (nothing adopted from outside).

## Rollout shape

- **Tests first.** Each track names its done-when as tests:
  - **A:** `swift test` passes all `pairing-url` and `redeem` fixtures, plus a
    concurrency test; the iOS `PairedBoxStoreTests` pass on the simulator.
  - **B:** `bin/finish-preflight.test.ts` covers the new group, and
    `bin/apple-test` passes on this Mac.
  - **C:** the moved tests pass under `swift test`, and the iOS app builds
    and its suite passes.
  - **D:** `swift test` covers the pairing sheet's state (pasteboard link,
    malformed text, http host policy, confirm, each `PairingError`). One
    recorded walkthrough exhibit against this worktree's test box: paste,
    confirm, the box appears in the menu and opens in the browser, a revoked
    device shows "Pair again".
  - **E:** each ported scan-uploader case passes, plus missing folder, box
    offline, and credential refused, each shown in the folder status.
  - **G:** a test that the runtime is not constructed with hosting off; a
    walkthrough exhibit: a fresh state directory with hosting off downloads
    nothing, turning hosting on starts the box, and one run with `BEEBOX_PORT`
    set shows the entry follows it.
  - **F:** the spike's checks are recorded.
- **No data migration on the box.** On the device, the iOS store file and
  Keychain item keep their names (C).
- **No server change** in any track. If Track E finds that the scan token
  mint fails over a device token, that is a finding that changes the plan,
  and it goes to the boxholder.
- The plan ships in one piece, when the boxholder says so.
