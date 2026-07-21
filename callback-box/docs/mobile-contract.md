# Cross-Platform Mobile Contract

**What this document is.** The living wire/behavioral contract between a callback-box (its
frontend and server) and every native mobile client that embeds it — today the iOS companion
app, tomorrow a planned Android app. It is not a point-in-time report: it is the specification
that all three sides implement and must be kept true.

**The sync rule.** Any commit that changes a contract surface listed here — a URL scheme param, an
auth-token carrier, a webview query param, a bridge channel name, a JSON field, an HTTP
request/response shape, or a server-side mobile-awareness branch — **must update this document in
the same commit.** The Contract Surface Index (§7) and the mirrored-constants list (§8) are the
artifacts an agent diffs a change against; if your change touches a row there, it touches this
doc. The process that enforces this — how iOS and Android are kept in parity, who reviews a
contract change — is defined in `docs/implemented-plans/mobile-parity-sync.md`.

**Path conventions.** Box code paths are relative to `callback-box/`; iOS paths are under
`ios-app/CallbackBox/`. Anchors name a file plus the identifier (function/struct/const) inside it —
never line numbers, which rot. A paired box's `baseURL` already includes the hub slug
(e.g. `http://127.0.0.1:3210/main/test1` in dev, `https://host/<slug>` in prod), so every native
HTTP path below is `<baseURL>/api/...`.

**Drift legend.** For each surface, drift is either **LOUD** (a mismatch produces a visible
error / 4xx / 5xx / status message) or **SILENT** (the mismatch is swallowed — message lost,
composer not suppressed, wrong attribution — with no error surfaced).

---

## 1. Pairing

### 1.1 `callbackbox://pair` deep link

- **Direction:** external (QR scan / deep link / `simctl openurl`) → native.
- **Wire shape:** `callbackbox://pair?baseURL=<url>&label=<name>&pairingToken=<token>` (all
  URL-encoded). Query params:
  | param | aliases | required | notes |
  |---|---|---|---|
  | `baseURL` | `url` | yes | box base URL incl. slug; must have scheme+host or URL is rejected |
  | `label` | — | no (default `"Callback Box"`) | display name |
  | `pairingToken` | `token` | no | short-lived ticket, redeemed for a device token |
  | `session` | — | no | initial chat session id |
  | `authToken` | — | **DEBUG builds only** | raw device token imported directly, no redeem |

  The box generator emits **only** `baseURL`/`label`/`pairingToken` — never `session` or `authToken`.
- **Anchors:**
  | side | anchor |
  |---|---|
  | iOS scheme registration | `ios-app/CallbackBox/Info.plist` — `CFBundleURLSchemes = ["callbackbox"]`, name `app.callbackbox.ios.pairing` |
  | iOS parser | `ios-app/CallbackBox/Storage/PairedBoxStore.swift` — `PairedBoxStore.pair(from:)` (requires `scheme == "callbackbox"` AND `host == "pair"`) |
  | box link generator | `src/frontend/src/components/settings/CompanionPairingSection.tsx` — `pairingDeepLink(token)`, `boxBaseUrl()`, `qrSvg()` |
  | box render site | `src/frontend/src/pages/settings/SettingsPage.tsx` — `<CompanionPairingSection />` |
- **Drift:** SILENT. A bad/unparseable URL makes `pair` return `false` with no toast.
- **Known duplicate-dispatch hazard:** both `CallbackBoxApp.onOpenURL` and
  `CallbackBoxAppDelegate.application(open:)` (→ `PairingURLInbox.shared.accept` →
  `CallbackBoxApp.onReceive`) can fire for one URL, producing two redeem POSTs; the second fails on
  the single-use token and is swallowed. Carried as an open risk (§9).

### 1.2 Pairing-ticket mint (owner-gated)

- **Direction:** box web UI (Settings) → box server. **Not called by native code.**
- **Wire shape:** output `PairingTicket { token: string; expiresAt: string /* ISO */ }`. Token is
  `crypto.randomBytes(32).toString("base64url")` (256-bit), stored only as a SHA-256 hash in an
  in-process `Map` keyed by `tokenHash`. TTL `DEFAULT_PAIRING_TTL_MS = 10 min`, single-use.
- **Anchors:**
  | side | anchor |
  |---|---|
  | box endpoint | `src/webapp/trpc/routers/pairing.ts` — `pairing.createTicket` (`ownerProcedure`) |
  | box impl | `src/core/mobile/pairing.ts` — `createMobilePairingTicket(boxRoot, { createdBy })`, `pendingPairings`, `DEFAULT_PAIRING_TTL_MS`, `pruneExpiredPairings` |
- **Drift:** LOUD (tRPC error surfaces in Settings).

### 1.3 `POST /api/pairing/redeem`

- **Direction:** native → box (unauthenticated; the ticket IS the credential).
- **Request (native `PairingRedeemRequest`):**
  ```json
  { "pairingToken": "<string>", "deviceLabel": "<UIDevice.current.name>" }
  ```
  Headers: `Content-Type: application/json`, `User-Agent: CallbackBox-iOS/0.1`.
- **Server body schema (`RedeemBody`):** `{ pairingToken: string.min(1), deviceLabel?: string.min(1) }`;
  `deviceLabel` defaults to `"iOS companion"` when absent.
- **Response 200:**
  ```json
  { "boxSlug": "<slug>", "label": "Callback Box", "deviceId": "<uuid>",
    "deviceLabel": "<label>", "token": "<deviceToken>" }
  ```
  iOS reads **only** `token`. The device token is `crypto.randomBytes(32).toString("base64url")`,
  returned once in cleartext, then only its SHA-256 hash is persisted.
- **Errors:** 400 `{ error }` (bad body); 401 `{ error: "Pairing code is invalid or expired." }`
  (bad/expired/used/wrong-box). iOS maps any non-2xx → `URLError(.userAuthenticationRequired)` →
  `pair` returns `false`.
