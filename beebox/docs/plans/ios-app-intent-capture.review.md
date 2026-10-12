# Plan Engineering Review — iOS text capture with Siri and Shortcuts

Independent review: Claude Fable, plan review rounds 1–2, 2026-10-12. Round 1 raised eight findings. The plan was revised and round 2 verified all eight; it found no new material contradiction. This review covers the plan only. It does not authorize implementation or substitute for the physical-iPhone checks.

## What already exists

- The App Intent already requires a `thought` string and uses one `BeeBoxAppShortcuts` provider (`ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:4-14,57-65`).
- `BeeBoxApp.init()` registers the paired-box and box-screen dependencies but not App Shortcut parameters (`ios-app/BeeBox/BeeBoxApp.swift:18-21`). The shortcut already appears and runs when tapped, so the plan treats the registration call as current-guidance compliance, not the proven Siri fix.
- `BoxScreenStore.captureExternalThought` restores the outbox, persists before submitting, and does not drain unrelated entries (`ios-app/BeeBox/Storage/BoxScreenStore.swift:191-204`). The outbox stores before a request (`ios-app/BeeBox/Storage/QuickChatOutbox.swift:156-176`).
- The intent currently reports every `.sent` response as “Sent to …”, while `QuickChatView.statusLine` distinguishes a busy-chat queue from a send (`ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:43-46`; `ios-app/BeeBox/Storage/BoxScreenStore.swift:64-70`).
- Existing `BoxScreenStoreTests` cover external persistence and protected-box refusal (`ios-app/BeeBoxTests/BoxScreenStoreTests.swift:145-180`). The physical test can read unified logs from subsystem `app.beebox.ios` (`ios-app/BeeBox/Services/BoxLog.swift:90-99`).

## Ontology (verified against the code's own names)

`CaptureThoughtIntent`, `BeeBoxAppShortcuts`, the `thought` parameter, `QuickChatOutboxEntry`, `QuickChatView`, and source `apple-app-intents` all match current code names. The plan keeps the intent parameter, local outbox entry, and server routing result distinct. It does not invent a Notes entity or infer Siri-versus-Shortcut caller identity.

## Prior art (external) — verified

