---
title: "iOS Companion — code review (2026-07-09)"
status: active
workstream: unknown
issues: []
---
# iOS Companion — code review (2026-07-09)

**Superseded:** follow-up review at `ios-companion-review-2026-07-17.md` (2026-07-17) — most iOS findings closed by the composer redesign; server findings S1–S3 still open there.

**Reviewer:** Claude (Fable), with three Opus sub-reviewers (iOS Swift, server auth, native-emission bridge). Spot-checked the load-bearing findings against the code directly.
**Scope:** everything under `ios-app/`, plus the box-side mobile pairing/auth and native-emission bridge added across commits `f5bcd2fc → 348de275`.
**Audience:** Codex, who wrote this. This is a punch list, not a rewrite mandate — where you disagree, say so; several items are judgment calls flagged as such.

## TL;DR

The core primitives are good. The **pairing token primitive** (`core/mobile/pairing.ts`) is well-built: 256-bit `crypto.randomBytes` tokens, SHA-256 hashed at rest, `0o600`, timing-safe compare, box-scoped, single-use TTL tickets, owner-gated minting. The **web-side bridge** (`native-emission.ts` + the `embed=1` gating) is the right shape: a `window` queue drained on mount with the CustomEvent as a wake signal, reusing the canonical `Emission`/`assembleChatMessage`/`dispatchEmission` pipeline instead of forking it, contract shapes matching byte-for-byte across the Swift/TS boundary.

The problems cluster in two places: **(1) the iOS app is half-migrated** — the old direct-HTTP outbox/retry stack was left in place, dead, beside the new bridge, and the bridge itself is fire-and-forget with no real delivery guarantee; **(2) the box-side integration plumbing** weakened the hub auth wall and leaks the device token into URLs and logs. None of the server findings is a straight data-disclosure bypass (the box re-verifies before serving), so I'd rate the batch **major**, not critical — but the three server majors should land before this touches the deployed hub.

Cross-referencing the plan (`ios-companion-app.md`): this work is **Tracks A, C, D, G, H partially built ahead of their subplans**. Track A's own plan says `docs/plans/ios-pairing-auth.subplan.md` is a blocker and lists "device-token/web-session convergence" and "user-identity unification" as *the hardest problem*. That subplan doesn't exist yet, and the identity-unification question (below, §Plan-alignment) looks unresolved in the code.

---

## Critical

### C1 — Auth token injected into `localStorage` on every frame, including cross-origin iframes
`ios-app/CallbackBox/Views/ChatWebView.swift:154,160`

The startup `WKUserScript` does `window.localStorage.setItem('callbackbox.mobileAuthToken', …)` and is injected with `forMainFrameOnly: false`. `localStorage` is per-origin, so the script also runs inside any cross-origin `<iframe>` the chat transcript renders and writes the bearer token into *that* origin's storage.

*Failure:* the box chat page embeds any third-party iframe (oembed, external card HTML, analytics); that origin's JS reads `callbackbox.mobileAuthToken` from its own `localStorage` and walks off with a valid, long-lived box credential. Fix: `forMainFrameOnly: true`, and gate the injection on the box origin. (Both the iOS and bridge sub-reviewers flagged this independently.)

### C2 — No navigation policy; the token script can run on an attacker origin
`ios-app/CallbackBox/Views/ChatWebView.swift:39-42`

`allowsBackForwardNavigationGestures = true`, the token script is `atDocumentStart`, and there is no `decidePolicyFor navigationAction`. Nothing pins the main frame to the box origin.

*Failure:* a link, redirect, or open-redirect in the chat page navigates the main frame off-origin; the document-start token script (C1) runs there and seeds the secret into the attacker origin's `localStorage`. Fix: a navigation delegate that cancels cross-origin main-frame loads (hand them to Safari).

---

## Major — server / box-side

### S1 — Hub auth downgraded from "verify token" to "a token is present"
`callback-box/src/hub/hub-server.ts:126-130` (`hasMobileAuthAttempt`), used at `:390` and `:442`

`hasMobileAuthAttempt` checks only that an `Authorization: Bearer …` header or `?mobileToken=…` param *exists* — it never validates it. When true, the request skips the hub auth wall and is proxied to the box, which then re-verifies. Commit `ae36e3c2` verified for real here (`verifyMobileBearer(...) || verifyMobileToken(...)`); the "fix mobile hub auth fallback" commit `b2db5a85` deliberately replaced that with presence detection. Verified against the current code.