- **Anchors:**
  | side | anchor |
  |---|---|
  | native caller | `ios-app/CallbackBox/Storage/PairedBoxStore.swift` — `PairedBoxStore.redeemPairing(baseURL:pairingToken:)`, types `PairingRedeemRequest`/`PairingRedeemResponse` |
  | box endpoint | `src/webapp/routes/pairing.ts` — `POST /api/pairing/redeem`, `RedeemBody` |
  | box device store | `src/core/mobile/pairing.ts` — `MobileDevice { id,label,tokenHash,createdAt,lastUsedAt?,revokedAt? }`, `writeDeviceStore` (`<boxRoot>/.callback-box/mobile-devices.secret.json`, mode `0o600`) |
  | hub wall allowance | `src/hub/hub-server.ts` — `isMobilePairingRedeem` |
  | box-scope allowance | `src/webapp/server-box-scope.ts` — `isPairingRedeemUrl` |
- **Drift:** LOUD server-side (401/400); SILENT on iOS (maps to `false`, no toast).
- **Benign field drift:** iOS ignores `boxSlug`, `label`, `deviceId`, `deviceLabel`. A platform may
  begin honoring these without a server change.

### 1.4 Device listing / revocation (box UI only, not native)

- `pairing.devices` (query) → `listMobileDevices`; `pairing.revokeDevice` (mutation) →
  `revokeMobileDevice`. Both `ownerProcedure`. UI in `CompanionPairingSection.tsx`. No native
  participation.

---

## 2. Auth — device-token carriage

The redeem step (§1.3) yields a durable device token. It is **header-only on the wire**: it must
never appear in a URL. Because a device token has no expiry (`MobileDevice` tracks only
`revokedAt`), any copy that lands in an access log, a `Referer`, or WebKit history is replayable
until a human manually revokes the device — so a URL carrier turns a routine leak into an
unbounded one.

Ordinary requests therefore carry the durable token in an `Authorization` header, and everything
the browser sends on its own — navigations it initiates itself, and the tRPC WebSocket upgrade,
which the browser `WebSocket` API cannot attach headers to — rides a **short-lived `cb_mobile`
cookie** minted from that token.

### 2.1 Carriers

| carrier | wire shape | who sets it | who reads it |
|---|---|---|---|
| localStorage | key `callbackbox.mobileAuthToken` = `<token>` | native startup `WKUserScript` (`ChatWebView.swift`) writes it, gated on `origin === allowedOrigin`, `forMainFrameOnly:true` | web `mobile-auth.ts` — `getMobileAuthToken()`, `mobileAuthHeaders()`, `withMobileAuth()` |
| `Authorization: Bearer <token>` header | HTTP header | native `ChatAPI.applyAuth`; web `mobileAuthHeaders()` (applied to `/chat/send`, `/chat/transcribe-audio`) | box `verifyMobileBearer` |
| `cb_mobile` cookie | `Set-Cookie: cb_mobile=<signed>; HttpOnly; Secure; SameSite=Lax; Path=/<slug>; Max-Age=3600` | box `webapp/mobile-cookie.ts` — issued on any mobile-authenticated response, and by `POST /api/pairing/session` | box `core/mobile/mobile-session.ts` · `verifyMobileSession` |

- **Mirrored key:** `callbackbox.mobileAuthToken` is defined native-side inline in the
  `ChatWebView.swift` startup script and box-side as `MOBILE_AUTH_TOKEN_STORAGE_KEY` in
  `src/frontend/src/lib/mobile-auth.ts` (comment-linked).
- **The initial webview navigation** (`ChatWebView.request()`) sets `Authorization` on the
  `URLRequest` and loads a plain URL. The response's `Set-Cookie` seeds WebKit's own cookie
  store, which is what carries every later request. The cookie is deliberately NOT written via
  `WKHTTPCookieStore.setCookie` before loading — that API's completion handler is
  documented-unreliable and can hang (WebKit bug 185483).
- **Cookie lifetime and revocation.** The cookie lives one hour and is re-issued on any
  authenticated response past its halfway point; renewal re-reads the device store
  (`isMobileDeviceActive`), so once a revoke is committed and visible the next renewal declines
  to re-issue and actively clears the existing cookie. That revocation-check read is **lock-free
  and outside `withDeviceStoreLock`** (to keep the renewal path filesystem-cheap): a renewal that
  reads the pre-revoke store *concurrently* with an in-flight revoke can still mint one more
  full-TTL cookie, so the precise guarantee is **no cookie is issued more than one TTL (one hour)
  after a revoke commits** — not that renewal stops on the same instant the revoke lands. A signed
  cookie also cannot be invalidated before its own `exp`. Both effects collapse to the same bound:
  **revocation takes effect within at most one hour** on an active session. That bound is the
  deliberate trade for a verification path that costs no per-request lock. An *unreadable* store
  (as opposed to genuinely empty) fails closed — the renewal check treats the device as inactive.
- **Recovery.** A WebKit-initiated reload re-issues the bare URL with no `Authorization` header,
  so a lapsed cookie 401s. The web layer then calls `POST /api/pairing/session` with the token
  from localStorage and retries once (`lib/trpc/index.ts` · `trpcFetch`). This is why the
  localStorage carrier still exists.

### 2.2 Verification (box)

| anchor | role |
|---|---|
| `src/core/mobile/pairing.ts` — `verifyMobileBearer(boxRoot, authHeader)` | parses `Bearer ` prefix, delegates |
| `src/core/mobile/pairing.ts` — `verifyMobileToken(boxRoot, token)` | SHA-256 + timing-safe compare vs non-revoked devices; writes `lastUsedAt` back |
| `src/core/mobile/pairing.ts` — `isMobileDeviceActive(boxRoot, deviceId)` | read-only revocation check, used when renewing a cookie |
| `src/core/mobile/mobile-session.ts` — `verifyMobileSession(boxRoot, cookie)` | per-box HMAC + `exp` check; no filesystem access |
| `src/core/mobile/request-auth.ts` — `resolveMobileRequestAuth(boxRoot, headers)` | **the one resolver every mobile gate uses** — cookie first, then bearer |
| `src/webapp/server-box-scope.ts` — `addBoxAuthHook` | box auth preHandler: accepts agent bearer or `resolveMobileRequestAuth`; renews the cookie |
| `src/webapp/server-box-scope.ts` — `createContext` | tRPC context: `mobileOk` → `authed:true` |
| `src/webapp/server-root.ts` — `listMobileAuthorizedBoxes` / `isMobileAuthorizedForBox` | real verify for `/api/boxes` box list |

### 2.3 Identity NOT unified (structural)

