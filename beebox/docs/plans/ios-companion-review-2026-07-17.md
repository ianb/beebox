---
title: "iOS Companion — follow-up code review (2026-07-17)"
status: active
workstream: unknown
issues: []
---
# iOS Companion — follow-up code review (2026-07-17)

**Reviewer:** Claude (Opus), re-checked against HEAD (`c7e77831`) with a fresh iOS pass and a full wire/behavioral contract map. Spot-checked the load-bearing findings (C1/C2 fix sites, the N1 `deliver` early-return, the N2 token-in-URL construction, the I4 photo-remove reindex) against the code directly.
**Scope:** everything under `ios-app/` re-reviewed against the July-9 punch list (`ios-companion-review-2026-07-09.md`), plus the box-side mobile pairing/auth/bridge status carried over from that review. Supersedes the July-9 doc.
**Audience:** Codex, who wrote this. Still a punch list, not a rewrite mandate.

## TL;DR

The app was substantially redesigned across ~15 commits (`348de275 → c7e77831`) and it closed most of the July-9 iOS list at a stroke. The direct-HTTP outbox/retry stack (`OutboxStore`, `QueuedMessage`, `OutboxListView`, `ChatAPI.assembleMessage`) is **deleted** — I1/I2/I5 collapse together. Sends now flow through a single **bidirectional receipt bridge** (`beeboxEmissionReceipt`): the web app posts a real `Receipt` back and native tracks inflight IDs with a 35s timeout, replacing the old eval-success lie (I3). A **navigation policy** pins the main frame to the box origin (C2), and the token injection is **main-frame-only + origin-gated** (C1). Both criticals are closed. The audio session is deactivated (I7), and photo-remove no longer wipes the whole attachment set (I4).

Two clusters remain. **iOS:** the delivery guarantee is strong in the loaded case but holed when the page isn't loaded — a send there clears the input, shows a spinner, and schedules *nothing* (N1); the async HQ-transcription window is unlocked (N3); the durable token still sits in plaintext JSON rather than the Keychain (I6, unchanged). **Server:** all three July-9 server majors — **S1, S2, S3 — are STILL OPEN** and are now the oldest unaddressed items in the batch. And the plan's stated **hardest problem — device-token/user-identity unification** — remains **unresolved**: a pure mobile request is `authed: true` but `user` stays `null` and `isOwner: false`, so native chat sends attribute to nobody.

Overall the redesign is a clear, correct improvement and nothing here is an architectural dead-end. Address N1 and the token-handling pair (N2/I6) before this shell is trusted on real devices; the three server majors should land before the deployed hub relies on them. The rest are cleanups.

---

## (a) July-9 finding status

Every July-9 finding, with current status and evidence. iOS paths under `ios-app/BeeBox/`; box paths under `src/` (relative to `beebox/`).

### Critical

| ID | Finding | Status | Evidence |
|----|---------|--------|----------|
| **C1** | Token injected into `localStorage` on every frame incl. cross-origin iframes | **FIXED** | Injection is `forMainFrameOnly: true` (`ios-app/BeeBox/Views/ChatWebView.swift:403,418`) and self-gates on `if (window.location.origin === allowedOrigin)` (`ChatWebView.swift:412`). |
| **C2** | No navigation policy; token script can run on an attacker origin | **FIXED** | `decidePolicyFor` (`ChatWebView.swift:147-162`) cancels off-origin main-frame loads and hands them to `UIApplication.shared.open` (Safari); only same-origin or `about:` is allowed. |

### Major — server / box-side

| ID | Finding | Status | Evidence |
|----|---------|--------|----------|
| **S1** | Hub auth downgraded from "verify token" to "a token is present" | **STILL OPEN** | `hasMobileAuthAttempt` (`src/hub/hub-server.ts:134-138`) checks only that `Bearer …`/`?mobileToken=` is *present*, never validates it; used at the HTTP catch-all (`:400-402`) and WS upgrade (`:452-454`). A valid-slug + `Bearer x` still cold-starts the box (`resolveEndpoint`, `:427`) before it 401s → unauthenticated box-wake / existence oracle. `listMobileAuthorizedBoxes` (`:146-147`) *does* verify for real — only the wall bypass is presence-only. |
| **S2** | Device token carried in a URL query parameter (`?mobileToken=`) | **STILL OPEN** | Produced by `getWebSocketUrl` (`src/frontend/src/api-core.ts:86-87`) and `ChatWebView.authenticatedChatURL` (`ChatWebView.swift:357-358`); consumed at `hub-server.ts:128`, `server-box-scope.ts:235`, `server-root.ts:335`. Durable token lands in access/proxy logs, `Referer`, WebKit history; tokens never expire. See N2 for the iOS-side origin. |
| **S3** | Device-store read-modify-write is unlocked; a revocation can be silently erased | **STILL OPEN** | `verifyMobileToken` (`src/core/mobile/pairing.ts:155-168`) does read→mutate `lastUsedAt`→`writeDeviceStore` with no `withCardLock`/file-lock; `revokeMobileDevice` (`:170-177`) races it → an in-flight verify can clobber a revocation. `writeDeviceStore` (`:84-88`) is a bare `writeFileSync` (no temp+rename) → crash mid-write corrupts the store. |