*Failure:* an unauthenticated attacker who guesses a slug sends `GET /<slug>/` with `Authorization: Bearer anything`. Presence check passes → hub bypasses auth → `resolveEndpoint(slug)` **cold-starts the box** and resets its idle timer before the box 401s the bogus token. That's (a) an unauthenticated box-wake / resource-exhaustion vector the hub wall previously blocked, and (b) a box-existence oracle: valid-slug-bad-token gets proxied (box 401), unknown-slug redirects to `/auth/login` — distinguishable. The downgrade also looks unnecessary: the hub already verifies on the same request in `listMobileAuthorizedBoxes` (`:132-141`), and `readDeviceStore` reads a file, so it works for a stopped box too. Recommend restoring real verification at the hub.

### S2 — Device token carried in a URL query parameter (`?mobileToken=`)
`callback-box/src/frontend/src/api-core.ts` (`getWebSocketUrl`), consumed at `hub-server.ts:117-124`, `server-box-scope.ts` / `server-root.ts` `mobileTokenFromUrl`

The long-lived device token is placed in the WS URL query string and accepted there for any GET. Query strings land in access logs, reverse-proxy logs, `Referer` headers, and browser history. A token recovered from any of those is replayable until manually revoked — and tokens never expire (S5).

*Failure:* prod nginx/hub access logs now contain `…/trpc?mobileToken=<valid-token>` on every embedded-chat WS upgrade; anyone with log access has a working credential. The header path (`connectionParams`/`mobileAuthHeaders`) is the safe channel; the URL copy exists only because the hub WS-upgrade gate can't read tRPC `connectionParams` (they arrive post-upgrade). If the URL channel has to stay, scope it to a short-lived single-use handshake token, not the durable device token.

### S3 — Device-store read-modify-write is unlocked; a revocation can be silently erased
`callback-box/src/core/mobile/pairing.ts:147-160` (`verifyMobileToken` writes `lastUsedAt`) vs `:162-169` (`revokeMobileDevice`)

Every successful verify does a full read-modify-write of the shared JSON with no `withCardLock`/`file-lock` — the CLAUDE.md "same-file read-modify-write goes through `withCardLock`" rule. Concurrent writers clobber.

*Failure:* owner clicks "Revoke" while the device has an in-flight request. `verifyMobileToken` reads (not yet revoked) → `revokeMobileDevice` reads, sets `revokedAt`, writes → `verifyMobileToken` writes back its stale copy without `revokedAt`. **The revocation is gone and the compromised device keeps working.** Separately, `writeFileSync` is non-atomic (no temp+rename), so a crash mid-write corrupts the store and locks out all devices. Wrap the RMW; write atomically.

---

## Major — iOS app

### I1 — The offline outbox is dead code; sends are fire-and-forget with no delivery guarantee
`ios-app/CallbackBox/Storage/OutboxStore.swift:22` (`enqueue` — zero callers, verified by grep)

`NativeComposerView.send` (`:126-143`) sets `statusText = "Sent to chat."` and calls `onSendEmission`, which hands the text to the webview via `evaluateJavaScript("window.callbackboxNativeReceive(…)")`. That JS merely pushes onto an in-page queue. So the entire outbox stack — `enqueue`, `OutboxStore.send`/`retryPending`, `QueuedMessage`, `ChatAPI.send`, `messageId` dedup, and the whole `OutboxListView` retry/discard UI — is unreachable. The queue implies durability the app doesn't have.

*Failure:* user is offline or the web layer's own POST fails; `evaluateJavaScript` still "succeeds" (the JS ran), `onEmissionHandled` fires, `pendingNativeEmission` clears — message gone, no retry, no error, UI says "Sent." Decide the architecture: either route composed messages through `enqueue` + a real delivery-confirmation from the web app, or delete the outbox and own the fire-and-forget honestly. Straddling both is the worst option.

### I2 — Two divergent send paths coexist; the dead one can still fire on upgrade with a different wire format
`ios-app/CallbackBox/Views/NativeComposerView.swift:121-122` (`.task` → `outbox.retryPending`) + `ios-app/CallbackBox/Services/ChatAPI.swift:109` (`assembleMessage`)