A pure mobile request sets `authed: true` but leaves `user: null` and `isOwner: false` in the tRPC
context (`server-box-scope.ts` — `createContext`). Native chat sends therefore attribute to nobody.
This is a known open risk (§9), not an incidental bug — a platform implementer must expect
authenticated-but-unattributed behavior.

### 2.4 Failure semantics

- Box API/WS unauth → 401 `{ error: "Not authenticated" }`.
- HTML nav unauth: standalone → redirect `/auth/login`; behind hub → 401 with a spoof-explanation
  detail (`server-box-scope.ts`).
- LOUD to the client, but native surfaces most as generic errors.

---

## 3. Webview embedding

### 3.1 The URL the app loads

- **Wire shape:** `<baseURL>/chat?nativeComposer=1[&session=<id>][&mobileToken=<token>]`.
- **Contract param:** `nativeComposer=1` (NOT the legacy `embed=1` — see §9). Mirrored: native
  `PairedBox.chatURL` builds `nativeComposer=1` (with an in-code "keep in sync" comment); web
  `ChatPage` reads it and the router schema declares it.
- **Anchors:**
  | side | anchor |
  |---|---|
  | native URL build | `ios-app/CallbackBox/Models/PairedBox.swift` — `PairedBox.chatURL`; `ios-app/CallbackBox/Views/ChatWebView.swift` — `authenticatedChatURL` (appends `&mobileToken=`) |
  | web parse | `src/frontend/src/pages/ChatPage.tsx` (reads `embed` + `nativeComposer`); `src/frontend/src/router.tsx` (route schema `nativeComposer`) |
- **Drift:** SILENT (wrong/missing param → web composer not suppressed, bridges never enabled).

### 3.2 What `nativeComposer` changes web-side

- `InteractiveChat.tsx` — `usesNativeComposer = nativeComposer === true`;
  `usesNativeShell = isEmbedded || usesNativeComposer`.
- `InteractiveChat-view.tsx` — suppresses the web composer when `embedded || nativeComposer`.
- `InteractiveChat.tsx` — enables `useNativeEmissionBridge({ enabled: usesNativeShell })` and
  `useNativeLocationBridge({ enabled: usesNativeShell, boxSlug })`.
- **Viewport/safe-area is owned by native, not the web contract** — `NativeComposerView`,
  `RootView` (safe-area insets), `ChatWebView` (inline media playback).

### 3.3 Script-message channels (web → native)

Four channels, all web→native. On iOS they are `WKScriptMessageHandler` names registered on the
`userContentController`; the transport is platform glue (§10), the channel names and payloads are
the contract.

| channel name | payload (web → native) | native handler |
|---|---|---|
| `callbackboxSession` | `window.location.href` (string) | `Coordinator.userContentController` → `onSessionChange(visibleSessionID)` |
| `callbackboxEmissionReceipt` | `Receipt` object (§4.2) | → `receiveEmissionReceipt` |
| `callbackboxLocationResult` | `{ id, success, message }` | → `receiveLocationResult` |
| `callbackboxComposerCommand` | V1 composer command (§4.4) | → `receiveComposerCommand` |

- Native-side registration: `ChatWebView.swift` (`userContentController.add(_, name:)` for all four).
- Session reporting: the native-authored startup script wraps `history.pushState`/`replaceState` +
  `popstate` and posts `location.href` on every nav; native extracts `?session=` via
  `visibleSessionID`. Origin-checked at both post and receipt time.
- **Web posts via the platform-neutral `window.callbackboxNativePost(channel, payload)`** (since
  2026-07-17, Track 0 of `docs/plans/android-companion-app.md`): each shell's document-start script
  defines the function; payloads always cross the neutral path as **strings** (`Receipt` and
  location-result objects are `JSON.stringify`-ed; the session href is passed through as-is). Web
  side: `src/frontend/src/components/chat/native-post.ts` · `postNativeMessage`, called from
  `use-native-bridge.ts` (`postNativeReceipt`, `postNativeLocationResult`). **Transitional
  fallback:** when the neutral function is absent (an installed iOS build that predates it), the web
  falls back to the legacy `window.webkit.messageHandlers.<channel>.postMessage(<object>)` form;
  remove once the neutral iOS build is the installed floor. iOS-side, the startup script in
  `Views/ChatWebView.swift` defines `callbackboxNativePost` (routing to
  `webkit.messageHandlers[channel]`), and the native handlers accept **both** the legacy object form
  and the neutral JSON-string form (`ChatWebView.dictionaryPayload(from:)`).

### 3.4 Navigation policy

- `ChatWebView.swift` — `decidePolicyFor`: main-frame loads off `allowedOrigin` (and not `about:`)
  are cancelled and handed to `UIApplication.shared.open` (external browser).
  `allowsBackForwardNavigationGestures = true`.
- On provisional nav start, all inflight emission/location state clears and `pageLoaded=false`; a
  mid-flight nav re-arms delivery on the next `didFinish`.

---

## 4. Bridge channels — emission, location, and composer mutation

### 4.1 Emission (native → web)

- **Canonical V2 wire shape** (native → `window.callbackboxNativeReceive(<json>)`):
  ```json
  { "version": 2, "id": "<UUID string>", "text": "<string>",
    "origin": "typed"|"voice", "diarized": <bool>,
    "images": [ { "id": <int>, "mimeType": "<string>", "dataBase64": "<base64>" } ],
    "files": [ { "id": <int>, "path": "<tmp/...>", "originalName": "<string>",
      "size": <number>, "mimetype": "<string>" } ],
    "selections": [ { "id": <int>, "ref": "<string>", "text": "<string>",
      "position": "<string>", "anchor": <string|null>, "spokenWords": <number|null> } ] }
  ```
- **Transport globals + event (native-authored startup script):**
  `window.callbackboxNativeReceive(detail)` pushes onto `window.callbackboxNativeQueue` and
  dispatches `CustomEvent('callbackbox:native-emission', { detail })`. The **queue is authoritative**;
  the event is only a wake signal (its `detail` is never read).
- **Web drain/handle:** `use-native-bridge.ts` — `useNativeEmissionBridge` drains
  `callbackboxNativeQueue` on mount + each event → `handleNativeEmission` →
  `nativeEmissionFromDetail` (`native-emission.ts`) → `createTypedEmission`/`createVoiceEmission`
  (native `id` preserved via `withNativeId`) → dispatched to `/chat/send`.
