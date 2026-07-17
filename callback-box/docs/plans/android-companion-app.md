# Native Android companion app

**Status:** draft — build-ready, written 2026-07-17. Stack (native Kotlin +
Compose), depth, and monorepo location were chosen by the boxholder; the rest is
grounded in the same-day contract inventory (`docs/mobile-contract.md`), the iOS
follow-up review (`ios-companion-review-2026-07-17.md`), and Android platform
research, pending boxholder review. Mirrors the shipped iOS companion app against
the same box wire contract.

This plan adds a native Kotlin/Jetpack Compose Android app that pairs with one or
more self-hosted Callback Box instances and reproduces the iOS companion's stance:
a `WKWebView`-equivalent (`android.webkit.WebView`) hosts the box's existing web
chat while native code owns only the stable, weak-on-mobile parts — the input
composer, photo attachment, voice capture, pairing, and location handoff. It
implements **exactly** the contract in `docs/mobile-contract.md`; it adds no new
box-facing surface except one platform-neutral refactor (Track 0) that also
touches iOS. Business logic lives in framework-free Kotlin tested with plain
JUnit, and the whole app **builds and unit-tests headless on Linux** — a real CI
advantage over the iOS target, which needs macOS/Xcode.

## Stated preferences this plan trades against

- `docs/engineering-principles.md`: **#1 types are structure** (bridge messages,
  receipts, and phases are `sealed`/`enum` classes and `@Serializable` data
  classes, never correlated booleans), **#3 validate at boundaries** (every
  inbound bridge message and HTTP response is `kotlinx.serialization`-decoded at
  the WebView/network edge), **#4 resilient and never silent** (an unsupported
  WebView feature, a failed redeem, or a mic denial is a visible screen/banner,
  never a degraded no-op), **#5 failure paths in signatures** (redeem and upload
  return discriminated results the UI branches on), **#8 one way to do each
  thing** (the neutral `callbackboxNativePost` is the single web→native path on
  both platforms), and **#10 testability is architectural** (bridge, transport,
  camera, recorder, and keystore sit behind narrow interfaces with fakes).
- `code-style.md`: the box side of Track 0 (TypeScript) follows the usual
  validation/Result/exhaustiveness/logging rules. Kotlin follows the same intent
  with `sealed class` exhaustiveness (`when` with no `else`) and typed exceptions.
- Shipped precedent: `docs/plans/ios-companion-app.md` (umbrella), the native
  rework captured in the contract map, and the review lessons in
  `docs/plans/ios-companion-review-2026-07-17.md`. This plan ports the iOS
  *contract and stance*, not its Swift; where iOS has a known bug or a weaker
  choice, Android does the better thing and the parity matrix (Track 6) records
  the divergence.

## What already exists

- **The full box wire contract — reuse verbatim.** Pairing redeem, bearer/`?mobileToken=`
  auth, the `nativeComposer=1` chat URL, the three script-message channels, the
  `callbackboxNative*` bridge globals/queues/events, and the three native HTTP
  endpoints are all mapped in `docs/mobile-contract.md`. Android implements that
  document; it invents no new wire shapes.
- **Web→native posting is iOS-specific today — Track 0 fixes it.** The web layer
  posts receipts and location results through `window.webkit.messageHandlers.<channel>.postMessage`
  (`src/frontend/src/components/chat/use-native-bridge.ts:98-106`). WebKit's
  `messageHandlers` object does not exist in Android's WebView, so the web code
  must call a platform-neutral function each shell defines. Session reporting is
  already emitted from the *native-authored* startup script (per the contract
  map, `ChatWebView.swift:370-400`), so it needs no web-side change — only the
  two `postMessage` calls in `use-native-bridge.ts` do.
- **The native→web direction already is neutral.** The web reads
  `window.callbackboxNativeQueue` / `callbackboxNativeLocationQueue` and listens
  for `callbackbox:native-emission` / `callbackbox:native-share-location`
  (`use-native-bridge.ts:9-55`); the injecting startup script (native-authored on
  each platform) defines `window.callbackboxNativeReceive` /
  `callbackboxNativeShareLocation`. Android reproduces that script and drives it
  via `WebView.evaluateJavascript`. No web change is needed in this direction.
