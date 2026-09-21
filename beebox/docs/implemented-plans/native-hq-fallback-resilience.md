---
title: "Native HQ fallback resilience"
status: implemented
workstream: hq-settings-broken
issues: []
---
# Native HQ fallback resilience

The iOS composer already saves a voice preparation before starting its HQ request, but an HQ failure currently becomes an ordinary realtime-text message with no durable failure provenance. This plan makes that fallback truthful, makes its cause diagnosable, and gives short HQ requests a bounded chance to finish when the app is backgrounded, without turning the native one-shot path into a durable upload system.

**Issues addressed:** none. This is a bounded follow-up, not closure of the broader resilience issue.

**Related issue:** `2026-09-10-live-transcription-failure-loses-the-hq-pass`. This plan improves its native one-shot path: a completed recording already gets an independent HQ attempt and retained audio survives it, but the native fallback is not marked and the request has no app-switch execution window. The issue remains open for its physical-device/manual-testing gate and the deliberately deferred long-recording behavior.

## Smallest fix and budget

The smallest honest fix has three coupled tracks:

1. carry `hqFallback: true` through the native emission contract so the existing assembler writes `hq="failed"`;
2. preserve and log the observable facts around the native HQ fallback; and
3. hold a UIKit background-task assertion only around the one-shot HQ request.

Target budget: 160–280 changed source lines and 180–280 changed test lines across Swift and TypeScript, plus roughly 40–80 lines of contract/plan documentation and fixtures. The fuller durable design—background `URLSession`, resumable/chunked uploads, retry state, and late correction—would make long uploads reliable across suspension or termination, but it is explicitly outside this plan and was previously removed by boxholder decision.

## Stated preferences this plan trades against

- Engineering principle **#4, resilient and never silent**: “Degradation is allowed for failures that can genuinely happen; invisible degradation is not” (`beebox/docs/engineering-principles.md:49-56`). Realtime fallback stays, but it becomes visible in the durable message and actionable in logs.
- Principle **#5, failure paths visible in signatures** says that when callers branch on failure, the failure belongs in the signature (`beebox/docs/engineering-principles.md:64-73`). `prepareVoiceMessage` therefore returns an HQ-or-fallback outcome instead of four correlated tuple values; diagnostic details stay in logs because no caller branches on them.
- Principle **#10, testability is architectural** permits a narrow injected seam for the UIKit background-task API (`beebox/docs/engineering-principles.md:116-125`). This adds a small abstraction rather than leaving lifecycle correctness testable only on a phone.
- Principle **#13, show actual state** says an affordance must display what actually happened (`beebox/docs/engineering-principles.md:151-164`). A message built from realtime text after an attempted HQ pass must not look indistinguishable from an ordinary realtime message.
- The shipped resilience precedent deliberately says “Track 6 (iOS) is reverted. The native app keeps its one-shot path” (`beebox/docs/implemented-plans/resilient-voice-recording.md:41-50`). This plan trades completeness for the requested low-hanging improvement and does not recreate that track.

## What already exists