- **Legacy image parse:** malformed image entries are dropped individually; V2 rejects the whole
  payload when any image is malformed.
- **V2 validation:** `native-emission.ts` · `parseNativeEmissionDetail` requires every V2 field
  and rejects the whole payload when an image, file, or selection is malformed. Unknown versions
  reject with a reason naming that version. File metadata is retained on the `Emission` value even
  though current chat assembly needs only `id` and `path`.
- **Legacy compatibility (intentional boundary leniency):** a payload with no `version` keeps the
  shipped decoder policy: a missing/invalid `id`
  is replaced with a generated emission id (`withNativeId` keeps the native id only when it is a
  non-empty string); an unknown/absent `origin` coerces to `"typed"`; `diarized` is `true` only for
  a literal `true`, else `false`; malformed `images` entries are dropped **individually**; and a
  synthetic rejection (a `null` parse) occurs **only when neither text nor any valid image
  survives**. Fixtures (`docs/implemented-plans/mobile-parity-sync.md`) pin both policies separately.
- **Field mapping:** V2 is a complete projection of web
  `Emission { id, origin, text, images, files, selections, diarized }`. Legacy payloads produce
  empty `files` and `selections`.
- **Anchors:**
  | side | anchor |
  |---|---|
  | native payload | `ios-app/CallbackBox/Models/NativeComposerContract.swift` — `NativeEmissionV2`, `NativeEmissionFile`, `NativeEmissionSelection`; `ios-app/CallbackBox/Views/ChatWebView.swift` — `NativeChatEmission` |
  | web parse | `src/frontend/src/components/chat/native-emission.ts` — `parseNativeEmissionDetail`, `nativeEmissionFromDetail`; `src/frontend/src/components/chat/use-native-bridge.ts` — `useNativeEmissionBridge`, `drainNativeEmissionQueue` |
- **Drift:** LOUD for V2 (a rejected receipt carries the validation reason); legacy coercion remains
  SILENT except when no usable text or image survives.

### 4.2 Emission receipt (web → native)

- **Wire shape** (web posts the dispatch `Receipt` verbatim on the `callbackboxEmissionReceipt`
  channel):
  ```
  { disposition: "sent";     emissionId: string; deduplicated: boolean }
  { disposition: "queued";   emissionId: string }
  { disposition: "rejected"; emissionId: string; reason: string }
  ```
- **Anchors:**
  | side | anchor |
  |---|---|
  | web post | `src/frontend/src/components/chat/use-native-bridge.ts` — `postNativeReceipt`; `src/frontend/src/input/targets/receipts.ts` — `Receipt` union, `expectReceipt` (30s backstop) |
  | native decode | `ios-app/CallbackBox/Views/ChatWebView.swift` — `receiveEmissionReceipt`, `NativeEmissionReceipt.Disposition { sent, queued, rejected }` |
- **Ack/dedup semantics:** native `deliver` only sends emissions not already in
  `inflightEmissionIDs`, marks inflight, starts a **35s** receipt timeout, and on an
  `evaluateJavaScript` error reports a synthetic `rejected` immediately. Delivery is gated on
  `pageLoaded` (items typed during nav are held, re-delivered on `didFinish`). On any receipt
  (real, timeout, or error) `RootView` clears the emission from `pendingNativeEmissions`;
  `NativeComposerView` restores text+images on `rejected`. Native 35s > web 30s deliberately (web
  reports first).
- **Drift:** SILENT→LOUD (no receipt → native 35s timeout → user sees "not confirmed").
- **Benign field drift:** native ignores `deduplicated` on `sent` receipts.

### 4.3 Location request (native → web) + result (web → native)

- **Request wire shape:** `window.callbackboxNativeShareLocation("<requestId UUID>")` pushes
  `{ id }` onto `window.callbackboxNativeLocationQueue` and dispatches
  `CustomEvent('callbackbox:native-share-location', { detail })`.
- **Result wire shape** (web → native on `callbackboxLocationResult`):
  `{ id: string, success: boolean, message: string }`.
- **Anchors:**
  | side | anchor |
  |---|---|
  | native request + result decode | `ios-app/CallbackBox/Views/ChatWebView.swift` — `callbackboxNativeShareLocation` script, `receiveLocationResult` (15s timeout) |
  | web handle | `src/frontend/src/components/chat/use-native-bridge.ts` — `useNativeLocationBridge`, `handleNativeLocationRequest` (→ `captureAndStore(boxSlug, Date.now())`), `postNativeLocationResult`, `drainNativeLocationQueue` |
- **Drift:** request → SILENT→LOUD (15s native timeout); result → LOUD (status message shown).

### 4.4 Companion selection command (web → native) + durability acknowledgement

- **Command wire shape** (web posts on `callbackboxComposerCommand`):
  ```json
  { "version": 1, "id": "<UUID string>", "kind": "add-selection",
    "selection": { "ref": "<card path>", "text": "<selected text>",
      "position": "<source position>" } }
  ```
  V1 is strict: every field is required and `kind` has only `add-selection`.
- **Acknowledgement wire shape** (native → web): accepted is
  `{ "version":1, "id":"<same id>", "accepted":true }`; rejected is
  `{ "version":1, "id":"<same id>", "accepted":false, "reason":"<user-visible reason>" }`.
  Rejection without a non-empty `reason` is malformed.
- **Transport globals + event:** `window.callbackboxNativeComposerCommandAck(detail)` pushes the
  acknowledgement onto `window.callbackboxNativeComposerCommandAckQueue` and dispatches
  `CustomEvent('callbackbox:native-composer-command-ack', { detail })`. The queue is authoritative;
  the event is a wake signal.
- **Durability and dedup:** native acknowledges acceptance only after the box-scoped draft manifest
  is saved. It persists a bounded history of processed command IDs, so retrying before or after app
  relaunch returns accepted without adding a second selection or inline token. Rejection leaves the
  draft unchanged. Web waits 15s, then shows a dismissible error and lets the user add again.
- **Composition semantics:** typed companion selections have `anchor:null` and `spokenWords:null`,
  so native inserts `[selectionN]` at the current UTF-16 caret. During active native dictation,
  native instead snapshots the last eight recognized words and total spoken-word count as
  `anchor`/`spokenWords` and does not insert an inline token. Both forms reach Emission V2.