- **HQ transcription accepts standard WAV — reuse (verify per provider).** `POST
  /api/chat/transcribe-audio` reads one multipart file and dispatches to
  `transcribeAudioHq` (`src/webapp/routes/chat-audio-routes.ts:57-92`), whose default
  `hqService` is `whisper` (`whisper-1`) and whose diarized path is Voxtral
  (`src/core/transcription/index.ts:235-258`). The server **forwards the bytes to the
  configured provider unmodified** — it does not resample. Provider-side acceptance of
  a 16 kHz mono **16-bit PCM** WAV is *expected* (Whisper and Voxtral both document
  WAV support) and keeps uploads small, but it **must be verified against each
  configured HQ provider** (Track 4's first chunk), not assumed. The 16-bit choice
  also sidesteps the iOS float-WAV ambiguity (review finding I8).
- **The iOS app is the behavioral reference.** `ios-app/CallbackBox/` holds the
  mirror: `Views/ChatWebView.swift` (bridge + nav policy), `Views/NativeComposerView.swift`
  and `Views/ComposerActionsView.swift` (composer dock + `+` actions),
  `Views/QRScannerView.swift` (bespoke scanner), `Storage/PairedBoxStore.swift`
  (pairing + plaintext token storage), `Services/ChatAPI.swift` (three HTTP calls),
  `Services/SpeechDictation.swift` (the single-tap fan-out Android cannot mirror),
  and `Models/PairedBox.swift` (chat-URL construction). The only iOS test file is
  `CallbackBoxTests/SpeechKeywordsTests.swift` — pure-logic XCTest, no UI/Robolectric.

## Prior art (external)

Grounded in the platform-API research (`docs/mobile-contract.md`'s companion
research; findings summarized here with the load-bearing gotchas):

- **`androidx.webkit` is the compat/feature-detection layer over the system
  WebView APK.** `WebViewCompat.addDocumentStartJavaScript` (feature
  `DOCUMENT_START_SCRIPT`, ~Chrome-WebView M126+) replaces the iOS
  `WKUserScript(.atDocumentStart)`, and `WebViewCompat.addWebMessageListener`
  (feature `WEB_MESSAGE_LISTENER`) replaces the `WKScriptMessageHandler`s — both
  take `allowedOriginRules` **enforced by WebView itself**, not an `if
  (origin===…)` check inside injected JS as on iOS. Features depend on the
  installed WebView provider, not the API level, so both must be feature-detected.
  <https://developer.android.com/reference/androidx/webkit/WebViewCompat>
- **Native→JS push stays `WebView.evaluateJavascript` on the main thread** — there
  is no listener-based push API. Keep the queue+CustomEvent JS pattern so the same
  frontend code runs on both shells.
  <https://developer.android.com/reference/android/webkit/WebView#evaluateJavascript(java.lang.String,%20android.webkit.ValueCallback%3Cjava.lang.String%3E)>
- **`EncryptedSharedPreferences` / Jetpack Security is deprecated (1.1.0-alpha07,
  2025)** for main-thread I/O and OEM keyset-corruption crashes. Current guidance:
  DataStore for storage + Android Keystore for the key. This app encrypts one
  bearer token with an `AndroidKeyStore` AES-256-GCM key and stores ciphertext+IV
  in Preferences DataStore — no Tink, no deprecated wrapper.
  <https://developer.android.com/privacy-and-security/security-crypto>
- **Camera pixels arrive in sensor orientation with an EXIF `Orientation` tag** —
  the same "pixels aren't upright, EXIF says how" situation iOS defends against in
  `CameraImageEncoder`. `androidx.exifinterface` reads the tag; the full EXIF affine
  transform (rotation AND mirroring — orientations 2/4/5/7 are mirrored/transposed)
  is baked into the bitmap via a `Matrix` before re-encoding. Skipping this is the
  most likely sideways-photo bug.
  <https://developer.android.com/reference/androidx/exifinterface/media/ExifInterface>
- **Android's mic is exclusive at the capture-session level** — `SpeechRecognizer`
  opens its own mic, and a concurrent `AudioRecord` typically fails or gets
  silence. The iOS single-`installTap` fan-out (recognizer + WAV writer off one
  `AVAudioEngine` buffer, `SpeechDictation.swift`) **has no Android equivalent**,
  and on-device recognition is Pixel/Samsung-first, not a uniform platform
  guarantee. This forces the honest voice divergence (Track 4).
  <https://developer.android.com/reference/android/speech/SpeechRecognizer>
- **`PickMultipleVisualMedia` and the deep-link intent filter need no runtime
  permission and no `autoVerify`** — the photo picker is a sandboxed system UI,
  and `callbackbox://pair` is a custom (non-http) scheme, so App Links machinery
  does not apply (mirrors iOS treating `callbackbox://` as a plain custom scheme).
  <https://developer.android.com/training/data-storage/shared/photopicker>
- **`kotlinx.serialization` uses compiler codegen, not reflection** — R8-safe with
  minimal keep rules, unlike Gson/Moshi-reflection which silently drop fields in
  release builds. This is the single most common "worked in debug, broke in
  release" bug class for small Kotlin apps.
  <https://github.com/Kotlin/kotlinx.serialization>

No third-party bridge, HTTP, or scanning framework beyond `androidx.*`, ML Kit,
and `kotlinx.serialization` is required.

## Tracks / scope

Box-side TypeScript: Track 0 only. Everything else is the new `android-app/`.

### Track 0 — Platform-neutral web→native posting *(box-side + iOS prerequisite)*

**What.** Replace the iOS-specific `window.webkit.messageHandlers.<channel>.postMessage`
in the web layer with a single neutral `window.callbackboxNativePost(channel,
payloadJson)` that each native shell defines in its document-start script, and
map it to `webkit.messageHandlers` on iOS and to the `addWebMessageListener`
object on Android.

**Why this needs to change.** `use-native-bridge.ts:98-106` calls a WebKit-only
global. On Android that path is `undefined`, so receipts and location results
would silently vanish (the exact SILENT-drop failure the receipt state machine
exists to prevent). The neutral function is the only web-side change either shell
needs; it lands before any Android code and updates `docs/mobile-contract.md`.

**Direction.** Three channels flow web→native; after Track 0 all three carry a
**string** payload through the one neutral function:

| channel | payload encoding |
|---|---|
| `callbackboxEmissionReceipt` | JSON string of the `Receipt` object (§4.2 of the contract) |
| `callbackboxLocationResult` | JSON string of `{id, success, message}` |
| `callbackboxSession` | the `location.href` string (**not** JSON) |

In the web layer, `postNativeReceipt` and `postNativeLocationResult` call
`window.callbackboxNativePost("callbackboxEmissionReceipt", JSON.stringify(receipt))`
and `…("callbackboxLocationResult", JSON.stringify(result))`. **Session reporting is
authored by each platform's own startup script** (which wraps `history.pushState`/
`replaceState` + `popstate`), so it never needs the web-side neutral function — but
`callbackboxNativePost` must still *accept* `callbackboxSession`, because the Android
startup script routes its own session posts through the same neutral function for
uniformity.

- **Android transport.** `callbackboxNativePost(channel, payloadString)` calls the
  injected `callbackboxNative.postMessage(<string>)` with a single JSON-string
  envelope `{"channel": "<name>", "payload": "<string>"}`. Native's
  `addWebMessageListener` receives a `WebMessageCompat` **whose `data` is that
  string** (not a JS object), `kotlinx.serialization`-decodes the envelope, then
  decodes the per-channel `payload` string (JSON for receipt/location, the raw href
  for session).
- **iOS transport.** `callbackboxNativePost(channel, payloadString)` routes to
  `window.webkit.messageHandlers[channel].postMessage(payloadString)`. The native
  handlers **accept both the legacy object form and the new string form** during the
  transition (each channel's `receive*` first parses the string, else falls back to
  the object), so a partially-upgraded pairing never drops a message.

**Backward compatibility, both directions:**

- **New web → old iOS shell.** The temporary web fallback covers it: if
  `callbackboxNativePost` is absent, `postNativeReceipt`/`postNativeLocationResult`
  fall through to the old `webkit.messageHandlers.<channel>.postMessage(obj)` path,
  so an installed iOS build without the neutral definition keeps working. Removed in
  a later commit once the neutral iOS build is the floor.
- **New Android shell → old box (web code that predates Track 0).** Un-upgraded box
  web code calls `window.webkit.messageHandlers.<channel>.postMessage` directly and
  knows nothing of `callbackboxNativePost`. So the Android startup script **also
  installs a WebKit-compatibility façade** — only when `window.webkit` is undefined:
  `window.webkit = { messageHandlers: { callbackboxSession: {postMessage},
  callbackboxEmissionReceipt: {postMessage}, callbackboxLocationResult: {postMessage}
  } }`, each handler forwarding its message into the same `{channel, payload}`
  envelope. This makes Android work against a box that has not shipped Track 0 —
  there is **no minimum-box-version requirement**.