### Major — iOS app

| ID | Finding | Status | Evidence |
|----|---------|--------|----------|
| **I1** | Offline outbox is dead code; fire-and-forget send | **MOOT + FIXED** | `OutboxStore`/`QueuedMessage`/`OutboxListView` deleted (no remnants). Delivery is now confirmed by a real receipt channel (see I3). |
| **I2** | Two divergent send paths; legacy wire format can still fire on upgrade | **MOOT** | `retryPending`/`ChatAPI.assembleMessage` removed. `ChatAPI` (`Services/ChatAPI.swift`) now only does `transcribeAudio`/session lookup. Single path: bridge → web `dispatchNativeEmission`. |
| **I3** | Emission marked "handled" on JS-eval success, not delivery | **FIXED** | Web posts a real `Receipt` over `beeboxEmissionReceipt` (`src/frontend/src/components/chat/use-native-bridge.ts:98-101`); native tracks `inflightEmissionIDs` + a 35s timeout (`ChatWebView.swift:186-240`); eval-error → synthetic `.rejected` (`:193-203`); `NativeComposerView` restores text/images on reject (`Views/NativeComposerView.swift:78-91`). |
| **I4** | Removing one photo attachment deletes all of them | **FIXED** | `removeImage` (`NativeComposerView.swift:366-371`) reindexes `images` only; no longer resets `selectedPhotoItems`. `loadPhotos` early-returns on empty (`:342-344`) so the picker-clear no longer triggers a wipe. |
| **I5** | Message body embedded in box markup unescaped | **MOOT** | `assembleMessage` removed; the bridge assembles server-side via canonical `createTyped/VoiceEmission`. Raw text now crosses as a JSON string field (`NativeEmissionPayload`, JSON-encoded `ChatWebView.swift:422-428`), not spliced into markup. |
| **I6** | Auth token persisted in plaintext JSON, not the Keychain | **STILL OPEN** | `PairedBox.authToken` still JSON-encoded into `Library/Application Support/paired-boxes.json`, written `.atomic` (`Storage/PairedBoxStore.swift:140-153`). No Keychain, no `CODE_SIGN_ENTITLEMENTS`, no `FileProtection` anywhere. Departs from Track C's stated Keychain plan. |
| **I7** | Audio session never deactivated after dictation | **FIXED** | `endRecording` now calls `AVAudioSession…setActive(false, options: .notifyOthersOnDeactivation)` (`Services/SpeechDictation.swift:72`). |
| **I8** | Recorded WAV written in the mic's native float format | **VERIFIED / CLOSED (2026-08-06)** | Still `format = inputNode.outputFormat`, `AVAudioFile(forWriting:…settings: format.settings)` (`SpeechDictation.swift:137,180`) — typically 32-bit float. Live checks with a 48 kHz mono Float32 WAV returned usable speech from every selectable OpenAI and Voxtral HQ path, including Voxtral diarization. No conversion is needed; see `issues/closed/bugs/2026-07-17-ios-hq-wav-float-format-needs-verify.md`. |

### Minor

