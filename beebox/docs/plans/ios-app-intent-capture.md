---
title: "iOS text capture with Siri and Shortcuts"
status: draft
workstream: siri-app-intents
issues:
  - ../../../issues/bugs/2026-08-08-ios-siri-app-intent-capture.md
---
# iOS text capture with Siri and Shortcuts

> **Product review, 2026-10-12:** Subsequent human requirements include shared material with accompanying instructions and predictable box destinations. The [latest product-shape review](ios-app-intent-capture.product-shape.review.md) identifies gaps in this draft. Revise the design and implementation scope before implementing this plan.

This plan repairs and validates Bee Box's existing text capture action on iOS. It defines the exact Siri, Shortcuts, Spotlight, and Action Button scenarios the feature supports, preserves the current durable quick-chat path, and ends with a short physical-iPhone exercise list.

**Issues addressed:** `2026-08-08-ios-siri-app-intent-capture`. The broader [quick-drop entry-points issue](../../../issues/features/2026-09-25-quick-drop-entry-points.md) remains open; this plan does not settle Mac, web, share-sheet, or media capture.

## Design

### Situations

- When Priya Marlowe is driving and remembers a thought, she wants to invoke Bee Box with Siri and speak the thought after Siri asks, so she can capture it without handling the phone.
- When Priya has text from another Shortcut action, she wants to pass that text to Bee Box, so she can save it through the same selected-box path.
- When Priya presses her Action Button or chooses Bee Box from Spotlight, she wants the same capture action and result, so she does not need to learn a different delivery flow for each system surface.
- When Priya has selected a box that requires device unlock, she wants capture refused even if the phone is unlocked, so a hands-free entry point cannot bypass the box's access rule.
- When Bee Box cannot confirm delivery, Priya wants a clear local-save or failure result, so she knows whether the words reached the phone or the box.
- When Priya is speaking to Siri about a different app or recipient, she does not want Bee Box to capture incidental speech. The action runs only after Siri selects the Bee Box shortcut and the person supplies its required text.

### Right place, right time

| Situation | Act, show, or quiet | Surface and record | Attention |
|---|---|---|---|
| Siri capture while hands are busy | Run the App Intent after the person invokes its phrase and supplies the prompted text | Siri dialog; existing quick-chat submission and transcript | Brief spoken result after persistence or server response |
| Shortcut passes text | Capture the supplied text through the same App Intent | Shortcuts result; same quick-chat submission and transcript | Return control to the running Shortcut after the honest result |
| Action Button or Spotlight starts capture | Run the same App Shortcut and parameter flow | System surface → App Shortcut → Siri/Shortcuts result | No separate confirmation or delivery path |
| Selected box requires device unlock | Refuse before persistence or networking | Siri/Shortcut result; no outbox entry | Brief refusal |
| Device is offline or routing needs a choice | Preserve the existing outbox/routing state and name it accurately | Siri/Shortcut result; outbox or server quick-chat record | Brief result; resolution waits in the Bee Box app |
| Siri does not match the shortcut | Stay quiet; no intent result or capture is claimed | Siri; no new record | No Bee Box interruption |

### Spirit

- **Serves:** “The best stuff comes from the people” in `beebox/docs/architecture/spirit.md` — the capture preserves the person's supplied words.
- **Risks:** “You should be able to see the gears” — a spoken success could hide local queueing or uncertain delivery. The intent must distinguish server acceptance from local persistence, and say nothing was saved if persistence fails.

### Trust

The person explicitly invokes capture and supplies its text. For this narrow quick-chat path, that is the existing automatic-capture tradeoff described in `beebox/docs/design/trust.md`: capture is frictionless, while durable records and honest delivery status preserve trust to keep. Do not ask the box agent to interpret the text before storing it. Do not advance to another box, unlock a protected box, or report delivery without evidence. A `needsChoice` result is saved for the selected box and waits for the person to choose in Bee Box.

### When it goes wrong or does nothing