The three payload shapes (receipt JSON, location-result JSON, session href) are
unchanged; only the transport wrapper is neutral. Follow `code-style.md` for the
TS: exhaustive `switch` on channel where one is introduced, and a single justified
`eslint-disable` only if the existing `unicorn/require-post-message-target-origin`
suppression must move.

**Vocabulary lock-ins.** Web→native transport function `callbackboxNativePost(channel,
payloadString)` (payload always a string); the Android envelope
`{ channel: string, payload: string }` carried as one JSON string through
`callbackboxNative.postMessage`; the three channel names unchanged
(`callbackboxEmissionReceipt`, `callbackboxLocationResult`, `callbackboxSession`);
the Android WebKit-compat façade `window.webkit.messageHandlers.<channel>` installed
only when `window.webkit` is undefined.

**First implementation chunk.** Refactor the two web calls with the fallback, add
`callbackboxNativePost` to the iOS startup script, update `docs/mobile-contract.md`
§3.3/§4/§8/§10 and rows B2/B4/W2, and add a frontend unit test covering all three
conformance cases: neutral-present (the neutral call fires), neutral-absent (the
`webkit.messageHandlers` fallback triggers), and — as an Android-side JUnit test
landed later with Track 1 — the WebKit-compat façade forwarding a legacy
`webkit.messageHandlers.<channel>.postMessage` into the envelope. No Android code in
this chunk.

### Track 1 — Android scaffold, WebView bridge, navigation pinning, fail-closed feature gate

**What.** The `android-app/` project, the `WebView`-in-Compose host, the two-way
bridge, main-frame origin pinning, and a hard fail-closed screen when the WebView
provider lacks the required features.

**Why this needs to change.** Net-new; nothing exists. The bridge and origin
enforcement are a layered security boundary — `allowedOriginRules` on the bridge,
`shouldOverrideUrlLoading`, and the `onPageStarted` origin check together — and the
substrate every later track rides on.

**Direction.** One `:app` module; `gradle/libs.versions.toml` version catalog;
Kotlin 2.4.x with the bundled Compose compiler plugin; current-stable AGP; Compose
BOM; `minSdk 28`, `targetSdk 36`; `applicationId` `app.callbackbox.android` (open
question). Dependencies: `androidx.webkit`, `androidx.browser` (Custom Tabs),
`androidx.activity:activity-compose`, `androidx.datastore:datastore-preferences`,
`androidx.exifinterface`, `androidx.camera:*` + `com.google.mlkit:barcode-scanning`,
`org.jetbrains.kotlinx:kotlinx-serialization-json`.

- Host the `WebView` in `AndroidView` inside Compose. Set the Activity's
  `android:windowSoftInputMode="adjustResize"` so the window shrinks for the IME;
  do **not** enable edge-to-edge on the WebView screen unless insets are explicitly
  consumed before the `AndroidView` (double-inset jitter is a known WebView+Compose
  rough edge — verify on device).
- **WebView configuration.** `settings.javaScriptEnabled = true` and
  `settings.domStorageEnabled = true` — **both default `false`, and the app is dead
  without them** (no bridge, no `localStorage` token). Declare the `INTERNET`
  permission in the manifest. Cleartext policy, fail-closed to match the
  strict/fail-closed house bias and mirror iOS's DEBUG-only allowances: **release
  builds allow `https` only** (an `android:networkSecurityConfig` with cleartext
  disabled); **debug builds additionally permit cleartext** for local dev boxes
  (`http://10.0.2.2`, `127.0.0.1`, `localhost`) via a `debug`-variant
  network-security config.
- **Feature gate, fail closed.** At WebView creation, check
  `WebViewFeature.isFeatureSupported(DOCUMENT_START_SCRIPT)` **and**
  `…(WEB_MESSAGE_LISTENER)`. If either is unsupported, render a full-screen
  "Update Android System WebView" screen with a Play Store link and **do not load
  the box** — never a silent degraded bridge (strict/fail-closed house style).
- **Document-start injection.** `WebViewCompat.addDocumentStartJavaScript(webView,
  startupScript, setOf(allowedOrigin))` installs the same JS the iOS startup
  script installs: it seeds `localStorage['callbackbox.mobileAuthToken']` (gated by
  a secondary in-script origin check), defines `callbackboxNativeReceive` /
  `callbackboxNativeShareLocation` (queue + CustomEvent), defines
  `callbackboxNativePost(channel, payloadString)` → `callbackboxNative.postMessage`
  with a `{channel, payload}` JSON-string envelope, and — only when `window.webkit`
  is undefined — installs the WebKit-compat façade (Track 0) so an un-upgraded box's
  legacy `webkit.messageHandlers.<channel>.postMessage` calls forward into the same
  envelope.
- **Inbound bridge.** `WebViewCompat.addWebMessageListener(webView, "callbackboxNative",
  setOf(allowedOrigin), listener)`. The listener validates `isMainFrame` and
  `sourceOrigin == allowedOrigin` (belt-and-suspenders over WebView's own
  enforcement), `kotlinx.serialization`-decodes the `{channel, payload}` envelope
  (the `WebMessageCompat` `data` is the envelope **string**, not a JS object), then
  decodes the inner payload per channel (`callbackboxSession` href,
  `callbackboxEmissionReceipt`, `callbackboxLocationResult`) into typed data. The
  `allowedOriginRules` origin string is computed exactly as iOS's
  `ChatWebView.origin(from:)` (scheme+host+port).
- **Native→web.** `webView.evaluateJavascript` on the main thread for
  `callbackboxNativeReceive(json)` and `callbackboxNativeShareLocation(id)`.
- **Navigation pinning (layered).** `WebViewClientCompat.shouldOverrideUrlLoading`:
  if `request.isForMainFrame` and `originOf(request.url) != allowedOrigin` (and not
  `about:`), launch a `CustomTabsIntent` and `return true` (cancel), mirroring iOS
  `decidePolicyFor`. **But `shouldOverrideUrlLoading` is not invoked for POST
  navigations** (documented Android behavior), so it is not by itself the origin
  boundary. Add a belt-and-suspenders main-frame origin check in `onPageStarted`: if
  the started main-frame URL is off-origin, `stopLoading()`, recover to the box URL,
  and log loudly. On provisional main-frame nav, clear inflight emission/location
  state and mark the page not-loaded so delivery re-arms on the next page finish
  (mirrors the iOS re-arm). The security boundary is the three layers together:
  `allowedOriginRules` on the bridge + `shouldOverrideUrlLoading` + the
  `onPageStarted` check.
