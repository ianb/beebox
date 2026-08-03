# Mobile parity matrix

Feature-level parity between the native companion apps and the box contract.
Maintained under the process in `docs/implemented-plans/mobile-parity-sync.md`; wire-level
detail lives in `docs/mobile-contract.md`. Cell values: **done**,
**planned** (link the issue or plan), **divergent** (deliberate, with reason),
**n/a** (platform limitation or not applicable).

Android columns reflect `docs/plans/android-companion-app.md` — a plan, not
shipped code. Every Android "planned" cell below points at that plan until the
app exists.

| Capability | iOS | Android |
|---|---|---|
| Pairing: QR scan (custom full-screen scanner) | done | planned (Track 2) |
| Pairing: `callbackbox://pair` deep link | done | planned (Track 2) |
| Pairing: debug-only raw `authToken` import | done | planned (Track 2) |
| Pairing: single dispatch path (no double redeem) | **divergent** — duplicate `onOpenURL`/`PairingURLInbox` paths race the single-use token (`issues/bugs/2026-07-17-ios-pairing-flow-robustness.md`) | planned (Track 2, single `PairingCoordinator`) |
| Pairing: loud redeem-failure UI | **divergent** — failures collapse to a silent `false` (same issue as above) | planned (Track 2, typed `RedeemResult` → visible message) |
| Token storage encrypted at rest | **divergent** — plaintext JSON, not Keychain (`issues/bugs/2026-07-17-ios-token-plaintext-not-keychain.md`) | planned (Track 2, Keystore AES-GCM + DataStore) |
| Chat webview shell (`nativeComposer=1`, composer suppressed) | done | planned (Track 1) |
| Webview origin pinning (main-frame navigation policy) | done | planned (Track 1) |
| Bridge origin enforcement | done (in-script origin check) | planned (Track 1, `allowedOriginRules` — platform-enforced, stronger) |
| Native emission bridge with delivery receipts (35 s timeout, restore-on-rejected) | done | planned (Track 3) |
| Text composer | done | planned (Track 3) |
| Photo attachments (picker + camera, unlimited selection, EXIF baked upright) | done — **at most 4 ride inline**; a larger selection routes to a bulk batch (`docs/mobile-contract.md` §8, `INLINE_PHOTO_LIMIT`) | planned (Track 3 — must implement the same threshold; inlining an unbounded selection is a known crash, `issues/bugs/2026-07-30-many-photos-to-chat-fails-ios.md`) |
| Bulk file-upload batch (many-file drop → `<upload>` message → chat-agent filing) | done — dedicated native uploader (`Services/BulkUploadAPI.swift`, `Services/BulkUploadCoordinator.swift`), bounded at 3 concurrent, file-backed bodies, delivery confirmed before local state is released. **NOT durable across a relaunch**: uploads use `URLSession.shared`, not a background session, and no local batch record is persisted, so a force-quit mid-batch strands an open batch server-side (`BulkUploadCoordinator.resume` exists and is tested for in-session use, but nothing calls it after a cold start). Photos only so far (the composer's `.fileImporter` still uses the single-file attach path) | not planned until an Android uploader ships — the server contract (`docs/mobile-contract.md` §5.6) is uploader-agnostic and now has two reference implementations (web overlay, iOS) |
| Voice: live on-device partial transcription | done (SpeechAnalyzer / SFSpeechRecognizer) | **divergent** — record-only; Android `SpeechRecognizer` holds the mic exclusively, so no live partials alongside the recording (plan Track 4) |
| Voice: spoken keyword commands (e.g. "send") | done | **divergent** — requires live partials; same reason as above |
| Voice: HQ server transcription upload | done (float WAV — format question tracked in `issues/bugs/2026-07-17-ios-hq-wav-float-format-needs-verify.md`) | planned (Track 4, 16 kHz mono 16-bit PCM WAV) |
| Location share via bridge | done | planned (Track 5, + geolocation permission handoff) |
| External links → system browser | done (Safari hand-off) | planned (Track 1, Custom Tabs) |
| Shared golden-fixture contract tests | done (`docs/implemented-plans/mobile-parity-sync.md` step 3 — TS doctest + iOS `MobileContractFixtureDecodeTests`/`SpeechKeywordsTests`) | planned (Track 6) |
| Headless CI build + unit tests | n/a — needs macOS/Xcode | planned (Track 6 / open question; Linux-friendly) |
| Per-box local device lock | done (`docs/implemented-plans/ios-per-box-device-lock.md`; physical-device acceptance remains) | planned (`issues/features/2026-07-20-android-per-box-device-lock-parity.md`) |
| Capture mode | done (`docs/plans/ios-native-capture-mode.md`; recorder silent-stop tracked in `issues/bugs/`) | not planned |
| Push notifications | not planned (no APNs channel server-side) | not planned (no FCM channel server-side) |
| Share-sheet intake | not planned yet (umbrella plan Track E) | not planned |

Divergences marked **divergent** are deliberate and stay listed until the
lagging platform closes the gap (each cites its issue or the plan section that
owns it). When the Android app lands, flip cells to done/divergent as built and
prune rows that turn out not to exist.