- If Siri does not match the App Shortcut, Bee Box has not run. Do not infer a capture from Siri's transcript; use Console.app to look for an existing capture/refusal/submission event or inspect the persisted result.
- If Siri invokes the intent but has no text, ask for it or return a refusal. Do not enqueue an empty thought.
- If no box is selected, credentials are unavailable, or the selected box requires device unlock, refuse before persistence and name the reason. Never fall back to a different box.
- If outbox persistence fails, say the thought was not saved.
- If persistence succeeds but the server cannot be reached or delivery is uncertain, say it is saved on the phone and Bee Box could not confirm delivery. Preserve the stable ID for retry.
- If the server returns `needsChoice`, say the thought was saved for the selected box and needs a destination choice in Bee Box. Do not say “sent.”
- If the server returns `sent` with `queued == true`, say it is queued in the destination chat. If `queued` is false or absent, say it was sent to the selected box. Do not read the agent reply aloud.
- If Siri treats a phrase as a recipient/message request or otherwise fails before `perform()`, do not call that an App Intent result. Record the phrase and device outcome for the physical test report.

### Walkthrough

Priya has selected her `hearth` box in Bee Box and invokes “Save a thought in Bee Box,” the phrase already transcribed correctly on the physical phone. Siri asks for the required Thought parameter. Priya says, “Ask Tomas about the school schedule.” Siri passes that text to `perform()`. The intent trims whitespace, reads the selected `PairedBox`, and refuses if the box is absent, has no credential, or requires device unlock (`ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:18-37`). For an eligible box, `BoxScreenStore.captureExternalThought` restores the outbox, stores the thought with a stable ID and external source, then attempts submission (`ios-app/BeeBox/Storage/BoxScreenStore.swift:191-204`). `QuickChatOutbox.store` persists before the request starts (`ios-app/BeeBox/Storage/QuickChatOutbox.swift:156-176`). The server's existing `quickChat.submit` operation routes the thought; no new endpoint or mobile-contract shape is needed. If the server reports `sent` with `queued == true`, Siri says it is queued; if it reports `sent` with `queued != true`, Siri says it was sent. If routing needs a choice or delivery is uncertain, Siri says so and the record remains available in Bee Box. If Siri never selected the App Shortcut, none of these steps ran and the person receives no Bee Box success claim.

## Smallest fix and budget

The smallest plausible fix is to install a build that follows Apple's current App Shortcut registration guidance, then test the existing phrase while observing the device logs. The shortcut already appears in Shortcuts and runs when tapped, so registration alone is not an established explanation for Siri failing to invoke it. The fuller plan corrects misleading result dialogs, keeps the known phrase stable for the first diagnostic run, and changes one phrase variable only if that run proves Siri did not enter the intent.

Estimated changed source and test lines: 120–240 total additions plus deletions across Swift and XCTest. Authored documentation: 240–320 lines across the updated plan, usage-guide correction, and issue checklist. Generated output: none expected. This remains under the 2,000-line BIG CHANGE threshold. No backend or shared HTTP/bridge contract change is planned.

## Stated preferences this plan trades against

- The boxholder decided that a box marked `requiresDeviceUnlock` stays unavailable through Siri. The intent already checks this before capture (`ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:27-30`); this plan keeps the same refusal for every invocation path and verifies no outbox write.
- The boxholder asked for hands-free quick adding through Siri, Shortcuts, the Action Button, and likely other system surfaces. This plan supports those surfaces through one App Shortcut where Apple exposes it; it does not add separate semantics for each caller.
- The boxholder said the previous implementation's “overall shape” was not up to the task. This plan narrows the result to text supplied to one App Intent and its existing delivery path, and makes unsupported inputs/surfaces explicit rather than claiming a general quick-drop system.
- `beebox/docs/design/trust.md` says quick chat trades confirmation for frictionless capture only because “the thought is never lost.” The plan keeps write-before-network outbox semantics and truthful result wording, instead of adding a direct request that could lose offline text.
- The main `issues/features/2026-09-25-quick-drop-entry-points.md:42-45` leaves “Quick chat versus capture” unresolved. This plan retains the existing quick-chat semantics only for the already-shipped text intent. A broader destination change must be decided in the umbrella design before new capture types are added.