- **Renderer-death recovery.** Implement `WebViewClientCompat.onRenderProcessGone`:
  without it, a WebView renderer crash **kills the whole app process by default**. On
  renderer death, tear down and recreate the `WebView`, reload the box URL, re-arm
  the bridge (document-start script + `addWebMessageListener`), and **re-deliver
  still-pending (unreceipted) emissions** — which survive the crash because pending
  emissions live in the native layer, not in the WebView.
- Chat URL from `PairedBox`: `<baseURL>/chat?nativeComposer=1[&session=<id>]`, then
  append `&mobileToken=<token>` for the first load — **`nativeComposer=1`, never
  the legacy `embed=1`** (contract map §3.1, drift item 12). User-Agent
  `CallbackBox-Android/0.1`.
- Keep bridge/origin/URL logic in framework-free Kotlin (`OriginMatcher`,
  `ChatUrlBuilder`, `BridgeEnvelope`) so JUnit covers them with no WebView.

**Vocabulary lock-ins.** Bridge JS object name `callbackboxNative`; startup-script
globals identical to iOS; `allowedOriginRules` = the single paired-box origin;
chat param `nativeComposer=1`; User-Agent `CallbackBox-Android/0.1`;
`settings.javaScriptEnabled`/`domStorageEnabled` = true; manifest `INTERNET`; a
release cleartext-disabled / debug cleartext-for-localhost `networkSecurityConfig`.

**First implementation chunk.** Scaffold + version catalog; WebView settings
(`javaScriptEnabled`/`domStorageEnabled`), the `INTERNET` permission, and the
release/debug network-security config; the feature-gate screen; the document-start
script (with the WebKit-compat façade) and `addWebMessageListener` wired to a stub
that logs decoded envelopes; nav pinning to Custom Tabs with the `onPageStarted`
origin check; `onRenderProcessGone` recovery. JUnit for `OriginMatcher`,
`ChatUrlBuilder`, envelope decode, and the façade forwarding. Load a hardcoded box
URL and confirm the bridge round-trips a synthetic message; verify the fail-closed
screen by forcing the feature check false.

### Track 2 — Pairing: deep link, scanner, redeem, encrypted token storage

**What.** The `callbackbox://pair` intent filter, a full-screen CameraX + ML Kit
QR scanner, the `POST /api/pairing/redeem` client, and Keystore-encrypted token
storage in a `PairedBoxStore`.

**Why this needs to change.** Net-new. This is the credential spine; the WebView
and every HTTP call need a stored bearer token.

**Direction.**

- **Intent filter** (`AndroidManifest.xml`): `VIEW` + `DEFAULT` + `BROWSABLE`,
  `android:scheme="callbackbox"` `android:host="pair"`, **no `autoVerify`** (custom
  scheme, matches iOS). A single `Activity` receives the intent.
- **One dispatch path.** Parse the pairing URL in exactly one place —
  deliberately avoiding the iOS `onOpenURL` + `PairingURLInbox` duplicate that
  fires two redeems against a single-use token (contract map drift 6; review N8,
  `ios-companion-review-2026-07-17.md`). Whether the URL arrives from the intent or
  the in-app scanner, it funnels through one `PairingCoordinator.redeem(url)`; the
  scanner hands its decoded string directly (no Intent round-trip).
- **Parse.** Accept `callbackbox://pair` with `baseURL` (alias `url`), `label`,
  `pairingToken` (alias `token`), `session`; require scheme+host on `baseURL` or
  reject loudly. `authToken=` direct import is honored **only in debug builds**
  (`BuildConfig.DEBUG`), mirroring the iOS `#if DEBUG` gate.
- **Scanner.** CameraX (`camera-camera2`/`camera-lifecycle`/`camera-view`) preview
  + `ImageAnalysis` feeding `com.google.mlkit:barcode-scanning`, full-screen with a
  cancel control — parity with the bespoke `QRScannerView.swift`. Requires the
  `CAMERA` runtime permission. (Google's `play-services-code-scanner` is the
  acceptable-simplification alternative — see Open questions.)
- **Redeem client.** `POST <baseURL>/api/pairing/redeem`, headers
  `Content-Type: application/json` + `User-Agent: CallbackBox-Android/0.1`, body
  `{ pairingToken, deviceLabel: <Build.MODEL> }`, read only `token` from the 200
  response (the server also returns `boxSlug/label/deviceId/deviceLabel`, ignored —
  same benign drift as iOS). **Redeem errors surface loudly in the UI** — a typed
  `RedeemResult` (`Ok(token)` | `Invalid` | `Network`) drives a visible message,
  deliberately better than iOS's silent `false` (contract map P3; review lesson).
- **Token storage, exceeding iOS.** Generate an `AndroidKeyStore` AES-256-GCM key
  (`callbackbox_token_key`), encrypt the token, store `{ciphertext, iv}` plus box
  metadata (`baseURL`, `label`, `slug`, `session`). No `EncryptedSharedPreferences`,
  no Tink. This deliberately **exceeds** the iOS plaintext-JSON baseline (contract
  map I6); the parity matrix records it as an intentional divergence until iOS
  adopts Keychain.
- **One serialized value, not a typed record set.** Preferences DataStore has no
  list or typed-record value type, so the whole paired-box list (each entry's
  ciphertext+IV+metadata) is `kotlinx.serialization`-encoded to **one JSON string**
  stored under a single Preferences key. (Proto DataStore is the typed-schema
  alternative; the JSON-string-in-Preferences choice is the decision — it keeps one
  serialization stack.) One active box at a time (parity with iOS).
- **Exclude the store from Android Auto Backup.** Auto Backup includes app files by
  default, so add explicit backup rules (`android:dataExtractionRules` +
  `android:fullBackupContent`) **excluding the DataStore file** — the ciphertext must
  never land in a backup, since the `AndroidKeyStore` key does not survive
  device-to-device restore and cannot decrypt it anyway. The decrypt-failure →
  force-re-pair path (Failure modes) stays as defense in depth.