`retryPending(for:)` still runs from `.task(id: box.id)` on every composer appearance and sends via the legacy `ChatAPI.assembleMessage` — a second wrapper that diverges from the web's `chat-assemble.ts` (omits the witness attrs like `zoomed-view` / `time-passed`, folded `<user-selection>`s).

*Failure:* a user upgrading from a build that persisted `outbox.json` entries — on next launch those stragglers POST via direct HTTP, bypassing the visible web chat entirely, in a wire format the box no longer produces elsewhere. This is the concrete reason I1's "pick one path" matters: today the dead path isn't fully dead.

### I3 — Emission marked "handled" on JS-eval success, not on delivery
`ios-app/CallbackBox/Views/ChatWebView.swift:80-96` (`deliver`) + gate at `InteractiveChat.tsx:280`

`onEmissionHandled(emission.id)` fires when `evaluateJavaScript`'s completion has `error == nil` — i.e. the JS function ran, not that anything reached the server. Worse, if the webview has navigated off the embedded chat route (`embed=1` no longer matches — and `allowsBackForwardNavigationGestures` + card links make that reachable), the bridge is disabled, items pile into `callbackboxNativeQueue`, `pendingNativeEmission` still clears, and there's no retry.

*Failure:* user taps a card link → lands on `/browse/...` → types and sends → composer says "Sent to chat." → message is invisibly queued, delivered only if they happen to navigate back. Delivery confirmation should come back *from* the web app over the `callbackboxSession` channel, not from eval success.

### I4 — Removing one photo attachment deletes all of them
`ios-app/CallbackBox/Views/NativeComposerView.swift:302-308` (`removeImage`) → `:113-117` (`onChange`) → `:282-299` (`loadPhotos`)

`removeImage` reindexes `images`, then sets `selectedPhotoItems = []`. That mutation fires `onChange(of: selectedPhotoItems)` → `loadPhotos(from: [])` → the loop iterates nothing → `images = loaded` = `[]`. Verified the chain against the code.

*Failure:* user attaches 4 photos, taps ✕ on one — all four vanish. Don't reset `selectedPhotoItems` in a way that triggers a full `loadPhotos` wipe.

### I5 — Message body embedded in box markup unescaped
`ios-app/CallbackBox/Services/ChatAPI.swift:109-114` (`assembleMessage`)

`assembleMessage` builds `"<\(tag)…>\(message)</\(tag)>"` with raw user text. `SpeechKeywords.keywordTag` escapes `&`/`"`; the message body does not.

*Failure:* dictated/typed text containing `<`, `&`, or a literal `</speech>` produces malformed markup the box parses — corrupting the turn or injecting attacker-controlled tags into the box's prompt pipeline. Reachable via the outbox/`ChatAPI` path (I1/I2). Escape the body. (Note: the live bridge path assembles server-side via `chat-assemble.ts`, so this bites only the legacy path — another reason to kill it.)

### I6 — Auth token persisted in plaintext JSON, not the Keychain
`ios-app/CallbackBox/Storage/PairedBoxStore.swift:142-144`

`authToken` is a field of `PairedBox`, JSON-encoded into `Library/Application Support/paired-boxes.json`. No Keychain, no `NSFileProtectionComplete`, no `CODE_SIGN_ENTITLEMENTS` in `project.pbxproj`. Track C's plan explicitly says "a `PairedBox` model persisted in the **keychain** (token) + app storage (metadata)" — so this is a departure from the plan, not just from Apple convention.

*Failure:* the token sits in an app-container file included in unencrypted local backups, readable at `…UntilFirstUserAuthentication`; a backup extraction or jailbroken read yields the long-lived box bearer token. Bearer tokens belong in the Keychain (ideally `…ThisDeviceOnly`).

### I7 — Audio session never deactivated after dictation
`ios-app/CallbackBox/Services/SpeechDictation.swift:94-96` (activate `.duckOthers`) vs `:34-49` (`stop()`)

`stop()` never calls `setActive(false, options: .notifyOthersOnDeactivation)`. After one dictation, other apps' audio stays ducked and the session stays active until the app is killed.

### I8 — Recorded WAV written in the mic's native float format
`ios-app/CallbackBox/Services/SpeechDictation.swift:103-107`

