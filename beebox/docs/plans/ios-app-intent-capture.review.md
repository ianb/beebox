# Plan Engineering Review — iOS quick capture

Reviewed 2026-10-12 by Codex, with independent **Claude Fable** cross-model review. Target: [revised plan](ios-app-intent-capture.md). This replaces the prior narrow text-repair review; the earlier document remains in Git history. The [product-shape review](ios-app-intent-capture.product-shape.review.md) and [iOS research](../../../research/ios-quick-capture-2026-10-12.md) remain context.

## What already exists

Text capture has a durable native quick-chat outbox, but Siri matching failed on the physical phone. Share extension handles URL/text and authenticated protected boxes. Capture and bulk-upload supply media staging/writers and restart recovery, with existing chat-directed processing policies. `share.saveTextual` already provides idempotent box-level save-only URL/text acceptance. Its lack of files and accompanying human words does not make it nonexistent.

## Ontology (verified against the code's own names)

Paired box and chat session are separate destinations. Proposed capture UUID is receipt identity; source memo stores it in an optional `share-id`, consistent with existing external share convention. Existing webpage `capture-id` belongs to Clerk and is not scanned for native capture follow-up. Material role stays in coordinator manifests; source memo reuses context and attach scope. Context event has a separate delivery UUID referring to original capture and box. These coordinator records are proposed, not existing server capabilities.

## Prior art (external) — verified

The dated research checks Apple primary documentation and installed SDK availability. App Shortcut trigger-plus-prompt is the supported baseline; arbitrary initial-utterance string binding is not. AudioRecordingIntent requires an ongoing Live Activity. Controls are iOS 18+. Cold/locked recording launch, Siri microphone handoff, and share-sheet keyboard dictation remain physical-phone gates. Neither schema-backed one-utterance capture nor always-background recording is promised by this plan.

## Stated preferences this plan trades against

The human wants fast behavior, Siri/voice, predictable boxes, and screenshot-plus-words or follow-up. The revised plan preserves those instead of limiting the work to registration repair. The retained source and shared queue cost more than a text-only fix. The plan declares BIG CHANGE and awaits approval for implementation at that scale. Protected Siri refusal remains distinct from authenticated sharing.

## Could this be simpler? (verified)

A registration fix and named Dictate Text Shortcut would cover some short thoughts, but would omit audio preservation and contextual screenshot capture. A foreground recorder is a credible simpler platform adapter; the chosen plan also exposes native recording tasks/controls with an explicit foreground fallback. Cross-model scope opinions do not authorize deleting desired entry experiences. The server contract was simplified to one file-backed request, and the first share release was reduced to one material item plus words.

## Failure modes

The important corrected gaps were extension-exit delivery, duplicate intake, offline context loss, wrong shared selection fallback, and false voice framing. Proposed handling and concrete cases are in the plan's Failure modes table. No implementation or device success is claimed. Phone-only acceptance is explicitly separate from local persistence/contract verification.

## Agent-flow / user-flow edge cases

A saved screenshot can be inert material. Words supplied later refer to its explicit identity, including offline and after filing. Recorded transcript is derived human input with retained audio, without implying a live conversation. A removed target cannot redirect a pending capture. Inbox discovery is independent of memo status: sources must remain outside inbox to avoid an unintended second agent intake.

## Findings

### Extension delivery depended on a live client sequence

**Location in plan:** Track 1 acceptance contract and Track 2 delivery.
**Citation:** Earlier draft proposed declaration, per-item PUT, then a final accept request. `ios-app/BeeBoxShareExtension/ShareViewController.swift:74`: `extensionContext?.completeRequest(returningItems: nil)`.
**Issue:** A multi-call sequence after extension dismissal needed client completion/relaunch orchestration that the plan had not specified.
**Why it matters:** Saved-on-phone could become a share that waits indefinitely for opening the main app.
**Suggested action/adjudication:** **Accepted and corrected:** one persisted multipart body, one background upload scheduled before dismissal, one server complete-set seal. Missing response recovers the receipt. The reviewer's categorical claim that multi-request delivery is impossible is broader than the evidence; the smaller contract removes the dependency anyway.

### Source memos could trigger a second intake

**Location in plan:** Source memo ontology and Track 3.
**Citation:** `beebox/src/cli/commands/wakeup/steps.ts:308-310`: `entry.endsWith(".card")` and `!existingRefs.has(relPath)`; `beebox/src/core/state.ts:96-98` scans inbox recursively. Memo status/share identity is not an intake guard.
**Issue:** Writing source into inbox and separately submitting its words could run two agents on the same capture.
**Why it matters:** Unwanted autonomous processing of save-only material or duplicate work.
**Suggested action/adjudication:** **Accepted and corrected:** retain sources under `_content/captures/`, outside inbox; coordinator owns transcription and explicit dispatch. Reject the proposed remedy of using a memo status to suppress intake: current discovery does not read it. Keep text source memos as a product choice so detail and explicit later context work uniformly; no second intake follows merely from retaining a source.

### Capture default missed the extension's selection fallback

**Location in plan:** Track 2 destination.
**Citation:** `ios-app/BeeBox/Storage/SharedSelectedBoxSnapshot.swift:58`: `return boxes.first { $0.id == selectedBoxID } ?? boxes.first`.
**Issue:** Fixing app selection alone would leave wrong-box behavior in sharing.
**Why it matters:** Browsing/pairing changes could redirect captures independently of the intended default.
**Suggested action/adjudication:** **Accepted and corrected:** captureDefaultBoxID lives under its own app-group preference key, independent of selectedBoxID and whole-snapshot rewrites. Multiple boxes without default require setup; removal never falls back.

