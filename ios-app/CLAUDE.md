# iOS development

This directory is the native iOS companion app. Read this file before changing
Swift code or `CallbackBox.xcodeproj`; read `README.md` for the current product
surface and simulator-pairing shortcut.

## Architecture boundary

- The app is a native SwiftUI shell around the existing web chat. `RootView`
  embeds `ChatWebView` and adds native pairing, composition, speech, and capture.
- The webview is still the chat client: it owns transcript/session state, target
  busy/queue state, dispatch, and server-rendered pending messages. Do not build
  parallel native models for those concerns.
- Native input crosses the bridge as the shared mobile contract documented in
  `../callback-box/docs/mobile-contract.md`. When the wire shape changes, update
  Swift encoding/decoding, the TypeScript bridge parser, that reference doc, and
  the shared fixtures under
  `../callback-box/test/mobile-contract/fixtures/` in the same change.
- The iOS input-plane parity work is designed in
  `../callback-box/docs/plans/ios-input-plane-parity.md`. Native capture has a
  separate lifecycle in `../callback-box/docs/plans/ios-native-capture-mode.md`;
  do not route ordinary composer attachments through capture staging.
- There are no third-party iOS dependencies. The deployment target is iOS 17;
  newer APIs require availability checks and an older-system fallback.

## Toolchain check

Full Xcode is required, not only Command Line Tools. Confirm the selected copy
and inspect the project before diagnosing source code:

```sh
xcode-select -p
xcodebuild -version
xcodebuild -list -project ios-app/CallbackBox.xcodeproj
xcrun simctl list devices available
```

If `xcode-select -p` does not point inside `/Applications/Xcode.app`, select the
installed Xcode with `sudo xcode-select --switch /Applications/Xcode.app` and
accept the license/startup components in Xcode. Simulator names and OS versions
drift; discover them with `simctl` instead of copying an old destination.

Open the project for interactive work:

```sh
open ios-app/CallbackBox.xcodeproj
```

## Build and test

From the monorepo root, a signing-free simulator compile is:

```sh
xcodebuild \
  -quiet \
  -project ios-app/CallbackBox.xcodeproj \
  -scheme CallbackBox \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Run XCTest against an installed simulator selected from `simctl`:

```sh
xcodebuild \
  -quiet \
  -project ios-app/CallbackBox.xcodeproj \
  -scheme CallbackBox \
  -configuration Debug \
  -destination 'platform=iOS Simulator,id=<SIMULATOR-UDID>' \
  test
```

The `CallbackBoxTests` target includes speech/mobile-contract and native capture
tests. Some mobile-contract tests read the monorepo fixture directory through
the test source's `#filePath`; run them from this checkout and keep the relative
`ios-app/` + `callback-box/` layout intact.

Bridge and server changes also need the corresponding callback-box checks. At a
minimum, run the directly affected doctest(s), then the normal checks required
by the callback-box pre-commit hook. The broad test command is:

```sh
pnpm --dir callback-box test
```

## Xcode project file

`CallbackBox.xcodeproj/project.pbxproj` is manually enumerated. It does not use
folder-synchronized groups and there is no project generator. Adding a `.swift`
file on disk is insufficient: it must also have all of these entries in the
project file:

1. `PBXFileReference`
2. `PBXBuildFile`
3. Membership in the correct `PBXGroup`
4. Membership in the app or test target's `PBXSourcesBuildPhase`

Prefer adding files through Xcode when practical. If editing `project.pbxproj`
directly, use unique 24-character IDs consistent with the file, keep app/test
target membership separate, and immediately run `xcodebuild -list` followed by
a simulator build or test. Do not rewrite or reformat the whole project file.

Assets are similarly explicit through `Assets.xcassets`. User-specific Xcode
state, workspaces' `xcuserdata`, `DerivedData`, and `ios-app/build/` are ignored;
do not commit them. The shared scheme under
`CallbackBox.xcodeproj/xcshareddata/xcschemes/` is tracked.

## Running against a local box

The shared monorepo router serves main at:

```text
http://127.0.0.1:3210/main/test1
```

For a worktree, replace `main` with the worktree name. The router is shared
across sessions; do not restart or stop it from an agent worktree. Ask the
boxholder when it is not running.

After the app has been built and installed on a simulator, bypass camera/QR
pairing with:

```sh
ios-app/scripts/pair-simulator-box
```

Arguments are `device base-url label session-id`; `device` defaults to
`booted`. The script writes the DEBUG paired-box store inside the simulator app
container, so installation must happen first. Re-run it after deleting the app,
because uninstalling removes that container.

The simulator can reach the Mac through `127.0.0.1`. A physical iPhone cannot
use that simulator URL: pair it to a reachable hosted or LAN box using the QR
flow. Real-device signing uses Xcode's automatic signing; choose the connected
device and development team in Xcode rather than committing machine-local
signing changes.

## Bridge discipline

- `CallbackBox/Views/ChatWebView.swift` is the native transport and navigation
  boundary. Keep allowed-origin checks, delivery deduplication, receipt
  timeouts, and navigation reload behavior explicit.
- `callback-box/src/frontend/src/components/chat/native-emission.ts` and the
  hooks beside it are the web side. Native must submit an `Emission` to the
  visible web session; it must not call chat-send APIs behind the webview.
- Web-to-native traffic uses named `WKScriptMessageHandler` channels. Validate
  every message body before mutating state. Native-to-web queues are
  authoritative; DOM events are wake signals.
- Add or update shared JSON golden fixtures for every wire-shape or compatibility
  change. TypeScript and XCTest must consume the same fixture, including
  malformed and legacy cases.
- Preserve stable message IDs across retries. Receipts can arrive late, twice,
  or out of order; match by emission ID and never overwrite a newer draft.

## Native testing boundary

Simulator coverage is appropriate for reducers, persistence, bridge delivery,
layout fixtures, and most picker-independent UI. A change is not fully verified
when it depends on camera hardware, iCloud Photos, microphone/speech models,
audio interruptions, background execution, QR pairing, signing, or physical
keyboard/safe-area behavior until it passes on a real phone.

For deterministic composer layout checks, launch a DEBUG build with
`--composer-fixture=<state>`. Supported states are `empty`, `typing`,
`multiline`, `many-attachments`, `uploading`, `failed-upload`,
`selection-detail`, `recording`, `hq-preparation`, `two-pending`,
`rejected-send`, `expired-attachment`, and `keyboard-shown`. The fixture uses
the production composer with isolated stores and no web/server dependency.
After installing the build, `ios-app/scripts/capture-composer-fixtures` captures
the complete state set for a simulator and restores its status-bar override.
Use `simctl ui <device> appearance` and `content_size` to repeat representative
states in dark mode and accessibility sizes. The `keyboard-shown` reference
requires the simulator's hardware-keyboard connection to be disabled.

For user-facing composer or capture work, record which of these were actually
tested. Do not describe a simulator-only pass as device verification.