- **Anchors:**
  | side | anchor |
  |---|---|
  | web command + ack | `src/frontend/src/components/chat/native-composer-command.ts`; `use-native-composer-commands.ts`; `use-companion-selection.ts`; `InteractiveChat-view.tsx` |
  | native decode + durable mutation | `ios-app/CallbackBox/Models/NativeComposerContract.swift` — `NativeComposerCommand`, `NativeComposerCommandAcknowledgement`; `Storage/ComposerDraftStore.swift` — `applySelectionCommand`; `Views/ChatWebView.swift` — `receiveComposerCommand` |
- **Drift:** LOUD (native rejection or web 15s timeout is user-visible).

---

## 5. Direct HTTP calls from native code

Only four endpoints are hit by native code. (`/chat/send` is called by the **web layer inside the
webview**, not natively — §6.)

### 5.1 `POST /api/pairing/redeem`

See §1.3 (full request/response/errors).

### 5.2 `POST /api/chat/transcribe-audio` — HQ audio transcription

- **Direction:** native → box.
- **Request:** `POST`; `Content-Type: multipart/form-data`; `User-Agent: CallbackBox-iOS/0.1`;
  `Authorization: Bearer <token>`. Multipart body: text field `session=<resolved session id>`; file
  field `file`, filename `segment.wav`, content-type `audio/wav`.
- **Response 200:** `{ text: string, diarized: boolean }`.
- **Errors:** 400 `{ error: "No audio uploaded" }`; 500 `{ error: <msg> }` → iOS
  `ChatAPIError.server(...)` (surfaces in composer status).
- **Anchors:**
  | side | anchor |
  |---|---|
  | native caller | `ios-app/CallbackBox/Services/ChatAPI.swift` — `ChatAPI.transcribeAudio(fileURL:)`, `applyAuth`, `HqTranscriptionResult { text, diarized }` |
  | box handler | `src/webapp/routes/chat-audio-routes.ts` — `POST /api/chat/transcribe-audio` (→ `transcribeAudioHq({ audioBuffer, filename, boxRoot })`) |
- **Drift:** LOUD (5xx surfaced) / SILENT if a float-format WAV is mis-decoded — see §9 (I8, needs verify).

### 5.3 `GET /api/chat/default` — session resolution

- **Direction:** native → box (only when `box.sessionID` is empty).
- **Response:** `{ sessionId?: string }` (most-active session, or absent).
- **Anchors:**
  | side | anchor |
  |---|---|
  | native caller | `ios-app/CallbackBox/Services/ChatAPI.swift` — `ChatAPI.resolvedSession()`, `DefaultSessionResult { sessionId? }` |
  | box handler | `src/webapp/routes/chat.ts` — `GET /api/chat/default` (→ `getMostActive(boxRoot)`) |
- **Drift:** SILENT (on any non-2xx `resolvedSession` returns `"new"` — a transient 5xx silently
  forks a new session).

### 5.4 `POST /api/chat/upload-file` — composer file upload

- **Direction:** native → box.
- **Request:** `POST`; `Content-Type: multipart/form-data`; `User-Agent: CallbackBox-iOS/0.1`;
  `Authorization: Bearer <token>`. One file field named `file` with the original filename and MIME
  type. Native reports `URLSession` byte progress while uploading.
- **Response 200:** `{ path: string, originalName: string, size: number, mimetype: string }`; `path`
  points under the box's `tmp/` directory and becomes the Emission V2 file `path`.
- **Anchors:**
  | side | anchor |
  |---|---|
  | native caller | `ios-app/CallbackBox/Services/ChatAPI.swift` — `uploadFile`, `uploadFileRequest` |
  | box handler | `src/webapp/routes/chat-uploads.ts` — `registerChatUploadRoutes` |
- **Drift:** LOUD (non-2xx, malformed metadata, interruption, and timeout produce retryable native
  attachment failure; incomplete files block send).

### 5.5 (web layer, for completeness) `POST /api/chat/send`

- **Direction:** the webview's own JS → box, on every native emission (§4.1).
- **Request:** `{ "Content-Type": "application/json", ...mobileAuthHeaders() }`; body
  `{ session, message, messageId, images?, contextDir?, seedFeatures?, openCard?, cardActivity?, cardState? }`.
  Image schema `{ id: number, mimeType: string, dataBase64: string.min(1) }`, byte cap in
  `validateImages`.
- **Response:** `{ turnId? } | { queued: true } | { deduplicated: true }` (dedup keyed on `messageId`).
- **Anchors:**
  | side | anchor |
  |---|---|
  | web caller | `src/frontend/src/api-chat.ts` (`chatTurnStartSchema`, `ChatImageAttachment`) |
  | box handler | `src/webapp/routes/chat-send-routes.ts`; `src/webapp/routes/chat-helpers.ts` — `sendBodySchema`, `validateImages` |
- **Drift:** LOUD (400) / SILENT dedup.

---

## 6. Server-side "mobile" awareness

Every place the box server branches on mobile-ness. The contract is entirely token- and
query-param-driven — there is **no user-agent gating** anywhere.

| anchor | branch | effect |
|---|---|---|
| `src/hub/hub-server.ts` — `hasMobileAuthAttempt` | `Bearer ` present OR `?mobileToken=` present (**presence only**) | bypasses the hub auth wall (HTTP catch-all + WS upgrade); box re-verifies — **S1** |
| `src/hub/hub-server.ts` — `listMobileAuthorizedBoxes` | real `verifyMobileBearer`/`verifyMobileToken` | `/api/boxes` returns the mobile-authorized box list |
| `src/webapp/server-box-scope.ts` — `isPairingRedeemUrl` | `POST` + redeem URL | box auth hook lets redeem through |
| `src/webapp/server-box-scope.ts` — `addBoxAuthHook` | `verifyMobileBearer` OR `verifyMobileToken(?mobileToken=)` | passes box auth preHandler |
| `src/webapp/server-box-scope.ts` — `createContext` | `mobileBearerOk`/`mobileTokenOk` | `authed:true`; **`user` stays null, `isOwner:false`** (§2.3) |
| `src/webapp/server-root.ts` — `listMobileAuthorizedBoxes` / `isMobileAuthorizedForBox` | real verify | mobile box list / per-box authorization for standalone server |
| `src/core/mobile/pairing.ts` (whole module) | device store, tokens | source of truth |

