---
title: "Siri cannot invoke the iOS thought capture shortcut by voice"
workstream: siri-app-intents
area: beebox
priority: important
needs: [manual-testing]
filed-by: agent
discovered-in: worktree-siri-app-intents — implementing Siri text capture
---

> **Reopened 2026-10-12:** The App Shortcut appears in Shortcuts and works when tapped, but Siri did not invoke it on a physical iPhone. Siri showed the correct transcript for “Save a thought in Bee Box” and then said “I didn't get that, try again?” The previous manual-testing gate was removed because the feature is not ready for another Siri test.

When the developer is hands-free and a thought arrives, they want to speak or pass text to Bee Box and have it reach the capture default without opening the app.

## Re-encounter (2026-10-12)

- The App Shortcut is visible in Shortcuts and works when run by tapping it.
- Saying “Add a thought to Bee Box that [thought]” produced “To who?”
- Saying the exact phrase written in the provider, “Save a thought in Bee Box,” showed the correct transcript, then produced “I didn't get that, try again?”
- Neither response is returned by `CaptureThoughtIntent.perform()` in `ios-app/BeeBox/Intents/CaptureThoughtIntent.swift`. The failure likely occurs before the intent runs. The transcript alone does not prove that Siri matched the App Shortcut.
- `BeeBoxApp.init()` in `ios-app/BeeBox/BeeBoxApp.swift` registers intent dependencies, but does not call `BeeBoxAppShortcuts.updateAppShortcutParameters()`. [Apple's App Intents sample](https://developer.apple.com/documentation/appintents/acceleratingappinteractionswithappintents) calls this method during app initialization to register App Shortcuts with the system. Add that registration, install the new build, and repeat the exact-phrase Siri test.

## Research (incomplete)

The current `AppShortcut` phrases in `ios-app/BeeBox/Intents/CaptureThoughtIntent.swift` do not bind the required `thought` string. The person must invoke the shortcut, then provide the thought when Siri prompts. Apple's [App Shortcuts session](https://developer.apple.com/videos/play/wwdc2022/10170/) says a phrase cannot collect an arbitrary string in its initial utterance; phrase parameters must be predefined.

One-utterance text input may be possible through an App Intent that adopts a suitable Apple App Schema. Apple's current schemas include [`notes.createNote`](https://developer.apple.com/documentation/appintents/app-schema-domain-notes) and [`messages.sendMessage`](https://developer.apple.com/documentation/appintents/app-schema-domain-messages), whose Siri examples include natural-language text. Research whether a schema accurately describes adding a thought to Bee Box, and which iOS versions and devices support that Siri path. Do not adopt a schema that misrepresents Bee Box's behavior.

The user also reported that saying the whole thought after “Add a thought to Bee Box” made Siri ask “To who?” Do not treat that as a supported invocation. First fix App Shortcut registration and verify the two-step flow. Then investigate schema-backed one-utterance capture separately.

The usage guide `beebox/docs/box/siri-shortcuts.md` says to unlock a protected box before using Siri. This is inaccurate: `CaptureThoughtIntent.perform()` refuses a box marked `requiresDeviceUnlock` even when the phone is unlocked. Correct the guide with the implementation follow-up.

## Implementation follow-up (2026-10-12)

The reviewed [quick-capture plan](../../beebox/docs/plans/ios-app-intent-capture.md)
supersedes the earlier text-only implementation. Registration now runs at app
launch and pairing changes; the displayed/spoken app name is Bee Box. This
repairs registration, but does not prove why Siri failed before `perform()`.

- Siri triggers a required thought prompt, persists locally, then says
  “Saved on your phone for <box>.” It no longer waits for chat routing.
- Capture default is independent of the browsed box. A pinned Shortcut/share
  override is explicit; a removed target never falls back. Protected boxes
  remain refused by Siri/App Intents even while the phone is unlocked.
- Voice notes retain actual AAC audio and a separate derived transcript. Shares
  keep one image/URL/clipping plus optional human instructions. Later context
  identifies the original capture and box, including while offline.
- One multipart upload seals complete source bytes before processing. Save-only
  material starts no chat task. Retries preserve IDs; offline discard remains
  pending until an owner tombstone prevents late-upload revival.
- Removed the old `BoxScreenStore.captureExternalThought`, result enum, tests,
  and dependency registration. Normal box-screen quick chat and old persisted
  outbox recovery remain applicable.

## Manual testing

Use the matched iOS build **and a box server containing this implementation**.
An older server must show Unsupported while keeping local content. This branch
is not landed or deployed. Record phone OS/build and use synthetic paired boxes
A/B. Open Capture to verify saved source bytes and words, not just dialogs.
Local checks passed: 70 XCTest cases, 152 backend assertions, six Codex guidance
audits, TypeScript/lint/contract checks and simulator build. Cross-model findings
are fixed/adjudicated; these checks do not prove the original Siri failure is gone.
The [usage guide](../../beebox/docs/box/siri-shortcuts.md) gives installed action
names and fallback setup.

1. **Siri:** with app closed, say “Save a thought in Bee Box,” answer its prompt
   with “Phone test alpha,” and touch nothing. Expect saved-on-phone naming A
   and one exact thought. Repeat “Add a thought to Bee Box,” and locked where
   Siri is enabled. Separately run a named Shortcut containing Dictate Text →
   Add a Thought to Bee Box; record whether Siri matched the app or asked an
   unrelated recipient question.
2. **Voice:** say “Start a voice note in Bee Box,” speak a marker, then “Stop and
   save my voice note in Bee Box.” Expect playable audio and separate transcript.
   Repeat cold start, screen locking during recording, interruption, and
   Action Button/control/Live Activity where available. An interrupted draft
   must say it may end early and offer Save or Discard; no silent replacement.
3. **Refusals:** deny microphone, then disable Live Activities in a separate
   run; no false Recording/Saved result. Restore permissions. Siri to a protected
   box refuses even unlocked. Explicit share/main recording uses authentication;
   its Stop link opens the same unlock flow.
4. **Share:** screenshot plus keyboard-dictated “Find the problem shown here”
   becomes one item with correct image and words. URL/clipping without words
   saves without a task. Unsupported multiple items show the limit before
   acceptance and keep the entered words.
5. **Destination:** default A while browsing B still captures to A. Pinned
   Shortcut/share override B goes to B. Remove a default/pinned target: no
   fallback. A recording keeps its original box and pauses if that box is removed.
   Captures from removed boxes keeps phone copies accessible; protected copies
   require unlock, and export never silently sends to another box. Also protect an
   already-captured box before removing it: recovery rows must hide its words.
   With a private interrupted draft retained, invoke Siri text while locked,
   then reopen: the original recording must not be overwritten or treated as absent.
6. **Recovery/context:** capture text/audio/screenshot offline; force quit after
   acceptance, restore network, reopen, and find one server item each. Add context
   offline to a phone-only original; reconnect while staying in app and confirm
   both arrive in order. Follow up an older/filed item with newer items present,
   including needs-choice: original identity/chat remains fixed. Request offline
   deletion: Discard requested until confirmation, then no revived upload.

Simulator build, XCTest, browser source checks and synthetic transcription do
not prove Siri matching, microphone handoff, locked launch, or extension transfer
continuation. Keep this issue open until the physical-device batch passes or the
boxholder accepts documented platform limitations.

## Deferred

One-utterance schema/SiriKit capture and spoken agent replies remain separate.
Attribution names acquisition APIs, without guessing Siri versus Action Button.
