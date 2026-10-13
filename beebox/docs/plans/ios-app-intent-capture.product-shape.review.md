# Plan Engineering Review — iOS capture and accompanying context

This review reassesses the text-only plan against the subsequent human requirements. It is a product and plan review, not an implementation plan. The current plan needs revision before implementation.

Independent review: `claude fable`, product and plan review, 2026-10-12. The reviewer traced hands-free text and a screenshot with commentary followed by a later instruction. Its findings were checked against the cited source. Adjudication appears below; its recommendations are evidence for product decisions, not authorization to implement them.

The decisive human requirements are: “I have no opinion on the shortcut or the techniques available on ios, I just want the behavior,” “There's also some questions about what box it goes to,” and “I have a screenshot, but the screenshot isn't the entirety, I have to say what to do with it. That should be possible, or a followup, or something.” These outrank the current plan's text-only boundary.

## What already exists

- The App Intent receives text and selects a paired box: `@Parameter(title: "Thought") var thought: String` and `guard let box = pairedBoxStore.selectedBox` (`ios-app/BeeBox/Intents/CaptureThoughtIntent.swift:12,23`).
- Box selection has a fallback: `return boxes.first { $0.id == selectedBoxID } ?? boxes.first` (`ios-app/BeeBox/Storage/PairedBoxStore.swift:34-38`). `select` saves the browsed selection (`:164-167`).
- The quick-chat outbox pins entries to a box but stores text only: `var boxID: UUID` and `var text: String` (`ios-app/BeeBox/Storage/QuickChatOutbox.swift:13-19`).
- External text capture persists, then waits for a submission attempt: `await outbox.retry(id: entry.id)` before returning its result (`ios-app/BeeBox/Storage/BoxScreenStore.swift:193-204`). The request uses `timeoutInterval: origin == .external ? 20 : 60` (`ios-app/BeeBox/Services/QuickChatAPI.swift:60-65`).
- The share extension only loads one URL or plain-text item. Its fallback says “This version can share a web link or text” (`ios-app/BeeBoxShareExtension/ShareViewController.swift:170-195,216-217`). Its model is `SharedTextualItem`, whose kind is `url` or `text` (`ios-app/BeeBoxShareExtension/ShareExtensionAPI.swift:36-44`).
- Sharing sends `message: item.value` to a selected chat, or saves the textual item to a selected destination (`ios-app/BeeBoxShareExtension/ShareExtensionAPI.swift:77-83,96-128`). The backend `saveTextualInput` accepts only `kind: "url"` or `kind: "text"` (`beebox/src/webapp/trpc/routers/share/contract.ts:33-35`). Neither shape carries accompanying instructions or an image.
- The share extension already offers authentication for a protected box: `context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock … before sharing.")` (`ios-app/BeeBoxShareExtension/ShareViewController.swift:144-165`). The human's Siri refusal rule does not authorize removing this visible authenticated path.
- Existing capture staging is another seam to assess, not a free replacement: the routes stage files and finalize a session (`beebox/src/webapp/routes/capture/register.ts:2-6,160-162,203-212`), while the native API exposes session creation, upload, and finalize (`ios-app/BeeBox/Services/CaptureAPI.swift:172-225,251-252`). A revised plan must trace whether those lifecycle semantics fit one shared image with commentary.
- The server refuses an amendment submitted under the same quick-chat ID: `if (previous.message !== input.message) throw new QuickChatTextConflictError()` (`beebox/src/core/chat/routing/quick-chat-submit/submit.ts:207`). Adding context must not be modeled as resubmitting different text under the old ID.
- All external text is currently described to the agent as “real human input addressed to the box as a whole” (`beebox/src/core/chat/session/prompts.ts:55`). This assumption needs review when a Shortcut supplies a clipping rather than the person's words.

## Ontology (verified against the code's own names)

- **Capture**, in this product discussion, means one accepted contribution: supplied words, material, or material with accompanying words. This does not prescribe a new card type or replace the existing capture-session vocabulary.
- **Destination box** identifies the owner of that contribution. It is distinct from the conversation chosen inside the box and from the box currently browsed in the app.
- **Accompanying words** are the person's commentary or instruction about material. They must remain distinguishable from the material's own content.
- **Capture acknowledgment** reports durable acceptance. It is distinct from routing, queued chat delivery, and completion of an agent task.
- **Follow-up context** is a later contribution explicitly associated with the original material and its owning box. It is not a guess that the latest item in the currently browsed box is the target.
- Existing `QuickChatOutboxEntry`, `QuickChatView`, and `SharedTextualItem` solve parts of this problem. None of them alone represents the whole proposed product shape.