| Item | Status | Evidence |
|------|--------|----------|
| Box-existence oracle survives an S1 fix (anchor/slug-scope) | **STILL OPEN** | Folded into S1; the presence-only wall bypass still distinguishes valid-slug-bad-token (proxied → box 401) from unknown-slug (`/auth/login`). |
| `isPairingRedeemUrl` suffix match unanchored | **STILL OPEN** | `path.endsWith("/api/pairing/redeem")` (`src/webapp/routes/pairing.ts:10-13`) — `/anything/api/pairing/redeem` matches. Low risk (token-gated). |
| Device tokens never expire | **STILL OPEN** | `MobileDevice` (`pairing.ts`) has no `expiresAt`; only `revokedAt` is checked. Compounds S2/S3 — a leaked token is valid indefinitely. |
| Pending pairings live only in process memory | **STILL OPEN** | `pendingPairings` Map, 10-min TTL, but a lazy hub idle-stops a box (~5 min) inside that window → ticket lost, redeem 401s. Racy with the exact flow it serves. |
| `lastUsedAt` write on every authed request, multiplied | **STILL OPEN** | Unchanged; each verify RMWs the store, and `/api/boxes` iterates every box then re-verifies in `addBoxAuthHook`/`createContext`. |
| `resolvedSession` returns `"new"` on any non-2xx | **STILL OPEN** | `Services/ChatAPI.swift:57-59`. A transient 5xx during HQ resets diarization speaker-letter numbering to "A". (See N7.) |
| Duplicate deep-link handling → two redeem POSTs | **STILL OPEN** | `onOpenURL` (`BeeBoxApp.swift:13-17`) **and** `BeeBoxAppDelegate.application(open:)`→`PairingURLInbox` (`BeeBoxAppDelegate.swift:4-13` → `BeeBoxApp.swift:18-23`) both fire one URL → two concurrent `store.pair` → two redeems racing a single-use token. (See N8.) |
| URL-scheme pairing auto-pairs with no confirmation | **PARTIAL** | Raw `authToken=` import is now `#if DEBUG`-gated (`PairedBoxStore.swift:81-85`, documented in README). But `pairingToken` redemption still auto-pairs an arbitrary external `baseURL` with no user confirm and no https requirement (`:52-93`). (See N4.) |
| On-device recognition not requested | **STILL OPEN (legacy path)** | The iOS 26 `SpeechAnalyzer` path is on-device by design. The legacy `SFSpeechRecognizer` path (`SpeechDictation.swift:155-159`) omits `requiresOnDeviceRecognition` → iOS 17–25 partials go to Apple servers, contradicting the README's on-device framing. (See N5.) |
| Temp dictation WAVs leak | **STILL OPEN** | Deleted only on the keyword-HQ success path (`NativeComposerView.swift:276`); manual send / cancel / erase / mic-off / stop nil `recordedAudioURL` without `removeItem` → a WAV leaks per non-keyword dictation. (See N6.) |
| Synchronous main-actor disk writes incl. base64 blobs | **MOSTLY MOOT** | Image blobs no longer persisted — `PairedBox` holds only `authToken`; images live in `@State`; the draft is text-only in `UserDefaults`. `PairedBoxStore.save` is still `@MainActor` sync `Data.write(.atomic)`, but writes a tiny JSON. |
| `mobileTokenFromUrl` duplicated verbatim 3× | **STILL OPEN** | `hub-server.ts:125-132`, `server-box-scope.ts:230-237`, `server-root.ts:332-337` — a security-relevant parser copy not yet hoisted. |

### Nits

| Item | Status | Evidence |
|------|--------|----------|
| `Info.plist` opts into `NSAllowsLocalNetworking`, no HTTPS assertion | **STILL OPEN** | `Info.plist:30-34`; `pair()` accepts an `http` baseURL/redeem with no scheme check. |
| RootView "Pair Box"/"Manage Boxes" duplicate items | **MOOT** | Old RootView menu gone; one "Pair or Manage Boxes" item in `Views/ComposerActionsView.swift:53`. |
| `SWIFT_VERSION = 5.0` (no strict concurrency) | **STILL OPEN** | `project.pbxproj` (4 configs). The new concurrency-heavy `AppleSpeechAnalyzerSession` (`@Sendable` closures, `NSLock`, `@MainActor` hops) is not compiler-checked. |
| Two identical `String.nilIfEmpty` extensions | **STILL OPEN** | `PairedBoxStore.swift:187`, `ChatWebView.swift:431`. |
| `emission.ts` "Voice sends carry no images" comment now false | **STILL OPEN** | `src/frontend/src/input/emission.ts:77` — `createVoiceEmission` now takes `images`, and native `.voice` emissions carry photos. |
| Bridge CustomEvent `detail` never read (queue authoritative) | **OK** | `use-native-bridge.ts:30-37` drains the queue on any event; the `detail` is unused by design. Fine — the queue is authoritative. |
| README materially stale | **FIXED** | `ios-app/README.md` now describes pairing-token redemption, the SpeechAnalyzer/DictationTranscriber/SFSpeechRecognizer tiers, HQ WAV, and DEBUG-only raw-token import. Accurate. Gap: token-at-rest posture (I6) and the manual-send-skips-HQ nuance still undocumented. |

---

## (b) New findings (ranked)

