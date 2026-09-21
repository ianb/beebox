# Plan Engineering Review — chat routing

## What already exists

Independent Claude review completed. The normal send and exact-target paths are reusable, but unbound native composition is not represented in the current shared contract.

## Prior art (external) — verified

Correction after review: the boxholder supplied https://openrouter.ai/~typesafe/jev-latest. OpenRouter lists Jev and documents its Decisions interface at https://openrouter.ai/labs/jev/compile. The earlier catalog search missed it; the claimed need for a direct TypeSafe key was incorrect. The plan now uses OpenRouter. No authenticated evaluation has run.

## Stated preferences this plan trades against

Keep Jev in the first version. A manual-only first shipment would not fulfill routing. Native dictation versus a smaller initial web composer is a boxholder decision.

## Could this be simpler? (verified)

A web composer for the initial iOS Quick chat avoids extending native target bindings, at the cost of native dictation on that screen. This is an alternative, not an accepted scope cut.

## Failure modes

An unresolved Quick chat must not reuse the previous session binding. Stable message identity must survive new-session assignment and retries.

## Agent-flow / user-flow edge cases

The review verified native Send requires a ready target. A button alone cannot implement native Quick chat input.

## Findings

### Native composition requires an explicit decision

**Location in plan:** Tracks / scope, Track 3; Subplans.
**Citation:** `ios-app/BeeBox/Models/NativeComposerContract.swift:584`: `guard kind == .selection, isValid, selection?.kind == .ready,`.
**Issue:** Existing target types cannot represent routing before a destination is known.
**Why it matters:** Reusing another target risks misdelivery; publishing no target disables Send.
**Suggested action:** Choose a web composer for initial input or design the native contract extension before source edits.
**Relevant preference:** iOS Quick chat access; preserve drafts and accurate targeting.

Accepted. The boxholder subsequently requested lower-impact, provisional entry UI for live evaluation. Revised direction: a web form presented in a separate iOS sheet, preserving the existing native composer and pending drafts behind it. No new native emission binding. This resolves the product choice; sheet authentication and navigation still need implementation verification.

### Setup and catalog owners were underspecified

**Location in plan:** Service track and What already exists.
**Citation:** Plan originally said “Use a box-granted `typesafe` secret at server access.”
**Issue:** Credential integration needs review of the existing secret registries. Candidate construction must not accidentally inherit a one-chat-per-landmark cap.
**Why it matters:** Setup or candidate omissions could undermine the feature.
**Suggested action:** Include registry integration and name uncapped underlying catalog owners.

Accepted and incorporated. Rejected the separate recommendation to ship only a manual picker first: it does not fulfill the routing request.

### Landmark destination rules are a possible alternative

**Location in plan:** Rubric track.
**Citation:** `beebox/src/schemas/landmark.ts:112-113` documents `rules`/`procedure` as meaningful for triage.
**Issue:** The first draft cited the navigation-prose restriction without discussing the existing filing rules.
**Why it matters:** The design should explain why it introduces a separate rubric.
**Suggested action:** Record the actual tradeoff.

Accepted the missing explanation. Retained one canonical chat-routing rubric: landmark filing rules do not already support chat routing, and session-specific exceptions still need a home. Splitting authorship between those surfaces is not demonstrably simpler.

### New-session assignment needs a retry case

**Location in plan:** Entry, dispatch, and receipts.
**Citation:** Plan promised a “stable submission ID across retries.”
**Issue:** That promise did not describe new-session target assignment.
**Why it matters:** A retry could create or route to another chat if it reruns selection.
**Suggested action:** Freeze the accepted action, use the existing reservation/default-model owners, and test retries across session assignment.

Accepted and incorporated. Corrected citation line numbers, including target.ts:22, husk-read.ts:97, and ios-app/CLAUDE.md:11.

## NOT in scope (verified)

Document triage, Telegram, automated cold-start heuristics, and automatic routing thresholds remain outside the first version.

## Things I checked and found clean

The reviewer verified the box-selector Capture link, iOS URL construction, exact-send binding, send dedup call, recent-chat window, and optional-service OpenRouter precedent. No live routing or iOS runtime verification has occurred. The subsequent boxholder direction resolves the native input choice in favor of a lower-impact web form. That revision has not had a second independent review.


## Implementation review and adjudication

The independent implementation review traced the standalone form, ordinary chat
dispatch, session reservation, and native sheet. Its material fixes were:

- Preserve actionable provider and rubric errors through the tRPC formatter;
  keep failed-submission text selectable and copyable. Actual HTTP tests cover
  both failure classes. Recovery uses retry or copying into an ordinary chat.
- Bound aggregate transcript excerpts while preserving every destination.
  The catalog shares 32,000 text characters and stays within 60,000 serialized
  candidate characters; the receipt discloses shortened evidence.
- Exercise reserved, taken, and unsupported session reservation, stable retries,
  and a deleted landmark before reservation.

The suggested removal of stored excerpts/rules was declined: the private
snapshot is intentional evidence for evaluating routing against the exact
context supplied. Its contents, mode 0600, and lack of expiry are documented.
A provisional preference for existing chats may retain an older landmark
conversation; labeled live evaluation will test that behavior.