- The native send path durably stages `VoicePreparation` before it clears the draft or starts HQ, then resumes that preparation independently (`ios-app/BeeBox/Views/NativeComposerView.swift:824-863`). Reuse it; do not add another queue.
- `prepareVoiceMessage` already has one explicit success/fallback junction, but its catch returns `(live text, false, false, nil)` and loses the fact that HQ was attempted (`ios-app/BeeBox/Views/NativeComposerView.swift:915-933`). Replace that tuple with a typed outcome at this junction.
- `PendingEmissionStore.finishVoicePreparation` constructs the durable emission and removes only the preparation copy after it has persisted the emission (`ios-app/BeeBox/Storage/PendingEmissionStore.swift:227-270`). Extend that atomic handoff with fallback provenance; preserve its ordering.
- Native models and the V2/V3 bridge already carry `hqText` and `hqService` as additive optional fields (`ios-app/BeeBox/Views/ChatWebView.swift:6-20`, `ios-app/BeeBox/Models/NativeComposerContract.swift:21-69`). Add the optional fallback field to the same path; no wire-version bump is required.
- The TypeScript emission type already defines `hqFallback?: true`, makes it mutually exclusive with `hqText`, and the assembler already writes `hq="failed"` (`beebox/src/frontend/src/input/emission.ts:82-92`, `beebox/src/frontend/src/input/emission.ts:154-182`, `beebox/src/frontend/src/input/targets/chat-assemble.ts:112-125`). Reuse these semantics rather than inventing a native-only marker.
- The native parser validates `hqText`/`hqService` and invokes `createVoiceEmission`, but drops any fallback field today (`beebox/src/frontend/src/components/chat/native-emission.ts:60-92`). Extend this boundary and reject contradictory HQ success/fallback provenance before construction.
- `ChatAPI.transcribeAudio` already logs transport, HTTP, and decode failures, but its thrown server error keeps only the human message and discards HTTP status, `permanent`, and `code` (`ios-app/BeeBox/Services/ChatAPI.swift:109-156`; `beebox/docs/mobile-contract.md:857-862`). Preserve those structured server facts for the preparation-boundary log.
- The app already uses a private `LogFlushBackgroundTask` wrapper over `UIApplication.beginBackgroundTask` (`ios-app/BeeBox/Views/RootView.swift:526-558`). Extract its lifecycle mechanism into one small reusable helper rather than creating a second ad hoc UIKit wrapper.
- Shared `emission` JSON fixtures are deep-compared by the TypeScript contract doctest and strictly decoded by XCTest (`beebox/test/mobile-contract/fixtures.doctest.md:82-106`, `ios-app/BeeBoxTests/SpeechKeywordsTests.swift:435-461`). Extend that family for success, fallback, and contradictory provenance. The `native-emission-v3` fixture family checks binding validity only and is not a regression anchor for content fields.

## Prior art (external)