## What already exists

- `ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:4-14`: `CaptureThoughtIntent` has a required `thought: String`, background execution preference, and dependencies on the app-lifetime box and quick-chat stores. Reuse it; do not make a second intent for Siri versus Shortcuts.
- Source: `@Parameter(title: "Thought") var thought: String` (`ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:12`).
- `ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:57-65`: `BeeBoxAppShortcuts` exposes “Add a thought to …” and “Save a thought in …” phrases. Keep both unchanged in the first diagnostic build; use “Save a thought in Bee Box” for the baseline because it is the phrase already transcribed correctly on the phone. Only add one candidate phrase in a later build if logs show that Siri did not invoke the intent.
- Source: `phrases: ["Add a thought to \(.applicationName)", "Save a thought in \(.applicationName)"]` (`ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:61`).
- `ios-app/BeeBox/BeeBoxApp.swift:18-21`: app initialization registers both intent dependencies, but does not update shortcut parameters. Add the App Shortcuts registration beside these dependency registrations.
- Source: `AppDependencyManager.shared.add(dependency: { await AppRuntime.pairedBoxStore })` and `AppDependencyManager.shared.add(dependency: { await AppRuntime.boxScreenStore })` (`ios-app/BeeBox/BeeBoxApp.swift:19-20`).
- `ios-app/BeeBox/Storage/BoxScreenStore.swift:191-204`: `captureExternalThought` restores, stores, retries, and reports `.submitted` or `.savedLocally` without draining unrelated restored outbox entries. Reuse this operation for all supported text sources.
- Source: `/// Capture one external thought through the same durable outbox as the box screen, without draining unrelated entries restored from disk.` (`ios-app/BeeBox/Storage/BoxScreenStore.swift:191-192`).
- `ios-app/BeeBox/Storage/QuickChatOutbox.swift:156-176`: `store` writes the entry before any request and returns `nil` on persistence failure. Keep this ordering and stable ID.
- Source: `guard await persist() else {` inside `store` and its `return entry` after persistence (`ios-app/BeeBox/Storage/QuickChatOutbox.swift:172-176`).
- `ios-app/BeeBox/Storage/BoxScreenStore.swift:342-361`: `submitEntry` uses the stored ID and source when submitting, retains failed entries, and records the returned server state. Reuse this path; do not call chat-send APIs behind the webview.
- Source: `view = try await client(box).submit(id: entry.id, message: entry.text, origin: entry.origin, source: entry.source, hqService: entry.hqService)` (`ios-app/BeeBox/Storage/BoxScreenStore.swift:346-350`).
- `ios-app/BeeBoxTests/BoxScreenStoreTests.swift:155-178`: existing tests cover external capture persistence and protected-box refusal. Extend the current tests for the plan's required outcomes rather than duplicating storage tests.
- Source: `XCTAssertEqual(client.submittedSources, ["apple-app-intents"])` and `XCTAssertTrue(entries.isEmpty)` (`ios-app/BeeBoxTests/BoxScreenStoreTests.swift:161,179`).
- `ios-app/BeeBoxShareExtension/ShareViewController.swift:56-79,107-120`: the share extension is a separate, visible picker flow that loads a shared textual item and submits after explicit selection. It is not part of this App Intent slice.
- Source: `switch selection` chooses `.chat` or `.save` before `extensionContext?.completeRequest(returningItems: nil)` (`ios-app/BeeBoxShareExtension/ShareViewController.swift:63-74`).
- `beebox/docs/mobile-contract.md:1275-1321,1395`: §5.11 documents quick-chat submission, external origin/source, and its iOS implementation anchors. This plan does not change the request shape, so the shared contract remains unchanged.
- Source: `External input requires a source; other origins reject source.` (`beebox/docs/mobile-contract.md:1281-1282`).
- `beebox/docs/box/siri-shortcuts.md:7-12`: the guide correctly describes selected-box targeting but incorrectly says to unlock a protected box before Siri use. Correct the guide to say such a box is unavailable through this action, even if the phone itself is unlocked.
- Source: `Open Bee Box and unlock that box before using Siri.` (`beebox/docs/box/siri-shortcuts.md:11-12`).
- Issue search found the Siri capture bug and quick-drop umbrella as direct matches. The umbrella also names share-sheet, Mac, notification, photo, file, and voice capture work; those are not silently folded into this plan.