- **Clear the WebView copy on teardown.** The startup script also copies the token
  into WebView `localStorage` (`callbackbox.mobileAuthToken`). On unpair, box
  removal, or decrypt failure, clear WebView storage for that origin
  (`WebStorage.getInstance().deleteAllData()`, or targeted per-origin clearing) so
  the browser-side copy dies with the native copy.
- Keep parsing (`PairingUrlParser`), redeem-result mapping, and the WAV/crypto
  envelope framing in framework-free Kotlin for JUnit; the Keystore call sits
  behind a `TokenCipher` interface with a fake.

**Vocabulary lock-ins.** `callbackbox://pair` params (`baseURL`/`url`, `label`,
`pairingToken`/`token`, `session`, debug-only `authToken`); localStorage key
`callbackbox.mobileAuthToken`; Keystore alias `callbackbox_token_key`; redeem body
`{ pairingToken, deviceLabel }`; paired-box list stored as one
`kotlinx.serialization` JSON string under a single Preferences key.

**First implementation chunk.** Intent filter + `PairingUrlParser` (JUnit incl.
the debug-gated `authToken`), the redeem client against a fake transport with the
typed result branches, and the `TokenCipher`/DataStore store with a fake cipher
(incl. a JSON-string list round-trip). Then the CameraX/ML Kit scanner and a real
end-to-end pair against a dev box.

### Track 3 — Composer: text, photos, EXIF, emission/receipt state machine

**What.** The Compose composer dock mirroring iOS (text field, `+`-actions,
mic/send), photo attachment via the system picker and camera with baked-in EXIF
orientation, and native emission delivery with the receipt state machine.

**Why this needs to change.** Net-new. This is the primary native input surface
and the place the SILENT-drop contract failures concentrate.

**Direction.**

- **Dock.** A Compose dock inset above the WebView via `Modifier.imePadding()`;
  text field, a `+` action sheet (Take Photo / Choose Photos / Share Location),
  and a mic-or-send affordance — the `NativeComposerView.swift` layout.
- **Photos.** `PickMultipleVisualMedia(maxItems = 4)` (no runtime permission) for
  gallery and `ActivityResultContracts.TakePicture()` (via `FileProvider`) for
  camera — the correct-parity choices (iOS uses the system picker/camera, not a
  custom CameraX UI). Cap at 4, matching iOS.
- **EXIF, always.** After either source returns a `Uri`, read
  `ExifInterface(TAG_ORIENTATION)` and **apply the full EXIF affine transform
  (rotation AND mirroring)** via a `Matrix` — orientations 2/4/5/7 are
  mirrored/transposed, not merely rotated, so a rotation-only `postRotate` is wrong
  for them. Re-encode to JPEG (PNG only if alpha must survive), then base64 — the
  `CameraImageEncoder` invariant. The extension matches the encoded bytes. This is a
  hard invariant, not a nicety (sideways-photo bug class).
- **Downsample before decode (memory discipline).** Decode with `BitmapFactory`
  `inSampleSize` (or `ImageDecoder` target-size) **before** the full bitmap lands in
  memory, so four full-resolution bitmaps plus their base64 copies don't OOM. Never
  decode all four at native resolution.
- **Emission.** Build the exact contract shape (contract map §4.1): `{ id:<UUID>,
  text, origin:"typed"|"voice", diarized:<bool>, images:[{id:<int>, mimeType,
  dataBase64}] }`, JSON-encode with `kotlinx.serialization`, deliver via
  `evaluateJavascript("window.callbackboxNativeReceive(<json>)")`.
- **Receipt state machine** mirroring iOS `deliver`/`receiveEmissionReceipt`:
  deliver only emissions not already inflight (inflight dedup by id); gate
  delivery on `pageLoaded` (hold and re-deliver on page finish); start a **35 s**
  receipt timeout (> the web-side 30 s so the web reports first). **Android's
  `evaluateJavascript` callback has no error parameter** — only the JS result string
  — so wrap the injected call so the script itself returns a sentinel: evaluate
  `(function(){ try { window.callbackboxNativeReceive(<json>); return "ok"; } catch (e) { return "err:" + String(e); } })()`
  and parse the result string — a non-`"ok"` result (e.g. `"err:…"`) produces the
  synthetic `rejected` receipt immediately, while an absent/`null` result (the page
  went away mid-eval) falls back to the 35 s timeout rather than a synthetic
  rejection. On any receipt
  (`sent`/`queued`/`rejected`, decoded from the `callbackboxEmissionReceipt`
  channel), remove the emission from pending; on `rejected`, **restore** the text
  and images to the composer for retry. `deduplicated` on `sent` is ignored
  (benign, matches iOS).
- Keep the emission builder, the receipt reducer, and the EXIF-orientation
  math (fed decoded pixel arrays) in framework-free Kotlin; camera/picker/WebView
  sit behind interfaces with fakes.

**Vocabulary lock-ins.** Emission JSON keys `{id,text,origin,diarized,images{id,mimeType,dataBase64}}`;
receipt dispositions `sent|queued|rejected`; 35 s native receipt timeout; 4-photo
cap; JPEG/PNG bytes with matching extension.

**First implementation chunk.** Emission builder + receipt reducer with JUnit
tables (inflight dedup, page-not-loaded hold/re-deliver, timeout→unconfirmed,
rejected→restore, eval-sentinel `err:`→synthetic-rejected and `null`→timeout) and an
EXIF-orientation unit test over fixture bitmaps for all eight orientation tags
(verifying rotation AND mirroring), plus a downsample test. Then wire the real
picker/camera/WebView and a device round-trip through the web pending bubble.

### Track 4 — Voice: record-and-upload (the honest divergence)

**What.** A record-only voice path: `AudioRecord` → hand-written 16-bit PCM mono
WAV → `POST /api/chat/transcribe-audio` → transcribed text lands in the composer
for review/edit → the user sends. **No live on-device partials and no voice
keyword commands.**

**Why this needs to change.** Net-new, and it is where Android honestly cannot
match iOS. `SpeechRecognizer` holds the mic exclusively, so the iOS single-tap
fan-out (recognizer + WAV writer off one `AVAudioEngine` tap, `SpeechDictation.swift`)
has no Android equivalent, and on-device recognition is not a uniform platform
guarantee. This is a bounded UX regression, called out as such.

**Direction.**

- Flow: tap mic → `RECORD_AUDIO` permission → record with a visible indicator →
  stop → "Transcribing…" → upload → text lands in the composer for edit → user
  sends (an ordinary `origin:"voice"` emission through Track 3). Recording is a
  distinct state; the composer is not sent automatically.