- **`User-Agent: CallbackBox-iOS/0.1`** is sent on all four native HTTP calls but the server never
  branches on it — informational / for logs only.

---

## 7. Contract Surface Index

The authoritative surface list. A platform implements **exactly** these rows. Anchors are file +
symbol; drift is LOUD or SILENT (§Drift legend).

| # | Touchpoint | Direction | Wire shape (exact fields) | Native side (file · symbol) | Box side (file · symbol) | Drift |
|---|---|---|---|---|---|---|
| P1 | `callbackbox://pair` deep link | ext→native | `baseURL`\|`url`, `label`, `pairingToken`\|`token`, `session`, `authToken`(DEBUG) | `Storage/PairedBoxStore.swift` · `pair(from:)`; `Info.plist` · URL scheme | `settings/CompanionPairingSection.tsx` · `pairingDeepLink` | SILENT |
| P2 | Pairing-ticket mint | UI→box | out `{token,expiresAt}` | — (UI only) | `trpc/routers/pairing.ts` · `createTicket`; `core/mobile/pairing.ts` · `createMobilePairingTicket` | LOUD |
| P3 | `POST /api/pairing/redeem` | native→box | req `{pairingToken,deviceLabel}`; res `{boxSlug,label,deviceId,deviceLabel,token}` (native reads only `token`) | `Storage/PairedBoxStore.swift` · `redeemPairing` | `routes/pairing.ts` · redeem route, `RedeemBody` | LOUD server / SILENT native |
| A1 | Device token → localStorage | native→web | key `callbackbox.mobileAuthToken` = `<token>` | `Views/ChatWebView.swift` · startup `WKUserScript` | `lib/mobile-auth.ts` · `MOBILE_AUTH_TOKEN_STORAGE_KEY` | SILENT |
| A2 | Device token → `Authorization: Bearer` | native/web→box | header | `Services/ChatAPI.swift` · `applyAuth`; web `lib/mobile-auth.ts` · `mobileAuthHeaders` | `core/mobile/pairing.ts` · `verifyMobileBearer`; `server-box-scope.ts` · `addBoxAuthHook` | LOUD |
| A3 | Device token → `Set-Cookie: cb_mobile` | box→browser | `cb_mobile=<signed>; HttpOnly; Secure; SameSite=Lax; Path=/<slug>; Max-Age=3600` | `Views/ChatWebView.swift` · `request()` sets `Authorization`, WebKit stores the response cookie | `webapp/mobile-cookie.ts` · `setMobileSessionCookie`; `core/mobile/mobile-session.ts` · `MOBILE_COOKIE_NAME` | LOUD |
| A5 | `POST /api/pairing/session` | web→box | req `Authorization: Bearer <token>`; res `204` + `Set-Cookie` | web `lib/mobile-auth.ts` · `refreshMobileSession` | `routes/pairing.ts` · session route | LOUD |
| A4 | tRPC context identity | box internal | `authed` from mobile token; `user=null,isOwner=false` | — | `server-box-scope.ts` · `createContext` | SILENT |
| W1 | Chat webview URL | native→web | `/chat?nativeComposer=1[&session]` — carries NO credential | `Models/PairedBox.swift` · `chatURL`; `Views/ChatWebView.swift` · `request()` | `pages/ChatPage.tsx`; `router.tsx` | SILENT |
| W2 | Session report | web→native | `callbackboxSession` = `location.href` (string) | `Views/ChatWebView.swift` · `userContentController`, `visibleSessionID` | native-authored startup script | SILENT |
| B1 | Native emission | native→web | V2 `{version:2,id,text,origin,diarized,images,files,selections}`; legacy `{id,text,origin,diarized,images}` remains accepted; delivered via `callbackboxNativeReceive`, queue `callbackboxNativeQueue`, event `callbackbox:native-emission` | `Models/NativeComposerContract.swift` · `NativeEmissionV2`; `Views/ChatWebView.swift` · `NativeChatEmission` | `use-native-bridge.ts` · `useNativeEmissionBridge`; `native-emission.ts` · `parseNativeEmissionDetail` | LOUD V2 / SILENT legacy |
| B2 | Emission receipt | web→native | `{disposition:sent\|queued\|rejected, emissionId, deduplicated?/reason?}` via `callbackboxEmissionReceipt` | `Views/ChatWebView.swift` · `receiveEmissionReceipt` | `use-native-bridge.ts` · `postNativeReceipt` → `native-post.ts` · `postNativeMessage`; `input/targets/receipts.ts` · `Receipt` | SILENT→LOUD |
| B3 | Location request | native→web | `callbackboxNativeShareLocation("<uuid>")`, queue `callbackboxNativeLocationQueue`, event `callbackbox:native-share-location`, detail `{id}` | `Views/ChatWebView.swift` · location script | `use-native-bridge.ts` · `useNativeLocationBridge` | SILENT→LOUD |
| B4 | Location result | web→native | `{id,success,message}` via `callbackboxLocationResult` | `Views/ChatWebView.swift` · `receiveLocationResult` | `use-native-bridge.ts` · `postNativeLocationResult` → `native-post.ts` · `postNativeMessage` | LOUD |
| B5 | Companion selection command | web→native | V1 `{version:1,id,kind:add-selection,selection:{ref,text,position}}` via `callbackboxComposerCommand` | `Models/NativeComposerContract.swift` · `NativeComposerCommand`; `Views/ChatWebView.swift` · `receiveComposerCommand`; `Storage/ComposerDraftStore.swift` · `applySelectionCommand` | `native-composer-command.ts`; `use-native-composer-commands.ts`; `InteractiveChat-view.tsx` | LOUD |
| B6 | Composer command acknowledgement | native→web | accepted `{version:1,id,accepted:true}` or rejected `{version:1,id,accepted:false,reason}` via `callbackboxNativeComposerCommandAck`, queue + `callbackbox:native-composer-command-ack` event | `Models/NativeComposerContract.swift` · `NativeComposerCommandAcknowledgement`; `Views/ChatWebView.swift` · `deliverComposerCommandAcknowledgements` | `native-composer-command.ts` · `nativeComposerCommandAcknowledgementFromDetail`; `use-native-composer-commands.ts` | LOUD |
| H1 | `POST /api/chat/transcribe-audio` | native→box | multipart `session` + `file`(segment.wav, audio/wav); res `{text,diarized}` | `Services/ChatAPI.swift` · `transcribeAudio` | `routes/chat-audio-routes.ts` | LOUD / SILENT if float-WAV mis-decoded — **I8** |
| H2 | `GET /api/chat/default` | native→box | res `{sessionId?}` | `Services/ChatAPI.swift` · `resolvedSession` | `routes/chat.ts` · default-session route | SILENT (→ `"new"`) |
| H3 | `POST /api/chat/send` (web layer) | web→box | `{session,message,messageId,images?,…}`; res `{turnId?}\|{queued}\|{deduplicated}` | `api-chat.ts` | `routes/chat-send-routes.ts`; `routes/chat-helpers.ts` · `sendBodySchema` | LOUD / SILENT dedup |
| H4 | `POST /api/chat/upload-file` | native→box | multipart `file`; res `{path,originalName,size,mimetype}` | `Services/ChatAPI.swift` · `uploadFile` | `routes/chat-uploads.ts` · `registerChatUploadRoutes` | LOUD |
| M1 | Hub mobile-auth wall | box internal | full verification of bearer or `cb_mobile` for the request's slug | — | `hub-server.ts` · `hasMobileAuth` → `core/mobile/request-auth.ts` · `verifyMobileRequest` | LOUD |

