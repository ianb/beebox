---
title: "iOS App Intent: capture a thought with Siri or Shortcuts"
workstream: siri-app-intents
needs: [manual-testing]
area: beebox
priority: important
filed-by: agent
discovered-in: worktree-siri-app-intents — implementing Siri text capture
---
> **⏳ Awaiting manual testing** — fix landed in `a90dd8715`; try Siri and Shortcuts on a physical iPhone, including locked-box and offline cases. Only the developer clears this.

When the developer is hands-free and a thought arrives, they want to speak or pass text to Bee Box and have it reach the selected box without opening the app.

## Implemented

- A text-only App Intent in the main iOS app target uses the existing quick-chat outbox and delivery path.
- Capture targets the selected paired box. A box marked `requiresDeviceUnlock` is refused before persistence, even when the phone itself is unlocked. The intent never falls back to another box.
- The server stores the message as human input with origin `external` and source `apple-app-intents`. The source names the shared App Intents integration; the framework does not reliably reveal whether Siri, Shortcuts, Spotlight, or the Action Button invoked it.
- The spoken result distinguishes server acceptance, a destination choice, local save with unconfirmed delivery, and refusal. The intent does not record audio or read the box's reply.
- The initial request is bounded to 20 seconds. An uncertain delivery remains in the phone outbox under the same message ID and retries through the existing quick-chat path.

## Manual testing

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