- **Format.** `AudioRecord`, `ENCODING_PCM_16BIT`, mono, target **16 kHz** — but
  **probe `AudioRecord.getMinBufferSize` at runtime** and, if 16 kHz is unsupported
  on the device, **fall back to a supported rate** (44.1 kHz is universally
  supported), writing the **actual** sample rate into the WAV header. Never assume
  the requested rate was honored. Stream into a file with a hand-written 44-byte
  RIFF/WAV header. The server forwards the bytes to the provider unmodified, so 16
  kHz (when available) keeps uploads small while staying widely accepted; **16-bit
  PCM** (not float) also sidesteps the iOS float-WAV question (review I8).
- **Upload.** `POST <baseURL>/api/chat/transcribe-audio`, multipart with a `session`
  text field and a `file` field (`audio/wav`); when `box.sessionID` is empty, first
  `GET /api/chat/default` to resolve it (contract map §5.2–5.3). Surface non-2xx
  loudly in composer status (better than the iOS `GET /api/chat/default` silent
  fork-on-5xx, review N7). The response `{text, diarized}` fills the composer.
- **SpeechRecognizer live partials are a tracked later option, not v1** (Open
  questions). Do not attempt the simultaneous-tap architecture.
- Keep the WAV header writer and the multipart body builder in framework-free
  Kotlin (JUnit over the RIFF bytes and the boundary framing); `AudioRecord` sits
  behind a `Recorder` interface with a fake emitting canned PCM.

**Vocabulary lock-ins.** 16 kHz (or a device-supported fallback rate, e.g. 44.1 kHz)
mono 16-bit PCM WAV, the WAV header carrying the **actual** rate; multipart fields
`session` + `file` (`segment.wav`, `audio/wav`); endpoint `/api/chat/transcribe-audio`.

**First implementation chunk.** The WAV writer + multipart builder with JUnit
(RIFF header bytes, sample-count/byte-length fields, the actual-vs-requested sample
rate written into the header, multipart boundary), and the transcribe client against
a fake transport (2xx→composer, non-2xx→visible error). Then wire real `AudioRecord`
(with the `getMinBufferSize` rate probe + 44.1 kHz fallback), the permission flow, a
device transcription, and **one integration probe per configured HQ provider**
confirming it accepts the uploaded WAV.

### Track 5 — Location share + geolocation permission handoff

**What.** The `callbackboxNativeShareLocation` / `callbackboxLocationResult` bridge
plus the Android-specific wrinkle: the **web layer** does the geolocation capture,
so the WebView must be granted geolocation and the app must hold
`ACCESS_FINE_LOCATION`.

**Why this needs to change.** On iOS `WKWebView` prompts for location itself; on
Android the WebView delegates to `WebChromeClient.onGeolocationPermissionsShowPrompt`,
and that callback can only grant what the *app* already holds — so a second,
app-level runtime-permission handoff is required that iOS does not need.

**Direction.**

- **Acquire the app permission first, then issue the request.** Acquire the
  app-level `ACCESS_FINE_LOCATION` runtime permission **before** issuing the bridge
  request. Only once the app permission is resolved does native build a `requestId`
  UUID, call `evaluateJavascript("window.callbackboxNativeShareLocation('<id>')")`,
  and **start the 15 s native timeout** (matching iOS). Ordering it this way means
  the timer can never expire while the user is staring at the app permission dialog;
  the subsequent `WebChromeClient` grant callback then answers instantly. The web
  captures via `captureAndStore` and posts `{id, success, message}` back on the
  `callbackboxLocationResult` channel (via the Track-0 neutral function).
- **Permission handoff.** Set a `WebChromeClient` overriding
  `onGeolocationPermissionsShowPrompt(origin, callback)`: because the app already
  holds `ACCESS_FINE_LOCATION` by this point, `callback(origin, true, false)` answers
  immediately (if for some reason it does not, request it and grant/deny on the
  result). Declare `ACCESS_FINE_LOCATION` in the manifest. A denial surfaces as a
  visible location-failed result, never a silent hang.
- **Secure-origin requirement.** Chromium-based WebView **auto-denies geolocation on
  insecure origins without ever invoking `onGeolocationPermissionsShowPrompt`**.
  `localhost`/`127.0.0.1` count as secure contexts, so dev boxes work over plain
  http; a plain-`http` *remote* box gets an automatic **silent denial** from the
  WebView. Native treats that as a normal location-failed result (immediate failure
  or the 15 s timeout), and **`https` is the real-world requirement for location on
  Android**.
- Keep the request/result correlation (id matching, timeout) in framework-free
  Kotlin with a fake WebView; the `WebChromeClient` wiring is thin.

**Vocabulary lock-ins.** Location result `{id, success, message}`; 15 s native
timeout; manifest permission `ACCESS_FINE_LOCATION`.

**First implementation chunk.** The request/result reducer with JUnit (id match,
timeout→failed, denial→failed, permission-resolved-before-request-and-timer) and the
`onGeolocationPermissionsShowPrompt` handoff; then a device share through the web
pending pipeline over both an https box (grant/deny) and a plain-http remote box
(auto-deny → failed result).

### Track 6 — Cross-platform golden fixtures, parity matrix, end-to-end verification

**What.** Consume the shared golden fixtures the parallel `docs/plans/mobile-parity-sync.md`
process defines, wire them into the Gradle test build, maintain the
iOS↔Android↔box parity matrix, and run the device acceptance pass.

**Why this needs to change.** Two clients against one contract drift silently
unless the wire shapes are pinned by fixtures both platforms decode. The parity
matrix is where deliberate divergences (Keystore vs plaintext; record-only voice;
one dispatch path; loud redeem errors) are tracked rather than lost.

**Direction.**

- Golden fixtures (emission JSON, receipt JSON, location result JSON, redeem
  request/response, pairing-URL cases) live under `callback-box/test/mobile-contract/fixtures/`
  per `docs/plans/mobile-parity-sync.md`. Add a Gradle test-resources `srcDir`
  pointing at that path so Android JUnit decodes the same bytes iOS XCTest and the
  box doctests decode. Any wire-shape change fails all three.
- The parity matrix (`docs/mobile-parity.md`, owned by the sync plan) lists each
  contract touchpoint with iOS/Android columns and marks the four deliberate
  Android divergences.
