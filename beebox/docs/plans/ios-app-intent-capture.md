---
title: "iOS hands-free text capture with App Intents"
status: draft
workstream: siri-app-intents
issues:
  - ../../../issues/features/2026-08-08-ios-siri-app-intent-capture.md
---
# iOS hands-free text capture with App Intents

This plan adds a text-capture action to Bee Box for Siri and Shortcuts. It uses the existing quick-chat outbox and delivery path, and labels the delivered message as generic external input so other platforms can use the same vocabulary later.

**Issues addressed:** `2026-08-08-ios-siri-app-intent-capture`; `2026-07-20-android-per-box-device-lock-parity` is related but not addressed because it is a separate Android feature.

## Design

### Situations

- When a person is driving and remembers something to keep, they want to say “add this to my box” and have the thought recorded without handling the phone.
- When a person builds a Shortcut with text from another action, they want Bee Box to capture that text in the selected box.
- When a person has more than one paired box, they want to know which selected box received the thought.
- When a person invokes capture for a box that requires device unlock, they want Siri to say that box is unavailable rather than queue a message that Siri must not access.
- When a person tries a phrase that does not provide text, they want a clear explanation instead of a false success or a discarded thought.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Siri supplies a text thought | Persist it, attempt quick-chat delivery, then report the actual result | Siri dialog; existing quick-chat record and transcript | Interrupts only to confirm capture or explain failure |
| A Shortcut supplies text | Use the same capture action and result | Shortcuts result; same records | Returns to the Shortcut immediately after durable enqueue or bounded send |
| Action Button runs the App Shortcut | Use the same action; do not claim to know it was the Action Button | Action Button → App Shortcut → Siri dialog | Same as the calling shortcut |
| Selected box requires device unlock | Refuse before storing or sending | Siri dialog | Brief refusal; no queue entry |
| No paired box or unavailable credential | Refuse before claiming capture; direct the person to pair or unlock in the app | Siri dialog | Brief explanation; no queue entry |
| Text is absent or the invocation is not implemented | Return an explicit unsupported-input result | Siri/Shortcuts dialog | No write and no success wording |

### Spirit

- **Serves:** “The best stuff comes from the people” — preserve the person's words at the moment they arrive.
- **Risks:** “You should be able to see the gears” — a spoken “sent” could hide whether the server accepted the message or the phone only saved it. The result must distinguish server acceptance from a durable local queue, following engineering principle 4, “Resilient AND never silent.”

### Trust

The person explicitly invokes capture, so quick-chat's existing automatic capture tradeoff applies. The intent stores the exact supplied text without asking the box agent to interpret or confirm before keeping it. The box's routing decision remains in quick chat. A selected box with `requiresDeviceUnlock == true` is excluded from this path even if the phone happens to be unlocked; there is no Siri unlock flow and no fallback to another box. A refusal stores nothing. This preserves the human decision that locked boxes cannot be accessed through Siri.

### When it goes wrong or does nothing

- If there is no selected paired box, say to pair a box in Bee Box. Do not store the text without a destination.
- If the selected box requires device unlock, say it is unavailable through Siri and ask the person to unlock it in the app. Do not store or reroute the text.
- If the credential is unavailable, keep the thought only when the selected box passed Siri eligibility and the outbox write succeeded. Say it is saved on the phone and needs Bee Box to confirm delivery; do not claim a send.
- If outbox persistence fails, say the thought was not saved. Do not claim a queued capture.
- If persistence succeeds but quick-chat submit fails or times out, say the thought is saved on this phone and Bee Box could not confirm delivery. A timeout can race with server acceptance, so do not claim it is definitely waiting to send. Keep the same ID and retry using the existing outbox policy.
- If the server returns a `needs-choice` record, tell the person it was saved for the box and needs a destination choice in the app. Do not imply it reached a chat.
- If the server returns `sent`, report the server's accepted result. Do not read back the agent reply in this slice.
- The text intent exposes no audio-recording or reply-reading mode. If the system cannot resolve a text parameter, ask for text and do not create an entry or claim capture. Do not add unsupported placeholder actions.