---

## 8. Mirrored constants (diff targets)

String/shape constants that exist in two places and must move together. A change to either side
without the other is a contract break.

- **localStorage key** `callbackbox.mobileAuthToken` — `Views/ChatWebView.swift` (startup script) ↔
  `lib/mobile-auth.ts` · `MOBILE_AUTH_TOKEN_STORAGE_KEY` (comment-linked).
- **Mobile session cookie name** `cb_mobile` — `core/mobile/mobile-session.ts` ·
  `MOBILE_COOKIE_NAME` ↔ nothing native-side by design: the native shell never names the cookie,
  it only sends `Authorization` and lets WebKit store whatever the response sets. A rename is
  therefore box-internal, which is the point — it keeps the credential out of client code.
- **Webview param** `nativeComposer=1` — `Models/PairedBox.swift` · `chatURL` (with in-code sync
  comment) ↔ `pages/ChatPage.tsx` / `router.tsx`.
- **Emission V2 JSON keys** `{version,id,text,origin,diarized,images,files,selections}` —
  `Models/NativeComposerContract.swift` · `NativeEmissionV2` ↔
  `native-emission.ts` · `NativeEmissionV2` / `parseNativeEmissionDetail`.
- **Receipt shape** `{disposition,emissionId,reason?,deduplicated?}`, dispositions
  `sent|queued|rejected` — `Views/ChatWebView.swift` · `NativeEmissionReceipt.Disposition` ↔
  `input/targets/receipts.ts` · `Receipt`.
- **Location result** `{id,success,message}` — `Views/ChatWebView.swift` · `receiveLocationResult`
  ↔ `use-native-bridge.ts` · `postNativeLocationResult`.
- **Composer command V1** `{version,id,kind,selection:{ref,text,position}}` and acknowledgement V1
  `{version,id,accepted,reason?}` — `Models/NativeComposerContract.swift` ↔
  `native-composer-command.ts`.
- **Bridge globals** `callbackboxNativeReceive` / `callbackboxNativeQueue` /
  `callbackboxNativeShareLocation` / `callbackboxNativeLocationQueue` /
  `callbackboxNativeComposerCommandAck` / `callbackboxNativeComposerCommandAckQueue` and events
  `callbackbox:native-emission` / `callbackbox:native-share-location` /
  `callbackbox:native-composer-command-ack` — native-authored startup script in
  `Views/ChatWebView.swift` ↔ `use-native-bridge.ts` / `use-native-composer-commands.ts`.
- **Script-message channel names** `callbackboxSession` / `callbackboxEmissionReceipt` /
  `callbackboxLocationResult` / `callbackboxComposerCommand` — `Views/ChatWebView.swift`
  (`userContentController.add`) ↔ `native-post.ts` · `NativeShellChannel`.
- **Neutral web→native transport** `callbackboxNativePost(channel, payload)` (string payloads) —
  startup script in `Views/ChatWebView.swift` ↔ `native-post.ts` · `postNativeMessage` (with the
  legacy `webkit.messageHandlers` object-form fallback for pre-neutral shells).

---

## 9. Known open contract risks

Still-open items to carry into the Android plan and the sync process. Full analysis (severity,
reproduction, proposed fixes) is in `docs/plans/ios-companion-review-2026-07-17.md`.

- **S1 — hub presence-only wall bypass (CLOSED 2026-07).** `hasMobileAuthAttempt` checked only
  that a `Bearer` header or `?mobileToken=` was *present*, never valid, so any `Bearer x` bypassed
  the hub auth wall and cold-started the box. Replaced by `hasMobileAuth`, which verifies against
  the request's slug — affordable because the cookie path is pure HMAC. See
  `docs/implemented-plans/mobile-token-handshake.md`.
- **S2 — durable token in `?mobileToken=` URL (CLOSED 2026-07).** The carrier is gone: the token
  is header-only and the `cb_mobile` cookie carries what the browser sends on its own. All three
  copies of `mobileTokenFromUrl` are deleted. See `docs/implemented-plans/mobile-token-handshake.md`.
- **S3 — unlocked device-store RMW + non-atomic write (RESOLVED).** Every device-store mutation
  (`resolveMobileTokenIdentity`'s `lastUsedAt` stamp, `redeemMobilePairingTicket`,
  `revokeMobileDevice`) now runs through the cross-process `file-lock.ts` primitive
  (`withDeviceStoreLock`) and lands via temp-file + fsync + atomic rename — the same pattern as
  `webapp/local-users.ts`. Cross-process matters here because `cb hub` verifies a bearer (stamping
  `lastUsedAt`) before proxying to the per-box child, which verifies it again and can revoke it, so
  two processes genuinely race the file. Those functions are now `async`. See
  `test/core/mobile/pairing-store-concurrency.doctest.md`.
- **Token in plaintext, not Keychain (OPEN, iOS I6).** `PairedBoxStore` writes `authToken` as
  plaintext JSON in Application Support.
