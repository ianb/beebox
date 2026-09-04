# Cross-Platform Mobile Contract

**What this document is.** The living wire/behavioral contract between a beebox (its
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

**Path conventions.** Box code paths are relative to `beebox/`; iOS paths are under
`ios-app/BeeBox/`. Anchors name a file plus the identifier (function/struct/const) inside it —
never line numbers, which rot. Box-relative wire values (landmark/share-destination `dir`s,
uploaded-file `path`s) are opaque tokens iOS round-trips unmodified; under the one-root box
layout (shapeVersion 3, `docs/plans/one-root-box-layout.md`) they land in underscore areas
(`_content/…`, `_tmp/…`) — the wire shape is unchanged, only the values moved. A paired box's `baseURL` already includes the hub slug
(e.g. `http://127.0.0.1:3210/main/test1` in dev, `https://host/<slug>` in prod), so every native
HTTP path below is `<baseURL>/api/...`.

**Drift legend.** For each surface, drift is either **LOUD** (a mismatch produces a visible
error / 4xx / 5xx / status message) or **SILENT** (the mismatch is swallowed — message lost,
composer not suppressed, wrong attribution — with no error surfaced).

---

## 1. Pairing

### 1.1 `beebox://pair` deep link

- **Direction:** external (QR scan / deep link / `simctl openurl`) → native.
- **Wire shape:** `beebox://pair?baseURL=<url>&label=<name>&pairingToken=<token>` (all
  URL-encoded). Query params:
  | param | aliases | required | notes |
  |---|---|---|---|
  | `baseURL` | `url` | yes | box base URL incl. slug; must have scheme+host or URL is rejected |
  | `label` | — | no (default `"Bee Box"`) | display name |
  | `pairingToken` | `token` | no | short-lived ticket, redeemed for a device token |
  | `session` | — | no | initial chat session id |
  | `authToken` | — | **DEBUG builds only** | raw device token imported directly, no redeem |

  The box generator emits **only** `baseURL`/`label`/`pairingToken` — never `session` or `authToken`.
- **Anchors:**
  | side | anchor |
  |---|---|
  | iOS scheme registration | `ios-app/BeeBox/Info.plist` — `CFBundleURLSchemes = ["beebox"]`, name `app.beebox.ios.pairing` |
  | iOS parser | `ios-app/BeeBox/Storage/PairedBoxStore.swift` — `PairedBoxStore.pair(from:)` (requires `scheme == "beebox"` AND `host == "pair"`) |
  | box link generator | `src/frontend/src/components/settings/CompanionPairingSection.tsx` — `pairingDeepLink(token)`, `boxBaseUrl()`, `qrSvg()` |
  | box render site | `src/frontend/src/pages/settings/SettingsPage.tsx` — `<CompanionPairingSection />` |
- **Drift:** SILENT. A bad/unparseable URL makes `pair` return `false` with no toast.
- **Known duplicate-dispatch hazard:** both `BeeBoxApp.onOpenURL` and
  `BeeBoxAppDelegate.application(open:)` (→ `PairingURLInbox.shared.accept` →
  `BeeBoxApp.onReceive`) can fire for one URL, producing two redeem POSTs; the second fails on
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
  Headers: `Content-Type: application/json`, `User-Agent: BeeBox-iOS/0.1`.
- **Server body schema (`RedeemBody`):** `{ pairingToken: string.min(1), deviceLabel?: string.min(1) }`;
  `deviceLabel` defaults to `"iOS companion"` when absent.
- **Response 200:**
  ```json
  { "boxSlug": "<slug>", "label": "Bee Box", "deviceId": "<uuid>",
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
  | native caller | `ios-app/BeeBox/Storage/PairedBoxStore.swift` — `PairedBoxStore.redeemPairing(baseURL:pairingToken:)`, types `PairingRedeemRequest`/`PairingRedeemResponse` |
  | box endpoint | `src/webapp/routes/pairing.ts` — `POST /api/pairing/redeem`, `RedeemBody` |
  | box device store | `src/core/mobile/pairing.ts` — `MobileDevice { id,label,tokenHash,createdAt,lastUsedAt?,revokedAt? }`, `writeDeviceStore` (`<boxRoot>/.beebox/mobile-devices.secret.json`, mode `0o600`) |
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
which the browser `WebSocket` API cannot attach headers to — rides a **short-lived `bbx_mobile`
cookie** minted from that token.

### 2.1 Carriers

| carrier | wire shape | who sets it | who reads it |
|---|---|---|---|
| localStorage | key `beebox.mobileAuthToken` = `<token>` | native startup `WKUserScript` (`ChatWebView.swift`) writes it, gated on `origin === allowedOrigin`, `forMainFrameOnly:true` | web `mobile-auth.ts` — `getMobileAuthToken()`, `mobileAuthHeaders()`, `withMobileAuth()` |
| `Authorization: Bearer <token>` header | HTTP header | native `ChatAPI.applyAuth`; web `mobileAuthHeaders()` (applied to `/chat/send`, `/chat/transcribe-audio`) | box `verifyMobileBearer` |
| `bbx_mobile` cookie | `Set-Cookie: bbx_mobile=<signed>; HttpOnly; Secure; SameSite=Lax; Path=/<slug>; Max-Age=3600` | box `webapp/mobile-cookie.ts` — issued on any mobile-authenticated response, and by `POST /api/pairing/session` | box `core/mobile/mobile-session.ts` · `verifyMobileSession` |

- **Mirrored key:** `beebox.mobileAuthToken` is defined native-side inline in the
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
- **Contract param:** `nativeComposer=1`. Mirrored: native
  `PairedBox.chatURL` builds `nativeComposer=1` (with an in-code "keep in sync" comment); web
  `ChatPage` reads it and the router schema declares it.
- **Anchors:**
  | side | anchor |
  |---|---|
  | native URL build | `ios-app/BeeBox/Models/PairedBox.swift` — `PairedBox.chatURL`; `ios-app/BeeBox/Views/ChatWebView.swift` — `authenticatedChatURL` (appends `&mobileToken=`) |
  | web parse | `src/frontend/src/pages/ChatPage.tsx` (reads `nativeComposer`); `src/frontend/src/router.tsx` (route schema `nativeComposer`) |
- **Drift:** SILENT (wrong/missing param → web composer not suppressed, bridges never enabled).

### 3.2 What `nativeComposer` changes web-side

- `InteractiveChat.tsx` — `usesNativeComposer = nativeComposer === true`;
  `usesNativeShell = isEmbedded || usesNativeComposer`.
- `InteractiveChat-view.tsx` — suppresses the web composer when `embedded || nativeComposer`.
- `InteractiveChat.tsx` — enables `useNativeEmissionBridge({ enabled: usesNativeShell })` and
  `useNativeLocationBridge({ enabled: usesNativeShell, boxSlug })`.
- `InteractiveChat-voice.ts` — the web screen wake lock (`useDebouncedWakeLock`) is **not** requested;
  the device idle timer is native property under the native composer (§4.11).
- **Viewport/safe-area is owned by native, not the web contract** — `NativeComposerView`,
  `RootView` (safe-area insets), `ChatWebView` (inline media playback).

### 3.3 Script-message channels (web → native)

The following channels are web→native. On iOS they are `WKScriptMessageHandler` names registered on the
`userContentController`; the transport is platform glue (§10), the channel names and payloads are
the contract.

| channel name | payload (web → native) | native handler |
|---|---|---|
| `beeboxSession` | `window.location.href` (string) | `Coordinator.userContentController` → `onSessionChange(visibleSessionID)` |
| `beeboxEmissionReceipt` | `Receipt` object (§4.2) | → `receiveEmissionReceipt` |
| `beeboxLocationResult` | `{ id, success, message }` | → `receiveLocationResult` |
| `beeboxHqDictationState` | `{ enabled }` | → `receiveHqDictationState` |
| `beeboxComposerCommand` | V1 or V2 composer command (§4.7, §4.8) | → `receiveComposerCommand` |
| `beeboxLastAudioRequest` | V1 last-audio request (§4.9) | → `receiveLastAudioRequest` |

- Native-side registration: `ChatWebView.swift` (`userContentController.add(_, name:)`).
- Session reporting: the native-authored startup script wraps `history.pushState`/`replaceState` +
  `popstate` and posts `location.href` on every nav; native extracts `?session=` via
  `visibleSessionID`. Origin-checked at both post and receipt time.
- **Web posts via the platform-neutral `window.beeboxNativePost(channel, payload)`** (since
  2026-07-17, Track 0 of `docs/plans/android-companion-app.md`): each shell's document-start script
  defines the function; payloads always cross the neutral path as **strings** (`Receipt` and
  location-result objects are `JSON.stringify`-ed; the session href is passed through as-is). Web
  side: `src/frontend/src/components/chat/native-post.ts` · `postNativeMessage`, called from
  `use-native-bridge.ts` (`postNativeReceipt`, `postNativeLocationResult`). **Transitional
  fallback:** when the neutral function is absent (an installed iOS build that predates it), the web
  falls back to the legacy `window.webkit.messageHandlers.<channel>.postMessage(<object>)` form;
  remove once the neutral iOS build is the installed floor. iOS-side, the startup script in
  `Views/ChatWebView.swift` defines `beeboxNativePost` (routing to
  `webkit.messageHandlers[channel]`), and the native handlers accept **both** the legacy object form
  and the neutral JSON-string form (`ChatWebView.dictionaryPayload(from:)`).

### 3.4 Navigation policy

- `ChatWebView.swift` — `decidePolicyFor`: main-frame loads off `allowedOrigin` (and not `about:`)
  are cancelled and handed to `UIApplication.shared.open` (external browser).
  `allowsBackForwardNavigationGestures = true`.
- On provisional nav start, inflight location/screenshot/composer-command state clears and
  `pageLoaded=false`. Inflight *emission* IDs clear later, on `didCommit` — the old document can
  still deliver a real receipt while a provisional navigation is pending — and `didFinish`
  redelivers the same persisted emission IDs into the new page.

---

## 4. Bridge channels — emission, location, and composer mutation

### 4.1 Emission (native → web)

- **Canonical V2 wire shape** (native → `window.beeboxNativeReceive(<json>)`):
  ```json
  { "version": 2, "id": "<UUID string>", "text": "<string>",
    "origin": "typed"|"voice", "diarized": <bool>,
    "images": [ { "id": <int>, "mimeType": "<string>", "dataBase64": "<base64>" } ],
    "files": [ { "id": <int>, "path": "<_tmp/...>", "originalName": "<string>",
      "size": <number>, "mimetype": "<string>" } ],
    "selections": [ { "id": <int>, "ref": "<string>", "text": "<string>",
      "position": "<string>", "anchor": <string|null>, "spokenWords": <number|null> } ] }
  ```
- **Transport globals + event (native-authored startup script):**
  `window.beeboxNativeReceive(detail)` pushes onto `window.beeboxNativeQueue` and
  dispatches `CustomEvent('beebox:native-emission', { detail })`. The **queue is authoritative**;
  the event is only a wake signal (its `detail` is never read).
- **Web drain/handle:** `use-native-bridge.ts` — `useNativeEmissionBridge` drains
  `beeboxNativeQueue` on mount + each event → `handleNativeEmission` →
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
  | native payload | `ios-app/BeeBox/Models/NativeComposerContract.swift` — `NativeEmissionV2`, `NativeEmissionFile`, `NativeEmissionSelection`; `ios-app/BeeBox/Views/ChatWebView.swift` — `NativeChatEmission` |
  | web parse | `src/frontend/src/components/chat/native-emission.ts` — `parseNativeEmissionDetail`, `nativeEmissionFromDetail`; `src/frontend/src/components/chat/use-native-bridge.ts` — `useNativeEmissionBridge`, `drainNativeEmissionQueue` |
- **Drift:** LOUD for V2 (a rejected receipt carries the validation reason); legacy coercion remains
  SILENT except when no usable text or image survives.

### 4.1a Attachment tokens (shared vocabulary, no wire of its own)

An attachment is anchored *in the message text* by a token, so a photo can sit
mid-sentence rather than being appended in an arbitrary order. Both composers
mint them independently; the ids are per-emission and per-kind.

- **Current form:** `[image#1]`, `[file#2]`, `[selection#3]`.
- **Legacy form:** `[image1]`, without the `#`, used before 2026-08-25. Every
  message already in a box's transcript, every draft persisted before the
  change (browser `localStorage` and on-device alike), and every installed iOS
  build until it updates still speak it.
- **Rule: write the current form, read both.** A reader that matches only one
  form drops the other's attachment on the floor — the token stops resolving,
  and either the photo vanishes from the turn or the bare token shows up in the
  bubble as text the user never typed.
- **Within one message the token and whatever resolves it always agree**: a
  body that says `[file1]` gets an `<attachments>` line that says `[file1]`.
  The agent reads either form and is never asked to reconcile two.
- **Anchors:**
  | side | anchor |
  |---|---|
  | web | `src/shared/composer-tokens.ts` (the writer + the reader roster it lists) |
  | native | `ios-app/BeeBox/Models/ComposerToken.swift`; `Models/ComposerDraft.swift` — `insertToken`, `removeToken` |
- **Drift:** SILENT. Nothing validates a token against its attachment list, on
  either side.

### 4.2 Emission receipt (web → native)

- **What a receipt means:** durable acceptance — the box has recorded the message and will run it.
  `/api/chat/send` responds when the message and its dedup claim persist, before the engine spawns;
  a run that then fails to start reports on the turn stream, never by revoking the receipt.
- **Ownership:** native owns the durable pre-POST queue and redelivery (`PendingEmissionStore`);
  web owns dispatch and settles receipts from the POST outcome; the server owns acceptance, the
  claim registry, and delivery to the engine.
- **Wire shape** (web posts the dispatch `Receipt` verbatim on the `beeboxEmissionReceipt`
  channel):
  ```
  { disposition: "sent";     emissionId: string; deduplicated: boolean }
  { disposition: "queued";   emissionId: string }
  { disposition: "rejected"; emissionId: string; reason: string }
  ```
- **Anchors:**
  | side | anchor |
  |---|---|
  | web post | `src/frontend/src/components/chat/use-native-bridge.ts` — `postNativeReceipt`; `src/frontend/src/input/targets/receipts.ts` — `Receipt` union, `expectReceipt` |
  | native decode | `ios-app/BeeBox/Views/ChatWebView.swift` — `receiveEmissionReceipt`, `NativeEmissionReceipt.Disposition { sent, queued, rejected }` |
- **Ack/dedup semantics:** native `deliver` only sends emissions not already in
  the inflight map (`inflightEmissionGenerations` — id → per-attempt generation), marks them
  inflight, and on an `evaluateJavaScript` error reports a synthetic `rejected` — but only when the
  erroring attempt's generation is still current, so a stale completion from an abandoned attempt
  cannot reject a fresh one. Receipts stay ID-only by design: the dedup registry answers any
  attempt truthfully, so whichever attempt provoked a receipt, it settles the emission. Delivery is gated on
  `pageLoaded` (items typed during nav are held, re-delivered on `didFinish`). On any receipt
  `RootView` clears the emission from `pendingNativeEmissions`;
  `NativeComposerView` restores text+images on `rejected`. Neither web nor native manufactures a
  rejection from elapsed time. Transport, bridge-evaluation, malformed-response, and backend
  failures still reject explicitly. Navigation clears native inflight state (`didCommit`, §3.4)
  and redelivers the same persisted emission ID; server dedup retains the claimed ID for seven
  days, which makes navigation, crash-recovery, and backoff retries safe.
- **In-session redelivery (native):** a `pending` emission whose receipt has not arrived
  redelivers on a wall-clock backoff (10s/30s/60s after attempts 1-3, then every 120s, no cap):
  `RootView` publishes a `NativeEmissionRedeliveryRequest`, the coordinator abandons the inflight
  attempt (drops its inflight generation) and delivers again. A late receipt from an
  abandoned attempt is dropped by the inflight guard; the new attempt's receipt settles. Past 30s
  pending, the composer row offers Restore/Discard — the state stays `pending`; no verdict is
  manufactured. Re-evaluation runs only while the scene is active (5s ticker + foregrounding).
- **Drift:** a missing outcome remains visibly pending (with a user exit after 30s); retries
  always carry the same emission ID.
- **Benign field drift:** native ignores `deduplicated` on `sent` receipts.

### 4.3 Location preference toggle (native → web) + state/result (web → native)

- **Request wire shape:** `window.beeboxNativeShareLocation("<requestId UUID>", "toggle")` pushes
  `{ id, action: "toggle" }` onto `window.beeboxNativeLocationQueue` and dispatches
  `CustomEvent('beebox:native-share-location', { detail })`.
- **Result wire shape** (web → native on `beeboxLocationResult`):
  `{ id: string, success: boolean, enabled: boolean, message: string }`.
- **State wire shape** (web → native on `beeboxLocationState`): `{ enabled: boolean }`.
  The web posts this when the native bridge mounts so the native menu reflects the persisted
  per-box preference without initiating a location capture.
- **Consent semantics:** toggle-on captures and stores a fix before returning `enabled:true`;
  toggle-off persists disabled without reading location. The web-owned localStorage preference
  remains the single source of truth for both composers.
- **Anchors:**
  | side | anchor |
  |---|---|
| native request + state/result decode | `ios-app/BeeBox/Views/ChatWebView.swift` — `beeboxNativeShareLocation` script, `receiveLocationState`, `receiveLocationResult` (15s timeout) |
  | web handle | `src/frontend/src/components/chat/use-native-bridge.ts` — `useNativeLocationBridge`, `handleNativeLocationRequest` (→ `captureAndStore(boxSlug, Date.now())`), `postNativeLocationResult`, `drainNativeLocationQueue` |
- **Drift:** request → SILENT→LOUD (15s native timeout); result → LOUD (status message shown).

### 4.4 Narration state (web → native)

- **Wire shape:** `{ enabled: boolean }` on `beeboxNarrationState`.
- **Semantics:** the web chat posts the current session's narration flag whenever it changes. Native
  defaults to off. A normal native voice keyword send uses its Apple live transcript directly only
  when both narration and HQ dictation are off; the explicit `clean up and send` / `send and clean
  up` keyword enters durable HQ audio preparation regardless of either state.
- **Anchors:** web `use-native-bridge.ts` — `useNativeNarrationBridge`; native
  `Views/ChatWebView.swift` — `receiveNarrationState`; `Views/NativeComposerView.swift` —
  `sendKeywordIntent`.
- **Drift:** fail-local — absent or malformed state leaves native narration off, avoiding an
  unintended audio upload.
- **Keyword detection is per-side, not bridged.** Each surface detects spoken keywords over its own
  transcript (`Services/SpeechKeywords.swift` natively; `lib/audio/speech-keywords.ts` +
  `input/voice-intent.ts` on web) and only the resulting tagged text crosses the bridge as ordinary
  emission content. The implementations deliberately diverge where their pipelines differ: native
  holds a detected keyword's tag substitution until the composer's send lock accepts it (a refusal
  restores the pre-keyword transcript) and refuses to match inside an existing markup tag; web never
  re-feeds composer text to detection, so it needs neither guard. Neither side may assume the
  other's detector fired.

### 4.4a HQ dictation state (web → native)

- **Wire shape:** `{ enabled: boolean }` on `beeboxHqDictationState`.
- **Semantics:** the web posts the resolved HQ setting for the visible chat. Native defaults to off.
  When enabled, both the native Send button and ordinary spoken-send keyword enter the durable HQ
  audio preparation path. Typed messages remain direct sends; the explicit cleanup keyword remains
  HQ regardless of this state.
- **Anchors:** web `use-native-bridge.ts` — `useNativeHqDictationBridge`; native
  `Views/ChatWebView.swift` — `receiveHqDictationState`; `Views/NativeComposerView.swift` —
  `send`, `sendKeywordIntent`.
- **Drift:** fail-local — an absent or malformed state leaves native HQ dictation off. If HQ
  transcription later fails, the durable preparation visibly falls back to its live transcript.

### 4.5 Speech playback state (web → native)

- **Wire shape:** `{ playing: boolean }` on `beeboxSpeechPlaybackState`.
- **Semantics:** the web posts changes to its actual speech playback state. An active native
  continuous-dictation turn pauses while `playing:true` and resumes when the final queued speech
  segment reports `playing:false`; an explicit stop or `send and close` prevents the later resume.
  The pause covers only the **automatic** reopens — after speech ends, after a send that keeps the
  microphone, after an erase — because none of those is the user asking to speak now. An explicit
  press of the record button does the opposite: it barges in (§4.10), matching the web composer,
  where `START_DICTATION` stops speech and opens the microphone at once. Native resumes on
  `playing:false` only for a microphone it actually deferred, so a barge-in's own stop does not
  restart the dictation the press already began.
- **Anchors:** web `use-native-bridge.ts` — `useNativeSpeechPlaybackBridge`; native
  `Views/ChatWebView.swift` — `receiveSpeechPlaybackState`; `Views/NativeComposerView.swift` —
  `applyVoiceTurn`.
- **Drift:** fail-local — absent or malformed state does not alter native microphone state.

### 4.6 Response generation state (web → native)

- **Wire shape:** `{ active: boolean }` on `beeboxResponseState`.
- **Semantics:** `active:true` means the chat machine is streaming an agent response;
  `active:false` means it is not. Native starts its send/wait earcon loop locally, ignores a stale
  initial false, observes the following true, and stops the loop when streaming transitions to
  refreshing and the web posts false. This matches the web voice composer's tick boundary.
- **Anchors:** web `use-native-bridge.ts` — `useNativeResponseBridge`; native
  `Views/ChatWebView.swift` — `receiveResponseState`; `Services/NativeEarcons.swift` —
  `NativeEarconState`.
- **Drift:** fail-local — absent or malformed state leaves the bounded 30-second tick loop to stop
  itself.

### 4.7 Companion selection command (web → native) + durability acknowledgement

- **Command wire shape** (web posts on `beeboxComposerCommand`):
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
- **Transport globals + event:** `window.beeboxNativeComposerCommandAck(detail)` pushes the
  acknowledgement onto `window.beeboxNativeComposerCommandAckQueue` and dispatches
  `CustomEvent('beebox:native-composer-command-ack', { detail })`. The queue is authoritative;
  the event is a wake signal.
- **Durability and dedup:** native acknowledges acceptance only after the box-scoped draft manifest
  is saved. It persists a bounded history of processed command IDs, so retrying before or after app
  relaunch returns accepted without adding a second selection or inline token. Rejection leaves the
  draft unchanged. Web waits 15s, then shows a dismissible error and lets the user add again.
- **Composition semantics:** typed companion selections have `anchor:null` and `spokenWords:null`,
  so native inserts `[selection#N]` at the current UTF-16 caret. During active native dictation,
  native instead snapshots the last eight recognized words and total spoken-word count as
  `anchor`/`spokenWords` and does not insert an inline token. Both forms reach Emission V2.
- **Anchors:**
  | side | anchor |
  |---|---|
  | web command + ack | `src/frontend/src/components/chat/native-composer-command.ts`; `use-native-composer-commands.ts`; `use-companion-selection.ts`; `InteractiveChat-view.tsx` |
  | native decode + durable mutation | `ios-app/BeeBox/Models/NativeComposerContract.swift` — `NativeComposerCommand`, `NativeComposerCommandAcknowledgement`; `Storage/ComposerDraftStore.swift` — `applySelectionCommand`; `Views/ChatWebView.swift` — `receiveComposerCommand` |
- **Drift:** LOUD (native rejection or web 15s timeout is user-visible).

### 4.8 Command envelope V2 (web → native) + command result (native → web)

The V1 envelope in §4.7 cannot carry a command that has no selection — native decodes `selection`
unconditionally — and the acknowledgement has no room for an answer. V2 fixes both, and is what the
UI scan (`docs/plans/agent-points-at-ui.md`, Track 5) rides.

- **Command wire shape** (web posts on the same `beeboxComposerCommand` channel):
  ```json
  { "version": 2, "id": "<UUID string>", "kind": "scan-controls" }
  { "version": 2, "id": "<UUID string>", "kind": "add-selection",
    "payload": { "ref": "…", "text": "…", "position": "…" } }
  { "version": 2, "id": "<UUID string>", "kind": "point-at-control",
    "payload": { "id": "bbx-composer-mic", "action": "point" } }
  ```
  `kind` discriminates the payload; a kind that carries none omits `payload`. `id` is required and
  non-empty in **every** version — that is what lets an older build's failed decode answer with a
  rejection (§4.7) instead of returning silently. An unknown `kind` is refused on both sides rather
  In `point-at-control` the payload's `id` is the **control's** `bbx-` address, not the command id
  (the envelope carries that separately), and `action` is closed to `point|focus|reveal`. Both are
  strict: an empty address and an unrecognised action each fail the whole decode, because the web
  degrades an unknown `action=` in a `control:` href to `point` before it ever builds a command, so a
  fourth value arriving here is a bundle skew — and acting on the interface on a guess is the one
  thing this feature must not do. An unknown `kind` is refused on both sides rather
  than guessed at — and note *how* native refuses it: the kind is a closed enum decoded before a
  command object exists, so an unknown one fails the whole decode and produces **only** the §4.7
  rejection acknowledgement, never a result. The web's wait is what covers that case, which is why
  no-result and refusal must stay indistinguishable to it. **V1 remains what the web sends for `add-selection`**, because installed iOS
  builds decode that shape and nothing else; V2's `add-selection` exists so the migration is
  expressible, not because the web has moved.
- **Result wire shape** (native → web, on its own global):
  ```json
  { "version": 2, "id": "<same id>", "kind": "scan-controls", "ok": true,
    "controls": [ { "id": "bbx-composer-mic", "role": "button", "label": "Start dictation",
      "does": "…", "container": "Composer", "disabled": false } ] }
  { "version": 2, "id": "<same id>", "kind": "scan-controls", "ok": false, "reason": "<reason>" }
  { "version": 2, "id": "<same id>", "kind": "point-at-control", "ok": true }
  { "version": 2, "id": "<same id>", "kind": "point-at-control", "ok": false, "reason": "<reason>" }
  ```
  `role` is closed to `button|textbox`. `does` is **omitted** when absent (Swift's encoder drops a
  nil optional); the web reads absent and null identically. `ok` is the discriminant rather than the
  presence of a field, so a successful **empty** inventory (`controls: []`) cannot be read as a
  failure. A successful `point-at-control` carries **nothing else**: the ring is already drawn on
  the phone, so the only thing to return is that it happened.
  `actions` on a control entry is closed to `point|focus|reveal` and says what the shell can
  actually do with that control. An installed build older than `point-at-control` **omits the key
  entirely**, and absent reads as **none** — never as `point` — because such a build can enumerate a
  control and cannot act on one; the dump then prints it `(not pointable)` rather than handing the
  agent a link that would break on click.
- **Result is separate from the acknowledgement, on purpose.** The ack (§4.7) says whether native
  *took* the command; the result says what the command *answered*. Native emits both for a V2
  command that *has* an answer — `scan-controls` and `point-at-control`. V2 `add-selection` is
  decodable but is **acknowledgement-only**: it has no result member on either side, because the
  web still sends selections as V1 (§4.7) and the V2 form exists so the migration is expressible,
  not because anything sends it. For a command native could not decode (an unknown kind, an unknown
  `action`, or an old build meeting V2 at all) only the rejection ack exists to emit. Keeping them apart is what makes "refused, and here is why"
  and "succeeded, and the answer is empty" two different facts.
- **Transport globals + event:** `window.beeboxNativeCommandResult(detail)` pushes onto
  `window.beeboxNativeCommandResultQueue` and dispatches
  `CustomEvent('beebox:native-command-result')`. The queue is authoritative; the event is a
  wake signal — same discipline as the emission and acknowledgement queues.
- **`scan-controls` semantics.** Native answers from a registry populated by the `.controlAnchor`
  view modifier, which registers `(id, label, does, container, disabled, frame)` while a view is on
  screen and deregisters it on disappear, and sets the view's `accessibilityIdentifier` to the same
  `id` in the same call. The `bbx-` ids are **shared with the web** (Track 4's table): the same string
  names the same control on both surfaces, so renaming one is a contract migration. Registration is
  by view-instance token, so the composer's mic → send → stop swap cannot leave a stale entry, and
  the inventory is coalesced by `id` so an in-flight swap cannot report two mutually exclusive
  controls at once.
- **`point-at-control` semantics.** Native looks the address up in the same registry and answers
  from it, so the scan and the pointer can never disagree about what exists. `point` draws a ring at
  the registered frame for ~2s — an overlay with `allowsHitTesting(false)`, no mask and no modal
  layer, static under Reduce Motion — and that is the *whole* effect: it never scrolls, focuses or
  operates anything. `focus` and `reveal` run only where the anchor supplied a handler for them, and
  `NativeControlEntry.actions` is **derived from** those handlers rather than declared beside them,
  so the list the agent reads cannot promise something the view has no way to do. In this build that
  is `focus` on `bbx-composer-input` (make the composer text field first responder) and `reveal` on
  `bbx-composer-add` (present the actions sheet) — and nothing else.
  Every gap answers with a sentence rather than doing nothing: an unregistered address, a frame the
  registry has no real layout for (refused rather than ringing the wrong place — the accepted
  lower-fidelity trade; such a control is also reported by `scan-controls` with **no actions**, so
  the inventory never advertises a pointer the dispatch would refuse), an action this control has no
  handler for, and any non-`point` action asked
  of a control that is on screen but disabled. The reason crosses back as the refusal's `reason` and
  the web renders it as the pointer's broken-link tooltip. **Known imprecision:** the ring is drawn
  by `RootView`, so a control inside a sheet a child view raised (the actions sheet's Capture row)
  would be ringed *under* that sheet — bounded, because the webview holding the link is covered by
  the same sheet, so the link cannot be tapped then.
- **Native refuses when its own chrome is covered.** A full-screen native surface (the lock screen,
  the pairing sheet) can sit over the chat while the composer beneath stays mounted and therefore
  stays registered. Answering from the registry then would describe controls the user cannot reach
  *and* claim the dump covers native chrome while the thing actually on top is absent from it, so
  `RootView.obstructedNativeSurface` refuses with a reason instead. **Known imprecision:** a sheet a
  child view raises — the attach menu, capture — is not visible to `RootView`, so a scan during one
  still answers from the composer registry. Bounded: those sheets are composer chrome themselves and
  the entries under them are real, just occluded. Recorded here rather than fixed, in the same class
  as the web scan's `offscreen` clipping imprecision.
- **The result queue is shared and non-destructive.** A subscriber puts back what it did not claim
  (`native-control-scan.ts` · `windowNativeControlBridge`), so two overlapping scans — or, next, a
  `point-at-control` answer — cannot swallow each other's results. Unclaimed results are capped at
  the most recent 10.
- **Web wait semantics.** The scan and the pointer each wait 1.5s for a result matching **both**
  their command id and their kind — the kind check is not redundant, since a shell answering the
  wrong question under the right id would otherwise be read as the right answer. No result, an
  `ok:false` result, and an old build that cannot decode the envelope at all are treated
  **identically**: the dump reports `coverage: "dom-native-unavailable"` and names the native
  controls that are therefore missing from it, rather than presenting a short list as complete. For
  a pointer, a refusal and a silence are also one outcome to the person tapping — the link takes the
  broken treatment either way — but they read differently: a refusal shows the shell's own sentence,
  a timeout says the app did not answer in time, because the shell may well have drawn the ring and
  lost the reply.
- **Anchors:**
  | side | anchor |
  |---|---|
  | web command + result + merge | `src/frontend/src/components/chat/native-composer-command.ts`; `native-command-bridge.ts`; `native-control-scan.ts`; `native-control-point.ts`; `ui-scan-request-handler.ts`; `src/frontend/src/components/ControlPointer.tsx` |
  | native registry + answer | `ios-app/BeeBox/Models/NativeComposerContract.swift` — `NativeComposerCommand`, `NativeComposerCommandResult`, `NativeControlEntry`; `Models/NativeControlRegistry.swift` — `controlAnchor`, `perform`; `Views/RootView.swift` — `handleComposerCommand`; `Views/NativeControlRingView.swift`; `Views/ChatWebView.swift` — `deliverComposerCommandResults` |
- **Drift:** LOUD in the dump (a coverage line the agent reads), silent to the user — nothing in the
  UI depends on it.
### 4.9 Last-audio request (web → native), answered by direct HTTP

The relay that lets a box agent retranscribe a message dictated in the **native** composer. Design:
`docs/plans/ios-audio-retranscription.md`.

- **Why it exists:** `bbx chat retranscribe --message <id>` is answered by whoever holds the
  recording. Web tabs answer from an in-memory store keyed by emission id
  (`src/frontend/src/lib/audio/last-audio.ts`). A natively-dictated recording never enters the page,
  so without this relay the phone's recordings are unreachable and every such message answers
  `no-audio`.
- **Request wire shape** (web posts on `beeboxLastAudioRequest`):
  ```json
  { "version": 1, "requestId": "<pending request id>", "messageId": "<emission id>",
    "sessionId": "<relaying tab's session id, or null>" }
  ```
  Both ids are required and non-blank. `requestId` is the answer's URL segment; `messageId` must be
  echoed on the answer or the server discards it (see below). `sessionId` is the **relaying tab's**
  own, and is null before the tab has been assigned one — but it is a **fallback**, not the answer:
  native stores the session each recording was dictated INTO and echoes that instead when it has
  one. The echoed session addresses the retranscription report
  (`cli/commands/chat-audio-report.ts` → the `chat-retranscription` bus event, which the web
  matches against its own session), so answering with the phone's currently-visible session would
  post the correction to whichever conversation the user happens to be looking at.
- **No acknowledgement channel.** Native answers the box directly over HTTP:
  `POST /api/chat/last-audio/:requestId`, multipart with `file` (audio/wav), `recordedAt` (ISO 8601),
  `text` (the committed transcript, capped — §8), `messageId`, and `sessionId` when non-null; or
  `Content-Type: application/json` with `{"none": true}` when this device does not hold that
  recording. Device-token auth as §2. Megabytes of WAV would have to be base64-ed to come back
  across a script message, so they do not.
- **Two server properties this depends on** (`src/core/last-audio-pending.ts`), both load-bearing:
  **(1)** a `none` answer does not settle the request — each request's grace window defaults to its
  own `timeoutMs`, so an instant chorus of "none" from tabs that lack the recording cannot cut off a
  slower answerer, which is exactly what the phone is; **(2)** echo-and-verify — an answer whose
  echoed `messageId` does not match the target is ignored without settling, so a phone holding a
  different recording cannot win. A `404` back to the phone is the ordinary multi-answerer outcome
  (another answer won, or the request timed out) and is not an error.
- **Both answer.** In a native shell the tab relays AND answers from its own store: a recording made
  by the *web* composer inside the same webview is legitimately the page's.
- **Retention:** native keeps the last five recordings per box on disk, keyed by emission id
  (`Storage/VoiceAudioRetentionStore.swift`) — the same bound as the web store (§8), but durable
  across app relaunch and the WKWebView content-process reload. Unpairing a box drops its
  recordings.
- **Anchors:**
  | side | anchor |
  |---|---|
  | web relay | `src/frontend/src/components/chat/native-last-audio-request.ts`; `src/frontend/src/lib/audio/last-audio.ts` — `fulfillLastAudioRequest` |
  | box server | `src/webapp/routes/chat-last-audio-routes.ts`; `src/core/last-audio-pending.ts` |
  | native decode, retention, answer | `ios-app/BeeBox/Models/NativeComposerContract.swift` — `NativeLastAudioRequest`; `Storage/VoiceAudioRetentionStore.swift`; `Services/ChatAPI.swift` — `answerLastAudio`; `Views/ChatWebView.swift` — `receiveLastAudioRequest`; `Views/RootView.swift` — `answerLastAudioRequest` |
- **Drift:** QUIET — a phone that stops answering looks identical to a phone that is asleep, and the
  agent sees the same "no recording is cached" either way. The fixture family `last-audio-request`
  and `VoiceAudioRetentionTests` are what catch it.

### 4.10 Speech control (native → web)

Barge-in. The native composer owns its microphone but not the speech it would talk over — the page
plays that (`lib/audio/tts-client.ts`), so only the page can stop it.

- **Direction:** native → web.
- **Wire shape:** `window.beeboxNativeSpeechCommand(<detail>)` pushes the detail onto
  `window.beeboxNativeSpeechCommandQueue` and dispatches
  `CustomEvent('beebox:native-speech-command')`. The queue is authoritative; the event is a
  wake signal (its detail is never read). Detail:
  ```json
  { "version": 1, "action": "stop" }
  ```
  V1 is strict: an unversioned payload is a pre-contract sender and an unknown `action` a newer one,
  and neither may be guessed at — there is no channel to report a guess through, so a payload that
  does not validate is dropped rather than stopping speech nobody asked to stop.
- **When native sends it:** on an explicit press of the record button while `playing:true`, and
  only then. Every automatic reopen (§4.5) keeps waiting instead: interrupting the box's reply to a
  message the user just sent is the opposite of what was asked. There is no keyword-initiated start
  to consider — native detects keywords over an already-live recognizer.
- **Web handling:** `use-native-bridge.ts` · `useNativeSpeechCommandBridge` drains the queue and
  sends the composer machine `STOP_SPEECH` — deliberately not `START_DICTATION`, whose `beginTurn` +
  `startMic` would open the *web* microphone inside a native shell and leave web turn-taking to
  reopen it after the next speech. The page is the speaker; native is the listener. One transition
  is worth knowing: `STOP_SPEECH` in the machine's `pausedForSpeech` state also `resumeMic`s, which
  would open the web microphone. It is unreachable in a native shell — that state is entered only
  from web recording, and the web composer is suppressed under `nativeComposer` (§3.2) — but a
  surface that ever starts the web mic inside the native shell would make this row unsafe.
- **No acknowledgement channel.** §4.5's `{playing:false}` already reports the stop, and native does
  not wait for it: the microphone opens on the press. A command that never lands costs the tail of
  one utterance overheard by the mic, which is strictly better than the turn it would otherwise cost.
- **Anchors:**
  | side | anchor |
  |---|---|
  | native decide + send | `ios-app/BeeBox/Services/SpeechDictation.swift` — `NativeVoiceTurnState`, `NativeVoiceTurnCommand.startDictationInterruptingSpeech`; `ios-app/BeeBox/Views/NativeComposerView.swift` — `applyVoiceTurn`; `ios-app/BeeBox/Views/ChatWebView.swift` — `deliverSpeechStopRequest`; `ios-app/BeeBox/Models/NativeComposerContract.swift` — `NativeSpeechCommand` |
  | web handle | `src/frontend/src/components/chat/native-speech-command.ts` — `nativeSpeechCommandFromDetail`; `src/frontend/src/components/chat/use-native-bridge.ts` — `useNativeSpeechCommandBridge`; `src/frontend/src/machines/composerMachine.ts` — `STOP_SPEECH` |
- **Drift:** SILENT-degraded — against a web build without the handler the microphone still opens and
  the speech keeps playing into it. A page load is the same outcome: a request is **settled on the
  spot** if no document is loaded, and **abandoned** on a provisional navigation or a box/session
  change, never parked and replayed. A stop aimed at an utterance that no longer exists would land
  on whatever the next document says next, which is worse than the press already being honoured
  natively — the microphone opened on the press regardless.

### 4.11 Screen wake — native owns the idle timer (no wire)

Not a channel: nothing crosses the bridge. It is here because it is a **split of responsibility**
that both sides must honour, and honouring it web-side means *not* acting.

iOS sleeps the display on a system idle timer that only user interaction resets, and a screen lock
suspends an app with no background-audio mode — so an open microphone in a silent room looks like an
abandoned phone, and the recording dies. Only the native layer can prevent that
(`UIApplication.isIdleTimerDisabled`); the Screen Wake Lock API requested from inside a `WKWebView`
is not a substitute for it.

- **Native holds the screen awake for**, and only for:
  - a composer voice turn — the microphone open or opening, *plus* the gaps inside the turn: the
    pause while the box speaks (§4.5) and the reply streaming in before that speech starts. Those
    gaps are exactly when nobody is speaking or touching, and the turn will reopen the microphone at
    the end of them. The turn ends — and the hold with it — when the microphone closes, the message
    is sent and closed, or dictation fails (denied permission, audio-engine failure, a phone call, a
    route change), because in each of those the microphone is already down.
  - page speech playing (§4.5 `{playing:true}`), which a screen lock would cut off mid-sentence.
  - native capture recording audio — the same open-microphone break on a different surface.
- **Native does not hold it for** an idle foregrounded chat, or a turn streaming in outside a voice
  turn. A reader who is not touching the screen is what the idle timer is for.
- **Release is primarily by re-derivation.** Each holder states its reason as a condition computed
  from current state — with `scenePhase == .active` folded into that condition — so backgrounding, a
  failed or interrupted dictation, and the microphone closing all release by the same path rather
  than by remembering to undo something. The one case re-derivation cannot cover is a surface that
  has gone away, so each also releases *its own* reasons on disappearance. A leaked hold is a phone
  that never sleeps, which is worse than the bug being fixed.
- **A reason is a role, and each has one live surface** — one composer for the selected box, one
  capture cover. Reasons are not instance-scoped, so a platform that can show two of the same surface
  at once needs an owner token per hold; two *different* reasons already coexist safely.
- **Web side: do not claim it under `nativeComposer`.** The page can see only the speech half of a
  native voice turn, so a web wake lock there would hold through the box talking and drop through the
  listening it cannot observe — the shape of the original bug. `useWakeLock` remains correct for the
  ordinary browser client, where the web *does* own the microphone.
- **Anchors:**
  | side | anchor |
  |---|---|
  | native hold | `ios-app/BeeBox/Services/ScreenAwake.swift` — `ScreenAwakeReason`, `ScreenAwakeState`, `ScreenAwakeHold`; `ios-app/BeeBox/Views/NativeComposerView.swift` — `screenAwakeReasons`; `ios-app/BeeBox/Views/NativeCaptureController.swift` — `NativeCaptureScreen.applyScreenAwake` |
  | web abstention | `src/frontend/src/components/chat/InteractiveChat-voice.ts` — `useDebouncedWakeLock(nativeComposer ? false : …)`; `src/frontend/src/hooks/useWakeLock.ts` |
- **Drift:** SILENT both ways. A native build without the hold sleeps under an open microphone (the
  filed bug); a web build that re-acquires its own lock under the native shell breaks nothing —
  native still holds the whole turn — but leaves two mechanisms claiming the screen, which is how
  this stayed confusing. The web half is deliberately **not** in the §11 anchor list for that reason:
  its failure is comprehensibility, not behaviour.

---

## 5. Direct HTTP calls from native code

The main app and its Share Extension use the endpoints below. Ordinarily `/chat/send` is called by
the **web layer inside the webview**; the Share Extension is the deliberate native exception.

### 5.1 `POST /api/pairing/redeem`

See §1.3 (full request/response/errors).

### 5.2 `POST /api/chat/transcribe-audio` — HQ audio transcription

- **Direction:** native → box.
- **Request:** `POST`; `Content-Type: multipart/form-data`; `User-Agent: BeeBox-iOS/0.1`;
  `Authorization: Bearer <token>`. Multipart body: text field `session=<resolved session id>`; file
  field `file`, filename `segment.wav`, content-type `audio/wav`.
- **Response 200:** `{ text: string, diarized: boolean, service?: string }`, where
  `service` is the backend resolved by the box (not the client's requested intent).
  Clients accept its absence for compatibility with older boxes.
- **Errors:** 400 `{ error: "No audio uploaded" }`; 500 `{ error: <msg> }` → iOS
  `ChatAPIError.server(...)` (surfaces in composer status).
- **Anchors:**
  | side | anchor |
  |---|---|
  | native caller | `ios-app/BeeBox/Services/ChatAPI.swift` — `ChatAPI.transcribeAudio(fileURL:)`, `applyAuth`, `HqTranscriptionResult { text, diarized, service? }` |
  | box handler | `src/webapp/routes/chat-audio-routes.ts` — `POST /api/chat/transcribe-audio` (→ `transcribeAudioHq({ audioBuffer, filename, boxRoot })`) |
- **Drift:** LOUD for provider rejection (5xx surfaced). A provider HTTP 200 with unusable text would
  be SILENT. Float32 WAV compatibility was verified against every selectable HQ path on 2026-08-06.

### 5.3 `GET /api/chat/default` — session resolution

- **Direction:** native → box (only when `box.sessionID` is empty).
- **Response:** `{ sessionId?: string }` (most-active session, or absent).
- **Anchors:**
  | side | anchor |
  |---|---|
  | native caller | `ios-app/BeeBox/Services/ChatAPI.swift` — `ChatAPI.resolvedSession()`, `DefaultSessionResult { sessionId? }` |
  | box handler | `src/webapp/routes/chat.ts` — `GET /api/chat/default` (→ `getMostActive(boxRoot)`) |
- **Drift:** LOUD (non-2xx `resolvedSession` throws; a transient 5xx does not silently fork a new
  session).

### 5.4 `POST /api/chat/upload-file` — composer file upload

- **Direction:** native → box.
- **Request:** `POST`; `Content-Type: multipart/form-data`; `User-Agent: BeeBox-iOS/0.1`;
  `Authorization: Bearer <token>`. One file field named `file` with the original filename and MIME
  type. Native reports `URLSession` byte progress while uploading.
- **Response 200:** `{ path: string, originalName: string, size: number, mimetype: string }`; `path`
  points under the box's `_tmp/` directory and becomes the Emission V2 file `path`.
- **Anchors:**
  | side | anchor |
  |---|---|
  | native caller | `ios-app/BeeBox/Services/ChatAPI.swift` — `uploadFile`, `uploadFileRequest` |
  | box handler | `src/webapp/routes/chat-uploads.ts` — `registerChatUploadRoutes` |
- **Drift:** LOUD (non-2xx, malformed metadata, interruption, and timeout produce retryable native
  attachment failure; incomplete files block send).

### 5.5 (web layer, for completeness) `POST /api/chat/send`

> **A `"new"` send may now carry `engine` and `model`** — the engine and model
> chosen in the web picker before a chat's first message
> (`docs/model-policy.md`). Both are optional and absence means the box's
> defaults, so the native path is unaffected: `ChatAPI.resolvedSession()` returns
> a session id or the literal `"new"` and never sends a choice. A chat created by
> a native-originated first message therefore takes the box defaults, which is
> correct — no choice was made. The picker itself lives in the webview.

- **Direction:** the webview's own JS → box, on every native emission (§4.1).
- **Request:** `{ "Content-Type": "application/json", ...mobileAuthHeaders() }`; body
  `{ session, message, messageId, images?, contextDir?, seedFeatures?, openCard?, cardActivity?, cardState?, channel? }`.
  `channel` is the client's own reading of the surface — `web-desktop | web-mobile | ios-native`
  (`src/shared/chat-channel.ts`), sent because the WebView's User-Agent cannot be told from mobile
  Safari's. A body without it (an old web bundle, or the Share Extension's S3 send) falls back to
  the server's User-Agent classification, so `ios-native` is reported only by a webview that sees
  the native bridge.
  Image schema `{ id: number, mimeType: string, dataBase64: string.min(1) }`, byte cap in
  `validateImages`.
- **Response:** `{ turnId? } | { queued: true } | { deduplicated: true }` (dedup keyed on `messageId`).
- **Anchors:**
  | side | anchor |
  |---|---|
  | web caller | `src/frontend/src/api-chat.ts` (`chatTurnStartSchema`, `ChatImageAttachment`) |
  | box handler | `src/webapp/routes/chat-send-routes.ts`; `src/webapp/routes/chat-helpers.ts` — `sendBodySchema`, `validateImages` |
- **Drift:** LOUD (400) / SILENT dedup.

### 5.6 Bulk file-upload batch (`/api/bulk/...`)

- **Direction:** native → box (also driven by the web overlay). The server contract is
  uploader-agnostic and carries bearer auth like every other native call; there are now two
  implementations of these rows — the web overlay and the iOS uploader
  (`docs/plans/chat-photo-batch-upload.md`, the Track 3 that
  `docs/implemented-plans/bulk-file-upload.md` §4 deferred). Neither may assume it is the only
  client. Auth: cookie OR `Authorization: Bearer
  <token>`, owner-scoped per session (same `authorizeCaptureSessionOwner` ownership as capture).
- **Endpoints:**
  - `POST /api/bulk/sessions` — create a batch. Req `{ targetSessionId: string /* required */,
    items?: BulkItem[] }` where `BulkItem = { id: string, name: string, size?:
    number, mimetype?: string }`. Res `{ sessionId, startedAt, capabilities: { acceptedUploadEncodings:
    ["raw-body-v1"] } }`. A missing/empty `targetSessionId` is **400** (a batch with no chat to
    deliver into is invalid at creation). The batch's context dir is derived **server-side** from
    `targetSessionId` (via the session→directory history binding) — the client never supplies a box
    path (a client-supplied dir would be a path-traversal vector), and any `contextDir` in the body is
    ignored. Item id/name/mimetype are length-capped (512); a duplicate id in the request, or more
    than 500 items, is **400**.
  - `POST /api/bulk/sessions/:id/items` — append to the item registry. Req `{ items: BulkItem[] }`.
    Res `{ registered: number }`. A duplicate id in the request, a new id colliding with one already
    registered, or exceeding the 500-item registry cap is **400**. **409** once the session is sealed
    (finalize froze the registry). Re-sending an existing id is idempotent.
  - `POST /api/bulk/sessions/:id/items/:itemId/upload` — stream one item's bytes. `Content-Type:
    application/octet-stream` (raw body, **streamed** to disk — never multipart); headers
    `X-Upload-Filename` (required; the staged idempotency key), `X-Upload-Original-Name`,
    `X-Upload-Mime-Type`, `X-Upload-Uploaded-At`. Res `{ success, filename, itemId, size, sha256 }`
    (size + sha256 **server-computed** while streaming). An unregistered `itemId` is **400**; a byte
    over the staging cap **413**; a same-filename/different-bytes retry **409**; a commit that races
    finalize (session sealed under the lock, or an item unregistered under the lock) **409**; a second
    concurrent stream for the same item, or more than 8 concurrent streams for the session, **409**
    (retry shortly).
  - `GET /api/bulk/sessions/:id` — resume/status: `{ sessionId, state, targetSessionId, registered:
    BulkItem[], received: [{ itemId, name, size }] }`.
  - `DELETE /api/bulk/sessions/:id` — cancel and discard the batch. Accepted only while the batch is
    `open` (still uploading) or `failed:*` (dead, retryable); **409** once finalize has sealed it,
    because the background worker owns it from then on and deleting the staging directory under that
    worker makes it read `null` and silently return — no `<upload>` message, while the client that
    already saw finalize succeed reports success. The state check and the delete run together under
    the staging lock, so a cancel cannot race the seal. Uploaders must disable their cancel/close
    affordances once finalize is in flight.
  - `POST /api/bulk/sessions/:id/finalize` — seal + fire the background prepare→deliver worker. Req
    `{ failedItems?: [{ id?, name, reason }], note?: string }`. Res `{ sessionId, staged: true }`.
    **503** if the box has no chat runtime. Returns immediately; the batch lands an `upload-batch`
    card under the chat's `tmp-upload/` and an `<upload>` message is injected.
    **A 200 here means SEALED, not DELIVERED** — prepare→deliver runs in the background afterwards
    and can still fail (`failed:prepare` / `failed:deliver`).
    **The seal is the hand-off.** Before it, the uploader is the only thing that can recover the
    batch, so a failed finalize means the uploader keeps the user's text and lets them retry. After
    it, the box holds both the bytes and the `note`, and owns recovery: a batch that ends `failed:*`
    is surfaced to its chat agent by the sweep (`core/bulk-upload/sweep.ts`, `notifyStranded`) with
    the introduction and the received/failed/registered counts, so the agent can tell the boxholder
    and offer to place the files. An uploader therefore **MUST NOT** mount its own retry for a sealed
    batch — two recovery paths for one batch is how it gets delivered twice — and MAY release its
    local copies and the composer text once finalize returns 200.
    Polling `GET /sessions/:id` after the seal is for UX only (reporting success promptly), not
    correctness. Terminal reads: `delivered`, `delivering` (queued to a busy agent), or **404**
    (staging is torn down only after delivery) all mean delivered; `failed:*` means the box will hand
    it to the agent.
    `note` is the batch's **introduction** — the uploader sends the composer text the user submitted
    the files with, verbatim. **Read it at finalize time, not when the batch starts.** A large batch
    takes minutes and the natural way to caption one is to pick the files and then write about them,
    so an uploader that snapshots the composer up front can only ever carry text typed *before* the
    picker opened — which is how the first prod run shipped with no note at all (2026-07-31). For the
    same reason an uploader **must not lock its text surface while a batch uploads**; gate the send
    action, not typing. It rides in the same atomic seal as `failedItems`, lands in the card's
    `note` frontmatter, and renders as the first paragraph of the `<upload>` message body (above the
    generated summary, separated by a blank line). Capped at 10,000 chars (**400** over); a
    whitespace-only note is stored as absent, and a batch with no note produces an `<upload>` message
    byte-identical to the pre-`note` form. **An uploader that has composer text MUST send it** —
    without it every batch is "unintroduced" and the agent asks what the files are instead of filing
    them (`src/schemas/upload-batch.tsx` duty 1).
- **Anchors:**
  | side | anchor |
  |---|---|
  | box handler | `src/webapp/routes/bulk-upload.ts` — `registerBulkUploadRoutes`; streaming write in `src/core/capture/staging-stream.ts` — `addFileStreamed` |
  | native caller | `Services/BulkUploadAPI.swift` — request shaping; `Services/BulkUploadCoordinator.swift` — bounded queue (3 in flight), per-item retry, resume via `GET /sessions/:id` |
- **Drift:** LOUD (400/409/413/404 all surface; incomplete uploads leave the item in the registry's
  missing list, which finalize reports).

### 5.7 `POST /api/trpc/debugLog.submit` — native log forwarding

- **Direction:** native → box. Non-batched tRPC mutation: no transformer is configured on the tRPC
  stack, so per the tRPC v11 HTTP-RPC spec this is a plain `POST <baseURL>/api/trpc/debugLog.submit`
  with the input object as the raw JSON body (not the batch-link envelope).
- **Request:** `{ source?: string, entries: [{ level: "error"|"warn"|"log"|"info", message: string,
  at?: string }] }`. `source` is a slug (`^[a-z][a-z0-9-]{0,15}$`, ≤16 chars); iOS sends `"ios"`.
  `at` is an RFC 3339 datetime with an offset (`z.string().datetime({ offset: true })`) — the
  device-side time the entry describes, since a queued entry can flush long after the incident (the
  forwarder persists entries on-device and only flushes on launch/foreground/best-effort-background).
  `message` is capped at 4000 chars server-side; iOS enforces the identical cap client-side before
  persisting, so a conforming client's batch can never 400 for size. Up to 100 entries per batch.
  Auth: `Authorization: Bearer <device token>` like every other native call (§2).
- **Native level policy:** iOS sends `error`, `warn`, and selected `info`
  transitions. Its offline queue evicts the oldest info entry before an
  error/warn entry at both per-box and global bounds. Info currently covers app
  scene phase, selected box, web-view navigation, speech/response activity, and
  audio-session role. This is behavior within the existing wire enum; no request
  field changed.
- **Response 200:** the tRPC HTTP-RPC envelope `{"result":{"data":{"ok":true}}}` — the procedure
  returns `{ ok: true }`, but the raw bytes a native client reads are wrapped (the native side only
  checks the status code, so it never unwraps this). A 2xx means the batch is **durably written** — the route's file
  append goes through a strict variant (`appendRollingLogStrict`) that rejects on filesystem failure,
  unlike the lenient one every other rolling-log writer uses. The forwarder relies on this: it only
  clears a batch from its local queue once it sees 2xx, so a swallowed disk error would otherwise be
  a silent, unrecoverable loss of the client's only copy.
- **Rendering:** appended to `<boxRoot>/.beebox/client-debug.log` as
  `<receiptISOTime> [level] message`; a `source` adds a `[source]` tag, and once `at` drifts more than
  ~5s from receipt time the tag becomes `[source@<at>]` — so a stale-flushed entry still shows the
  incident's own time. Control characters (including CR/LF) in `message` are normalized to single
  spaces before the line is written, for every source including web — a crafted or multiline message
  can't forge extra log lines. The 200-entry in-memory ring (`debugLog.get`) bakes the same tag into
  its `message` field; its `{ts,level,message}` shape is otherwise unchanged.
- **Forward-compat:** the input schema is a plain (non-strict) `z.object` — unknown top-level or
  per-entry keys are stripped rather than rejected, so an old server against a client sending fields
  it doesn't know yet still accepts the batch (untagged, degrading to today's web-only rendering).
- **Errors:** 400 (Zod validation — bad `level`, oversized `message`, batch over 100 entries, bad
  `source` shape); 500 if the strict append itself fails (disk full/permissions — rare, but the point
  of the strict variant is that it's never silent).
- **Anchors:**
  | side | anchor |
  |---|---|
  | native caller | `Services/LogForwarder.swift` — `flushBox`/`send` |
  | box handler | `src/webapp/trpc/routers/debugLog.ts` — `submit` |
  | box durability | `src/lib/rolling-log.ts` — `appendRollingLogStrict` |
- **Drift:** fail-local. A forwarding failure must never break the feature it's logging — entries are
  retained client-side on any network failure or 5xx and simply wait for the next flush trigger; there
  is no retry loop that could itself become a second unreliable upload. A 401/403 (revoked device)
  drops that box's queued batch rather than retrying forever against a device that will never regain
  access.

### 5.8 Share Extension — textual destinations and delivery

- **Shared pairing state:** the main app writes every paired box's non-secret metadata (id, label,
  base URL, lock requirement), plus its selected box id, to App Group
  `group.app.beebox.ios`. The Share Extension initially selects that box, always names the
  current box, and offers a box picker when more than one box is paired. Choosing a box in the
  extension is local to that share action and does not change the main app's selected box. The
  extension reloads destinations for the chosen box and ignores a stale response from an earlier
  choice. A protected box's device-owner authentication gate runs before destination loading,
  which gates submission; provider classification may happen first so unsupported input can fail
  without an unnecessary authentication prompt. The device token is never written to UserDefaults;
  it is a generic-password Keychain item shared through access group
  `44AJ3D25ZD.group.app.beebox.ios` (the resolved access group for the app's signing team), service
  `app.beebox.ios.device-token`, account `<box UUID>`. Both targets carry both entitlements.
- **`GET /api/trpc/share.destinations`:** bearer-authenticated query. The tRPC envelope's `data` is
  `{ chats, saves }`; `chats` contains at most two fresh resumable landmark chats, each
  `{sessionId,label,lastActivity,landmark:{dir,label,symbol}}`. `saves` starts with Inbox and then
  landmarks advertising `destinations: [{for:[share]}]` as
  `{destination:{kind:"inbox"}|{kind:"landmark",dir},label,symbol}`.
- **`POST /api/chat/send`:** a URL or text sent to chat uses
  `{message,messageId,session,exactSession:true}`. Exact mode rejects `new` and missing/archived
  sessions; it never creates the requested id or falls back to another chat. The URL is the message.
- **`POST /api/trpc/share.saveTextual`:** input is `{kind:"url",shareId,url,title?,capturedAt,
  destination}` or `{kind:"text",shareId,text,title?,capturedAt,destination}`. A URL creates one
  `.webpage.card` with the Clerk-compatible Markdown-link fallback; text creates one `.doc.card`.
  Both carry optional `share-id` provenance. A retry finds the id even after the card moves and
  returns that path only for identical immutable content; changed content or card type is 409.
- **Current native activation:** URL and plain text, one provider at a time. Image, audio, and file
  activation remains deferred until capture staging supports exact chat and save targets; the
  extension does not advertise unsupported types.
- **Anchors:** native `BeeBoxShareExtension/ShareExtensionAPI.swift`,
  `ShareViewController.swift`, app `Storage/PairedBoxCredentialStore.swift` and
  `SharedSelectedBoxSnapshot.swift`; box `trpc/routers/share.ts`, `share-contract.ts`, and
  `routes/chat-send-routes.ts`.
- **Drift:** LOUD. Malformed envelopes, stale destinations, stale chats, authentication failure,
  and conflicting retries remain visible in the sheet and do not dismiss it.

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

- **`User-Agent: BeeBox-iOS/0.1`** is sent on all four native HTTP calls but the server never
  branches on it — informational / for logs only.

---

## 7. Contract Surface Index

The authoritative surface list. A platform implements **exactly** these rows. Anchors are file +
symbol; drift is LOUD or SILENT (§Drift legend).

| # | Touchpoint | Direction | Wire shape (exact fields) | Native side (file · symbol) | Box side (file · symbol) | Drift |
|---|---|---|---|---|---|---|
| P1 | `beebox://pair` deep link | ext→native | `baseURL`\|`url`, `label`, `pairingToken`\|`token`, `session`, `authToken`(DEBUG) | `Storage/PairedBoxStore.swift` · `pair(from:)`; `Info.plist` · URL scheme | `settings/CompanionPairingSection.tsx` · `pairingDeepLink` | SILENT |
| P2 | Pairing-ticket mint | UI→box | out `{token,expiresAt}` | — (UI only) | `trpc/routers/pairing.ts` · `createTicket`; `core/mobile/pairing.ts` · `createMobilePairingTicket` | LOUD |
| P3 | `POST /api/pairing/redeem` | native→box | req `{pairingToken,deviceLabel}`; res `{boxSlug,label,deviceId,deviceLabel,token}` (native reads only `token`) | `Storage/PairedBoxStore.swift` · `redeemPairing` | `routes/pairing.ts` · redeem route, `RedeemBody` | LOUD server / SILENT native |
| A1 | Device token → localStorage | native→web | key `beebox.mobileAuthToken` = `<token>` | `Views/ChatWebView.swift` · startup `WKUserScript` | `lib/mobile-auth.ts` · `MOBILE_AUTH_TOKEN_STORAGE_KEY` | SILENT |
| A2 | Device token → `Authorization: Bearer` | native/web→box | header | `Services/ChatAPI.swift` · `applyAuth`; web `lib/mobile-auth.ts` · `mobileAuthHeaders` | `core/mobile/pairing.ts` · `verifyMobileBearer`; `server-box-scope.ts` · `addBoxAuthHook` | LOUD |
| A3 | Device token → `Set-Cookie: bbx_mobile` | box→browser | `bbx_mobile=<signed>; HttpOnly; Secure; SameSite=Lax; Path=/<slug>; Max-Age=3600` | `Views/ChatWebView.swift` · `request()` sets `Authorization`, WebKit stores the response cookie | `webapp/mobile-cookie.ts` · `setMobileSessionCookie`; `core/mobile/mobile-session.ts` · `MOBILE_COOKIE_NAME` | LOUD |
| A5 | `POST /api/pairing/session` | web→box | req `Authorization: Bearer <token>`; res `204` + `Set-Cookie` | web `lib/mobile-auth.ts` · `refreshMobileSession` | `routes/pairing.ts` · session route | LOUD |
| A4 | tRPC context identity | box internal | `authed` from mobile token; `user=null,isOwner=false` | — | `server-box-scope.ts` · `createContext` | SILENT |
| W1 | Chat webview URL | native→web | `/chat?nativeComposer=1[&session]` — carries NO credential | `Models/PairedBox.swift` · `chatURL`; `Views/ChatWebView.swift` · `request()` | `pages/ChatPage.tsx`; `router.tsx` | SILENT |
| W2 | Session report | web→native | `beeboxSession` = `location.href` (string) | `Views/ChatWebView.swift` · `userContentController`, `visibleSessionID` | native-authored startup script | SILENT |
| B1 | Native emission | native→web | V2 `{version:2,id,text,origin,diarized,hqText?,hqService?,images,files,selections}`; legacy `{id,text,origin,diarized,images}` remains accepted; delivered via `beeboxNativeReceive`, queue `beeboxNativeQueue`, event `beebox:native-emission` | `Models/NativeComposerContract.swift` · `NativeEmissionV2`; `Views/ChatWebView.swift` · `NativeChatEmission` | `use-native-bridge.ts` · `useNativeEmissionBridge`; `native-emission.ts` · `parseNativeEmissionDetail` | LOUD V2 / SILENT legacy |
| B2 | Emission receipt | web→native | `{disposition:sent\|queued\|rejected, emissionId, deduplicated?/reason?}` via `beeboxEmissionReceipt` | `Views/ChatWebView.swift` · `receiveEmissionReceipt` | `use-native-bridge.ts` · `postNativeReceipt` → `native-post.ts` · `postNativeMessage`; `input/targets/receipts.ts` · `Receipt` | SILENT→LOUD |
| B3 | Location toggle | native→web | `beeboxNativeShareLocation("<uuid>","toggle")`, queue `beeboxNativeLocationQueue`, event `beebox:native-share-location`, detail `{id,action:"toggle"}` | `Views/ChatWebView.swift` · location script | `use-native-bridge.ts` · `useNativeLocationBridge` | SILENT→LOUD |
| B4 | Location state/result | web→native | state `{enabled}` via `beeboxLocationState`; result `{id,success,enabled,message}` via `beeboxLocationResult` | `Views/ChatWebView.swift` · `receiveLocationState`, `receiveLocationResult` | `use-native-bridge.ts` · `postNativeLocationState`, `postNativeLocationResult` → `native-post.ts` · `postNativeMessage` | LOUD |
| B5 | Companion selection command | web→native | V1 `{version:1,id,kind:add-selection,selection:{ref,text,position}}` via `beeboxComposerCommand` | `Models/NativeComposerContract.swift` · `NativeComposerCommand`; `Views/ChatWebView.swift` · `receiveComposerCommand`; `Storage/ComposerDraftStore.swift` · `applySelectionCommand` | `native-composer-command.ts`; `use-native-composer-commands.ts`; `InteractiveChat-view.tsx` | LOUD |
| B6 | Composer command acknowledgement | native→web | accepted `{version:1,id,accepted:true}` or rejected `{version:1,id,accepted:false,reason}` via `beeboxNativeComposerCommandAck`, queue + `beebox:native-composer-command-ack` event | `Models/NativeComposerContract.swift` · `NativeComposerCommandAcknowledgement`; `Views/ChatWebView.swift` · `deliverComposerCommandAcknowledgements` | `native-composer-command.ts` · `nativeComposerCommandAcknowledgementFromDetail`; `use-native-composer-commands.ts` | LOUD |
| B11 | Speech control (barge-in) | native→web | V1 `{version:1,action:"stop"}` via `beeboxNativeSpeechCommand`, queue `beeboxNativeSpeechCommandQueue`, event `beebox:native-speech-command`; no ack — §4.5 `{playing:false}` reports the stop | `Models/NativeComposerContract.swift` · `NativeSpeechCommand`; `Services/SpeechDictation.swift` · `NativeVoiceTurnState`; `Views/ChatWebView.swift` · `deliverSpeechStopRequest` | `native-speech-command.ts` · `nativeSpeechCommandFromDetail`; `use-native-bridge.ts` · `useNativeSpeechCommandBridge` | SILENT-degraded (speech plays into an open mic) |
| B10 | Last-audio request relay | web→native | V1 `{version:1,requestId,messageId,sessionId\|null}` via `beeboxLastAudioRequest`; answered by H6, not by an ack | `Models/NativeComposerContract.swift` · `NativeLastAudioRequest`; `Views/ChatWebView.swift` · `receiveLastAudioRequest`; `Views/RootView.swift` · `answerLastAudioRequest` | `native-last-audio-request.ts`; `lib/audio/last-audio.ts` · `fulfillLastAudioRequest` | QUIET (asleep phone is indistinguishable) |
| B7 | Narration state | web→native | `{enabled}` via `beeboxNarrationState` | `Views/ChatWebView.swift` · `receiveNarrationState`; `Views/NativeComposerView.swift` · `sendKeywordIntent` | `use-native-bridge.ts` · `useNativeNarrationBridge` | fail-local |
| B14 | HQ dictation state | web→native | `{enabled}` via `beeboxHqDictationState` | `Views/ChatWebView.swift` · `receiveHqDictationState`; `Views/NativeComposerView.swift` · `send`, `sendKeywordIntent` | `use-native-bridge.ts` · `useNativeHqDictationBridge` | fail-local |
| B8 | Speech playback state | web→native | `{playing}` via `beeboxSpeechPlaybackState` | `Views/ChatWebView.swift` · `receiveSpeechPlaybackState`; `Views/NativeComposerView.swift` · `applyVoiceTurn` | `use-native-bridge.ts` · `useNativeSpeechPlaybackBridge` | fail-local |
| B9 | Response generation state | web→native | `{active}` via `beeboxResponseState` | `Views/ChatWebView.swift` · `receiveResponseState`; `Services/NativeEarcons.swift` · `NativeEarconState` | `use-native-bridge.ts` · `useNativeResponseBridge` | fail-local |
| B12 | Command envelope V2 | web→native | `{version:2,id,kind,payload?}`, kinds `add-selection`|`scan-controls`, via `beeboxComposerCommand` | `Models/NativeComposerContract.swift` · `NativeComposerCommand.Payload`; `Views/RootView.swift` · `handleComposerCommand` | `native-composer-command.ts` · `nativeComposerCommandFromDetail`; `native-control-scan.ts` | LOUD |
| B13 | Command result | native→web | `{version:2,id,kind,ok:true,controls[]}` or `{…,ok:false,reason}` via `beeboxNativeCommandResult`, queue + `beebox:native-command-result` event | `Models/NativeComposerContract.swift` · `NativeComposerCommandResult`; `Models/NativeControlRegistry.swift` · `controlAnchor`; `Views/ChatWebView.swift` · `deliverComposerCommandResults` | `native-composer-command.ts` · `nativeCommandResultFromDetail`; `native-control-scan.ts` · `requestNativeControls` | LOUD in the dump |
| R1 | Screen awake (device idle timer) | native-only, no wire | — (a responsibility split, §4.11): held for a voice turn, page speech playing, or capture recording; released by re-derivation incl. `scenePhase` | `Services/ScreenAwake.swift` · `ScreenAwakeHold`; `Views/NativeComposerView.swift` · `screenAwakeReasons`; `Views/NativeCaptureController.swift` · `applyScreenAwake`; `Services/SpeechDictation.swift` · `NativeVoiceTurnEvent.dictationFailed` | `components/chat/InteractiveChat-voice.ts` · `useDebouncedWakeLock` (suppressed under `nativeComposer`); `hooks/useWakeLock.ts` | SILENT both ways |
| H1 | `POST /api/chat/transcribe-audio` | native→box | multipart `session` + `file`(segment.wav, audio/wav); res `{text,diarized,service?}` | `Services/ChatAPI.swift` · `transcribeAudio` | `routes/chat-audio-routes.ts` | LOUD on rejection / SILENT on HTTP 200 with unusable text; Float32 WAV verified — **I8** |
| H6 | `POST /api/chat/last-audio/:requestId` | native→box | multipart `file`(last-message.wav, audio/wav) + `recordedAt`,`text`,`messageId`,`sessionId?`; or JSON `{"none":true}`; res `{ok}` / `404` when already settled | `Services/ChatAPI.swift` · `answerLastAudio`; `Storage/VoiceAudioRetentionStore.swift` | `routes/chat-last-audio-routes.ts`; `core/last-audio-pending.ts` · `fulfill`/`reportNone` | QUIET — a missing echo is IGNORED, not rejected |
| H2 | `GET /api/chat/default` | native→box | res `{sessionId?}` | `Services/ChatAPI.swift` · `resolvedSession` | `routes/chat.ts` · default-session route | SILENT (→ `"new"`) |
| H3 | `POST /api/chat/send` (web layer) | web→box | `{session,message,messageId,images?,channel?,…}`; res `{turnId?}\|{queued}\|{deduplicated}` | `api-chat.ts` | `routes/chat-send-routes.ts`; `routes/chat-helpers.ts` · `sendBodySchema` | LOUD / SILENT dedup |
| H4 | `POST /api/chat/upload-file` | native→box | multipart `file`; res `{path,originalName,size,mimetype}` | `Services/ChatAPI.swift` · `uploadFile` | `routes/chat-uploads.ts` · `registerChatUploadRoutes` | LOUD |
| H5 | `POST /api/trpc/debugLog.submit` | native→box | req `{source?,entries:[{level,message,at?}]}`; res `{"result":{"data":{"ok":true}}}` (tRPC envelope) | `Services/LogForwarder.swift` | `trpc/routers/debugLog.ts` · `submit`; `lib/rolling-log.ts` · `appendRollingLogStrict` | fail-local |
| S1 | `GET /api/trpc/share.destinations` | extension→box | res tRPC `{chats:[…],saves:[…]}` | `BeeBoxShareExtension/ShareExtensionAPI.swift` · `destinations` | `trpc/routers/share.ts` · `destinations` | LOUD |
| S2 | `POST /api/trpc/share.saveTextual` | extension→box | URL or text + `shareId`, `capturedAt`, destination; res `{created:[path]}` | `BeeBoxShareExtension/ShareExtensionAPI.swift` · `save` | `trpc/routers/share.ts` · `saveTextual` | LOUD |
| S3 | `POST /api/chat/send` exact mode | extension→box | `{message,messageId,session,exactSession:true,channel:"ios-native"}` | `BeeBoxShareExtension/ShareExtensionAPI.swift` · `send` | `routes/chat-send-target.ts` · `assertExactSessionTarget` | LOUD |
| M1 | Hub mobile-auth wall | box internal | full verification of bearer or `bbx_mobile` for the request's slug | — | `hub-server.ts` · `hasMobileAuth` → `core/mobile/request-auth.ts` · `verifyMobileRequest` | LOUD |
| U1 | `POST /api/bulk/sessions` | native/web→box | req `{targetSessionId,items?}` (context dir derived server-side from `targetSessionId`); res `{sessionId,startedAt,capabilities}` | — (deferred) | `routes/bulk-upload.ts` · `registerBulkUploadRoutes` | LOUD (400 no target) |
| U2 | `POST /api/bulk/sessions/:id/items` | native/web→box | req `{items:BulkItem[]}`; res `{registered}` | — (deferred) | `routes/bulk-upload.ts` | LOUD |
| U3 | `POST /api/bulk/sessions/:id/items/:itemId/upload` | native/web→box | octet-stream body, `X-Upload-Filename` + `X-Upload-Original-Name`/`-Mime-Type`; res `{success,filename,itemId,size,sha256}` | — (deferred) | `routes/bulk-upload.ts`; `core/capture/staging-stream.ts` · `addFileStreamed` | LOUD (400/409/413) |
| U4 | `GET /api/bulk/sessions/:id` | native/web→box | res `{sessionId,state,targetSessionId,registered,received}` | — (deferred) | `routes/bulk-upload.ts` | LOUD |
| U5 | `DELETE /api/bulk/sessions/:id` | native/web→box | res `{success}` | — (deferred) | `routes/bulk-upload.ts` | LOUD |
| U6 | `POST /api/bulk/sessions/:id/finalize` | native/web→box | req `{failedItems?}`; res `{sessionId,staged}` | — (deferred) | `routes/bulk-upload.ts`; `core/bulk-upload/worker.ts` · `prepareAndDeliverBulkBatch` | LOUD (503 no runtime) |

---

## 8. Mirrored constants (diff targets)

String/shape constants that exist in two places and must move together. A change to either side
without the other is a contract break.

- **localStorage key** `beebox.mobileAuthToken` — `Views/ChatWebView.swift` (startup script) ↔
  `lib/mobile-auth.ts` · `MOBILE_AUTH_TOKEN_STORAGE_KEY` (comment-linked).
- **Mobile session cookie name** `bbx_mobile` — `core/mobile/mobile-session.ts` ·
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
- **Composer command V2 + result** `{version:2,id,kind,payload?}` and
  `{version:2,id,kind,ok,controls?,reason?}`, `kind` closed to `add-selection|scan-controls`, control
  `role` closed to `button|textbox` — `Models/NativeComposerContract.swift` ·
  `NativeComposerCommand.Kind` / `NativeComposerCommandResult` / `NativeControlEntry` ↔
  `native-composer-command.ts`.
- **Control addresses** — the `bbx-`-prefixed ids from Track 4's table in
  `docs/plans/agent-points-at-ui.md` (`bbx-composer-add`, `-input`, `-send`, `-mic`, `-capture`,
  `-stop-dictation`, …). One string names one control on **both** surfaces: on the web it is the
  element's HTML `id`, natively it is the `.controlAnchor(...)` argument, which also becomes the
  view's `accessibilityIdentifier`. They are not anchored file-by-file (they live in ordinary view
  code on both sides); a rename is a contract migration and belongs in a commit that touches this
  document.
- **Last-audio request V1** `{version,requestId,messageId,sessionId}` —
  `Models/NativeComposerContract.swift` · `NativeLastAudioRequest` ↔
  `native-last-audio-request.ts`. Its answer's multipart field names
  (`file`,`recordedAt`,`text`,`messageId`,`sessionId`) are mirrored a THIRD time, by the web
  answerer — `Services/ChatAPI.swift` · `multipartLastAudioBody` ↔
  `lib/audio/last-audio.ts` · `fulfillLastAudioRequest` ↔ `routes/chat-last-audio-routes.ts`.
- **Retained-recording record** `{emissionID,recordedAt,text,sessionID?}` — device-local, so it is
  not a wire shape, but `sessionID` and `text` both leave the device on the answer and must keep
  meaning what §4.9 says: the session dictated into, and the transcript the message committed with.
- **Voice-recording retention bound** 5, and the answer's transcript cap 1500 characters —
  `Storage/VoiceAudioRetentionStore.swift` · `defaultCapacity` / `Services/ChatAPI.swift` ·
  `maximumAnswerTextCharacters` ↔ `lib/audio/last-audio.ts` · `RETENTION_CAPACITY` /
  `MAX_TEXT_CHARS` ↔ `routes/chat-last-audio-routes.ts` · `MAX_TEXT_HEADER_CHARS`.
- **`debugLog.submit` wire keys** `{source?,entries:[{level,message,at?}]}`, `level` closed to
  `error|warn|log|info`, `source` slug `^[a-z][a-z0-9-]{0,15}$` (iOS always sends `"ios"`), `at` an
  offset datetime — `Services/LogForwarder.swift` ↔
  `trpc/routers/debugLog.ts` · `submit`.
- **Speech command V1** `{version,action:"stop"}` — `Models/NativeComposerContract.swift` ·
  `NativeSpeechCommand` ↔ `native-speech-command.ts` · `nativeSpeechCommandFromDetail`.
- **Bridge globals** `beeboxNativeReceive` / `beeboxNativeQueue` /
  `beeboxNativeShareLocation` / `beeboxNativeLocationQueue` /
  `beeboxNativeComposerCommandAck` / `beeboxNativeComposerCommandAckQueue` /
  `beeboxNativeCommandResult` / `beeboxNativeCommandResultQueue` /
  `beeboxNativeSpeechCommand` / `beeboxNativeSpeechCommandQueue` and events
  `beebox:native-emission` / `beebox:native-share-location` /
  `beebox:native-composer-command-ack` / `beebox:native-command-result` /
  `beebox:native-speech-command` —
  native-authored startup script in `Views/ChatWebView.swift` ↔ `use-native-bridge.ts` /
  `use-native-composer-commands.ts` / `native-control-scan.ts`.
- **Script-message channel names** `beeboxSession` / `beeboxEmissionReceipt` /
  `beeboxLocationResult` / `beeboxLocationState` / `beeboxNarrationState` /
  `beeboxHqDictationState` /
  `beeboxSpeechPlaybackState` / `beeboxResponseState` /
  `beeboxComposerCommand` / `beeboxLastAudioRequest` —
  `Views/ChatWebView.swift` (`userContentController.add`) ↔
  `native-post.ts` · `NativeShellChannel`.
- **Neutral web→native transport** `beeboxNativePost(channel, payload)` (string payloads) —
  startup script in `Views/ChatWebView.swift` ↔ `native-post.ts` · `postNativeMessage` (with the
  legacy `webkit.messageHandlers` object-form fallback for pre-neutral shells).
- **Inline photo limit** `3` — `components/chat/file-routing.ts` · `INLINE_PHOTO_LIMIT` /
  `routeAddedFiles` ↔ the iOS composer's mirrored constant. **The most photos that may ride
  inline (base64) in one chat message.** A selection that would put the composer's *total* inline
  count above the limit is uploaded as a bulk batch (§5.6) instead, and so is any set containing a
  **non-image** (a document has no inline representation), however few files it holds. Photos **already inline join that
  batch** and are removed from the composer, so one selection act has one destination — batching only
  the new photos would send the composer text off as the batch's introduction while the older photos
  sat behind with nothing describing them. (Photos still *encoding* can't be folded, having no bytes
  yet; they finish and land inline rather than being discarded — never losing a photo outranks
  arriving in one piece.) The inline total is bounded by the limit however many separate selections a
  user makes, counting in-flight encodes. The rule applies identically to the picker, paste, drop
  and screenshot grab — on the web the composer's Add menu offers one "Add files…" entry and routing
  decides the rest, rather than asking the user to pick a path.

  This is a real behavioral contract, not a tuning knob: inlining a camera roll base64-encodes tens
  of megabytes into a single `/chat/send`, which is what
  `issues/bugs/2026-07-30-many-photos-to-chat-fails-ios.md` reports failing client-side with no
  server-side trace. There is **no documented size ceiling** for a WKWebView script message — the
  failure is memory pressure, not a published limit — so "inline just under the cliff" is not
  implementable; keeping the inline payload categorically small is the only sound posture. A
  surface that raises or ignores the limit reintroduces the bug.

  An uploader that routes a selection this way MUST send the composer text as the batch's `note`
  (§5.6) — otherwise the batch is unintroduced and the agent asks what the files are instead of
  filing them.

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
  is header-only and the `bbx_mobile` cookie carries what the browser sends on its own. All three
  copies of `mobileTokenFromUrl` are deleted. See `docs/implemented-plans/mobile-token-handshake.md`.
- **S3 — unlocked device-store RMW + non-atomic write (RESOLVED).** Every device-store mutation
  (`resolveMobileTokenIdentity`'s `lastUsedAt` stamp, `redeemMobilePairingTicket`,
  `revokeMobileDevice`) now runs through the cross-process `file-lock.ts` primitive
  (`withDeviceStoreLock`) and lands via temp-file + fsync + atomic rename — the same pattern as
  `webapp/local-users.ts`. Cross-process matters here because `bbx hub` verifies a bearer (stamping
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
- **`mobileTokenFromUrl` duplicated 3×** — a security-relevant parser copied verbatim across
  `hub-server.ts` / `server-box-scope.ts` / `server-root.ts`.
- **Benign field drifts.** Redeem `{boxSlug,label,deviceId,deviceLabel}` ignored by iOS; receipt
  `deduplicated` ignored by iOS; `User-Agent: BeeBox-iOS/0.1` never branched on server-side.
- **I8 — float WAV decoder compatibility (RESOLVED 2026-08-06).** Live calls with a 48 kHz mono
  Float32 WAV returned the expected speech from all OpenAI HQ variants and from Voxtral in both plain
  and diarized modes. See `issues/closed/bugs/2026-07-17-ios-hq-wav-float-format-needs-verify.md`.

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
`beeboxNativeReceive` / `beeboxNativeShareLocation` and the queues. Keeping it there lets
the web-side JS stay platform-agnostic: web code reads/writes the queues and dispatches the
CustomEvents, blind to how the native side is wired.

**The return path is now platform-neutral (Track 0, landed 2026-07-17).** The web side posts
through `window.beeboxNativePost(channel, payload)` (§3.3) with a transitional fallback to the
legacy `webkit.messageHandlers` object form for pre-neutral iOS builds. A new platform therefore
defines `beeboxNativePost` in its own document-start script and routes however its WebView
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

Paths are **repo-relative** (from the monorepo root, so box files carry the `beebox/` prefix,
unlike the `beebox/`-relative anchors in §7). A trailing `/` marks a **directory prefix** —
every file beneath it counts as an anchor (fixtures are part of the contract). Blank lines and
`#` comments are ignored. The Android bridge/native-shell files (`android-app/…`) join this list
when `android-app/` exists — add them alongside their iOS counterparts at that point.

```anchors
# Web-side bridge, auth, and receipt surface
beebox/src/frontend/src/components/chat/native-post.ts
beebox/src/frontend/src/components/chat/use-native-bridge.ts
beebox/src/frontend/src/components/chat/native-emission.ts
beebox/src/frontend/src/components/chat/native-composer-command.ts
beebox/src/frontend/src/components/chat/native-command-bridge.ts
beebox/src/frontend/src/components/chat/native-control-scan.ts
beebox/src/frontend/src/components/chat/native-control-point.ts
beebox/src/frontend/src/components/chat/ui-scan-request-handler.ts
beebox/src/frontend/src/components/chat/native-last-audio-request.ts
beebox/src/frontend/src/components/chat/native-speech-command.ts
beebox/src/frontend/src/components/chat/use-native-composer-commands.ts
beebox/src/frontend/src/components/chat/use-companion-selection.ts
beebox/src/frontend/src/lib/mobile-auth.ts
beebox/src/frontend/src/input/targets/receipts.ts

# Box server: pairing, mobile-token verification, native HTTP endpoints
beebox/src/core/mobile/pairing.ts
beebox/src/core/mobile/mobile-session.ts
beebox/src/core/mobile/request-auth.ts
beebox/src/webapp/mobile-cookie.ts
beebox/src/webapp/routes/pairing.ts
beebox/src/webapp/routes/chat-audio-routes.ts
beebox/src/webapp/routes/chat-last-audio-routes.ts
beebox/src/webapp/routes/chat-uploads.ts
beebox/src/webapp/routes/bulk-upload.ts
beebox/src/core/capture/staging-stream.ts
beebox/src/webapp/trpc/routers/debugLog.ts

# iOS native shell: webview bridge, pairing model, paired-box storage
ios-app/BeeBox/Views/ChatWebView.swift
ios-app/BeeBox/Models/NativeComposerContract.swift
ios-app/BeeBox/Models/NativeControlRegistry.swift
ios-app/BeeBox/Services/SpeechDictation.swift
ios-app/BeeBox/Services/ScreenAwake.swift
ios-app/BeeBox/Storage/ComposerDraftStore.swift
ios-app/BeeBox/Services/ChatAPI.swift
ios-app/BeeBox/Storage/VoiceAudioRetentionStore.swift
ios-app/BeeBox/Models/PairedBox.swift
ios-app/BeeBox/Storage/PairedBoxStore.swift
ios-app/BeeBox/Services/LogForwarder.swift

# Shared golden fixtures — any fixture change is a contract change (directory prefix)
beebox/test/mobile-contract/
```