### Walkthrough

The person says “Add this to my box: pick up Malik after practice.” The App Shortcut resolves the string parameter and calls the main app target's App Intent with the app configured to support background execution without opening its UI. The intent obtains the app-lifetime `PairedBoxStore` and quick-chat capture service through App Intents dependency registration. The shared outbox restores its disk state without launching the normal all-box drain, then the intent refuses if the selected box is missing or requires device unlock. It reads the selected `PairedBox` and credential through the existing main-app store, creates one outbox entry with a stable ID, quick-chat-only `origin: "external"`, and `source: "apple-app-intents"`, and persists before the request. It submits through `quickChat.submit`, which routes using the existing box logic. The server stores the origin and source on the quick-chat record and delivers `<external-input source="apple-app-intents">pick up Malik after practice</external-input>` to the chosen chat. The wrapper also tells the agent this arrived through quick chat: the person addressed the box, the box chose the conversation, and a destination phrase is addressed to the box rather than the current chat. The intent says “Sent to [box]” only after the server reports `sent`; on timeout or an unresolved routing choice it says the thought is saved on the phone and Bee Box could not confirm delivery. The outbox retries a failed submit with the same ID when its existing launch/foreground retry path runs. The transcript remains the durable human-message record.

## Smallest fix and budget

The smallest plausible change is an App Intent that POSTs straight to quick chat and speaks a result. That omits durable capture on network failure, but it violates the agreed hands-free behavior: a dropped request can lose the thought. The selected design uses the existing outbox and adds only the metadata and reader support needed to make its origin durable and correctly understood.

Estimated changed source and test lines: 400–650 TypeScript/Swift source lines and 450–700 test lines across the iOS app and Bee Box. Authored documentation: about 250–350 lines for this plan, the mobile contract, issue test instructions, and review record. Generated output: none expected. The estimate includes sender attribution and frontend parser paths needed to render the new wrapper correctly. It remains below the 2,000-line BIG CHANGE threshold.

## Stated preferences this plan trades against

- The human asked for a transparent first pass and explicitly accepted limiting supported paths. The plan exposes text capture and gives accurate queued/sent/error dialogs instead of adding speculative voice recording or reply reading.
- The human said locked boxes cannot be accessed through Siri. The intent checks `requiresDeviceUnlock` before writing and does not choose a different box as fallback.
- `ios-app/AGENTS.md` says quick chat is the native exception to the webview chat-send boundary and already calls `quickChat.submit` (§5.11). The plan uses that path rather than adding another HTTP endpoint or reusing Share Extension delivery.
- `beebox/docs/engineering-principles.md` principle 4 (“Resilient AND never silent”) informs explicit failure dialogs and diagnostics. `beebox/docs/design/trust.md` (“Trust to keep: nothing is thrown away”) informs durable enqueue before networking.
- The work introduces a shared input tag. It costs updates to readers and display parsing, but avoids misclassifying Siri captures as typed input and gives future Android or other assistant integrations the same origin vocabulary.

## What already exists