## Prior art (external) — verified

This review makes no new Apple API claims and does not repeat the previous API research. Platform details remain implementation choices to verify after the behavior is settled. The existing citations do not justify reducing the motivation to whichever behavior the current App Shortcut happens to expose.

## Stated preferences this plan trades against

- The human cares about the experience, not the Shortcut or particular iOS technique. Product situations should describe the moment and desired outcome before naming a mechanism.
- The human requires a way to supply instructions with shared material, or a dependable follow-up. Same-submission commentary and later contextual follow-up are alternatives to assess, not two features already mandated.
- Siri must refuse a box marked `requiresDeviceUnlock`. This is an entry-point-specific access rule; it must not become a blanket prohibition on authenticated in-app sharing.
- `beebox/docs/design/trust.md:56-61` says “Quick chat is a compromise, not a pattern to copy” and that “capture must cost nothing in the moment.” Existing quick-chat dispatch is not sufficient justification for making every captured object trigger agent activity.

## Could this be simpler? (verified)

The existing text intent can remain a bounded repair, but completing it cannot satisfy the screenshot requirement. The smallest broader contribution to build first is one shared image with optional commentary accepted together into a visibly chosen box. This can satisfy “the share isn't enough context” without inventing conversational resolution of “that screenshot.” A later explicit Add context action on the saved item is a possible recovery path. Unqualified hands-free references to recent captures should wait until the association rules can be made honest.

## Failure modes

| Failure | Consequence | Required product decision or plan remedy |
|---|---|---|
| Material is accepted but its accompanying instruction is lost | The box receives a different contribution from the one the person sent | Persist the combined contribution before acknowledgment; define partial-upload recovery |
| The instruction is dispatched before the material is available | An agent guesses what the person meant or acts without the referenced source | Gate task dispatch on availability of the complete input |
| Browsing or a stale selection changes the target box | Content reaches the wrong owner | Resolve the target explicitly and pin it through acceptance, retry, and follow-up |
| A later instruction attaches to the newest capture after another arrival | The wrong screenshot receives the task | Use an explicit original-item association; ask rather than infer if the reference is ambiguous |
| A local receipt returns before a reliable recovery path exists | The thought is kept on the phone but never reaches the box | Plan local durability and delivery recovery together; do not use an unowned background task |
| Empty commentary causes the box to infer an unwanted task | “Keep this” becomes authorization to act | Define default behavior for material without an instruction |
| A device repair checklist substitutes for experience acceptance | Technical checks pass while capture remains awkward or slow | Separate phone-only scenarios from diagnostic instructions |

## Agent-flow / user-flow edge cases

For a screenshot plus “compare these prices,” the current share loader rejects the image before a destination can be submitted. Even if the loader accepted it, the current textual API has no field for the image and its accompanying instruction. The plan cannot solve this by rewording Siri dialogs.

For a later explanation after another capture or a box switch, the current interfaces carry an operation/message ID for deduplication, but no contextual follow-up request pointing to the original material. The next plan must choose a durable existing identifier or introduce a narrowly defined reference; it must not rely on a global “latest capture.”

For hands-free text, the existing intent can preserve the supplied text and box ID, but its result waits for networking and its acquisition interaction depends on the invocation surface. A speech prompt and an Action Button's actual input interaction require separate acceptance scenarios.

## Findings

### 1. The plan's completion condition no longer covers the requested behavior

**Location in plan:** Introduction, NOT in scope, and rollout shape.

**Citation:** “this plan does not settle … share-sheet, or media capture” (`ios-app-intent-capture.md:14`).

**Issue:** The plan explicitly excludes the human's screenshot-with-instructions scenario and defines success as repairing the current text action.

**Why it matters:** The work could finish successfully under the plan while leaving the new requirement impossible.

**Suggested action:** Revise the product scenarios and implementation boundary. Keep the small intent repair as a prerequisite or separate bounded chunk. Re-estimate after walking the image/commentary path; the old source-line estimate is not an estimate for the broader work.

### 2. The destination policy is unresolved and the no-fallback claim is false

**Location in plan:** Situations and stale-box edge case.

**Citation:** “It does not fall back to another paired box” (`ios-app-intent-capture.md:173`), but `selectedBox` uses `?? boxes.first` (`PairedBoxStore.swift:38`).

**Issue:** The plan binds capture to browsing selection and overlooks its fallback. The discussion's independent capture default is still a proposal.

