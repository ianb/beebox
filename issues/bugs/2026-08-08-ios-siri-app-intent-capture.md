---
title: "Siri cannot invoke the iOS thought capture shortcut by voice"
workstream: siri-app-intents
area: beebox
priority: important
filed-by: agent
discovered-in: worktree-siri-app-intents — implementing Siri text capture
---

> **Reopened 2026-10-12:** The App Shortcut appears in Shortcuts and works when tapped, but Siri did not invoke it on a physical iPhone. Siri showed the correct transcript for “Save a thought in Bee Box” and then said “I didn't get that, try again?” The previous manual-testing gate was removed because the feature is not ready for another Siri test.

When the developer is hands-free and a thought arrives, they want to speak or pass text to Bee Box and have it reach the selected box without opening the app.

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

## Implemented

- A text-only App Intent in the main iOS app target uses the existing quick-chat outbox and delivery path.
- Capture targets the selected paired box. A box marked `requiresDeviceUnlock` is refused before persistence, even when the phone itself is unlocked. The intent never falls back to another box.
- The server stores the message as human input with origin `external` and source `apple-app-intents`. The source names the shared App Intents integration; the framework does not reliably reveal whether Siri, Shortcuts, Spotlight, or the Action Button invoked it.
- The spoken result distinguishes server acceptance, a destination choice, local save with unconfirmed delivery, and refusal. The intent does not record audio or read the box's reply.
- The initial request is bounded to 20 seconds. An uncertain delivery remains in the phone outbox under the same message ID and retries through the existing quick-chat path.

## Manual testing

This is the original validation plan from the feature implementation. It is
history, not a current readiness gate. Repeat the Siri steps only after fixing
shortcut registration.

Use a physical iPhone with the implementation installed and a paired test box.

1. With two boxes paired, select the second one in Bee Box. Terminate the app, invoke the App Shortcut with Siri using “Add a thought to Bee Box,” and provide a short test thought. Confirm Siri reports the result and the thought appears once in the selected box.
2. Make a Shortcut that supplies text to the Bee Box capture action. Run it and confirm the supplied text reaches the same selected box once.
3. If an Action Button is available, assign the App Shortcut, invoke it, and confirm the same capture behavior.
4. Mark the selected box as requiring device unlock. Invoke capture while the phone is unlocked. Confirm Siri refuses and no outbox entry or box message is created. Repeat from the lock screen if the device permits Siri there.
5. With the selected box eligible, enable Airplane Mode and invoke capture. Confirm Siri says delivery is unconfirmed rather than sent. Restore connectivity, open Bee Box, and confirm the thought retries and appears once.
6. Invoke capture with no paired box on a test install. Confirm the refusal does not claim the thought was saved.
7. Try the phrase with no thought text. Confirm Siri asks for text or returns a clear refusal without reporting success.

The simulator build and XCTest suite cannot verify Siri phrase matching, background launch, lock-screen behavior, or Shortcut execution. This issue stays open until those physical-device checks pass.

## Later

Voice memo recording, reading agent replies aloud, richer box selection, and exact attribution between Siri, Shortcuts, Spotlight, and Action Button are separate follow-up work.
