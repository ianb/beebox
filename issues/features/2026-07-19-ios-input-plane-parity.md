---
title: "Implement complete iOS input-plane parity"
design: ../../callback-box/docs/plans/ios-input-plane-parity.md
area: callback-box
---

The native iOS composer is visually usable but does not yet have the web input
plane's complete semantics. The implementation-ready design is
[`ios-input-plane-parity.md`](../../callback-box/docs/plans/ios-input-plane-parity.md).
This issue is the cold-start handoff for the next implementation session.

## Current mismatch

- Native bridge payloads carry text, images, origin, and diarization, but web
  `Emission` also carries uploaded files and companion-pane selections.
- iOS persists only text; image data, attachment work, voice preparation, and
  unacknowledged emissions can be lost on termination or box switching.
- `NativeComposerView` permits only one pending emission and disables the whole
  input plane until its receipt arrives.
- A rejection restores directly into the visible native fields, which can
  overwrite a newer draft once continued composition is allowed.
- Companion selections currently mutate the hidden web draft rather than the
  native draft that the user sees and sends.
- Regular iOS composition has no arbitrary-file, image-paste, or screenshot
  acquisition path and no caret-aware `[imageN]`, `[fileN]`, or `[selectionN]`
  token handling.

The web `TargetStrip` already remains visible when `nativeComposer=1`; do not
duplicate target busy/queue/interrupt controls in Swift. Native owns the draft,
while the embedded web chat remains authoritative for session/transcript state,
target state, final message assembly, and dispatch.

## How to resume

1. Create an implementation worktree and read, in order:
   `ios-app/CLAUDE.md`, `callback-box/docs/mobile-contract.md`, and the linked
   plan. The plan is complete; implementation starts with Track 1 rather than
   writing another design.
2. Implement all six tracks in dependency order. Commit-sized chunks are
   identified in each track, but they are not shipping milestones:
   full V2 emission/selection-command contract; durable native draft; native
   editor and attachments; companion selections; pending-send/voice state;
   integrated UI and acceptance.
3. Keep the bridge one-way in responsibility: Swift produces the complete
   semantic `Emission`; the visible web session performs the existing target
   dispatch. Do not add a native chat-send API or a second transcript model.
4. Update `docs/mobile-contract.md`, TypeScript bridge code, Swift wire values,
   and shared fixtures atomically for contract changes. Legacy iOS/Android
   payloads remain accepted as specified by the plan.
5. Reuse `/api/chat/upload-file` for ordinary files. If its buffering/limit
   behavior proves unsuitable, stop and write the transport subplan required by
   the parent plan; do not grow a second upload endpoint opportunistically.
6. Keep ordinary composer draft storage separate from native capture staging.
   The lifetimes and acknowledgement rules differ even though both use
   file-backed durability.

## Required verification

- TypeScript doctests for complete/legacy/malformed emissions and native
  selection commands, using the shared mobile-contract fixtures.
- XCTest for the draft reducer/repository, token and Unicode-caret behavior,
  attachment races, pending receipt ordering/retry/restore, and voice snapshot
  races.
- `xcodebuild` simulator test pass for the `CallbackBox` scheme. Discover the
  destination with `xcrun simctl list devices available`; do not hardcode an old
  simulator name.
- DEBUG composer fixtures and visual checks at compact/current iPhone and iPad
  sizes, keyboard shown/hidden, light/dark mode, large type, and attachment/error
  states.
- Real-phone acceptance for camera, iCloud Photos, Files, paste permission,
  screenshot, location, dictation keywords, audio interruption, background and
  force-quit restoration, offline retry, navigation during send, and two quick
  sends while the target is busy.

## Close only when

- Every plan track is implemented and its failure-table rows have tests plus
  visible handling.
- The full native emission reaches the ordinary web target with files and
  selections intact, and legacy payload fixtures still pass.
- No valid draft or rejected/pending emission is silently lost across app
  backgrounding, termination, navigation, receipt timeout, or box switching.
- Simulator and real-device acceptance results are recorded in the plan.
- Durable current behavior is folded into reference documentation, the plan is
  moved to `docs/implemented-plans/`, and this issue is moved to
  `issues/closed/features/` with the resolving commit.

Native TTS playback, native transcript rendering, cross-device draft sync,
pixel-for-pixel React parity, Android UI implementation, and a new upload
protocol remain explicitly out of scope.