- Apple recommends calling `updateAppShortcutParameters()` during app initialization. This does not establish that the missing call caused this report because the App Shortcut already appears and is tappable: [App Intents sample](https://developer.apple.com/documentation/appintents/acceleratingappinteractionswithappintents).
- The App Shortcut phrase includes the application name. The current string parameter is requested after invocation; the WWDC22 sample's phrase parameterization uses predefined entity values, not an arbitrary free-form suffix: [WWDC22 App Shortcuts](https://developer.apple.com/videos/play/wwdc2022/10170/).
- Apple presents schema-driven natural-language Siri actions in the iOS/iPadOS 27 generation. Notes `createNote` can describe a note, but Bee Box's current action is routed quick chat; the plan appropriately declines that schema: [WWDC26 Siri schemas](https://developer.apple.com/videos/play/wwdc2026/240/) · [Notes schema](https://developer.apple.com/documentation/appintents/app-schema-domain-notes).
- Apple lists Apple Intelligence-compatible phones as iPhone 15 Pro models and iPhone 16 or later, with software, language, and region requirements: [Apple Intelligence requirements](https://support.apple.com/en-la/121115).
- App Shortcuts can appear through Spotlight and the Action Button; a shared intent cannot claim which surface invoked it: [WWDC24 App Intents](https://developer.apple.com/videos/play/wwdc2024/10210/).

## Stated preferences this plan trades against

The plan preserves the human decision that a protected box is unavailable through Siri, including when the phone is unlocked. It keeps a single durable text path and requires result wording to distinguish local persistence, a queued server response, a sent response, and `needsChoice`. It defers media and new system widgets instead of implying that a tap supplies text.

## Could this be simpler? (verified)

Repeating the existing phrase while reading Console.app is the smallest diagnostic action. A registration call by itself would not separate Siri matching from intent execution. The plan adds that call only alongside outcome-wording corrections and a device test that observes existing events before changing the phrase. It adds no new logging subsystem or capture abstraction.

## Failure modes

The plan covers Siri not invoking the intent, missing text, dependency availability, protected/no-credential/no-box refusal, persistence failure, timeout ambiguity, queue-versus-send wording, and `needsChoice`. It assigns Siri matching and background invocation to a physical phone. The offline outbox case uses the Shortcuts app to avoid conflating Bee Box persistence with Siri network availability.

## Agent-flow / user-flow edge cases

The user flow preserves the selected box, rejects protected-box capture before persistence, retains a stable ID for retries, and tells the person to inspect the outbox before repeating a timed-out Siri attempt. The phone checklist no longer requires unpairing a real device to reach the no-box branch; that branch belongs in tests.

## Findings

### 1. Registration was framed as the likely Siri fix

**Location in plan:** Smallest fix and Track 1.

**Review:** The App Shortcut was already visible and tappable. Missing registration was not enough evidence to diagnose Siri failure.

**Disposition:** Fixed. The plan calls the registration update current-guidance compliance and makes the first device run inspect logs before a phrase change.

### 2. Phrase changes would confound the device test

**Location in plan:** Track 1 and physical-iPhone exercise list.

**Review:** The phrase “Save a thought in Bee Box” had a prior correct transcript; changing it with registration would change multiple variables.

**Disposition:** Fixed. The first build keeps both current phrases. A later build adds one candidate only if the baseline produces no intent event.

### 3. Queued delivery was called sent

**Location in plan:** Design, Track 2, and failure modes.

**Review:** `QuickChatView.state == .sent` can also have `queued == true`; the box screen already labels that “Queued in …”.

**Disposition:** Fixed. The plan requires distinct dialog wording and mapping coverage for queued and sent results.

### 4. Protected-box wording told people to unlock the box

**Location in plan:** Track 2 and exercise 5.

**Review:** The current intent and guide incorrectly imply that unlocking the protected box enables capture.

**Disposition:** Fixed. The plan changes the intent dialog and guide to direct people to an eligible box; it preserves the no-bypass rule.

### 5. A new start log would duplicate existing events

**Location in plan:** Track 1 and physical-iPhone exercise list.

**Review:** Existing `BoxLog` events already identify refusal, persistence, and server state. Forwarding to the box may wait until the scene becomes active.

**Disposition:** Fixed. No log line is added. The list directs live inspection through Console.app and explains delayed forwarding.

### 6. Siri could confound the offline outbox test or encourage duplicate capture

**Location in plan:** Failure modes and exercise 6.

**Review:** Siri availability while offline can fail before Bee Box runs, and a timed-out capture may already be stored or accepted.

**Disposition:** Fixed. Offline capture runs from Shortcuts with supplied text; before repeating a failed Siri attempt, the person checks the outbox and server state.

### 7. A no-box phone test could require unpairing a real phone

**Location in plan:** Track 1 and exercise 7.

**Review:** The test was unnecessary and could disturb the boxholder's paired device state.

**Disposition:** Fixed. No-box and missing-credential cases are covered in tests, not by unpairing the phone.

### 8. Two cited source ranges were inaccurate

**Location in plan:** What already exists and source quotes.

**Review:** The mobile-contract section citation started before §5.11; the outbox `store` citation included the separate `add` method.

**Disposition:** Fixed. The plan now cites §5.11 beginning at line 1275 and `store` at lines 156-176. Round 2 confirmed both ranges.

## NOT in scope (verified)

App Schemas, ControlWidget and widgets, notification actions, media and share-sheet inputs, quick-chat-versus-inbox redesign, reply readback, macOS, web, and Chrome extension remain deferred. The plan keeps the wider quick-drop umbrella issue open.

## Things I checked and found clean

- The selected box and `requiresDeviceUnlock` guard occur before `captureExternalThought` in the intent (`CaptureThoughtIntent.swift:23-37`).
- `captureExternalThought` stores the external thought before attempting its network request (`BoxScreenStore.swift:191-204`; `QuickChatOutbox.swift:156-176`).
- A server response can indicate queued delivery while its state is `sent`; the plan now reflects this in spoken outcomes (`QuickChatView.swift:32-47`; `BoxScreenStore.swift:64-70`).
- The revised scenarios, failure table, and phone checklist match the stated text-only scope and preserve no-success-without-persistence.
