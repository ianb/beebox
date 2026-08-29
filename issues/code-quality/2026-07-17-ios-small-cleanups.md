---
title: "iOS small cleanups: legacy STT off-device partials, temp WAV leak, dev pairing defaults, duplicate extension, no strict concurrency"
workstream: chores-burn-down
area: callback-box
filed-by: agent
discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
---

A bundle of small, independent iOS cleanups surfaced in the 2026-07-17 companion-app review:

- **Legacy `SFSpeechRecognizer` dictation path sends partials off-device.** The fallback path used on
  iOS versions before SpeechAnalyzer (or when it's unavailable), in `SpeechDictation.swift`, omits
  `requiresOnDeviceRecognition = true`. Live partial transcripts stream to Apple's servers on iOS 17–25,
  which contradicts the app README's "on-device" framing for dictation. Set the flag, or update the
  README to disclose the legacy-path exception.
- **Temp dictation WAV files leak on every non-keyword dictation.** The temp WAV written by
  `SpeechDictation` is only deleted on the keyword-triggered HQ-success path in
  `NativeComposerView.swift`. Manual send (tapping the arrow button rather than a voice keyword),
  cancel, erase, mic-off, and stop all nil out `recordedAudioURL` (via `resetDictationState`/
  `consumeRecordedAudioURL`) without ever calling `removeItem` — orphaning a WAV in
  `temporaryDirectory` on every one of those paths. iOS eventually reclaims temp storage, but it's an
  unbounded per-dictation leak until then.
- **`PairBoxView` ships dev-only defaults in release builds.** `PairBoxView.swift` seeds the manual-add
  form with `label = "Local test box"` and `urlString = "http://localhost:3210/main/test1"` unconditionally
  — a release user opening "manual add" sees a prefilled localhost URL. Should be gated behind `#if DEBUG`
  like the raw-`authToken` import already is.
- **Duplicate `String.nilIfEmpty` extension** defined identically in both `PairedBoxStore.swift` and
  `ChatWebView.swift`. Consolidate to one shared extension.
- **`SWIFT_VERSION = 5.0` across all build configs** (`project.pbxproj`) means Swift's strict-concurrency
  checking is off, despite the new bridge code (`AppleSpeechAnalyzerSession` and friends) using
  `@Sendable` closures, `NSLock`, and `@MainActor` hops that strict concurrency mode would actually check.
- **Stale comment in the web frontend.** `callback-box/src/frontend/src/input/emission.ts` still says
  voice sends carry no images, but `createVoiceEmission` now accepts `images` and native `.voice`
  emissions do carry photos — the comment is simply wrong now and should be updated or removed.
- **A routine simulator build emits two avoidable Xcode warnings.** The app-icon catalog still includes
  a 76x76@1x iPad slot that only applies before iOS 10 even though the deployment target is iOS 17,
  and App Intents metadata extraction runs despite the target not linking AppIntents.framework. Remove
  the obsolete icon slot and disable the inapplicable metadata-generation build step/setting so a clean
  `xcodebuild -quiet ... build` is actually quiet.

## Implemented in this workstream

This commit keeps the manual-pairing label and localhost URL defaults in debug
builds only. It also consolidates `String.nilIfEmpty` into one module-wide
extension. The legacy speech privacy, temporary WAV cleanup, strict concurrency,
stale web comment, and simulator-warning items remain open.