- `ios-app/BeeBox/Storage/QuickChatOutbox.swift:48-55` documents durable queueing, retries, and stable record IDs. `:105-153` loads and stores entries before requests. Reuse the persisted queue and ID semantics; split disk restore from launch draining so the intent can restore all entries but submit only its new entry.
- `ios-app/BeeBox/Storage/BoxScreenStore.swift:178-195` restores the outbox and drains it at launch; `:314-330` submits each entry through `QuickChatClient`. Reuse the submit contract and have one app-lifetime owner shared by RootView and the intent; do not create two outbox instances for the same file.
- `ios-app/BeeBox/Storage/PairedBoxStore.swift:14-39,216-247` loads paired boxes, restores credentials, exposes the selected box, and publishes the app-group snapshot. Reuse the main-app store as the single source of selection and credentials; the App Intent does not need a second box source.
- `ios-app/BeeBox/Storage/SharedSelectedBoxSnapshot.swift:8-29,52-59` publishes selected-box metadata for the Share Extension, including `requiresDeviceUnlock`. The App Intent is in the main app target, so it can use the main-app `PairedBoxStore` directly.
- `ios-app/BeeBox/Storage/PairedBoxCredentialStore.swift:28-49,61-80` reads and writes the per-box token in the shared Keychain access group. The existing `PairedBoxStore` restores it; do not copy credentials into the outbox or app-group snapshot.
- `ios-app/BeeBox/Services/QuickChatAPI.swift:22-31,46-50` builds bearer-authenticated `quickChat.submit` requests with a stable UUID and origin. Extend this quick-chat-only contract for source metadata.
- `ios-app/BeeBox/Models/NativeComposerContract.swift:21-25` and `ios-app/BeeBox/Views/ChatWebView.swift:6-10` define the webview bridge's `typed`/`voice` origin. Keep that bridge vocabulary unchanged; App Intent origin belongs to a separate quick-chat type.
- `ios-app/BeeBox/Services/BoxLockManager.swift:100-117` defines the app's locked-box state and biometric unlock flow. The intent must not invoke that UI; it must reject a box whose metadata requires unlock.
- `beebox/src/webapp/trpc/routers/quick-chat.ts:20-23,40-56` validates quick-chat input and delivers `<typed>` or `<speech>` wrappers from the stored origin. Extend the schema and delivery builder to preserve external source.
- `beebox/src/core/chat/routing/quick-chat-record.ts:22-44` defines persisted origins and backward-compatible defaults. Add `external` and optional `source` while keeping old records valid.
- Existing human-message recognition lives in `beebox/src/cli/lib/session-real-user.ts:17-24`; history backfill checks the tags in `beebox/src/core/chat/session/backfill.ts:16-53`; retro discovery delegates its count to `isRealUserMessage` at `beebox/src/core/retro/discovery/core.ts:85-89`. The note at `beebox/src/core/box/structure/defaults.ts:394-402` describes the retro rule and must stay accurate. Teach the actual classifier and backfill to recognize `<external-input>`.
- Display and transcript wrappers are stripped by `beebox/src/cli/lib/session-text.ts:38-68`, which `beebox/src/core/chat/transcript-render.ts` uses, and frontend `beebox/src/frontend/src/components/chat/message-parsing.ts:38-55`. Extend the actual stripper and renderer so the tag is never shown as message prose.
- `beebox/src/core/chat/session/prompts.ts:25-31,49-55` establishes voice-versus-typed reply behavior and describes `source="box-screen"`. Add a distinct external-input explanation that combines platform provenance with quick-chat semantics: the box chose the conversation, destination phrases are addressed to the box, no recording is attached, and the person may hear only Siri's short result, not the box reply.
- `beebox/src/webapp/routes/chat/helpers.ts:247-255`, `beebox/src/cli/lib/session-entry.ts:58-69`, and `beebox/src/frontend/src/components/chat/message-parsing.ts:173-183` inject or extract sender identity only for typed/speech wrappers. Add external-input to these readers so the sender remains visible and attributed.
- `beebox/src/webapp/routes/chat/user-message-sender.ts:26-34` applies sender attributes before persisting the user message. The wrapper recognizer must include `<external-input>` or a Siri message loses normal `user` and `user-email` metadata.
- `beebox/src/frontend/src/machines/chatMachine/chat-shared.ts:52-80` normalizes quick-chat wrapper attributes for optimistic-message comparison. Include the new wrapper so server-injected sender attributes do not leave an accepted message unmatched.
- `ios-app/BeeBox/BeeBoxApp.swift:4-15` owns app-lifetime state at the App boundary; `ios-app/BeeBox/Views/RootView.swift:4-16,161-170` currently creates the box-screen store inside the scene. Move quick-chat/outbox ownership to app lifetime and inject the same instance into RootView and App Intents.
- `beebox/docs/mobile-contract.md:1268-1305` documents quick-chat request shapes, stored origin, idempotency, and outbox semantics. Update §5.11 and its contract index for the new fields and caller.
- `ios-app/BeeBox.xcodeproj/project.pbxproj` manually lists app and test source membership. New Swift files must be added to each relevant group/build phase, then checked with `xcodebuild -list`.