**Why it matters:** A box switch, stale selection, or removed default can send content to an unintended box.

**Suggested action:** Decide the target policy before adding inputs. Recommended: automatic selection with one paired box; an explicit capture default with several; optional fixed Shortcut targets; a visible share-sheet override. Pin the chosen box at acceptance. An unavailable explicit/default target must refuse rather than substitute. Do not silently skip protected boxes while choosing a default.

### 3. Material and instructions need one acceptance boundary

**Location in plan:** Ontology, tracks, and media exclusions.

**Citation:** The current model has `var value: String` (`ShareExtensionAPI.swift:43`) and sends `message: item.value` (`:79`).

**Issue:** The plan has no representation or lifecycle for one image accompanied by instructions.

**Why it matters:** Independent sends can separate the instruction from its source, especially with partial network failure or concurrency.

**Suggested action:** Define the complete submitted unit at the product level, then trace existing attachment/capture seams. Preserve the human's words, original material, and box association together; acknowledge only once the promised unit is durable. This is a contract and persistence design decision, not a text-input patch.

### 4. Follow-up requires identity and a policy for work already started

**Location in plan:** Missing scenario in Design and failure modes.

**Citation:** The outbox has `id`, `boxID`, and `text`, but no original-material reference (`QuickChatOutbox.swift:13-28`).

**Issue:** “For that screenshot” is ambiguous after another capture, another device's arrival, or a box switch. Later context can also arrive after the box has acted on its initial interpretation.

**Why it matters:** The box can perform the wrong task on the wrong material without an obvious error.

**Suggested action:** Prefer commentary before sending as the first supported scenario. If later context is included, use an explicit Add context action from the saved item's receipt/recent entry. Keep the original capture and append the later instruction as a new associated contribution. Do not promise that a late explanation can undo work already performed.

### 5. Durable acceptance is coupled to routing and networking

**Location in plan:** Walkthrough and result handling.

**Citation:** `await outbox.retry(id: entry.id)` precedes the result (`BoxScreenStore.swift:200-204`); the external request timeout is 20 seconds (`QuickChatAPI.swift:65`).

**Issue:** The plan specifies truthful states but does not define how quickly the person can leave or how delivery proceeds afterward.

**Why it matters:** A thought can be safely stored while the capture still feels stalled. Returning sooner without a durable recovery owner would create a different failure.

**Suggested action:** Define acknowledgment at durable acceptance, separate from routing and task completion. Use clear local-versus-box receipt wording. Design recovery before promising asynchronous completion, with attachment bytes and commentary both included in the durability claim.

### 6. Keeping material and instructing an agent are different meanings

**Location in plan:** Trust and reuse of quick chat.

**Citation:** The repo says “Quick chat is a compromise, not a pattern to copy” (`beebox/docs/design/trust.md:56`).

**Issue:** The plan reuses automatic quick-chat dispatch without defining what a bare screenshot, a passing observation, or a specific instruction authorizes.

**Why it matters:** The box can guess a task when the person intended preservation, or wait for context when the person explicitly delegated work.

**Suggested action:** Define behavior from the contribution: explicit instructions can initiate the requested work; material without instructions is kept and may be prepared for later use, without inventing a consequential task. Decide what default processing is acceptable before selecting delivery machinery.

### 7. Entry-point acquisition and phone acceptance are underspecified

**Location in plan:** Action Button situation and phone checklist.

**Citation:** “the same text parameter flow” (`ios-app-intent-capture.md:224`) and “Connect the iPhone to the Mac and open Console.app” (`:220`).

**Issue:** The plan neither specifies what pressing the button does to acquire speech nor provides a normal phone-only acceptance experience.

**Why it matters:** The person can technically invoke the same intent while still having to tap or type through several steps.

**Suggested action:** Give each surface its own start/input/finish/receipt scenario. Put Console diagnostics in an appendix used after a failure. Shared storage and delivery can coexist with different interactions.

### 8. Text can be material too

**Location in plan:** Shortcut-supplied text situation and external-input ontology.

**Citation:** The prompt labels external input “real human input addressed to the box as a whole” (`beebox/src/core/chat/session/prompts.ts:55`).

**Issue:** A Shortcut can supply clipboard contents or an extracted paragraph. That is source material, while a dictated thought or “compare these prices” is the person's contribution about it. The current shape flattens both into addressed human text.

**Why it matters:** The box can treat words copied from elsewhere as the person's instruction, or lose the explanation of why they were supplied.