`format = inputNode.outputFormat(forBus: 0)` (typically 32-bit float) → `AVAudioFile(forWriting:…settings: format.settings)`, then uploaded as `audio/wav` to `chat/transcribe-audio`.

*Failure:* if the server WAV decoder expects 16-bit integer PCM, it rejects/mis-decodes the float file, so the HQ transcription leg silently no-ops for every voice message and you're left with on-device text only. Worth checking the server side accepts float WAV; if not, convert to 16-bit PCM before upload. (Flagging as major-ish because it defeats the whole HQ path if true — but I didn't verify the server decoder, so confirm before acting.)

---

## Minor

- **Hub `mobileToken` presence check enables a box-existence oracle even after S1 is fixed** — anchor and slug-scope; see S1.
- **`isPairingRedeemUrl` suffix match is unanchored** — `routes/pairing.ts:10-13` uses `path.endsWith("/api/pairing/redeem")`, so `/anything/foo/api/pairing/redeem` matches. Low risk (token-gated, read-only), but anchor on the slug boundary.
- **Device tokens never expire** — `pairing.ts` `MobileDevice` has no `expiresAt`; only `revokedAt` is checked. Combined with S2 (URL leak) and S3 (revocation can be lost), a leaked token is valid indefinitely. Consider a max lifetime / rotation.
- **Pending pairings live only in process memory** — `pairing.ts` `pendingPairings = new Map(...)` with a 10-min TTL, but a lazy hub idle-stops a box (often 5 min). If the box idle-stops or restarts between mint and redeem, the ticket is gone and redemption fails with a generic "invalid or expired" — racy with exactly the flow this feature exists for.
- **`lastUsedAt` write on every authenticated request, multiplied** — `pairing.ts:154-155` blocking `writeFileSync` on each match; `/api/boxes` iterates and read-writes *every* box's store, then `addBoxAuthHook` and `createContext` re-verify. Throttle `lastUsedAt` and dedupe the verify calls per request.
- **`resolvedSession` returns `"new"` on any non-2xx** — `ChatAPI.swift:102-104`; a transient 5xx forks a fresh session instead of surfacing the error.
- **Duplicate deep-link handling** — `CallbackBoxApp.swift:15-25` (`onOpenURL`) and `PairingURLInbox` both fire for one URL → two `redeemPairing` POSTs; the second fails on a single-use token. Consolidate to one path.
- **URL-scheme pairing auto-pairs with no confirmation** — `PairedBoxStore.pair` (`:52-88`) accepts an arbitrary `baseURL` and even a raw `authToken` from the query string and pairs automatically. `callbackbox://pair?baseURL=<attacker>&authToken=<x>` silently points the app at an attacker box. Add an explicit confirm before adding a box from an external URL.
- **On-device recognition not requested** — `SpeechDictation.swift:98-100` doesn't set `requiresOnDeviceRecognition`; live partials go to Apple's servers. The plan sells "on-device STT (offline dictation)" as a core justification — worth a deliberate choice/disclosure here.
- **Temp dictation WAVs leak** — `SpeechDictation.swift:104-108` writes to `temporaryDirectory`; only deleted on the HQ success path. Cancel/erase/manual-stop nils `recordedAudioURL` without deleting.
- **Synchronous main-actor disk writes incl. base64 image blobs** — `OutboxStore.save`/`PairedBoxStore.save` are `@MainActor` sync `Data.write`; `QueuedMessage.images` holds full base64, so persisting a photo message blocks the main thread on a multi-MB write.
- **`mobileTokenFromUrl` duplicated verbatim 3×** — `hub-server.ts:117-124`, `server-box-scope.ts`, `server-root.ts`. A security-relevant parser copy-pasted; hoist one shared helper into `core/mobile/pairing.ts`.

## Nits

- `Info.plist:30-34` opts into `NSAllowsLocalNetworking` but the app never asserts HTTPS for token/redeem traffic — relies implicitly on ATS. An explicit scheme check in `pair` would be clearer (and matches the "bias toward strict / fail-closed" house style).
- `RootView.swift:113-121` — "Pair Box" and "Manage Boxes" menu items both just set `showingPairSheet = true`; identical behavior, two labels.
- `project.pbxproj` sets `SWIFT_VERSION = 5.0` — no Swift 6 strict-concurrency, so the `@MainActor` hops and the `@Sendable` audio-tap closure aren't compiler-checked.
- Two identical private `String.nilIfEmpty` extensions (`PairedBoxStore.swift:181-185`, `ChatWebView.swift:171-175`).
- `emission.ts:75-78` comment "Voice sends carry no images or file attachments today" is now false — native voice emissions carry images.
- The bridge's dispatched CustomEvent `detail` is never read (the listener always drains the queue). Harmless and good for dedup, but add a one-line comment that the queue is authoritative so nobody "fixes" the listener to read `event.detail` and double-processes.