## Prior art (external)

- **Adopted, Apple's App Intents:** App Intents expose app actions to Siri, Shortcuts, and system experiences; use an `AppShortcut` phrase and parameterized `AppIntent`. [AppIntent](https://developer.apple.com/documentation/AppIntents/AppIntent), [AppShortcut](https://developer.apple.com/documentation/appintents/appshortcut).
- **Adopted, App Intents dependency injection:** register the shared capture service through `AppDependencyManager` and resolve it with `@Dependency`; Apple says to register dependencies early because intents can run soon after app launch. [Creating your first app intent](https://developer.apple.com/documentation/appintents/creating-your-first-app-intent?changes=latest_major&language=objc_5).
- **Evaluated, execution mode:** `openAppWhenRun` is deprecated in current Apple documentation, which directs apps to `supportedModes`. Select the API available for the app's iOS 17 deployment floor and keep the UI closed. Confirm API availability in the installed Xcode during implementation. [openAppWhenRun](https://developer.apple.com/documentation/appintents/appintent/openappwhenrun?changes=_3).
- **Evaluated, invocation source:** Apple's documented App Intent protocol exposes system context, but the searched API references do not document a reliable Siri-versus-Shortcuts-versus-Action-Button caller field. Record `source: "apple-app-intents"` for this entry point instead of inferring a surface. [AppIntent](https://developer.apple.com/documentation/AppIntents/AppIntent), [AppShortcut](https://developer.apple.com/documentation/appintents/appshortcut).
- **Evaluated, Action Button:** Apple's documentation lists App Shortcuts as an Action Button action. It therefore shares this intent entry point and source value in the first slice. [App Intents overview](https://developer.apple.com/documentation/AppIntents?changes=l_8).

## Ontology

- **Quick chat outbox entry** (existing, `ios-app/BeeBox/Storage/QuickChatOutbox.swift:7-19`): one locally persisted message submission, identified by stable UUID and paired-box UUID; it is not a server chat record. It points to origin and source.
- **Quick-chat record** (existing, `beebox/src/core/chat/routing/quick-chat-record.ts:36-50`): the server's idempotent routing/delivery state for one submitted thought; identified by the same UUID as the outbox entry. It is not the delivered transcript entry.
- **Quick-chat origin** (existing on the server, `beebox/src/core/chat/routing/quick-chat-record.ts:22-24`; new distinct Swift type): how input reached quick chat: `typed`, `voice`, or `external`. It is not `NativeEmissionV2.Origin` and is not the platform name.
- **Source** (new): the platform integration that supplied external text, `apple-app-intents` for this slice. It is not a claim that the request came specifically from Siri voice, Shortcuts, or Action Button.
- **`<external-input>` wrapper** (new): the transcript marker for human-provided text supplied through an external assistant, with a `source` attribute. It is not speech audio and does not imply that the person can hear the assistant's reply.
- **Selected box** (existing, `ios-app/BeeBox/Storage/PairedBoxStore.swift:34-39`): the paired destination chosen in the app, with paired-box metadata and its credential restored by the main-app store. It is not a Siri-specific box picker or fallback.
- **Siri-eligible box** (derived): the selected paired box only when it exists and `requiresDeviceUnlock` is false. It is not another destination picker or an automatic fallback.

## Tracks / scope

### Track 1: Generic quick-chat origin and source contract

**What.** Add `external` to quick-chat origins and add a required, bounded `source` field to external submit input and persisted records. Carry both values through retries, choices, delivery, and transcript generation. Emit `<external-input source="apple-app-intents">…</external-input>` for external input; preserve existing typed and voice wrappers unchanged.

**Why this needs to change.** The existing origin enum has only `typed` and `voice` (`quick-chat-record.ts:22-24`), and the server maps every non-voice origin to `<typed>` (`quick-chat.ts:52-56`). Siri text is neither keyboard typing nor a recording.

**Direction.** Keep legacy requests valid: missing `origin` remains `typed`; missing `source` remains absent for old records. Require `source` for `external`; reject `source` for typed/voice inputs. Accept only source values supported by the server; the first is `apple-app-intents`. Persist source in the `QuickChatRecord` so retries and `chooseQuickChat` use the original attribution. Construct the external wrapper only from validated source values; encode user text with the existing send-message framing conventions. On Swift, define a quick-chat-specific origin enum and use it in `QuickChatOutboxEntry` and `QuickChatAPI`; do not add `external` to `NativeEmissionV2.Origin`, the webview bridge schema, or the composer emission parser. Keep `channel: "ios-native"` unchanged.

**Vocabulary lock-ins.** Quick-chat-only `origin: "external"`; `source: "apple-app-intents"`; `<external-input source="…">`.

**First implementation chunk.** Update the quick-chat zod inputs, record schema, submit/choose delivery arguments, wrapper construction, tests, and `mobile-contract.md` §5.11 fixtures. No open naming or compatibility decisions remain.

### Track 2: Treat external input as human text everywhere

**What.** Update backend classifiers, history backfill/discovery, sender-attribute injection and extraction, transcript cleaning, retro discovery, husk snippet extraction, accepted-message identity, and frontend message parsing/rendering. Add the prompt rule for external input.

**Why this needs to change.** Readers currently identify human chat by the two existing wrappers. If `<external-input>` is missed, a capture could disappear from chat history discovery or human-chat analysis, or its wrapper could leak into rendered text.

**Direction.** Centralize the accepted wrapper vocabulary in the narrowest existing shared parser helpers; use explicit tag matching rather than generic permissive XML scraping. `isRealUserMessage`, `backfill.ts`, history parsing, retro counts, review discovery, `injectUserAttr`, backend and frontend user-identity extraction, snippet cleanup, transcript rendering, accepted-message rendering, and frontend `stripUserDisplayTags` must all handle the new wrapper. Prompt text must say that this is text from an external assistant surface, has no recoverable recording, and does not imply that the person will hear the box reply. It must also preserve the existing quick-chat meaning that the thought was sent to the box and routed to a chat. Do not apply the “voice in implies voice out” rule to this wrapper.

**Vocabulary lock-ins.** `<external-input>` always denotes real human text; `source` is provenance metadata, not free-form prompt instructions.

**First implementation chunk.** Add parser/classifier doctests and representative frontend parsing tests with a realistic wrapper, then update all known readers and the system prompt. Tests must prove shell tags and attributes are removed from display while body text remains.

### Track 3: iOS text capture App Intent over the outbox

**What.** Add a discoverable App Intent with a text parameter and App Shortcut phrase. Run from the main app target in background mode without opening the UI. Resolve the selected box and its restored token from `PairedBoxStore`, reject unavailable/locked boxes, persist through the quick-chat outbox, and make a bounded quick-chat submit attempt.

**Why this needs to change.** The issue asks for hands-free capture; the existing native composer and box screen require visible UI. The human chose quick chat rather than Share Extension's exact-session send path.

**Direction.** Move quick-chat/outbox ownership from `RootView` to one application-lifetime `BoxScreenStore` created during `BeeBoxApp` initialization, register it and `PairedBoxStore` through `AppDependencyManager`, and inject the same `BoxScreenStore` into `RootView` and the intent. Split the outbox's restore-only operation from its launch-drain operation. The intent first restores disk state without attempts, refreshes `BoxScreenStore`'s paired-box list from `PairedBoxStore`, then checks the selected box's `requiresDeviceUnlock` flag before using its credential or making a request. It targets only that eligible box and the newly added entry. This prevents an empty in-memory outbox from overwriting previously queued thoughts and avoids sending unrelated entries from other boxes. Change the submit boundary to return the `QuickChatView` to the intent. Persist quick-chat-specific `origin: .external` and `source: "apple-app-intents"` with the stable outbox ID. Attempt `quickChat.submit` with a deadline safely below the system intent budget. Return “Sent to [box]” only for a server `sent` state. On timeout, say the thought is saved and delivery is unconfirmed; on `needs-choice`, say a destination choice is needed in the app. Return an error dialog if eligibility or persistence fails. Never trigger `BoxLockManager` authentication UI.

The first slice supports text supplied by the Siri App Shortcut or a user-built Shortcut. It does not promise to distinguish Siri voice, Shortcuts, Spotlight, or Action Button invocation; Apple does not document a reliable caller identifier for this App Intent surface. Action Button assignment may run the same App Shortcut and therefore uses the same source. Do not add voice recording, entity-based box selection, or answer readback.

**Vocabulary lock-ins.** Intent action “Add a thought to my box”; quick-chat-only origin `.external`; source `apple-app-intents`; one selected box; no fallback; one application-lifetime store; restore before write; durable local queue before networking.

**First implementation chunk.** Move `BoxScreenStore` ownership to `BeeBoxApp`, register it and `PairedBoxStore` as app dependencies, and inject the same store into RootView and the intent. Split outbox restore from draining, return the server view from targeted submission, and test a pre-existing queued entry surviving a cold intent invocation. Add the App Intent and provider to the main app target, then test selected/no box, unlock-required box, persistence failure, successful server state, offline queue, unresolved routing, timeout wording, sender attribution, and retry metadata. Add BoxLog transitions at refusal, restore/persist, request deadline, and server-result boundaries; never log message text or credentials. No open product question remains. Validate background process availability and the real spoken result on device in manual testing.

## Could this be simpler?

The simplest version is a single App Intent that submits directly to `quickChat.submit` and reports its HTTP result. It is smaller, but loses thoughts when the request fails, which conflicts with the user's hands-free capture goal and `beebox/docs/design/trust.md`'s rule that nothing is thrown away. The fuller version reuses the existing durable outbox and its stable IDs; it adds source metadata and reader updates because engineering principle 4 (“Resilient AND never silent”) and the existing real-user classifiers require honest attribution and visibility. A new share extension, new server endpoint, background daemon, reply-reading flow, or generalized source registry buys nothing for this first use and is excluded.

## Subplans

None. The remaining API availability and real-device behavior are verification items, not product choices that block implementation.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Selected box is absent or has no eligible destination | Intent coordinator unit test | Refuse before creating an entry; name pairing or unlock action | Clear spoken refusal |
| Selected box requires device unlock | Eligibility unit test | Refuse before using its credential or making a request; no persistence and no fallback | Clear spoken refusal |
| Keychain token is unavailable after reboot or has been removed | Credential/coordinator test | Do not claim sent; explain that the box cannot be reached. Preserve the thought only if it was safely persisted for an eligible box | Clear result; queued record remains visible on next app launch if stored |
| Outbox persistence fails | Repository failure test | Do not make the network request; report not saved | Clear spoken failure |
| App Intent and app UI submit concurrently | Shared coordinator/outbox concurrency test | One app-lifetime outbox owns in-memory state; per-entry in-flight protection and server UUID idempotency prevent duplicate delivery | No duplicate message; unexpected conflict is returned as an error |
| Request outlasts Siri's execution window | Bounded transport test and device timing check | Persist first; cancel the local attempt at the deadline; normal app launch/foreground retry uses the same ID | Says saved and delivery unconfirmed, not definitely waiting or sent |
| Server accepts request but response is lost | Retry/idempotency doctest and outbox test | Retry the same UUID; server returns the existing record and does not deliver a second message | Queue stays visible until a successful response |
| Server returns `needs-choice` | Intent result mapping test | Keep the server quick-chat record and direct the person to the app | Clear; does not call it delivered to chat |
| External wrapper is missed by a real-user/history reader | Focused classifier/backfill/retro doctests | Update each known reader and shared wrapper parser | Tests fail rather than silently excluding the session |
| Wrapper or source appears in message prose | Frontend and transcript-render tests | Strip wrapper shell and retain body | Tests fail visibly |
| Source is malformed or caller supplies a fabricated source | tRPC validation test | Accept only the enumerated external source for this client contract | Clear request validation error |

**Risk to validate:** Apple controls intent execution duration and process startup. The local outbox makes persistence independent of network completion, but a simulator cannot establish lock-screen Siri behavior or real-device execution timing.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** Quick-chat origin means `typed`, `voice`, or `external`; source means platform integration. Neither changes `NativeEmissionV2.Origin`, which remains `typed` or `voice`. The track contract and tests keep these distinct.
- **Stale ref — ADDRESSED.** There is no content ref. `boxID` and stable message UUID identify the destination and submission; a missing/unpaired destination fails instead of redirecting.
- **Two agents touching the same card — ADDRESSED.** No card is written directly by this feature. Existing quick-chat locking and send-message IDs govern server routing/delivery (`quick-chat-submit/submit.ts:201-211`; mobile contract §5.11).
- **Hand-edit drift — ADDRESSED.** The server validates origin/source; transcript wrappers are system-built from validated values. Users do not author the tag.
- **Fabricated free-form value — ADDRESSED.** `source` is a closed enum in the tRPC boundary, not copied as free-form markup.
- **Validation error UX — ADDRESSED.** A missing/invalid text or server rejection becomes an explicit Siri result; no success dialog is returned.
- **Partial migration / transition state — ADDRESSED.** Existing outbox entries decode with their current typed default; existing quick-chat records and clients keep `origin: typed` defaults and `source` remains optional for those records. Existing transcript tags remain supported. The new Swift quick-chat origin enum preserves the existing encoded strings; the webview bridge enum remains typed/voice only.
- **Cold intent with old unsent entries — ADDRESSED.** The app-lifetime outbox restores without draining, before the new entry is appended; a test keeps older queued entries intact and verifies only the selected new entry is submitted.
- **Sender attribution — ADDRESSED.** Server sender injection and transcript identity readers recognize the new wrapper, preserving `user` and `user-email` attributes.
- **Multi-box selection — ADDRESSED.** Use exactly the currently selected `PairedBox`; no prompt or fallback to another paired box. A requires-unlock selection is unavailable through Siri.
- **Unknown invocation surface — ADDRESSED.** Use source `apple-app-intents`; do not infer an exact entry surface from App Intents system context.
- **Reply timing — ADDRESSED.** This is capture-only. The user is told the local/server capture state; the intent does not wait for or speak the agent response.

## NOT in scope

- Voice memo recording or audio upload: microphone behavior from App Intents is unresearched and not needed for text capture.
- Reading a chat answer aloud: response routing and Siri's execution budget need a separate design.
- App Entity box picker or asking the user to choose among boxes: the first slice follows the in-app selected box.
- Exact source labels for Siri voice, Shortcuts, Spotlight, or Action Button: no reliable caller identity is documented for a shared intent.
- Android capture or Android device-lock parity: separate platform issue `issues/features/2026-07-20-android-per-box-device-lock-parity.md`.
- Share Extension send-path changes: the App Intent uses quick chat by human decision.
- New endpoint or background daemon: existing quick-chat tRPC and outbox are sufficient.
- Merging to `main`, release, or deployment: this plan is worktree-only until separately requested.

## Open design questions

None. During implementation, verify `supportedModes` availability for the iOS 17 deployment target and select the compatible background/no-foreground API. The initial source is fixed as `apple-app-intents`; the intent does not claim a more specific surface.

## Knowledge audits

Add a `knows_directly` audit for the new `<external-input source="…">` wrapper. It should test that an agent recognizes the message as real human text from an external assistant, does not invent an audio recording, does not assume its reply will be heard, and does not apply voice-in-implies-voice-out. Run the audit against the test box as part of implementation and record its status. This new prompt vocabulary changes agent-facing interpretation, so a knowledge audit is required.

## What will hold this after it ships

- `pnpm test:changed` in `beebox/` reaches the quick-chat schema/submit flow, wrapper handling, human-message detection, history/backfill, transcript rendering, and prompt-related doctests selected by the changed files.
- Shared quick-chat request/record fixtures are parsed by the existing TypeScript contract doctest and `ios-app/BeeBoxTests/QuickChatAPITests.swift`; add an external-origin/source fixture and malformed-source case.
- iOS unit tests cover eligibility, persistence-before-send, result wording, request identity, and retry metadata. Run the signing-free simulator build and XCTest commands in `ios-app/AGENTS.md`; build/test commands remain under the human's authorized verification scope when the plan is implemented.
- `pnpm mobile-contract-check` enforces that mobile contract docs are co-staged with anchored Swift/backend files; the quick-chat fixture doctest and XCTest validate the actual wire shapes.
- The knowledge audit checks agent interpretation of the wrapper and response expectation.
- Native `BoxLog` transitions cover eligibility refusal, restore/persist failure, request deadline, and server result, with box ID and bounded status metadata only. An intent may run before `LogForwarder` has a selected box; logs can forward after the app next becomes active. Never log input text or credentials.
- Real Siri phrase matching, background launch, locked-device behavior, and Action Button assignment require a physical iPhone and remain manual checks.

## Implementation order

1. **Server contract and fixtures.** Add `external`/`source` to quick-chat input and persisted records, preserve both through retries/choices, build the new wrapper, and update contract fixtures/docs. Commit this as one server-contract checkpoint.
2. **Reader and prompt support.** Update backend human-message recognition, history/backfill, retro/review classifiers, `injectUserAttr`, backend/frontend identity extraction, transcript/snippet stripping, frontend wrapper parsing, and prompt semantics. Preserve quick-chat's box-routing meaning alongside the new platform source. Add focused tests and the knowledge audit. Commit after the selected beebox tests pass.
3. **iOS outbox and intent.** Introduce a quick-chat-specific origin enum without widening the composer bridge; add source to `QuickChatOutboxEntry` with backward-compatible decoding; split outbox restore from launch drain; move `BoxScreenStore` to app lifetime and inject the same instance in RootView and App Intents; extend `QuickChatAPI`; add the App Intent/App Shortcuts provider in the main app target; gate `requiresDeviceUnlock`; use a bounded request and honest spoken result. Add project membership, targeted submit result mapping, metadata-only runtime logs, and iOS tests. Commit after build and XCTest pass.
4. **Contract and manual-test reconciliation.** Update `mobile-contract.md` §5.11 and its contract index, issue status and device test script, then run changed tests, typecheck/lint as required by hooks, the mobile-contract co-staging check, and the simulator build/test. Get cross-model plan review before declaring the plan ready; implementation requires its own review when carried out.

## Rollout shape

This is additive and needs no migration of old outbox entries or quick-chat records. Missing origin continues to mean `typed`; missing source is valid only for legacy typed/voice records. Existing `<typed>` and `<speech>` transcript records remain valid. The new wrapper is emitted only after server validation and is understood by every updated reader. The new origin lives only in quick chat; the `NativeEmissionV2` bridge continues to accept `typed` and `voice`.

Done when: quick-chat fixtures prove backward compatibility and external source persistence; focused doctests prove every reader treats the wrapper as human input and strips it from display; `pnpm test:changed` passes in `beebox/`; iOS simulator build and XCTest pass; `pnpm mobile-contract-check` passes; the knowledge audit passes; cross-model review findings are adjudicated; and the issue has `needs: [manual-testing]` with steps to try Siri text capture, a Shortcut with supplied text, Action Button assignment if available, no paired box, locked-required box, offline queue, and later retry. The manual test must confirm the selected box receives the thought once, queue wording is accurate, locked-required boxes create no outbox entry, and unsupported inputs do not report success.