- Device acceptance: pair via QR and via a `callbackbox://pair` intent; send text;
  attach 4 photos (verify upright orientation from a sideways-held shot); record
  and transcribe a voice note; share location (grant and deny); navigate off-origin
  via each of a **GET link, a server redirect, a JS-initiated `location` assignment,
  and a form POST** — each handed to a Custom Tab or caught by the `onPageStarted`
  check (POST navigations do not fire `shouldOverrideUrlLoading`); background/
  foreground mid-receipt; force a WebView renderer kill (`chrome://crash`/debug API)
  and confirm recovery; force the WebView feature gate false; and repeat once against
  an older server to confirm graceful behavior. Verify the web pending bubble and
  delivered transcript throughout.

**Vocabulary lock-ins.** Fixture directory `test/mobile-contract/fixtures/`; the
parity matrix at `docs/mobile-parity.md`.

**First implementation chunk.** Wire the Gradle test-resources srcDir and add
Android decode tests over the existing emission/receipt/location/redeem fixtures;
seed the parity matrix with the four divergences. Device pass is the closeout.

## Subplans

No subplan is required. The box side is one bounded refactor (Track 0). The
Android app is one cohesive client fully directed above; the cross-platform
fixture *process* is owned by `docs/plans/mobile-parity-sync.md`, which this plan
consumes rather than defines.

## Failure modes (the load-bearing section)

Device-only behavior (camera, mic exclusivity, WebView-provider variance,
Keystore-after-restore) still needs the real-device acceptance pass; JUnit cannot
prove hardware or provider behavior.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| WebView lacks `WEB_MESSAGE_LISTENER`/`DOCUMENT_START_SCRIPT` | Planned feature-gate unit test (forced-false) | Full-screen "update WebView" screen; box never loads | Clear: fail-closed, never a degraded bridge |
| WebView provider too old at runtime on a real device | Device acceptance pass | Same feature gate catches it before load | Clear update-WebView screen |
| R8 strips `@Serializable` models in release | Planned release-variant decode test | `kotlinx.serialization` codegen + minimal keep rules; no reflection JSON | Clear at build/test, not a silent field drop |
| Web posts a receipt but the neutral fn is absent (old iOS shell) | Planned Track-0 fallback test | Temporary web `webkit.messageHandlers` fallback until neutral iOS build is floor | Clear: receipt still delivered on iOS |
| New Android shell loads an old box (pre-Track-0 web code) | Planned Android façade-forwarding test | Android startup script installs a `window.webkit.messageHandlers` façade (only if `window.webkit` undefined) forwarding into the envelope | Clear: no minimum-box-version requirement |
| WebView renderer process dies | Planned device pass (forced kill via `chrome://crash`/debug API) | `onRenderProcessGone` recreates the WebView, reloads, re-arms the bridge, re-delivers pending emissions from native state | Clear: app survives, no lost emissions |
| Camera or mic permission denied | Planned permission-flow unit test + device pass | Other composer actions stay usable; visible banner + Settings hint | Clear banner |
| EXIF orientation skipped → sideways/mirrored photo | Planned 8-orientation bitmap unit test | Bake the full affine transform (rotation AND mirroring) into pixels before encode; extension matches bytes | Clear/correct pixels |
| Four full-res bitmaps + base64 copies OOM | Planned downsample unit test + device pass | `inSampleSize`/`ImageDecoder` target-size downsample before decode | Clear: bounded memory, no crash |
| Receipt times out while page is navigating | Planned reducer table (page-not-loaded, timeout) | Hold until page finish; 35 s timeout → visible "not confirmed"; restore on rejected | Clear unconfirmed state |
| `evaluateJavascript` delivery fails (JS throws) | Planned sentinel-parse reducer test | Injected script returns an `"err:…"` sentinel → synthetic `rejected`; `null` result (page gone) → 35 s timeout fallback | Clear rejected/timeout, never a silent drop |
| Token decrypt fails after Android backup-restore | Planned decrypt-failure unit test | Keystore key does not survive restore though ciphertext does → detect decrypt failure, wipe, force re-pair | Clear, loud re-pair prompt |
| DataStore ciphertext captured by Android Auto Backup | Backup-rules review + device pass | `dataExtractionRules`/`fullBackupContent` exclude the DataStore file; decrypt-failure→re-pair as defense in depth | Clear: nothing decryptable leaves the device |
| Stale token left in WebView localStorage after unpair | Planned teardown unit test | Clear WebView storage for the origin (`WebStorage.deleteAllData`) on unpair/removal/decrypt-failure | Clear: browser copy dies with the native copy |
| Redeem races a lazy box idle-stop (server gap) | Planned redeem-result unit test | Typed `Network`/`Invalid` result → visible retry, not a silent false | Clear (known server gap, not silently swallowed) |
| WebView geolocation permission denied | Planned location reducer test | App permission acquired *before* the bridge request (15 s timer starts after); `WebChromeClient` grant answers instantly; denial → visible failed result | Clear failed result |
| Geolocation on a plain-http remote box (insecure origin) | Device acceptance pass (https vs http box) | WebView auto-denies without prompting → normal location-failed result; https is the real-world requirement | Clear failed result |
| IME/`adjustResize` double-inset jumping | Device acceptance pass | `adjustResize` + `imePadding`; no edge-to-edge unless insets pre-consumed | Clear on device; verified, not assumed |
| Duplicate deep-link → double redeem (the iOS bug) | Planned single-dispatch unit test | One `PairingCoordinator.redeem` path for intent + scanner | Clear: single-use token consumed once |
| Redeem error (bad/expired/used ticket) | Planned typed-result test | Loud UI message (better than iOS silent `false`) | Clear |
| Non-2xx from `/api/chat/default` before transcribe | Planned transcribe-client test | Surface error; do not silently fork a session (better than iOS N7) | Clear |
| Transcribe upload fails / times out | Planned transcribe-client test | Visible composer error; audio retained for retry | Clear composer status |
| External link navigation off-origin (GET/redirect/JS/POST) | Planned `OriginMatcher` unit test + device nav-type pass | `shouldOverrideUrlLoading` → Custom Tab; POST navigations (which skip `shouldOverrideUrlLoading`) caught by the `onPageStarted` off-origin check → stopLoading + recover | Clear hand-off |
| Wire shape drifts between clients | Planned shared-fixture decode tests (all 3 sides) | Golden fixtures fail iOS + Android + box together | Clear cross-platform break |
| Bridge message from an unexpected origin | Planned `OriginMatcher` unit test | `allowedOriginRules` (WebView-enforced) + in-listener recheck | Clear: dropped, stronger than iOS |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED by construction.** Android builds only the
  emission/receipt/location/redeem shapes in `docs/mobile-contract.md`; it authors
  no card or box document.
