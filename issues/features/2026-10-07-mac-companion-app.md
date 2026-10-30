---
title: "A Mac companion app, the desktop equivalent of the iOS app: input, selections, scanner upload, and optionally a locally hosted box"
workstream: app-shell
area: mac-app
labels: [desktop, input]
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: main — follow-on from the installable-app research
---

**2026-10-17 note (partly resolved):** the Mac app now pairs through a `beebox://pair` link, has a Preferences window, opens boxes in the browser, uploads a folder (Swift port of `scan-uploader`) and a Photos album, and can host a local box (off by default); see [the plan](../../beebox/docs/plans/mac-app-shell.md). Still open: input (global shortcut, voice, selections) and the quick-drop entry. Not yet exercised by hand: minting a scan token from a device paired by a real owner, the Uploads tab end to end, a PhotoKit export on a real library, Open at Login, notifications, and local hosting start/stop.

The iOS app (`ios-app/`) gives the phone a native front door to a box: fast
input (native composer, voice with Apple's speech recognition, capture),
pairing, and selections. The Mac has nothing equivalent. On the desktop a
boxholder uses the web app in a browser, the Clerk Chrome extension for
page captures, and the stand-alone `scan-uploader` script for ScanSnap
output. The boxholder wants one Mac app that plays the iOS app's role.

## Scope (boxholder, 2026-10-07)

- **Input:** a quick way to get a thought, voice note, file, or screenshot
  into the box from anywhere on the Mac (global shortcut or menu-bar entry),
  without switching to a browser tab. Voice can use Apple's on-device
  SpeechAnalyzer, as the iOS app does
  ([on-device HQ transcription](2026-10-06-ios-on-device-hq-transcription.md)).
- **Selections:** send what is selected in another app (text, a file in
  Finder, an image) to the box with its source, the desktop counterpart of
  the selections the iOS composer already carries (`beebox/docs/mobile-contract.md`,
  `Emission.selections`).
- **Scanner upload:** fold in what `scan-uploader` does today (watch the
  ScanSnap output folder and upload to the box's scan route,
  `beebox/docs/scan-upload-contract.md`), so it is part of the app instead of
  a separately copied script.
- **Locally hosted box, optional:** the app can also run a box on the Mac,
  using the VM approach the `mac-app/` spike proved (Apple Containerization,
  macOS 26, Apple silicon; findings in `research/installable-app/`). The
  boxholder expects this to add little once the app exists; otherwise the
  app pairs with a remote box like the iOS app does.

## Questions for design

- Native (Swift/SwiftUI, sharing code with `ios-app/` where it can) versus a
  wrapper around the web app. The iOS app's split (native input surfaces,
  web content) is the obvious model; check what transfers to macOS.
- How it relates to the existing `mac-app/` spike (one app that hosts and
  pairs, or a companion app plus a separate host).
- Pairing and auth: reuse the iOS pairing flow and mobile bearer, or a desktop
  variant.
- What the Clerk extension keeps (in-browser page capture) and what moves to
  the app.
- Quick-drop overlap: the `quick-chat-design` work on entry points
  ([quick drop entry points](2026-09-25-quick-drop-entry-points.md)) should
  treat the Mac app as one of the doors.

## Decisions (boxholder, 2026-10-07)

- **Wrap the web app, like the iOS app does.** The iOS app is a native shell
  around the web app with native input surfaces; the Mac app follows the same
  model. Build a shared layer the two apps reuse (bridge contract, pairing,
  input and speech, upload) rather than two separate codebases.
- **Keep the host.** The Mac app also hosts a box locally (the `mac-app/`
  approach); the boxholder expects it to be a small amount of code on top.
- **Pairing is needed, and looks different from iOS:** link-based rather than
  a QR code, since a link is easier to move around on a desktop.
- **Clerk is deferred.** Leave the Chrome extension as it is for now.
- **Quick drop:** yes, the Mac app is one of its entry points.

> 2026-10-08 (imbue-studio-research): Imbue Studio ships the same shape on
> macOS, an Electron app over a Lima VM running the workspace image. Its
> answer to the phase 1 open item "image delivery" is a prebuilt image fetched
> as content-defined chunks (`desync`) and verified against a minisign
> signature before Lima boots it, instead of building the toolchain in the VM
> (`imbue-ai/mngr`, `apps/minds/CHANGELOG.md`). See
> [research/imbue-studio/comparison.md](../../research/imbue-studio/comparison.md),
> section 3.

Re-reviewed 2026-10-30: input (shortcut, voice, selections) and quick drop are still open. Since the 2026-10-17 note the app was renamed Bee Box Desktop and gained the engine image channel and encrypted backups.