---

## Test coverage

- **iOS:** only `SpeechKeywordsTests.swift` exists — covers `SpeechKeywords.detect`/`appendSendKeywordTag` (mirrors the TS doctest) and `ChatWebView.visibleSessionID`. **Untested:** the `OutboxStore` state machine, `PairedBoxStore.pair` URL validation + redeem, `ChatAPI.assembleMessage` (would have caught I5), the photo add/remove logic (would have caught I4), `PairingURLInbox`. The three logic bugs I4/I5 and the whole outbox are in untested units.
- **Server:** `hub-server-auth.doctest.md` and `mobile-spa-fallback.doctest.md` exercise only the happy path — a *valid* token. **No negative-path test** that a garbage bearer is rejected at the hub, which is exactly what regressed in S1; the presence-only downgrade passes both doctests. Add `Bearer garbage` → valid slug asserts no cold-start / rejected. Also untested: revocation racing an in-flight verify (S3), token expiry (there is none — see minors), and the valid-slug-bad-token vs unknown-slug oracle.
- **Bridge:** `native-emission-bridge.doctest.md` tests only the pure `nativeEmissionFromDetail` converter (3 cases). Untested: queue drain/mount ordering, the event listener, native-side dedup (`deliveredEmissionID`), the `embed` gate, JS-error retry, image passthrough to `/chat/send`, malformed-image filtering in `parseNativeImages`. The tested surface is the least likely to break.

## README accuracy

`ios-app/README.md` is materially stale. It frames the app as "intentionally thin," "Manual pairing for now," and "this scaffold does not invent a token format ahead of that design" — but the shipped code implements pairing-token redemption, bearer storage + `localStorage` injection, HQ audio transcription, native dictation with keyword commands, image attachments, and an outbox UI. A reader badly underestimates the surface area, and the security-relevant token handling (C1/I6) is undocumented.

---

## Plan-alignment notes (for the parent plan, not bugs)

1. **Track A's subplan is a documented blocker that doesn't exist yet.** `ios-companion-app.md` §Subplans names `docs/plans/ios-pairing-auth.subplan.md` as "the highest-priority subplan," blocking A and transitively C–H, and lists **device-token/web-session convergence** and **user-identity unification** as *the hardest problem*. The code took a different tack than the plan sketched: rather than "a `cb_session`-compatible cookie installed into the `WKWebView`," it injects a bearer into `localStorage` and re-verifies mobile tokens at every layer. That may be fine, but it's an un-subplanned design decision on the plan's hardest open question — worth writing up so the plan and code agree.

2. **User-identity unification looks unresolved.** The plan (§Track A, Failure modes row "Device-token auth passes but chat attribution is null") warns that `getSessionUser` reads the `cb_session` cookie only, so a device-token request authenticates but attributes chat to nobody unless device-token identity flows through `resolveRequestIdentity` / tRPC context / `getSessionUser`. In the current `server-box-scope.ts createContext`, mobile tokens set `authed: true` but `user` stays whatever `resolveRequestIdentity` returned (null for a pure mobile request), and `isOwner` is false. Confirm whether native sends land attributed or null — the plan called this the subplan blocker.

3. **Keychain departure (I6)** and **on-device STT not actually on-device** (minor) are both places the code quietly diverges from stated plan commitments. Not wrong, but decide and document.

4. **Half-migrated iOS send stack (I1/I2)** is the single highest-leverage cleanup: finishing the bridge migration (delete `enqueue`/`OutboxStore.send`/`QueuedMessage`/`OutboxListView`, keep only `ChatAPI.transcribeAudio`) collapses I1, I2, and I5 at once and removes the divergent wire format. If instead the outbox is meant to be the durable-queue answer to the plan's "critical gap: offline send queue," then wire it up for real and make the bridge its transport — but right now it's neither.
