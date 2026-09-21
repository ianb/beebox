---
title: Quick chat destination routing
status: partial
workstream: chat-routing
issues:
  - ../../../issues/closed/features/2026-06-28-triage-agent-session-routing.md
---
# Quick chat destination routing

When the boxholder has a thought to send, they should not have to find the right conversation first. Quick chat selects an existing conversation or a new conversation in the right landmark, delivers through ordinary chat, and then shows the routing result.

**Issues addressed:** The closed session-routing issue above. Related: `issues/features/2026-09-21-jev-triage-and-quick-capture-routing.md` also owns document triage, which this plan does not resolve; do not close that combined issue. `issues/features/2026-08-02-mcp-launch-into-chat.md` concerns agent-initiated handoffs and remains separate.

## Smallest fix and budget

The evaluation version selects a destination and sends immediately; it shows the chosen destination and close alternatives afterward. It replaces the box-selector Capture link and adds an explicit iOS Quick chat action. The boxholder clarified that this is a live evaluation surface: easy to reach and use, but provisional and inexpensive to revise. It collects explicit copy-to-another-destination corrections for later calibration. Its near-tie margin is provisional, visibly reported, and not a correctness guarantee.

Estimated additions plus deletions: 700–900 source lines for catalog, typed service, decision record, and web UI; 50–150 source lines for native presentation/navigation; 350–450 test lines; 150–250 authored documentation lines. Total estimate: 1,250–1,750 lines, no generated output anticipated. Do not extend the native emission/binding contract for this trial. Reassess if presentation requires materially more machinery.

## Stated preferences this plan trades against

The boxholder selected “Landmark chats and recent web chats” and requested entry “From the box selector (instead of capture)” and the initial iOS chat when cold, allowing “maybe a separate button.” Earlier routing requirements preserved in the originating brief: maintain a destination rubric, distinguish existing landmarks from new sessions, prefer existing.

Latest boxholder direction: “entry point UI that is easy to access and use, but not necessarily finished” and “a lower-impact implementation is better (since I might change my mind on this).” Use a web form for the trial, including on iOS; polished native integration is deferred.

The later boxholder decision is to send blindly and inspect results afterward, including close probabilities. Automatic routing is enabled for this trial; service errors keep the text without sending; uncertain fit falls back to a plausible recent/general chat or a new root chat. The old issue's fresh-session fallback is superseded by the newer existing-destination preference.

`ios-app/CLAUDE.md:11`: “The webview is still the chat client” — keep dispatch in the web layer. Native input must not bypass it.

## What already exists

All source paths here are monorepo-relative.

- `beebox/src/frontend/src/components/BoxSelectionTiles.tsx:75`: `search={toSearch({ capture: "1" })}`. Replace this shortcut with Quick chat; retain other capture functionality.
- `ios-app/BeeBox/Models/PairedBox.swift:50`: `var items = [URLQueryItem(name: "nativeComposer", value: "1")]`. The paired box opens ordinary chat, optionally naming a session. Add explicit Quick chat navigation; do not infer a cold-start timeout here.
- `beebox/src/core/chat/session/target.ts:22`: `export type ChatTargetSpec =`. Use only the existing/fresh arms for delivery, never `most-active-or-fresh`; landmark placement is a separate coordinate from session continuity.
- `beebox/src/webapp/routes/chat-send-routes.ts:111`: `const claim = messageId ? claimMessageId({ messageId, processedMessageIds, inFlightSends }) : null;`. Reuse ordinary send with a stable message ID, including retry handling and identity attribution. Do not claim stronger delivery guarantees than this path provides.
- `beebox/src/frontend/src/machines/chat-bound-turn.ts:8`: `return { session: target.sessionId, exactSession: true, viewContext: attention };`. Preserve explicit binding through confirmation and dispatch.
- `beebox/src/core/chat/husk-read.ts:97`: `export async function listChatHusks(boxRoot: string): Promise<ChatHuskEntry[]>`. Use live catalog owners rather than a second permanent session registry. Compose `loadAllSessions` and `loadLandmarkSummaries`, as `recent-landmark.ts` does; do not reuse its capped one-chat-per-landmark result.
- `beebox/src/core/chat/session/recent-landmark.ts:4`: `export const CHAT_FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;`. Reuse the existing recent-chat window for candidate discovery, not for iOS launch behavior.
- `beebox/src/schemas/landmark.ts:202`: “Don't add a description or purpose field.” Keep routing prose in its own rubric card. Existing `LandmarkDestination` has `rules`, but `beebox/src/schemas/landmark.ts:112` says “`rules`/`procedure` are only meaningful when `for`”; the following line restricts them to triage. Extending it is possible, but would still need another home for session-specific rules. One rubric is the proposed editing surface.
- `beebox/src/core/openrouter.ts:5`: “The product shape is one secret and no configuration”. Routing is an optional service, not an admin-added chat model.