- Apple documents `beginBackgroundTask` as a limited extension for finishing critical work after backgrounding, not indefinite execution: [Extending your app's background execution time](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time).
- Apple documents that the shared URL session is not a durable background-transfer mechanism; background transfers require a configuration created with `background(withIdentifier:)`: [URLSession.shared](https://developer.apple.com/documentation/foundation/urlsession/shared), [URLSessionConfiguration.background(withIdentifier:)](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background(withidentifier:)). Therefore this plan promises only a best-effort execution window, never completion after suspension or termination.

## Tracks / scope

### 1. Make native HQ outcome provenance explicit

**What.** Replace the correlated return tuple from `prepareVoiceMessage` with a closed native outcome type and carry the fallback bit through persistence and the V2/V3 bridge.

**Why this needs to change.** Both a deliberate non-HQ voice send and a failed requested-HQ send currently reach the web with `hqText == nil`; the message therefore cannot tell the truth about which transcript it contains.

**Direction.** Introduce a small value such as:

```swift
enum VoicePreparationOutcome: Equatable {
    case hq(text: String, diarized: Bool, service: String?)
    case fallback(text: String)
}
```

`finishVoicePreparation` accepts this outcome (or a wire-ready projection of it) and persists exactly one of `hqText: true` or `hqFallback: true`. Add `hqFallback: Bool?` to `PendingEmission`, `NativeChatEmission`, and `NativeEmissionV2`; old persisted emissions decode it as `nil`. Native writers emit only `true` or absence. For compatibility with the existing `hqText` behavior, the TypeScript parser accepts boolean `false` as absence, rejects malformed non-booleans and `hqText === true && hqFallback === true`, and passes only literal `true` to the already-validating `createVoiceEmission` call. The Swift `NativeEmissionV2` decoder also rejects the success-plus-fallback contradiction, making the shared invalid fixture meaningful on both sides. Typed emissions ignore/reject HQ-only provenance consistently with the existing native contract policy.

**Vocabulary lock-ins.** The cross-platform wire field is `hqFallback?: true`; durable message markup remains `hq="failed"`; success remains `hqText: true` plus optional `hqService`.

**First implementation chunk.** Add deep-comparing V2 `emission` fixtures, a direct V3 encoder assertion, parser tests, and native persistence tests, then implement the outcome type and end-to-end field propagation through Swift and TypeScript. This chunk is complete when a relaunched pending fallback still assembles to a voice emission with `hqFallback === true`, the V3 JSON contains the field, and contradictory provenance is rejected. Do not use the binding-only `native-emission-v3` validity fixture as proof that content survived parsing.

### 2. Record the facts needed to diagnose the fallback

**What.** Preserve structured server error fields and record the observable facts needed to test the app-switch hypothesis: live application state at request start and failure, elapsed request time, whether the background hold was acquired or expired, `URLError` code when present, and HTTP status/`code`/`permanent` when present.

**Why this needs to change.** The current catch can say only “HQ transcription failed”; HTTP `permanent`/`code` are discarded, a missing recording reference silently takes the realtime path, and a background suspension is observationally indistinguishable from an ordinary timeout or network loss.

**Direction.** Extend `ChatAPIError.server` to retain `status`, `message`, `permanent`, and `code`, while preserving its existing localized message for callers. Capture an HQ-attempt snapshot immediately before the request: monotonic and wall-clock start times, live `UIApplication.State` from the injected application adapter, audio byte count when available, and the hold instance. On fallback, read application state again from that adapter and emit one warning with preparation ID, box ID, preparation age, awake-time and wall-clock request elapsed time, start/current application state, hold-acquired and hold-expired state, concrete Swift error type, `URLError` code if present, and structured server fields if present. The wall-clock duration makes time spent asleep visible while the monotonic duration remains immune to clock adjustments. Do not read `@Environment(\.scenePhase)` from the long-lived task: that value belongs to the view snapshot and can silently report the start state at failure time. Do not invent a seven-way category when every case has the same product outcome. Existing lower-level `ChatAPI` logs retain the operation name (`default-session` versus `transcribe-audio`) and detailed transport/HTTP/decode context; the boundary log supplies the preparation and lifecycle correlation without repeating raw messages.

The request still uses the platform's current timeout behavior. This track measures timeout code and elapsed time; changing timeouts is not smuggled into the diagnosis fix.

An absent `audioFilename`/recording reference is logged explicitly before marked fallback. A file that was referenced but disappeared fails during body construction and is logged from the thrown file-read error; the plan does not pretend the existing `voiceAudioURL` guard checks filesystem existence. A failed HQ request still completes the prepared emission with realtime text and `hqFallback: true`; only failure to persist that emission leaves the preparation for retry as it does today.

**Vocabulary lock-ins.** There are only two product outcomes: HQ text or marked fallback. Diagnostic fields are factual (`startApplicationState`, `failureApplicationState`, `elapsedMs`, `holdAcquired`, `holdExpired`, `urlErrorCode`, `httpStatus`, `serverCode`, `permanent`) and do not create additional product states.

**First implementation chunk.** Extend API tests for structured server fields, then add a pure log-metadata projection test for representative `URLError`, structured server error, invalid response, and file-read error. Wire one boundary log and explicitly test the no-recording-reference branch.

### 3. Give the one-shot request a bounded background window

**What.** Hold a UIKit background-task assertion from immediately before the HQ network request until it succeeds or falls back.

**Why this needs to change.** Switching away at the wrong time can suspend the foreground `URLSession.shared` request before it completes. A short dictation may need only a few more seconds, and the app already uses this UIKit mechanism for log flushing.

**Direction.** Extract a reusable main-actor `BackgroundExecutionHold` around a minimal application protocol exposing live `applicationState`, `beginBackgroundTask`, and `endBackgroundTask`. It is single-use, owns its assertion until explicit end or expiration, ends idempotently, and records both acquisition failure and expiration.

The live application-state check belongs in `resumeVoicePreparation`, before it calls `prepareVoiceMessage` or commits any outcome. If the app is already non-active, return without finishing the preparation. Extend the existing `.active` scene transition to call `resumeVoicePreparations` only when `automaticallyResumeVoicePreparations` is true; the existing `activeVoicePreparationIDs` guard prevents a duplicate start. This gives “not attempted yet” a control-flow representation without adding a third durable outcome.

When active, acquire a hold named `beebox.hq-transcription` immediately before `ChatAPI.transcribeAudio` and release it with `defer` on every success or failure path. If UIKit declines the assertion while the app is active, log `holdAcquired=false` and continue the ordinary foreground request; otherwise a preparation could remain stuck without another foreground transition. If the hold expires after a request began, it ends the assertion and records expiration; it does not cancel or decide fallback. The request remains the ordinary foreground transport, so it may suspend and later succeed or fail after foregrounding.

Migrate `LogFlushBackgroundTask` to the same helper only far enough to avoid two subtly different implementations of the same begin/end invariant. Keep its existing behavior that expiration cancels log-flush work; cancellation policy stays with that caller, not in the generic hold.

**Vocabulary lock-ins.** `BackgroundExecutionHold` means “bounded best-effort execution time,” never “background transfer” or “retry.” The HQ operation name is `beebox.hq-transcription`.

**First implementation chunk.** Add fake-application tests for normal end, declined acquisition, expiration, repeated end, live application-state reads, and ownership/deallocation safety; then wrap the one-shot HQ request, resume deferred preparations on return to `.active` while honoring `automaticallyResumeVoicePreparations`, and migrate log flushing without changing its externally visible behavior.

## Could this be simpler?

The absolute minimum is to add `hqFallback` in the existing tuple and bridge. That fixes the durable lie and should land even if the other tracks are cut. It does not explain whether app switching caused the fallback, and it leaves short app switches needlessly exposed.

An inline `UIApplication.beginBackgroundTask` call inside `NativeComposerView` would be fewer lines than the helper. It would duplicate the log-flush lifecycle, be difficult to unit-test, and make double-end/expiration behavior implicit; the small injected wrapper buys direct coverage of the only new lifecycle invariant, per principle #10. A background `URLSession` would buy much stronger reliability, but also requires durable task identity, file-backed request bodies, relaunch reconciliation, and retry/product decisions; that is not a simpler answer to this request.

## Subplans

None.

## Failure modes

There are no unresolved critical gaps in the planned paths. Physical suspension timing cannot be deterministically unit-tested, so the rollout includes a named device check and the UI/markup never promises that the execution window succeeded.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| The preparation has no recording reference | Planned Swift unit test | Send realtime text with `hqFallback: true`; log explicit absence | Clear in message and logs |
| A referenced audio file disappeared or cannot be read | Planned metadata projection/API test | Send marked fallback; log concrete error type | Clear |
| Session resolution fails before upload | Extend `ChatAPITests` plus boundary-log test | Send marked fallback; lower-level operation log plus correlated boundary facts | Clear |
| Foreground upload times out or loses connectivity | Extend `ChatAPITests` plus metadata projection test | Send fallback; record URL code, elapsed time, live application states, hold state | Clear |
| Server/provider rejects HQ, including permanent configuration errors | Extend `ChatAPITests` | Preserve status/permanent/code; send marked fallback | Clear |
| Server returns malformed success JSON | Extend `ChatAPITests` | Send marked fallback; decode log | Clear |
| Native bridge receives both success and fallback provenance | Planned shared fixture/doctest | Reject the native emission before dispatch | Clear rejection |
| App backgrounds before HQ starts | Planned helper/scene transition tests | Keep preparation staged; retry when scene becomes active | Clear in staged-preparation UI and logs |
| UIKit declines an assertion while the app is active | Planned helper test | Log unprotected state and continue the foreground request | Clear in logs |
| App backgrounds and UIKit expires an active execution hold | Planned helper test plus physical device check | End assertion, record expiration; request may later fail into marked fallback | Clear |
| Persisting the fallback emission fails after HQ failure | Existing preparation retry behavior plus extended store test | Keep `VoicePreparation` for retry | Clear composer status |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED:** the shared fixture and parser tests lock `hqFallback: true` to `hq="failed"`; success continues to use `hqText`/`stt="hq"` (Track 1).
- **Stale ref — ADDRESSED:** the change does not introduce a ref; it preserves the staged preparation ID and existing binding behavior.
- **Two agents touching the same card — ADDRESSED:** not applicable to the native local queue; the existing emission ID and binding revision remain unchanged.
- **Hand-edit drift — ADDRESSED:** native emission JSON is generated by Codable; the TypeScript boundary rejects malformed or contradictory provenance.
- **Fabricated free-form value — ADDRESSED:** wire provenance is the literal boolean `true`; diagnostic metadata consists of typed system/error facts rather than a free-form product field.
- **Validation error UX — ADDRESSED:** malformed bridge payloads use the existing rejected-emission receipt; normal HQ failure produces a sent message visibly marked as fallback.
- **Partial migration / transition state — ADDRESSED:** all new persisted and wire fields are optional. New iOS against old web loses the new marker but still sends; old iOS against new web remains unchanged. Ship both sides together, with no on-disk migration.

## NOT in scope

- Background `URLSession`, chunking, resumable uploads, retries, or relaunch reconciliation: these recreate the previously reverted native durable-upload track.
- Keeping an active recording alive while the app backgrounds: that is a separate audio-session/lifecycle problem, not the post-recording HQ request covered here.
- Long-conversation reliability or provider-size limits: the retained audio remains the recovery artifact; the one-shot path still has its known size/time limits.
- Changing the foreground request timeout: diagnostics will record elapsed time and URL error code first.
- Late HQ correction after realtime text is sent: explicitly removed from the shipped resilience design.
- Changing HQ preference inheritance or persistence: that fix has already landed independently.
- A new persistent native alert/history UI: the durable `hq="failed"` message marker and structured logs are the bounded visibility improvement.
- Provider retry policy: permanent/transient metadata is retained for diagnosis, not used to add retries in this plan.
- Reconciling suspension versus termination: termination preserves the staged preparation for a later attempt, while a resumed request that fails may commit marked fallback and remove its preparation copy. This asymmetry is logged and documented here, but changing it requires a retry/retention decision outside the small fix.

## Open design questions

None. If device evidence shows that the bounded assertion rarely helps even for short dictations, remove Track 3 rather than silently expanding it to background transfer.

## Knowledge audits

None. This adds no agent-facing tag or workflow: `hq="failed"` is already the shipped web vocabulary, and the new field is an internal native bridge representation of it.

## What will hold this after it ships

- Deep-comparing V2 mobile-contract fixtures exercise the same success/fallback/invalid provenance in XCTest and the TypeScript doctest; the Swift fixture assertion explicitly checks the decoded fallback field, and a direct V3 encoder test proves the bound native payload carries it.
- Swift unit tests hold persistence across relaunch, fallback log metadata, structured `ChatAPIError`, and the UIKit hold's begin/end/expiration invariant.
- The existing TypeScript emission tests/doctest hold mutual exclusion and final message assembly to `hq="failed"`.
- A physical-device manual check is required for the real UIKit scheduling claim: start an HQ send, switch apps during upload, and verify either HQ text or a visibly marked fallback. A simulator/unit result is not evidence that iOS granted execution time on a device.
- No new test tier is introduced. The lifecycle wrapper is injected precisely so its invariant is covered by ordinary XCTest rather than a bespoke background-test harness.

## Implementation order

1. **Contract/provenance tests and propagation.** Add deep-comparing fixtures, V3 encoding, persistence, and parser tests; implement `VoicePreparationOutcome` and `hqFallback` through Swift, JSON, TypeScript, and assembly.
2. **Diagnostic facts.** Extend structured API errors, add pure metadata-projection tests, and add the single preparation-boundary log with lifecycle timing.
3. **Background hold.** Extract/test the UIKit wrapper, apply it to HQ, and migrate the existing log-flush caller.
4. **Contract documentation and verification.** Update `beebox/docs/mobile-contract.md`, run selected Swift and TypeScript suites, then perform the named simulator and physical-device scenarios.

Each numbered chunk may be its own commit, but the feature ships as one unit only after all automated checks pass and the boxholder asks to land it.

## Rollout shape

Tests lead each chunk:

- extend the deep-comparing `beebox/test/mobile-contract/fixtures/emission/` family with HQ-success, HQ-fallback, and contradictory cases; add a direct V3 Swift encoder assertion and a V3 TypeScript parser assertion separately;
- extend `ComposerDraftTests` to prove a fallback survives persistence/relaunch and becomes a delivery with `hqFallback: true`;
- extend `ChatAPITests` for structured 5xx metadata, transport timeout, default-session failure, and malformed 2xx response;
- add pure outcome/log-metadata tests and `BackgroundExecutionHold` lifecycle tests, including declined acquisition, live application-state reads, and active-scene resumption with automatic resumption disabled/enabled;
- extend native-emission/assembly doctests to prove the final text carries `hq="failed"` and never both success and failure provenance.

Done means the selected iOS test targets, selected beebox doctests, TypeScript checks for changed packages, `git diff --check`, and the repository's change-selected finish checks pass. Before any claim about app switching, run on a physical iPhone: short HQ send in foreground; short HQ send with immediate app switch and return; switch long enough for the assertion to expire; and a forced server rejection. Record which ended as HQ and which ended as marked fallback. Do not claim durable background delivery from those results.