### Existing share modes and save-only API were omitted

**Location in plan:** What already exists and Track 6.
**Citation:** `beebox/src/webapp/trpc/routers/share/router.ts:41`: `saveTextual: authedProcedure`; `:67`: `Share ID already belongs to different content`.
**Issue:** The earlier revision omitted a reusable convention and left existing chat/landmark choices unspecified.
**Why it matters:** Implementation could remove existing destinations or mislabel a new acceptance coordinator as replacing all sharing.
**Suggested action/adjudication:** **Accepted and corrected:** cite and preserve existing URL/text Send to chat and Save in landmark under alternate destination choices. New default capture uses the unified coordinator because it needs contextual media and follow-up. Reject routing new save-only URL/text through an unrelated second acceptance path solely to avoid source storage; the existing route remains for its existing explicit mode.

### Voice-note transcript framing was false

**Location in plan:** Track 3 dispatch.
**Citation:** `beebox/src/core/chat/session/prompts.ts:55`: `No audio recording is attached.`
**Issue:** Current external-input framing describes text without retained audio; live speech framing also implies the wrong interaction.
**Why it matters:** Agent could deny access to source audio or assume an immediate spoken reply is wanted.
**Suggested action/adjudication:** **Accepted and corrected:** acquisition source enum and optional source/recording metadata in external-input; identify retained memo/audio and no live presence. Fixture checks no speech wrapper or false no-recording statement.

### New source fields duplicated existing conventions

**Location in plan:** Ontology, Track 3 source lookup.
**Citation:** `beebox/src/schemas/webpage.tsx:53`: `"capture-id": z.string().uuid().optional()` belongs to Clerk; memo context already supports URL/title/text and an attach scope.
**Issue:** Generic lookup by capture-id could match a different integration; a new material array on cards duplicated the canonical manifest.
**Why it matters:** Wrong original-item lookup or unnecessary schema growth.
**Suggested action/adjudication:** **Accepted and corrected:** optional memo share-id, typed memo-only ownership lookup, existing context/attachments, canonical role manifest read by detail and dispatch. No capture-materials field.

### Offline context had no local owner

**Location in plan:** Tracks 2, 3, 6.
**Citation:** Earlier draft defined only server `addContext` while promising later input about a saved item.
**Issue:** A phone-only original or offline follow-up could not reach that mutation.
**Why it matters:** The explanation could be lost or require returning later to reconstruct it.
**Suggested action/adjudication:** **Accepted and corrected:** context event is durably persisted in the same native store, using the same single-request acceptance contract with parentCaptureId. Delivery waits for the original receipt. Parent failure leaves visible blocked context. Reject disabling Add context until connected as the complete remedy: it would narrow the desired recovery behavior.

### Defer all native recording system surfaces

**Location in plan:** Track 5 and Smallest fix and budget.
**Citation:** Cross-model round 1 recommends foreground recorder only and deferring AudioRecordingIntent/Live Activity/controls.
**Issue:** Scope opinion: foreground is smaller and native background start remains unproven.
**Why it matters:** The chosen system surfaces account for part of the BIG CHANGE estimate and device risk.
**Suggested action/adjudication:** **Scope choice retained, surfaced for human approval:** native recording task/Live Activity/controls are direct researched fits for fast voice capture, with foreground fallback. They are not promised to bypass device unlocking. The foreground-only variant is a legitimate smaller scope choice, not a demonstrated defect. No implementation authority inferred.

## NOT in scope (verified)

SiriKit/Notes schema adapter, new toolchain, Watch, arbitrary document/video import, multi-item shares, file-bearing follow-up, voice replies, webpage extraction, and global latest-item reference guessing are explicitly deferred. Broader quick-drop umbrella remains open.

## Things I checked and found clean

Registration omission and current phrases match source. Selected-box fallback is real in both snapshots. Existing text outbox writes before networking. Shared app group exists in both targets. Quick-chat conflict/replay and expiry behavior supports immutable delivery IDs. Source fields and processing are proposed additions, not claimed free reuse. Phone list tests original material and destination, not merely a spoken acknowledgment. The plan preserves iOS 17 fallback and old outbox decoding.

Not checked as implementation evidence: signing, actual mic/Live Activity lifecycle, Siri phrase matching, server worker/runtime behavior of the proposed coordinator, or physical device checks. Those require implementation and the final device batch.

## Cross-model recheck

Round 1: Claude Fable; raw response `scratch/cross-model/2026-10-12T23-14-30-400Z-claude.md`. Corrections above were checked against source before adoption. Round 2: Claude Fable, `scratch/cross-model/2026-10-12T23-24-08-974Z-claude.md`. It confirmed the seven major corrections and identified four final details: extension session configuration/delegate routing, default persistence across snapshot rewrites, explicit Siri acknowledgment timing, and existing audit updates. All were incorporated.

The default now uses a separate app-group preference key. Extension sessions explicitly name their shared container and main-app callback routing. Siri acknowledgment is uniformly local and prompt; later delivery is visible in detail. Existing external-input and Siri guide audits are updated, alongside the memo description. These are proposed design choices, not running behavior.

Rejected the round-2 research-link nit: `../../../research/` from `beebox/docs/plans/` resolves to the repo-root research file and was checked directly. Confirmed `beebox/src/core/list-cards.ts:20` uses `glob("**/*.card")` with exclusions that do not exclude `_content/captures/`, so retained sources remain discoverable.

Round 3: Claude Fable, `scratch/cross-model/2026-10-12T23-30-42-320Z-claude.md`. Verification-only: all four corrections passed. No remaining plan defect identified in that bounded check. Remaining gates are human approval of the BIG CHANGE scope and the implementation/device evidence described in the plan.