Searches found the related MCP handoff issue still marked `needs: [design]`. Its proposal is not evidence of shipped handoff behavior.

## Prior art (external)

Checked during design:

- [TypeSafe API](https://docs.typesafe.ai/api): direct bearer-key `POST /v1/systemone`, model `jev-latest`; Choice accepts at most 255 options and returns a probability per option.
- [TypeSafe confidence](https://docs.typesafe.ai/confidence): confidence derives from the distribution; evaluate thresholds against application data.
- [OpenRouter Jev listing](https://openrouter.ai/~typesafe/jev-latest) resolves to `typesafe/jev-1.13`. [OpenRouter Decisions example](https://openrouter.ai/labs/jev/compile) uses `openRouter.alpha.decisions.create` with `state` and `questions`, returning typed answers and probabilities. The earlier public-catalog search missed this and did not justify the claim that Jev was unavailable. Use OpenRouter for this service; exact transport and provider-policy compatibility still need integration verification.

Authenticated synthetic evaluation passed through OpenRouter, including provider pinning and the no-training preference. Raw probe latency was 457 ms; the implemented service took 467 ms on another synthetic input. These are individual samples, not performance or calibration claims.

## Tracks / scope

### 1. Rubric and candidate construction

Direction: use optional `_config/chat-routing.yaml`, editable by the boxholder and box agents. Fields: `destinations`, each with a stable target reference (landmark card or chat card), `when`, `avoid`, examples, and `keepEligible`. Keep authored rules distinct from generated candidate facts. Validate references through existing ref resolution. This is a standalone validated configuration file for the trial; no new card schema or existing card migration.

Build candidates on demand from listed landmarks, recent resumable web chats, and explicit retained entries. Include landmark identity, session identity where present, title, activity time, rubric text, and bounded recent conversation text. Preserve source timestamps; do not invent summaries from titles. Check current availability before dispatch. Exclude deleted, unavailable, and background destinations unless explicitly opted in by the rubric.

Vocabulary: a destination has a place and an action. Existing landmark does not mean existing session. Multiple chats in one place remain distinct candidates. Empty landmarks allow a new chat there.

First implementation chunk: pure catalog fixtures for landmark chats, recent web chats, retained older chats, missing references, and deleted sessions; then the schema and builder. Candidate overflow must return an explicit catalog-too-large/manual-selection state rather than silently truncate eligible destinations.

### 2. Typed judgment and routing receipt

Direction: one Choice over complete actions: `existing-session(sessionId)`, `new-session(landmarkRef)`, `new-session(root)`. Send captured text plus bounded candidate facts. Code maps opaque Choice keys to validated targets; model output never supplies arbitrary refs. Preserve raw probabilities and returned model version.

Add a server-only Jev service behind real/fake service interfaces, using the box-granted OpenRouter key at server access and OpenRouter's Decisions interface. No separate TypeSafe credential is required by the documented route. Verify the endpoint contract and existing provider-pinning/data-policy support before implementation; do not treat ordinary chat completions as equivalent. A missing OpenRouter key produces an actionable setup state and manual destination selection. Never modify credentials automatically.

First version dispatches the chosen destination immediately and displays the result and alternatives afterward. There is no ask-me outcome: a plausible recent/general chat or new root chat provides the fallback. Existing targets sort ahead on exact ties. Record distributions and accepted/corrected destinations locally, with the candidate snapshot needed to diagnose missing candidates separately from ranking errors. Store these records as private box state, never in repository fixtures or shared logs. No automated rubric rewriting.

First implementation chunk: typed service fake and pure response validation, including unknown keys, malformed probabilities, absent answers, and timeout. No numeric automatic-routing threshold is introduced in this chunk.

### 3. Entry, dispatch, and receipts

Direction: add a clearly labeled Quick chat mode to the web chat surface. The box selector links to it. Draft editing remains available while awaiting a proposal; editing invalidates the old proposal. Submitting fixes the selected target and sends the original message through normal chat delivery. Keep a stable submission ID across retries and retain the destination link after acceptance. New-session actions resolve the accepted landmark to contextDir and use the normal new-chat engine/model defaults and client reservation owner. Persist the accepted action before send; session assignment updates its resolved session identity, never re-runs routing. Add a retry case spanning that assignment.

Use tRPC for proposing and recording decisions; keep actual send on the existing chat transport. Refresh availability at send time. An unavailable target returns to selection without silently creating a replacement session. Busy targets follow normal queue behavior.

On iOS, add an explicit Quick chat button that presents the same web form in a separate sheet. Keep the current native composer and its pending emissions behind the sheet; no routing emission crosses its binding contract. Closing the sheet returns to the original conversation and draft. Submission delivers through the web send path and presents a destination link. Do not make native dictation/voice integration part of this trial; ordinary keyboard dictation remains an input option. The form owns a distinct saved draft so dismissing it does not lose captured text.

The separate sheet must use the existing paired-box authentication and allowed-origin navigation rules. Do not assume removing `nativeComposer=1` hides the native composer: `BoxConversationShell.tsx:45` also detects the native shell, and `RootView.swift` installs its native composer independently. Present a dedicated web form rather than switching the existing chat shell into an unsupported unbound state. Keep authentication and navigation verified, but avoid a new native send protocol.

First implementation chunk: deterministic web state for draft → saved routing decision → normal send → routing receipt, covering edits, cancellation, unavailable targets, and retries. Then connect native navigation and input using the same state.

## Could this be simpler?

A manual destination picker is simpler but leaves the reported daily routing burden intact. A single prompt over session titles is smaller but cannot distinguish ongoing threads with similar titles. The chosen version supplies bounded conversation evidence and captures human corrections. A visible receipt and explicit copy correction keep evaluation observable without adding a confirmation step to every capture.

## Subplans

No native-binding subplan is needed for the revised evaluation surface. The boxholder chose lower-impact entry UI after reviewing the native extension question. Use the web form in a separate iOS sheet; native binding extensions belong to a later product decision.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Correct older chat omitted | Planned catalog doctest | Explicit retained rubric entries; manual alternatives | Visible selection; omission tracked |
| Too many candidates | Planned pure doctest | Keep the draft and direct the user to Chats; no silent truncation | Clear |
| Key missing, request fails, or response malformed | Planned fake-service doctest | Keep the draft and direct the user to Chats | Clear |
| Message changes while judgment runs | Planned state doctest | Invalidate stale proposal | Clear |
| Chat disappears before send | Existing exact-target guard; add route case | Re-select, never fresh fallback | Clear |
| Retry dispatches to another target | Planned route/state doctest | Stable submission identity and fixed accepted target | Clear |
| Opening or dismissing iOS form disrupts original draft | Planned navigation test and simulator check | Separate sheet; native draft and pending store stay unchanged | Must be verified before shipping |
| User accepts wrong destination | Planned UI flow | Show destination; explicit resend correction | Clear; prior effects cannot be undone |

## Agent-flow / user-flow edge cases

- Wrong destination: ADDRESSED by visible receipt and explicit copy correction record. Resending after execution is not an undo.
- Stale reference: ADDRESSED by catalog and pre-send validation.
- Concurrent edits: ADDRESSED by capturing the rubric/candidate snapshot; later edits affect the next proposal, not an accepted target.
- Hand-edited rubric: ADDRESSED by schema validation and visible errors.
- Fabricated value: ADDRESSED by opaque candidate IDs mapped server-side.
- Validation error UX: ADDRESSED by keeping text and explaining the failed destination/setup state.
- Partial transition: ADDRESSED by additive mode and schema. Existing direct chat remains direct.

## NOT in scope

- Document triage: separately owned use of Jev.
- Telegram, jobs, procedures, and inbox destinations: no approved delivery contract here.
- Agent-initiated MCP handoffs: distinct originating issue.
- Native routing bindings, native speech integration, and polished entry UI: defer until live evaluation establishes the desired flow.
- Automatic iOS cold-start heuristics: explicit button is the first version of the boxholder's allowed alternative; no arbitrary idle cutoff.
- Hiding routing receipts: retain them throughout the evaluation.
- Attachment understanding: begin with typed or transcribed text; do not silently ignore an attached file when choosing a destination.
- Undoing agent effects or moving transcript history: correction is explicit resend with a misroute record.

## Open design questions

Live evaluation needs a box-granted OpenRouter key. The boxholder supplied the OpenRouter Jev listing after the initial catalog search missed it. No direct TypeSafe key is needed for the documented route, and no credentials have been changed. Egress is through OpenRouter to TypeSafe; document both parties in the security report. Authenticated synthetic requests verified this integration with the authorized development key; the normal test-box UI still needs its own OpenRouter grant.

Automatic policy later: determine a suitability floor and the margin by which a new session must beat an existing one. Near-ties favor suitable existing sessions; uncertainty falls back to a recent/general chat or new root chat. Measure against labeled corrections and held-out examples rather than vendor cookbook numbers. Catalog completeness is a separate metric.

## Knowledge audits

Add and run one audit for the new rubric: a box agent knows how to maintain destinations, preserve authored rules, retain an older chat, and distinguish place from session continuity. Run only against the isolated test box. An unavailable model/key must be reported as an unrun audit, not a pass.

## What will hold this after it ships

Pure doctests cover candidate generation and response interpretation. Filesystem doctests cover rubric validation and decision records. Route doctests with service fakes cover setup failures, malformed answers, stale targets, and submission identity. Browser evidence covers the selector, sending, and receipts. Native tests and simulator evidence cover sheet navigation, authenticated access, and draft preservation. No new emission/binding fixtures are needed unless an existing contract actually changes. Real-device verification remains distinct from simulator results.

## Implementation order

1. Cross-model review this draft. Native binding expansion was avoided following the boxholder direction toward a provisional web form.
2. Catalog/configuration fixtures, then candidate construction and rubric guidance.
3. Fake/real Jev-over-OpenRouter service and proposal/decision tRPC procedures.
4. Quick chat state and ordinary dispatch integration.
5. Box selector and explicit iOS sheet entry; update mobile-contract navigation documentation and verify draft preservation.
6. Security report §3, knowledge audit, focused tests, browser/simulator evidence.
7. Live labeled evaluation using a box-granted OpenRouter key. Review outcomes before treating probabilities or the preference margin as calibrated.

## Rollout shape

Ship the first version as immediate routing with visible receipts. Completion requires selected doctests, typecheck and lint, native build/tests for changed contracts, rubric knowledge audit, and UI verification against the isolated box. Run `pnpm test:changed` and `pnpm lint:changed` before committing. No tests contact real external services. Record actual live evaluation separately; no quality or latency claim before it runs.

The new YAML configuration needs no migration. Update the current mobile and security references in the same implementation. Worktree commits are allowed; landing requires the boxholder's finish request. Do not close the combined document-triage issue.

## Implementation evidence

The implementation is approximately 1,912 authored changed lines across source,
tests, documentation, and audit evidence, plus about 135 generated documentation
index lines. Documentation exceeds the initial estimate because it includes
security, native-contract, and rubric audit evidence; no further feature scope
was added.

Implemented locally for evaluation. The 108 change-selected files passed 1,277
assertions. The focused Jev/catalog/request suite passed 66 assertions. Backend,
frontend, tooling, and user-story typechecks and changed-file lint pass. Native
simulator build and ChatWebViewRequestTests pass; physical-device and native
sheet visual verification remain unobserved. The rubric knowledge audit passed
1/1 with zero reads/searches in a disposable clone with package docs installed.

Browser evidence covers the real missing-key refusal and synthetic queued
receipts at narrow and desktop widths; successful browser receipts used network
fixtures, not a live agent. The authenticated provider tests used only synthetic
content and the existing authorized development key. No credentials were changed.
The security artifacts were reviewed by Ian and committed as a scoped amendment;
they retain the previous full-inventory anchor and explicitly do not claim a
fresh audit of unrelated historical changes. Native sheet visual review,
physical-device review, and live box evaluation remain open, so this plan is
partial rather than an assertion of calibrated routing quality.