### N1 — MEDIUM: a send while the webview is unloaded/failed hangs the composer forever, message lost
`NativeComposerView.send` (`ios-app/BeeBox/Views/NativeComposerView.swift:200-217`) clears `text`/`images` and sets `lastSentEmission` (→ `isSending` spinner) *before* delivery. RootView appends to `pendingNativeEmissions`; `Coordinator.deliver` **early-returns when `!pageLoaded`** (`ChatWebView.swift:183-185`) and therefore never inserts into `inflightEmissionIDs` and never schedules the 35s receipt timeout. There is **no `didFail`/`didFailProvisionalNavigation` delegate** anywhere in `ChatWebView`.

*Failure:* app opened offline, box down/cold-starting, or a load error → the page hasn't finished loading. A native send clears the input, shows the "Sending to chat…" spinner, and schedules nothing: no timeout, no rejection, no retry. Permanent spinner, typed/photo content gone from the field, recoverable only by reload/nav. This is I3's failure mode resurfacing in the not-yet-loaded window. Fix: schedule the receipt timeout on *acceptance* (independent of `pageLoaded`), and/or add `didFail*` handlers that reject all inflight + pending emissions so the composer restores.

### N2 — MEDIUM/LOW (security): durable mobile token still carried in the chat-URL query string
`ChatWebView.authenticatedChatURL` (`ChatWebView.swift:348-361`) appends `?mobileToken=<durable-token>` to the initial load URL. This is the **iOS-side origin of server-finding S2** — the long-lived device token lands in hub/nginx access logs, `Referer`, and WebKit history, replayable until manual revocation (and tokens never expire). The `localStorage` injection carries the same token as the intended durable channel; the URL copy exists only to satisfy the hub's pre-upgrade auth gate. Same mitigation as S2: scope the URL param to a short-lived single-use handshake token, not the durable device token.

### N3 — MEDIUM: async HQ-transcription window is not locked; double-send / interleave possible
`sendKeywordIntent` (`NativeComposerView.swift:244-258`) launches a `Task` that awaits `ChatAPI.transcribeAudio` (a multi-second upload) and only sets `lastSentEmission` (→ `isSending`) *after* the await, inside `enqueuePreparedVoiceMessage`. During the gap the composer is fully live (status merely reads "Improving transcription…").

*Failure:* user says "send message" → HQ upload runs 2–5 s → user types "hi" and taps the arrow, or toggles the mic → a second emission dispatches / dictation restarts mid-flight. Fix: set a preparing/sending flag *before* launching the Task.

### N4 — LOW (security/phishing): pairing auto-redeems an external baseURL with no confirm and no https requirement
`PairedBoxStore.pair` (`Storage/PairedBoxStore.swift:52-93`) accepts any `beebox://pair?baseURL=<x>&pairingToken=<y>` from outside the app and immediately POSTs the token to `<x>/api/pairing/redeem`, stores the returned token, selects the box, and loads `<x>` in the authed-looking shell — no user confirmation, no scheme check (`http` allowed). Combined with N2 there is no cross-box token leak (it stores the token *that* origin handed back), but it is a clean phishing surface: attacker content renders inside the app chrome. Fix: an explicit "Add this box?" confirm for externally-sourced URLs, and require https.

### N5 — LOW (security): legacy `SFSpeechRecognizer` path sends partials to Apple servers
`SpeechDictation.swift:155-159` omits `requiresOnDeviceRecognition = true`. On iOS 17–25 (or when SpeechAnalyzer is unavailable) live partials stream off-device, contradicting the README's on-device framing. Set the flag or disclose the tier.

### N6 — LOW: temp dictation WAV leak on every non-keyword dictation
Only the keyword-HQ path deletes the temp WAV (`NativeComposerView.swift:276`); manual send, cancel, erase, mic-off, and stop all nil `recordedAudioURL` (`resetDictationState`, `consumeRecordedAudioURL`) without `removeItem` → a WAV orphans in `temporaryDirectory` per non-keyword dictation.

### N7 — LOW: `resolvedSession` masks a 5xx as `"new"`
`ChatAPI.swift:57-59` — a transient server error on `GET /api/chat/default` silently forks a new session for the HQ diarization lookup, restarting speaker-letter numbering. Surface the error instead of falling through.

### N8 — LOW (cleanup): duplicate deep-link entry points race a single-use pairing token
`onOpenURL` (`BeeBoxApp.swift:13-17`) + `AppDelegate.application(open:)`→`PairingURLInbox` (`BeeBoxAppDelegate.swift:4-13`) both fire → two concurrent `store.pair` → two redeem POSTs; the loser's redeem 4xxs on the consumed token. Works today only by luck of `addOrSelectBox` not being reached on the losing branch. Consolidate to one path.

