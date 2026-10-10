# Plan Engineering Review — iOS App Intent capture

Independent review: Claude Fable, plan review rounds 1–3, 2026-10-09. The reviewer checked the plan against its cited Swift/TypeScript sources and traced a cold Siri invocation plus wrapper delivery. Round 1 identified eight findings; rounds 2–3 verified their fixes. No findings remain.

## What already exists

- The iOS app already has a durable, idempotent quick-chat outbox and a main-app quick-chat client. The plan reuses them and adds origin/source fields.
- The server already stores quick-chat routing records and emits typed/speech transcript wrappers. The plan adds one external-input wrapper and updates its readers.
- The outbox is currently restored and drained together by `QuickChatOutbox.load()`. The plan explicitly separates restore from drain and requires one app-lifetime store shared by RootView and the intent.

## Ontology (verified against the code's own names)

`QuickChatOutboxEntry`, `QuickChatRecord`, `PairedBox`, and `NativeEmissionV2.Origin` are existing code names. The plan separates quick-chat origin from the composer bridge enum and defines `source` as platform provenance. `<external-input>` is a new human-message wrapper.

## Prior art (external) — verified

- Apple documents App Intents for Siri, Shortcuts, and other system experiences; App Shortcuts provide phrases and parameters: [AppIntent](https://developer.apple.com/documentation/AppIntents/AppIntent), [AppShortcut](https://developer.apple.com/documentation/appintents/appshortcut).
- Apple documents `AppDependencyManager`/`@Dependency` for intent dependencies and advises early registration: [Creating your first app intent](https://developer.apple.com/documentation/appintents/creating-your-first-app-intent?changes=latest_major&language=objc_5).
- Current Apple documentation deprecates `openAppWhenRun` in favor of `supportedModes`; the plan leaves the deployment-floor availability check to implementation: [openAppWhenRun](https://developer.apple.com/documentation/appintents/appintent/openappwhenrun?changes=_3).
- The reviewed API references do not establish a reliable caller identity for Siri vs. Shortcuts vs. Action Button. The plan records `apple-app-intents` for this shared entry point.

## Stated preferences this plan trades against

The plan follows the human's selected quick-chat path instead of the issue's Share Extension send proposal. It rejects `requiresDeviceUnlock` boxes without falling back. It keeps the first slice text-only, reports local persistence separately from server acceptance, and uses a generic external origin with platform source metadata.

## Could this be simpler? (verified)

The direct-submit App Intent is the smallest version, but it can lose a thought when networking fails. Reusing the outbox is the smallest approach that keeps a durable local copy and stable retry ID. The source field and reader updates are required to preserve attribution and render the new wrapper as human text.

## Failure modes

The first review found a real cold-start data-loss path: an un-restored outbox's `store()` could write its empty in-memory list over earlier entries. The plan now requires an app-lifetime shared owner, restore without drain, targeted submission of the new entry, and a regression test that preserves old queued entries. It also covers locked/missing boxes, persistence failure, timeout ambiguity, server idempotency, routing choice, malformed source, sender identity, and wrapper stripping.

## Agent-flow / user-flow edge cases

The review traced a Siri message through `quickChat.submit`, record persistence, sender-attribute injection, transcript output, identity extraction, and rendering. The plan requires the external prompt to preserve quick-chat semantics: the person addressed the box, the box chose the chat, and destination phrases are not requests to the current chat. It also states that no recording exists and the person may hear only Siri's short result.

## Findings

### 1. Cold intent could overwrite old queued thoughts

**Location in plan:** Tracks 3, paragraphs “Direction” and “First implementation chunk”; `beebox/docs/plans/ios-app-intent-capture.md:145-151`.

**Citation:** “Split the outbox's restore-only operation from its launch-drain operation.”

**Issue:** `QuickChatOutbox.load()` both restores and attempts every entry; `store()` persists the in-memory array. A cold intent that writes before restore could erase prior offline captures.

**Why it matters:** The feature's core promise is that a hands-free thought survives a failed request.

**Suggested action:** Use one application-lifetime store, restore before writing, keep launch drain separate, and test a cold invocation with a prior unsent entry. **Adjudication:** Included and verified in rounds 2–3.

### 2. RootView and intent could own separate outboxes

**Location in plan:** Track 3, Direction; `beebox/docs/plans/ios-app-intent-capture.md:145`.

**Citation:** “inject the same `BoxScreenStore` into `RootView` and the intent.”

**Issue:** RootView currently creates its own box-screen store, and its lifecycle methods run from a scene. A second instance would race over the same outbox file.

**Why it matters:** Two in-memory queues can overwrite each other's state or submit stale entries.

**Suggested action:** Move ownership to app lifetime and inject one instance in both paths. **Adjudication:** Included and verified.

### 3. External wrapper could lose sender identity

**Location in plan:** Tracks 2 and 3; `beebox/docs/plans/ios-app-intent-capture.md:88-90,133,151`.

**Citation:** “The wrapper recognizer must include `<external-input>` or a Siri message loses normal `user` and `user-email` metadata.”

**Issue:** Sender injection and extraction currently recognize only typed/speech wrappers.

**Why it matters:** The message can appear without a sender, or be attributed inconsistently between transcript and frontend.

**Suggested action:** Update server injection, CLI/frontend identity extraction, and comparison normalization with tests. **Adjudication:** Included and verified.

### 4. `source` needed to preserve quick-chat meaning

**Location in plan:** Design walkthrough and Track 2 Direction; `beebox/docs/plans/ios-app-intent-capture.md:57,87,133`.

**Citation:** “the box chose the conversation, and a destination phrase is addressed to the box rather than the current chat.”

**Issue:** Existing `source="box-screen"` also tells the agent that the thought went to the box and might not be viewed in the current chat. The external wrapper uses source for platform provenance.

**Why it matters:** The agent could mistake a box-level thought for a request addressed to the selected chat.

**Suggested action:** State the quick-chat semantics explicitly in the external-input prompt paragraph while using the platform source. **Adjudication:** Included and verified.

### 5. Timeout result could claim a false delivery state

**Location in plan:** Design failures and Track 3 Direction; `beebox/docs/plans/ios-app-intent-capture.md:48-50,145,170`.

**Citation:** “Bee Box could not confirm delivery.”

**Issue:** Cancelling the client request does not prove the server did not accept the message.

**Why it matters:** Saying “waiting to send” could be false after server acceptance.

**Suggested action:** Report local save and unconfirmed delivery, then retry with the same idempotency key. **Adjudication:** Included and verified.

### 6. Selection must have one source

**Location in plan:** Track 3 Direction and multi-box edge case; `beebox/docs/plans/ios-app-intent-capture.md:141,145,190`.

**Citation:** “Resolve the selected box and its restored token from `PairedBoxStore`.”

**Issue:** The first draft mixed app-group snapshot selection with `PairedBoxStore` credentials. That would allow stale selection metadata.

**Why it matters:** The intent could send a thought to a box other than the one the app currently selects.

**Suggested action:** Use the main-app `PairedBoxStore` for selection and credentials; treat the app-group snapshot as Share Extension support only. **Adjudication:** Corrected after round 2; round 3 verified the track, ontology, and edge-case row.

### 7. Native runtime diagnostics were missing

**Location in plan:** Track 3 and “What will hold this after it ships”; `beebox/docs/plans/ios-app-intent-capture.md:151,220`.

**Citation:** “Add BoxLog transitions at refusal, restore/persist, request deadline, and server-result boundaries.”

**Issue:** A background intent adds state transitions that need diagnosis after the phone leaves Xcode.

**Why it matters:** The shared log forwarder may only upload once the app becomes active.

**Suggested action:** Add metadata-only BoxLog entries, never log input text or credentials, and document delayed forwarding. **Adjudication:** Included and verified.

### 8. Citation, principle, and check scope errors

**Location in plan:** “Stated preferences,” “What already exists,” and “What will hold this”; `beebox/docs/plans/ios-app-intent-capture.md:70,85-86,218`.

**Citation:** “`pnpm mobile-contract-check` enforces that mobile contract docs are co-staged with anchored Swift/backend files.”

**Issue:** The first draft misnumbered “nothing disappears,” used comments/consumers as implementation citations, and described the mobile-contract check as validating wire shapes.

**Why it matters:** A six-month reader could rely on false process and implementation claims.

**Suggested action:** Attribute nothing-disappears to trust design, cite implementation sites, and state that fixtures/tests verify wire shapes while the script checks co-staging. **Adjudication:** Corrected and verified in rounds 2–3; reader citations now point to `isRealUserMessage`, backfill, its retro caller, and `stripSpeechWrappers`.

## NOT in scope (verified)

Voice memo capture, reply readback, entity-based box selection, exact invocation-surface labels, Android implementation, Share Extension changes, new endpoint/daemon, and landing/deployment are explicitly deferred.

## Things I checked and found clean

- Human decisions override the issue's direct-session proposal and optional App Entity idea.
- Existing typed/voice quick-chat clients and records retain backward-compatible defaults.
- The new quick-chat origin does not widen `NativeEmissionV2.Origin` or the webview bridge.
- Locked-required boxes are refused without attempting app authentication or selecting a fallback.
- Timeout wording remains honest about possible server acceptance.
- The final selection source, wrapper readers, and no-text behavior were checked in the final verification round. No named issue remains.