- **Identity not fully unified.** Mobile requests are `authed` but the tRPC context still carries
  `user=null`/`isOwner=false`. Chat sends no longer attribute to nobody, though: `POST /api/chat/send`
  now falls back to `resolveMobileSender`, resolving the paired device's `createdBy` identity
  (`test/webapp/routes/chat-mobile-sender.doctest.md`). Unifying the tRPC context itself remains open.
- **Duplicate deep-link handling.** `onOpenURL` + `PairingURLInbox` both redeem one URL → the second
  redeem 401s on the single-use token (§1.1).
- **Token-lifecycle gaps.** Device tokens never expire (`MobileDevice` has no `expiresAt`); pending
  pairings live only in process memory (10-min TTL) and can be lost to a lazy 5-min box idle-stop
  mid-flow.
- **`isPairingRedeemUrl` unanchored** suffix match (`routes/pairing.ts`) — `/anything/api/pairing/redeem`
  matches. Low risk (token-gated).
- **`mobileTokenFromUrl` duplicated 3×** — a security-relevant parser copied verbatim across
  `hub-server.ts` / `server-box-scope.ts` / `server-root.ts`.
- **Benign field drifts.** Redeem `{boxSlug,label,deviceId,deviceLabel}` ignored by iOS; receipt
  `deduplicated` ignored by iOS; `User-Agent: CallbackBox-iOS/0.1` never branched on server-side.
- **I8 (needs verify).** Native records WAV in the mic's native format (typically 32-bit float PCM)
  and uploads as `audio/wav`; if the HQ decoder expects 16-bit int PCM the leg silently no-ops.
- **Legacy `embed=1` vs `nativeComposer=1` duality.** The web side still reads a legacy `embed=1`
  (header-suppress) alongside `nativeComposer=1`; both reach the same `usesNativeShell`. iOS uses
  only `nativeComposer=1`, which is the standard a new platform must adopt.

---

## 10. Adding a platform

An Android (or any future) client implements **exactly the surfaces in §7** — same query params,
same JSON shapes, same channel names, same HTTP request/response shapes. The server side does not
branch on platform (no UA gating), so a conformant client needs no server changes for the surfaces
as specified.

**Where platform-specific glue lives.** How web→native `postMessage` is *transported* is platform
glue, not contract: on iOS it's `WKScriptMessageHandler` names registered on the
`userContentController`; on Android it's an `androidx.webkit` `WebMessageListener` (or a
`@JavascriptInterface`-annotated bridge object). This transport belongs in the **native-authored
startup script** the client injects — the same slot the iOS app uses to define
`callbackboxNativeReceive` / `callbackboxNativeShareLocation` and the queues. Keeping it there lets
the web-side JS stay platform-agnostic: web code reads/writes the queues and dispatches the
CustomEvents, blind to how the native side is wired.

**The return path is now platform-neutral (Track 0, landed 2026-07-17).** The web side posts
through `window.callbackboxNativePost(channel, payload)` (§3.3) with a transitional fallback to the
legacy `webkit.messageHandlers` object form for pre-neutral iOS builds. A new platform therefore
defines `callbackboxNativePost` in its own document-start script and routes however its WebView
delivers messages — the Android plan's shape is a single `{"channel", "payload"}` JSON-string
envelope through an `androidx.webkit` `WebMessageListener` object, plus an optional
`window.webkit.messageHandlers` compatibility façade so the shell also works against a box whose
web code predates Track 0 (see `docs/plans/android-companion-app.md` Track 0). Payloads on the
neutral path are strings; receipt and location-result payloads are JSON, the session href is raw.

---

## 11. Anchor manifest (tripwire input)

The machine-readable distillation of §7 — the small set of files on all three sides that
**are** the contract surface. It is the input to the two-hook tripwire (`bin/mobile-contract-check.ts`,
wired into `.husky/pre-commit` + `.husky/commit-msg`; mechanism 5 of
`docs/implemented-plans/mobile-parity-sync.md`): if a commit stages any file listed here but does **not** also
stage this document, the commit is blocked at `commit-msg` time unless its message carries a
`Contract-Unchanged: <reason>` trailer. Keep this list and the surface it guards in sync — adding a
contract surface means adding its file here in the same change.

Paths are **repo-relative** (from the monorepo root, so box files carry the `callback-box/` prefix,
unlike the `callback-box/`-relative anchors in §7). A trailing `/` marks a **directory prefix** —
every file beneath it counts as an anchor (fixtures are part of the contract). Blank lines and
`#` comments are ignored. The Android bridge/native-shell files (`android-app/…`) join this list
when `android-app/` exists — add them alongside their iOS counterparts at that point.

```anchors
# Web-side bridge, auth, and receipt surface
callback-box/src/frontend/src/components/chat/native-post.ts
callback-box/src/frontend/src/components/chat/use-native-bridge.ts
callback-box/src/frontend/src/components/chat/native-emission.ts
callback-box/src/frontend/src/components/chat/native-composer-command.ts
callback-box/src/frontend/src/components/chat/use-native-composer-commands.ts
callback-box/src/frontend/src/components/chat/use-companion-selection.ts
callback-box/src/frontend/src/lib/mobile-auth.ts
callback-box/src/frontend/src/input/targets/receipts.ts

# Box server: pairing, mobile-token verification, native HTTP endpoints
callback-box/src/core/mobile/pairing.ts
callback-box/src/core/mobile/mobile-session.ts
callback-box/src/core/mobile/request-auth.ts
callback-box/src/webapp/mobile-cookie.ts
callback-box/src/webapp/routes/pairing.ts
callback-box/src/webapp/routes/chat-audio-routes.ts
callback-box/src/webapp/routes/chat-uploads.ts

# iOS native shell: webview bridge, pairing model, paired-box storage
ios-app/CallbackBox/Views/ChatWebView.swift
ios-app/CallbackBox/Models/NativeComposerContract.swift
ios-app/CallbackBox/Storage/ComposerDraftStore.swift
ios-app/CallbackBox/Services/ChatAPI.swift
ios-app/CallbackBox/Models/PairedBox.swift
ios-app/CallbackBox/Storage/PairedBoxStore.swift

# Shared golden fixtures — any fixture change is a contract change (directory prefix)
callback-box/test/mobile-contract/
```