- **Two clients touching one session — ADDRESSED.** The server owns concurrency
  (`chat-send-routes.ts` per-session enqueue, per the contract map); Android is
  just another emission source and dedups its own retries by emission id.
- **Fabricated free-form value — ADDRESSED.** Content is user text, user photos,
  and server-transcribed audio; there is no Android-authored summary.
- **Validation-error UX — ADDRESSED.** Typed redeem/upload/receipt results map to
  visible banners; unexpected inbound shapes fail decode loudly and preserve the
  composer (Tracks 2–4, Failure modes).
- **Partial migration / transition state — ADDRESSED.** Track 0's web fallback
  keeps older iOS builds working during rollout; the neutral function and the
  fallback removal are separate commits.
- **Cross-box confusion — ADDRESSED.** Storage is keyed by paired-box; one active
  box; the WebView is pinned to that box's origin (Tracks 1–2).

## NOT in scope (v1)

- **Native capture mode.** iOS capture mode is itself only planned
  (`docs/plans/ios-native-capture-mode.md`); Android follows once it ships.
- **Push notifications.** No FCM/APNs server channel exists; out of scope until a
  box-side push channel lands.
- **Share-sheet intake, TTS/spoken alerts, listening mode.** Separate companion
  tracks; not blocking a v1 shell.
- **Tablet/foldable polish and Play Store distribution polish.** v1 is
  sideload/internal-testing; adaptive layouts and store assets are later.
- **Live on-device partial transcription and voice keyword commands.** Tracked
  Track-4 follow-ups, deliberately not v1 (mic exclusivity).

## Open design questions

- **Should the server holes gate broad Android rollout?** S1 (hub presence-only
  wall bypass), S2 (durable token in `?mobileToken=`), S3 (unlocked device-store
  RMW), and the identity-unification gap (mobile requests are `authed` but
  `user=null`/`isOwner:false`, so sends attribute to nobody) are all OPEN
  (contract map §8; review `ios-companion-review-2026-07-17.md`). A second client
  doubles exposure of the same holes. **Lean: yes — fix them server-side before
  broad Android rollout;** internal-testing sideload can proceed in parallel since
  it does not widen exposure.
- **Google code scanner vs CameraX + ML Kit.** CameraX + ML Kit gives a custom
  full-screen scanner matching `QRScannerView.swift`; `play-services-code-scanner`
  is less code with a stock UI and no camera permission. **Lean: CameraX + ML Kit**
  for parity, but the code scanner is an acceptable simplification.
- **`applicationId` / package name.** Proposed `app.callbackbox.android` (parallel
  to the iOS `app.callbackbox.ios` pairing identifier). Confirm before first build.
- **Where Android build verification runs.** Pre-commit hooks cannot run Gradle.
  **Lean: agent-run `./gradlew test` at commit checkpoints, plus eventual CI** — a
  headless Linux runner (JDK 17 + Android SDK cmdline-tools) is a real advantage
  over iOS CI and should be stood up once the `:app` module compiles.

## Knowledge audits

No new box-agent concept is introduced. Track 0 is developer/client infrastructure
(a transport-wrapper rename), and the Android app is a client that speaks the
existing contract; neither adds a card/tag/schema convention a box agent must
recall. No knowledge-audit entry is needed. `docs/mobile-contract.md` gains the
neutral-post transport and the parity matrix; that is client-contract
documentation, not agent-facing knowledge.

## Implementation order

1. **Track 0** — neutral `callbackboxNativePost` (web + iOS startup script) with
   the temporary fallback; update `docs/mobile-contract.md`; frontend test. Ships
   independently and unblocks Android's inbound bridge.
2. **Track 1** — Android scaffold, feature-gate screen, document-start script,
   `addWebMessageListener`, nav pinning; bridge round-trip verified.
3. **Track 2** — pairing intent + parser + redeem + Keystore/DataStore store; then
   the CameraX/ML Kit scanner; real pair against a dev box.
4. **Track 3** — emission builder + receipt reducer + EXIF math (JUnit); then real
   picker/camera/WebView; device round-trip through the web pending bubble.
5. **Track 4** — WAV writer + multipart + transcribe client (JUnit); then real
   `AudioRecord` + permission; device transcription.
6. **Track 5** — location reducer + `onGeolocationPermissionsShowPrompt` handoff;
   device share (grant and deny).
7. **Track 6** — wire shared fixtures into Gradle, seed the parity matrix, then the
   real-device acceptance pass and closeout.

These are commit boundaries, not shipping milestones. The app ships (to internal
testing) only when Tracks 0–6 are complete and the server-hole question is
resolved per Open questions.

## Rollout and verification

- **Box-side automated (Track 0):** a frontend unit test that the neutral
  `callbackboxNativePost` fires for receipts and location results and that the
  `webkit.messageHandlers` fallback triggers only when the neutral global is
  absent; then full callback-box typecheck/lint/test. The fallback removal is a
  later, separate commit once the neutral iOS build is the installed floor.
- **Android automated:** `./gradlew test` (plain JUnit, headless on Linux) for
  `OriginMatcher`, `ChatUrlBuilder`, bridge-envelope decode, the pairing-URL
  parser (incl. debug-gated `authToken`), the redeem-result branches, the emission
  builder, the receipt reducer, the 8-orientation EXIF math, the WAV/multipart
  builders, the transcribe client, the location reducer, the token
  decrypt-failure path, and the release-variant `@Serializable` decode (R8). Then
  the shared-fixture decode tests (Track 6).
- **Device acceptance:** the Track-6 pass on a real device (QR + intent pairing;
  text send; 4-photo upright-orientation attach; voice record→transcribe;
  location grant/deny; external-link Custom Tab; background mid-receipt; forced
  feature-gate; old-server graceful behavior), verifying the web pending bubble
  and delivered transcript throughout.
- **Rollout compatibility:** deploy Track 0 (with the fallback) before any Android
  build reaches a device, so no installed iOS build loses receipts. Encrypted
  token storage is greenfield (no migration). The four deliberate divergences from
  iOS (Keystore vs plaintext, record-only voice, single dispatch path, loud redeem
  errors) are tracked in the `docs/mobile-parity.md` parity matrix until iOS
  closes the corresponding gaps.