## Prior art (external)

- **Adopted, Apple App Intents:** App Shortcuts use phrases containing the app name and can surface in Siri and Spotlight; Apple recommends updating shortcut parameters during app initialization. Use the current registration guidance and keep only a small set of memorable phrases. [Accelerating app interactions with App Intents](https://developer.apple.com/documentation/appintents/acceleratingappinteractionswithappintents)
- **Evaluated, Siri phrase matching:** Apple's WWDC22 sample supports parameterized phrases by enumerating predefined entity values; it does not define arbitrary free-form text after a phrase as a phrase parameter. Therefore this plan supports Siri's follow-up for the required string, not “phrase plus an unbounded thought” as a guaranteed one-utterance action. [Implement App Shortcuts with App Intents](https://developer.apple.com/videos/play/wwdc2022/10170/)
- **Evaluated, App Schemas:** Apple's Notes `createNote` schema represents creating a note with content and optional attachments. Bee Box's current action submits a routed quick-chat thought and may wait for destination choice, so this plan does not claim that action is a note. WWDC26 presents schema-driven natural-language Siri actions for the iOS/iPadOS 27 generation; they depend on Apple Intelligence support, which Apple lists for iPhone 15 Pro models and iPhone 16 or later, plus supported software, language, and region. That is a different path from this app's iOS 17+ custom App Intent. [Notes schema](https://developer.apple.com/documentation/appintents/app-schema-domain-notes) · [Apple Intelligence device requirements](https://support.apple.com/en-la/121115) · [WWDC26 Siri schemas](https://developer.apple.com/videos/play/wwdc2026/240/)
- **Evaluated, invocation surfaces:** Apple documents App Shortcuts across Siri and Spotlight and describes their use with the Action Button. Those surfaces can invoke the same intent; the intent cannot truthfully identify which one started it. This plan does not add a separate ControlWidget or widget extension. [WWDC24 App Intents session](https://developer.apple.com/videos/play/wwdc2024/10210/) · [App Shortcuts](https://developer.apple.com/documentation/appintents/acceleratingappinteractionswithappintents)
- **Evaluated, inputs beyond text:** `IntentFile` lets Shortcuts pass a file-backed resource to an App Intent. It does not replace the share extension or define Bee Box storage for attachments. The existing quick-chat request is text-shaped, so file and media payloads need a separate product/data decision. [IntentFile](https://developer.apple.com/documentation/appintents/intentfile)
- **Evaluated, comparable apps:** Bear describes Siri phrases that create notes; Things documents “In Things, remind me to …” and a Reminders inbox; Drafts opens an explicit dictation interface. These examples support clear action semantics and separating a dictation UI from an intent that receives text. [Bear Siri](https://bear.app/faq/how-to-use-bear-with-siri-on-ios/) · [Things Siri](https://culturedcode.com/things/support/articles/2877019/) · [Drafts dictation](https://docs.getdrafts.com/docs/editor/dictation)

## Ontology

- **App Shortcut** (existing, `ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:57-65`): the named system-discoverable wrapper around the one text-capture intent. It is not a record and does not prove an invocation occurred.
- **Capture intent** (existing, `ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:4-55`): one App Intent that receives a text thought and submits it to the selected paired box. It is not an audio recording, file transfer, or guarantee that Siri invoked it.
- **Thought text** (existing parameter, `ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:12`): the trimmed string supplied by Siri's parameter prompt or by a Shortcuts action. It is not an arbitrary guaranteed suffix of the trigger phrase.
- **Selected box** (existing, `ios-app/BeeBox/Storage/PairedBoxStore.swift`): the paired destination selected in Bee Box. The intent does not pick another box if this one is unavailable.
- **Quick-chat outbox entry** (existing, `ios-app/BeeBox/Storage/QuickChatOutbox.swift:13-54`): a local durable submission with a stable ID, selected box ID, text, origin, and source. It is not proof that the server accepted the thought.
- **Quick-chat record** (existing, `beebox/src/core/chat/routing/quick-chat-record.ts`): the server's idempotent routing state for that outbox ID. Its `sent`, `needsChoice`, `sending`, or `discarded` state is distinct from local persistence.
- **Invocation source** (existing, source string `apple-app-intents`): identifies the shared Apple App Intents integration. It does not distinguish Siri, Shortcuts, Spotlight, or Action Button.
- **App Schema note** (not adopted): a structured note entity created under Apple's Notes domain. Bee Box does not currently expose the selected quick-chat operation as this entity.

## Tracks / scope

### Track 1: Diagnose Siri invocation with one stable phrase

**What.** Keep one `CaptureThoughtIntent` and call App Shortcut registration during `BeeBoxApp.init()` as Apple currently recommends. Leave the existing phrase list unchanged in the first diagnostic build. Siri's supported flow is invocation followed by Siri's prompt for the thought. A Shortcut can instead supply text from an earlier action.

**Why this needs to change.** `BeeBoxApp.init()` registers dependencies but does not call `BeeBoxAppShortcuts.updateAppShortcutParameters()` (`ios-app/BeeBox/BeeBoxApp.swift:18-21`). Apple recommends this registration, but the shortcut is already visible and tappable; treat the call as current-guidance compliance, not as the proven Siri fix. The issue says the physical iPhone displayed a transcript and then failed, which does not prove the intent ran (`issues/bugs/2026-08-08-ios-siri-app-intent-capture.md:10-20`). First use the existing OS logs to determine whether any `perform()` branch ran. Preserve both existing phrases in this first build and test the already-transcribed “Save a thought in Bee Box.” If no intent event appears, add one candidate phrase in a later diagnostic build and repeat; do not combine phrase experiments.

**Direction.** Call `BeeBoxAppShortcuts.updateAppShortcutParameters()` at app initialization as current Apple guidance recommends. Keep both existing phrases unchanged in the first test build. Do not put arbitrary text in the trigger phrase. Do not add a new log line: `CaptureThoughtIntent.perform()` already logs its refusal branches, `captureExternalThought` logs when it persists, and submission logs its returned state. Read those events live in Console.app on the connected iPhone, filtered to subsystem `app.beebox.ios`; reopening Bee Box is an alternate way to flush queued native logs to the paired box. Retain `openAppWhenRun = false` on the iOS 17 baseline and the existing iOS 26 `supportedModes` declaration; verify cold/background behavior on the phone. Apple's runtime-mode documentation says `supportedModes` is a system preference and can be overridden by execution context. [Runtime behavior](https://developer.apple.com/documentation/appintents/configuring-the-runtime-behavior-of-your-app-intents)

**Vocabulary lock-ins.** `CaptureThoughtIntent`, `BeeBoxAppShortcuts`, `thought`, and source `apple-app-intents` remain stable. Do not add `source: siri` or claim exact caller attribution.

**First implementation chunk.** Add the registration call without changing the known phrase, correct the protected-box dialog, handle `.sent` with `queued == true` as “Queued in …” instead of “Sent to …”, and cover dialog mapping for empty text, no box/credential, protected box, local-save, queued, `needsChoice`, and sent. Cover no-box through tests, not by unpairing the boxholder's phone. No new diagnostic line, App Schema, or entry surface is part of this chunk.

### Track 2: Preserve one durable text-delivery path and honest results

**What.** Keep Siri and Shortcuts on `BoxScreenStore.captureExternalThought` → `QuickChatOutbox` → `QuickChatAPI` → `quickChat.submit`. Do not add a Siri-specific endpoint or a second outbox. Check every spoken result against the actual local or server state.

**Why this needs to change.** The intent already calls this path (`ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:36-52`), and it writes before networking (`ios-app/BeeBox/Storage/QuickChatOutbox.swift:156-176`). The user-facing guide currently gives incorrect protected-box instructions (`beebox/docs/box/siri-shortcuts.md:7-12`).

**Direction.** Keep the request and `mobile-contract.md` shape unchanged. For `.sent`, inspect `QuickChatView.queued`: the box screen's status line already distinguishes “Queued in” from “Sent to” (`ios-app/BeeBox/Storage/BoxScreenStore.swift:64-70`), while the intent currently says “Sent to” for both (`ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:43-46`). Correct the intent to match the existing state. Change protected-box wording to say the selected box is unavailable through this action and must be changed in Bee Box; do not suggest unlocking that same box will enable Siri. Add focused dialog tests for those branches. Update the guide and issue's physical test steps in the same plan, and leave the issue open until device checks pass.

**Vocabulary lock-ins.** Existing quick-chat states and the `external` / `apple-app-intents` provenance remain unchanged. “Saved on this phone,” “sent,” and “needs a destination choice” must remain distinct claims.

**First implementation chunk.** Add focused tests for queued-versus-sent and protected-box dialog wording, correct the guide, and replace the stale manual-test list with the exact physical exercise set below. Keep server and bridge contracts unchanged.

## Could this be simpler?

The smallest plausible version is to reinstall the current action and inspect Console.app while repeating the existing phrase list unchanged. The shortcut already appears and runs by tap, so adding a registration call without observing the intent would not isolate the failure. The selected implementation uses existing OS and forwarded logs to distinguish Siri matching from intent execution, then adds one candidate phrase only if the logs show the intent did not run. Correcting the queued and protected-box dialog text buys truthful results with no new capture abstraction; all supported callers still use the existing text operation.

## Subplans

None. App Schema adoption and the general quick-drop input model require decisions outside this text-only plan.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| App Shortcut is not registered or Siri fails to match its phrase | No automated test can establish Siri matching; a physical phone check with Console.app is required | Register at app initialization per current Apple guidance; preserve the known phrase in the first diagnostic build; change one phrase variable only if logs show no intent event | Clear in Siri only if it reports failure; Console.app separates matching from execution |
| Siri invokes the intent without a thought | Existing store coverage does not test Siri's parameter prompt | Existing intent returns “Tell me what thought to save” for empty text | Clear, no write |
| Intent dependencies are not available during a cold/background invocation | Existing simulator tests do not prove Siri's app lifecycle | Dependencies are registered in `BeeBoxApp.init()`; add the current App Shortcut registration call and cold-launch device check | Must be clear in the Siri result or existing Console.app events |
| Selected box is protected or credential is missing | `BoxScreenStoreTests` cover protected refusal; intent-level result mapping coverage to add | Intent refuses before persistence | Clear, no outbox entry |
| Outbox cannot persist text | Outbox/store tests exercise persistence failure handling | Existing `.persistenceFailed` result says the thought was not saved | Clear, no success claim |
| Request times out after server acceptance | Existing idempotent quick-chat/outbox path uses stable IDs; add or retain focused state test | Retry uses the same ID; the intent says delivery could not be confirmed. Before dictating again after a Siri-side failure, inspect the outbox and server state because the first request may have been accepted | Clear, may already exist server-side; a manual second capture would have a new ID |
| Server returns `needsChoice` | Existing quick-chat result tests cover state rendering; ensure intent dialog branch is asserted | Intent asks person to choose in Bee Box | Clear, saved but not sent |
| One-utterance phrase is interpreted as a recipient request | Previous physical report observed “To who?”; simulator cannot reproduce phrase routing | Phrase set avoids the recipient construction; no result is claimed unless intent runs | Clear as a device test failure, no assumed capture |
| Action Button or Spotlight invokes a different path or opens UI unexpectedly | No automated test; physical phone exercise required | Same App Shortcut is the declared action; no caller-specific behavior is assumed | Clear through observed surface, existing Console.app log event, and result |

There is no planned network write outside the existing outbox and `quickChat.submit` operation. This plan does not introduce a new critical failure path without handling.

## Agent-flow / user-flow edge cases

- **Wrong intent or input:** ADDRESSED — only one capture intent exists; it takes one required text value. No photo/file/audio values are coerced into text.
- **Stale box selection:** ADDRESSED — the intent reads `PairedBoxStore.selectedBox` at execution and verifies the box remains in `BoxScreenStore` before storing (`ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:23-37`; `ios-app/BeeBox/Storage/BoxScreenStore.swift:193-198`). It does not fall back to another paired box.
- **Two callers capture at once:** ADDRESSED by separate stable outbox IDs and server idempotency; tests must assert both entries survive and neither retries as the other. No user-authored card is involved.
- **Hand-edit drift:** ADDRESSED — no box schema or hand-edited data shape is added. App phrases and dialog text live in Swift; the guide is corrected in the same plan.
- **Fabricated free-form value:** ADDRESSED — only the string supplied to the required parameter is submitted. The intent does not infer a missing thought from the invocation phrase.
- **Validation error UX:** ADDRESSED — empty, no box, credential, protected-box, persistence, local-save, queued, sent, and `needsChoice` outcomes each have explicit wording. Tests assert the relevant text/state mapping.
- **Partial migration / transition state:** ADDRESSED — no persisted shape or server contract changes. Older app installs keep their current behavior until the new build is installed; the phone checklist begins by installing and launching the new build.
- **Invocation before app launch:** DEFERRED to physical device validation — dependency registration and shortcut registration happen in app initialization, but only an installed build and Siri can establish the cold-start behavior.

## NOT in scope

- One-utterance free-form Siri text through Notes or Messages App Schemas: those schemas must honestly describe the operation; current quick chat is not a notes or recipient-based messaging action.
- `ControlWidget`, Home Screen widget, Lock Screen widget, notification action, and Control Center control: they need a separate decision about whether a tap opens the app or asks for input; they cannot be treated as if a tap supplies free-form text.
- Photo, video, audio, `IntentFile`, URL, webpage, and share-sheet capture: the current `quickChat.submit` request accepts text, and the umbrella issue calls out separate storage/routing work.
- New capture inbox versus quick-chat destination: this plan keeps the existing quick-chat semantics for the existing App Intent; broader entry points wait on the umbrella design.
- Voice memo recording or reading agent replies aloud: neither is required to prove text capture.
- iOS/backend HTTP or bridge contract changes: no wire shape change is planned.
- macOS, web, Chrome extension, and physical-device implementation: separate platforms or verification; the phone checklist tests only the iOS build.

## Open design questions

- Before adding files, links, or other quick-drop entry points, should they create a routed quick-chat message or a durable inbox capture? This plan deliberately retains the existing quick-chat destination for text and does not answer the umbrella issue's broader question.
- App Schema adoption should be reconsidered only if Bee Box later has an action and record that honestly match a supported domain. The current recommendation is not to adopt one for this plan.

## Knowledge audits

No new box-agent concept is introduced. This work changes the native iOS App Intent, its user-facing Siri/Shortcuts guide, and a developer issue checklist; it does not change box-loaded instructions or schemas, so no knowledge audit applies.

## What will hold this after it ships

- XCTest holds the intent's parameter-to-dialog outcome mapping and the protected-box/no-persistence invariant. Extend the existing outbox and `BoxScreenStore` coverage; do not build a new test framework.
- XCTest holds deterministic intent-result mapping; it cannot establish system registration, Siri recognition, or background process launch.
- A physical-iPhone checklist is the acceptance test for phrase matching, Siri's follow-up prompt, Shortcut input delivery, Action Button/Spotlight invocation, and background behavior. Read unified logs live in Console.app by selecting the connected iPhone and filtering subsystem `app.beebox.ios`. The relevant existing events include intent refusal reasons, `external quick chat stored`, and `quick chat submitted state=…`. Reopening Bee Box flushes native logs to the paired box's `client-debug.log`; background invocation logs may not reach that file until the app becomes active.
- The mobile contract stays unchanged. Run the iOS simulator build and selected BeeBox XCTest targets during implementation; do not describe those as Siri verification.

## Implementation order

1. Register `BeeBoxAppShortcuts` in `BeeBoxApp.init()` without changing either existing phrase. Correct the queued and protected-box dialog wording and cover the result/refusal mapping. Keep the supported text path and iOS 17 fallback intact.
2. Correct `beebox/docs/box/siri-shortcuts.md` and update the bug issue with the phone checklist. The guide must state the protected-box refusal accurately.
3. Build/install on a physical iPhone and complete the baseline checklist. Use Console.app to determine whether `perform()` reached any logged branch. If the known phrase produces no Bee Box log event, change only the phrase in a subsequent diagnostic build (candidate: “Capture a thought with Bee Box”) and repeat before trying another phrase. Do not change registration and phrasing together, and do not broaden into App Schemas or new surfaces during this diagnostic pass.
4. Close the Siri issue only after the supported scenarios pass on a physical phone. Leave the umbrella quick-drop issue open for its remaining surfaces and inputs.

## Rollout shape

Implementation is ready when selected iOS XCTest coverage passes, the signing-appropriate iOS build succeeds, the updated guide matches the behavior, and the boxholder can complete the physical phone checklist below. A simulator pass is necessary for Swift changes but is not acceptance for Siri, Shortcuts, Spotlight, Action Button, background launch, or lock-screen behavior.

### Physical iPhone exercise list

Use a dedicated paired test box and an installed build containing the change. Connect the iPhone to the Mac and open Console.app. Select the iPhone, filter on subsystem `app.beebox.ios`, and note the existing event(s) for each run. Record the model, iOS version, whether Bee Box had been launched since install, exact phrase/surface, spoken result, and whether exactly one server-side thought appeared. The existing success events are `external quick chat stored` and `quick chat submitted state=…`; refusal branches log their reason. Do not expect the App Intent itself to write immediately to the box's log while the app has no active scene.

1. **Siri follow-up capture:** Select the test box, terminate Bee Box, say the known phrase “Siri, save a thought in Bee Box.” When Siri asks for the thought, say “Ask Tomas about the school schedule.” Expected: Console.app shows a Bee Box capture event if the intent ran, Siri reports the actual result, and the thought appears exactly once in the selected box. If no event appears, do not call the transcript proof of invocation; change only the phrase in a later build and repeat this test.
2. **Shortcut-supplied text:** Build/run a Shortcut that passes a fixed test string into Bee Box's Add a Thought action. Expected: no second text prompt, the same selected box receives exactly one thought, and the result reports the real server state.
3. **Action Button:** On a phone with an Action Button, assign the Bee Box App Shortcut and invoke it. Expected: the same text parameter flow and result as the Siri action; no claim that Bee Box can tell the Action Button was the caller. Check Console.app and inspect the outbox before repeating after any system-side failure.
4. **Spotlight:** Find and run Bee Box's Add a Thought App Shortcut from Spotlight. Expected: the same parameter and delivery behavior as the other App Shortcut surfaces.
5. **Protected selected box:** Mark the selected test box as requiring device unlock while leaving the phone unlocked. Invoke the supported Siri phrase. Expected: a refusal that says this box is unavailable through capture and no outbox entry or server-side thought. The message must not imply that unlocking this same box enables Siri.
6. **Offline capture:** Use the Shortcuts app to run the Bee Box action with supplied fixed text while Airplane Mode is on; do not depend on Siri's own network availability for this outbox check. Expected: the result says local save/delivery unconfirmed, not sent. Restore connectivity and open Bee Box; expected: one server-side thought appears after retry, with no duplicate. After any failed Siri run, inspect the outbox and server before dictating again under a new ID.
7. **No text:** Invoke the App Shortcut and cancel or leave its required parameter unanswered. Expected: Siri prompts or refuses; no success result, outbox entry, or server thought. No-box and missing-credential branches are covered by tests; do not unpair the boxholder's phone to exercise them.

Do not count an utterance that Siri interprets as a message recipient request as a supported capture. Record it as a phrase-matching failure, and check Console.app for existing Bee Box events before attributing it to `perform()`. Change only one phrase variable per installed build.