### N9 — NIT: `PairBoxView` ships dev defaults in release
`PairBoxView.swift:6-7` seeds `label = "Local test box"` and `urlString = "http://localhost:3210/main/test1"` in all builds. A release user opening manual-add sees a prefilled localhost URL. Default empty outside DEBUG.

### N10 — NIT: carried-forward tidy-ups
Two `String.nilIfEmpty` copies (`PairedBoxStore.swift:187`, `ChatWebView.swift:431`); `SWIFT_VERSION = 5.0` (no strict-concurrency checking of the new async code); the stale `emission.ts:77` comment.

---

## (c) Test coverage

`BeeBoxTests/SpeechKeywordsTests.swift` (still the only test file) now covers `SpeechKeywords.detect` (comprehensive — send/send-close/control/erase/no-match/at-start/escaping, mirroring the TS doctest), `ProgressiveSpeechTranscript` volatile/final apply, `PairedBox.chatURL` (nativeComposer + session), `ChatWebView.visibleSessionID` parsing, and `CameraImageEncoder` orientation-flattening. Solid on the pure/portable logic.

**Untested (highest-value gaps):**
- `ChatWebView.origin` / `authenticatedChatURL` (the token-in-URL construction, N2) and `startupScript` origin-gating — **the C1 fix has no regression test.**
- `decidePolicyFor` navigation policy — **the C2 fix has no regression test**; a future refactor could silently re-open the off-origin hole.
- The emission-receipt/timeout coordinator state machine (inflight dedup, reject-on-error, 35s timeout, re-delivery after nav) — the core new delivery-guarantee logic and the N1 hole are entirely unverified.
- `PairedBoxStore.pair` scheme/host validation, DEBUG `authToken` gating, redeem success/failure; `PairingURLInbox`.
- `loadPhotos` cap-at-4 + `removeImage` reindex — no guard against an I4 regression.
- Keyword-intent HQ flow (`prepareKeywordMessage`, `joinTranscript`).

**Server:** the July-9 gaps are unchanged. `hub-server-auth.doctest.md` / `mobile-spa-fallback.doctest.md` still exercise only a *valid* token — no negative-path test that a garbage bearer is rejected at the hub (exactly what S1's presence-only downgrade lets through), no revocation-races-verify test (S3), no token-expiry test (there is none).

Net: the security-critical fixes (C1/C2) and the new bridge state machine — exactly the code most likely to regress — have no tests; only the already-stable pure functions do.

---

## (d) Verdict

The redesign is a clear, correct improvement over the July-9 state. Deleting the outbox collapsed I1/I2/I5 at once; the native/web boundary is now coherent — native owns capture, the web owns the single canonical `Emission` pipeline, and a real bidirectional receipt channel with a 35s timeout replaces the eval-success lie (I3). Origin pinning (C2) + main-frame-only origin-gated injection (C1) close the two criticals. Nothing here is an architectural dead-end.

The residual fragility is all edge-finishing: (1) the delivery guarantee has a real hole when the page isn't loaded — no timeout is scheduled and there's no `didFail` handler, so a send can hang the composer and lose the message (N1); (2) the durable token still rides in a URL query param (N2 = S2) and sits in plaintext JSON rather than the Keychain (I6); (3) the async HQ window isn't locked (N3); and (4) the C1/C2 fixes and the receipt state machine are untested.

Three carry-overs deserve explicit call-out:

- **The plan's hardest question is still unresolved.** `ios-companion-app.md` named **device-token/web-session convergence and user-identity unification** as *the* blocker (the missing `ios-pairing-auth.subplan.md`). In the current `server-box-scope.ts createContext` (`:185-195`), a pure mobile request is `authed: true` but **`user` stays `null` and `isOwner: false`** — native chat sends attribute to nobody. This is unchanged since July 9 and remains an un-subplanned design decision on the plan's hardest open question.
- **S1/S2/S3 are the oldest still-open majors.** All three server findings survive untouched from July 9 and are now the longest-standing unaddressed items in the batch. None is a straight data-disclosure bypass (the box re-verifies), so the batch stays **major**, not critical — but they should land before the deployed hub relies on them.
- **I6 (Keychain) and legacy on-device STT (N5)** are still places the code quietly diverges from stated plan commitments — decide and document.

Priorities: fix **N1** and the **token-handling pair (N2/I6)** before this shell is trusted on real devices; land **S1/S2/S3** before the hub depends on them; the rest are cleanups. This is a punch list, not a rewrite mandate — where you disagree, say so.