**Suggested action:** Keep supplied material distinct from accompanying words even when both are strings. Define the user-visible action accordingly. This is a shared-contract and prompt-semantics decision; input type alone does not establish intent.

## NOT in scope (verified)

This review does not choose Apple APIs, implement a new capture model, or treat the proposed destination/default policy as already authorized. It does not require arbitrary files, video, voice recordings, multiple simultaneous attachments, or a universal contextual-reference resolver. It identifies what the next plan must settle.

## Things I checked and found clean

- The existing intent and outbox preserve text before attempting its network delivery; that ordering remains useful.
- Stable box IDs in stored outbox entries are useful for pinned delivery. The problem is how the target is chosen before the entry is stored.
- The existing share picker already makes the destination visible and permits explicit box selection; a revised design can retain that affordance.
- Existing authenticated sharing and Siri's protected-box refusal can remain different policies under one product shape.

## Recommended product shape and phone acceptance

The product should accept a contribution into a predictable box and acknowledge that it is durably kept. The input can be spoken words or one shared image with optional accompanying words. It should preserve these parts as one contribution without making every acquisition surface behave the same way.

The recommended minimum first share scenario is: share one screenshot, see the target box, optionally type or dictate what to do with it, submit once, receive a truthful receipt, and later see that screenshot and the person's words together. This satisfies the human requirement without depending on later conversational reference resolution. Explicit later Add context is a possible second scenario; it must retain the original target even after another capture or a box switch.

The next plan's phone-only list should include:

1. Speak a passing thought hands-free; receive a short persistence acknowledgment without needing to choose a conversation.
2. Press the capture button, speak, and finish without another screen interaction; record any unavoidable system prompt as a product limitation.
3. Share a screenshot with “compare these prices”; find the same screenshot and instruction together in the selected box.
4. Share a screenshot without commentary; confirm that it is kept without an invented task. If later Add context is in scope, add an instruction after another capture and a box switch; confirm the correct original receives it.
5. Browse a different box and capture again; verify the chosen destination policy. Override the target explicitly in the share picker or a fixed Shortcut and verify the receipt names the actual box.
6. Capture while offline; confirm the complete promised input survives dismissal and app restart and that delivery recovery is visible and reliable.
7. Verify that Siri refuses a protected target while an explicitly authenticated share follows the existing protected-box access policy.

Unresolved product decisions are the default box policy, whether later Add context is part of the first release, what processing a bare material capture authorizes, and the completion/recovery promise. They should be settled in the revised plan before implementation.

Offline image acceptance is not assumed here. The next plan must choose either durable local acceptance of image and commentary together, or a visible failure/pending share with no success receipt until the server accepts the complete input. A text outbox must not be presented as an image recovery mechanism.

## Cross-model adjudication

- **Accepted:** the silent selected-box fallback, absent image/commentary path, lack of a follow-up association, assumed immediate agent action, and copied-text provenance problem. These are source-supported gaps and appear in the findings above.
- **Accepted as a candidate to verify:** an Action Button Shortcut that acquires dictation and passes it to capture avoids reliance on Siri phrase matching. Its complete phone interaction still needs a device check. The review does not establish that it is the most reliable path or that it meets lock-screen and background expectations.
- **Destination recommendation not adopted:** the reviewer leans toward the browsed box for the initial slice. This adds little implementation state, but it makes captures depend on unrelated browsing. The recommendation here remains an explicit capture default with several boxes and optional per-Shortcut/visible share overrides. That is still a product decision for the human.
- **Duplicate remedy rejected:** announcing that an earlier thought is pending does not prevent a manual repeat from causing a second agent run, and legitimate new thoughts would receive the same notice. The revised plan needs a receipt/recovery story; it should not infer duplicates merely from nearby timing.
- **Receipt wording refined:** the reviewer recommends speaking both box and chat. The box is essential to destination confidence. Conversation detail can be shown later if routing has not finished; acquiring that label must not delay durable capture acknowledgment.
- **No new image card assumed:** the reviewer calls image saving a new card kind. The repo already has an image schema (`beebox/src/schemas/image/schema.tsx`) and capture-session support. The next plan must trace reuse before deciding that new storage vocabulary is needed.
- **Follow-up scope remains a choice:** in-app follow-up can be the first supported recovery path. It should open the original item or a receipt linked to the original conversation, rather than rely on whatever box or chat is now active. Hands-free “that screenshot” is not required by the human's wording and should not be added without a clear association design.

The earlier engineering review remains useful for the bounded text-intent repair. It does not establish that the revised product shape has been designed or that the current implementation tracks satisfy it.
