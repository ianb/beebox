---
title: "iOS log forwarding to the box debug log"
status: implemented
workstream: unknown
issues: []
---
# iOS log forwarding to the box debug log

**Update 2026-08-06:** the boxholder chose regular box-hosted diagnostics over
the issue's proposed on-device export/share bundle. The forwarder now also sends
selected `info` state transitions, evicts routine info before error/warn under
queue pressure, and the existing browser forwarder receives structured media
element failure metadata. Design:
`docs/implemented-plans/ios-diagnostic-forwarding-completion.md`.

Give the iOS app a native logging layer (`os.Logger`) whose errors and warnings
are forwarded to the paired box's existing client debug log
(`.callback-box/client-debug.log`), so native failures — capture uploads first —
become diagnosable server-side after the fact. Today the app is silent: a capture
upload can die on-device and leave zero trace anywhere a human or agent can read.

Reviewed by Codex 2026-08-03 (cross-model); findings 1–5, 8–9 and the citation
corrections are folded in below. Finding 6 (typed event constructors) is
partially adopted and finding 7 (cut to capture-only v1) declined — rationale
in NOT in scope.

**Job story.** When a capture (photos + voice) recorded on the phone fails to
upload, the boxholder wants the box itself to hold a trace of why — the error,
the file counts and sizes, the network condition — so the failure can be
diagnosed later without the phone attached to Xcode. Second situation: the
boxholder reports "the app did something weird yesterday"; an agent reads
`client-debug.log` (as `callback-box/CLAUDE.md` already instructs for web
issues) and sees the native-side story too, tagged so iOS and web entries are
distinguishable.

**Driver incident.** A prod capture upload failed with no `POST
/api/capture/sessions/:id/upload` reaching nginx, no staging session on disk,
and nothing in `client-debug.log`. The failure was entirely iOS-side and is
undiagnosable. Related filed issue:
`issues/bugs/2026-07-27-ios-native-runtime-errors-not-observable.md`.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — **resilient-not-silent** (the plan's whole
  point: every current `try?`/`catch { showError }` swallow becomes visible),
  **validate-at-boundaries** (server input schema gets real validation, not
  just caps), **reuse over rebuild** (the existing `debugLog.submit` sink, not
  a new pipeline).
- `callback-box/code-style.md` — logging-levels policy ("`console.error` — a
  human needs to investigate… carries enough context to debug from the line
  alone"); "Never silently ignore errors — at minimum log them"; no default
  parameters / max-2-positional conventions apply to the TS side.
- `callback-box/CLAUDE.md` — "Check client debug logs when debugging frontend
  issues" (this plan extends that one debugging surface to native);
  "don't add features beyond what the task requires" (bounds the queue/retry
  machinery); the mobile-contract sync rule (`docs/mobile-contract.md` header).
- Precedent: the web forwarder `src/frontend/src/components/DebugLog.tsx`
  (always-forward error/warn, debounce, fail-safe `.catch(() => {})`, noise
  filter) is the densest statement of how forwarding should behave.
- Privacy constraint from
  `issues/bugs/2026-07-27-ios-native-runtime-errors-not-observable.md`: *"This
  should not become unrestricted console capture: transcripts, message text,
  device tokens, and box content are sensitive."*

## What already exists

Server sink (REUSE, small extension):

- `src/webapp/trpc/routers/debugLog.ts` · `submit` — tRPC mutation taking
  `{ entries: [{ level, message }] }`, appends `ts [level] message\n` lines via
  `appendRollingLog` to `<boxRoot>/.callback-box/client-debug.log` (~100KB
  rolling truncate; concurrency-safe via its in-process promise chain — it
  rewrites the file when truncating, so it is not strictly append-only) and a
  200-entry in-memory ring (`debugLog.get`). **Caveat (Codex finding 2):**
  `src/lib/rolling-log.ts` catches every filesystem error and resolves
  successfully, so today a 2xx does not prove the line was durably written.
  Acceptable for best-effort web forwarding; NOT acceptable when the client
  deletes its only copy on ack — chunk 1 adds a strict-append variant for this
  route.
- Wire: no transformer is configured on the tRPC stack
  (`src/webapp/trpc/trpc.ts` · `initTRPC.context<TrpcContext>().create()`), so
  per the tRPC v11 HTTP-RPC spec a non-batched mutation is
  `POST <baseURL>/api/trpc/debugLog.submit` with the input object as raw JSON
  body. Routing verified against the dev router (unauthenticated probe reached
  the box-auth gate); body decode is pinned by the chunk-1 doctest, which
  POSTs the exact Swift-shaped request.
- Auth: `src/webapp/server-box-scope.ts` · `addBoxAuthHook` accepts
  `Authorization: Bearer <device token>` (via `resolveMobileRequestAuth`) for
  every `/api/` URL including `/api/trpc/*` (mobile-contract §6). The phone's
  existing pairing token authorizes the call. **No new auth surface.**
- `docs/client-debug-log.md` — the doc to extend.

iOS infrastructure (REUSE as patterns):

- Subsystem convention: `Services/AudioSessionRouting.swift` ·
  `Logger(subsystem: "app.callbackbox.ios", category: "audio")` — the only
  logger in the app today. New categories join this subsystem.
- Auth request shaping, duplicated three times with minor drift (a fourth site
  motivates consolidation): `ChatAPI.applyAuth` (Bearer only),
  `CaptureAPI.authenticatedRequest` and `BulkUploadAPI.authenticatedRequest`
  (Bearer + User-Agent). The plan extracts one shared helper — a deliberate
  consolidation refactor, not free reuse — and makes the log forwarder its
  fourth caller.
- Persistence shape: `Storage/ComposerDraftRepository.swift` (atomic JSON
  writes into Application Support, per-box files). NOTE: the companion
  `ComposerDraftStore.scheduleSave()` 250ms-debounced-save shape is
  deliberately NOT copied for persistence (Codex finding 4) — see Direction.
- Process-wide singleton fed from box changes: `CaptureUploadRuntime.shared`
  updated from `CallbackBoxApp` · `.onReceive(store.$boxes)`.
- Injectable transport + sleep for tests: `CaptureTransport` protocol
  (`CaptureAPI.swift`) and the `Sleep` typealias injection in
  `BulkUploadCoordinator` used by `BulkUploadTests`.

Not rebuilt: no new server endpoint, no separate iOS log store, no OSLogStore
harvesting (see Prior art).

## Prior art (external)

- **`OSLogStore` cannot recover pre-launch logs.** Reported by Use Your Loaf
  and consistent with Apple forum reports: the store API
  (`.currentProcessIdentifier` scope) returns only current-process entries
  since launch, so a run that crashed or was killed offline is unrecoverable
  from it. This makes "log normally, harvest at flush time" unable to cover
  the motivating failure; a forwarder with its own persisted queue covers it.
  https://useyourloaf.com/blog/fetching-oslog-messages-in-swift/ ,
  https://developer.apple.com/forums/thread/701441
- **iOS background execution is bounded.** An app moving to background gets
  only brief execution time unless explicitly extended
  (`beginBackgroundTask`), and a background-`URLSession` wake
  (`handleEventsForBackgroundURLSession`) is a bounded wake-up that ends when
  the completion handler is released — not general network runtime. This
  shapes the flush design: persistence at the failure boundary is the
  guarantee; network flush happens on launch/foreground.
  https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time ,
  https://developer.apple.com/documentation/foundation/downloading-files-in-the-background
- **Forward-to-server logging** (collect → bounded local persistence → POST)
  is what commercial SDKs (Sentry, Datadog) implement with far more machinery;
  no lightweight named pattern beyond that. We deliberately reuse the box's
  existing sink instead of adding an SDK.
- **tRPC v11 HTTP-RPC spec** documents the non-batched mutation wire shape
  (raw JSON body) and maps `TIMEOUT`→408 / `TOO_MANY_REQUESTS`→429 — both
  retryable, which shapes the client's response classification.
  https://trpc.io/docs/rpc

## Tracks / scope

Single track, four implementation chunks (see Implementation order). The
vocabulary lock-ins, stated once:

- **Wire shape** (mirrored constants, mobile-contract §8): `debugLog.submit`
  input becomes
  `{ source?: string, entries: [{ level: string, message: string, at?: string }] }`.
  - `source`: short slug (`z.string().regex(/^[a-z][a-z0-9-]{0,15}$/)`),
    optional; iOS sends `"ios"`. Absent = web (unchanged behavior).
  - `level`: closed enum `z.enum(["error", "warn", "log", "info"])` — the four
    levels the web already sends (`DebugLog.tsx` patches exactly these).
  - `at`: device-side timestamp, `z.string().datetime({ offset: true })`,
    optional per entry. Needed because a queued entry may flush hours after
    the failure it describes; the server's receipt timestamp alone would
    misdate the incident.
  - Caps (new, server-side): ≤ 100 entries per batch, `message` ≤ 4000 chars.
    Today `z.string()` is unbounded — an input-boundary gap this plan closes
    (validate-at-boundaries). iOS enforces the identical caps before
    persisting (truncation happens client-side, so a batch can never 400 for
    size — Codex finding 5).
  - Rendering: control characters in `message` (including CR/LF) are
    normalized to spaces for the log line — a multiline or crafted message
    cannot forge additional log records (applies to web entries too; a small,
    honest rendering change). Line format: `ts [level] [source] message` when
    `source` present; plus `@<at>` inside the bracket when `at` differs from
    receipt time by more than ~5s: `ts [level] [source@<at>] message`. Web
    lines stay unchanged except the control-char normalization.
  - Durability: the submit route writes through a strict variant of
    `appendRollingLog` that rejects on filesystem failure, so a 2xx means the
    line is durably appended; on failure the mutation errors and the client
    retains its copy (Codex finding 2).
- **iOS message discipline**: `category: detail key=value…` prose, metadata
  only. Allowed: session/item ids, counts, byte sizes, HTTP status,
  `URLError.Code`, attempt numbers, elapsed times, filenames already destined
  for the box, and error descriptions whose text originates from the box
  server or from Foundation (`URLError.localizedDescription`). Never: media
  bytes, transcript or composer text, tokens or `Authorization` values, full
  request bodies. Enforcement is threefold: (a) site discipline at each
  instrumentation point (reviewed in chunk 3), (b) client-side truncation to
  the wire caps, and (c) a forwarder-level guard that redacts any known
  device-token substring from outgoing messages before send, with a test
  (adopted from Codex finding 6; the full typed-event-constructor design is
  declined — see NOT in scope).
- **New Swift surface**: `Services/BoxLog.swift` (facade over `os.Logger` +
  enqueue), `Services/LogForwarder.swift` (actor: queue, persistence, flush,
  transport), `Services/BoxRequest.swift` (the extracted auth request helper).

### Direction (the shape)

**iOS logging facade.** `BoxLog` exposes `error(_:category:)` /
`warn(_:category:)` / `info(_:category:)` with categories as an enum
(`capture`, `upload`, `net`, `pairing`, `composer`, `webview`, `lifecycle`,
`audio`). Every call logs
to unified logging (subsystem `app.callbackbox.ios`) — the conventional Apple
path, visible in Console.app/Xcode. All three levels enqueue to `LogForwarder`;
info is limited to selected lifecycle/navigation/audio transitions rather than
general verbose logging.

Two durability tiers (Codex finding 4 — a sync facade cannot promise
crash-survival):

- `BoxLog.error/warn` are synchronous fire-and-forget (they launch a `Task`
  into the actor); an immediate crash can lose that one entry. This is the
  general-purpose tier.
- `await LogForwarder.record(_:)` is the awaitable tier: it returns only after
  the entry is persisted to disk. The capture-failure boundaries
  (`CaptureUploadCoordinator.handleCompletion` / `handleFailure`, the
  background-session completion path) use this tier directly, so a capture
  failure is durably recorded before the app can be suspended or crash —
  which is the driver incident's requirement.

**Forwarder.** `LogForwarder` is an actor. Entries are
`{ id: UUID, at, level, category, message, boxID }` — the stable `id` exists
because Swift actors are reentrant across the transport `await`: flush marks
its batch in-flight (one in-flight batch per box, concurrent flush calls
no-op), and on 2xx removes exactly the acknowledged ids, never "the first N"
(Codex finding 3). Bounds: 200 entries per box, 500 globally, drop-oldest; a
drop inserts one synthetic `warn` marker entry counting what was dropped (no
silent cap). Routine info entries are evicted before error/warn entries, so
transition chatter cannot replace the failure it is meant to explain. Entries
for boxes no longer in `PairedBoxStore` are purged when
the box map updates — no orphan queue for removed/re-paired boxes (Codex
finding 9). Persistence is one small JSON file in Application Support (atomic
writes, `ComposerDraftRepository` pattern), written on every enqueue —
errors are rare and the file is tiny, so there is no persistence debounce to
lose a crash-adjacent entry to.

Flush triggers — network flush is foreground-only; persistence is the
guarantee everywhere else (Codex finding 1):

1. App launch, after `PairedBoxStore` loads (the `CallbackBoxApp`
   `.onReceive(store.$boxes)` hook, which also keeps the forwarder's box map
   current — `CaptureUploadRuntime` pattern). This is where entries persisted
   by a suspended/killed/offline run finally land server-side.
2. Foregrounding (`scenePhase == .active`).
3. Debounced after enqueue while foreground (one 2s `Task`, armed by the first
   entry in a burst so steady info traffic cannot postpone it indefinitely).
4. On `scenePhase == .background` and on the background-URLSession completion
   path, the forwarder only guarantees persistence. A flush attempt is made
   under `beginBackgroundTask` with an expiration handler (best-effort; the
   entries survive either way, and the background-session completion handler
   is released only after persistence completes).

Flush = one `POST /api/trpc/debugLog.submit` per box with that box's queued
entries, `source: "ios"`, auth via the shared request helper. Response
classification (Codex finding 5): 2xx → remove acknowledged ids; network
error, 5xx, 408, or 429 → keep everything, wait for the next trigger (no retry
loop — forwarding must not become a second unreliable upload); 401/403
(revoked device) → drop that box's batch and note it via `os.Logger` only —
a revoked device should stop writing to the box; 400 → should be impossible
given client-side caps and the closed enum; treated as a bug signal: drop the
batch, `os.Logger` fault. A flush failure never enqueues a forwarded entry
about itself (loop guard); transport problems are visible in unified logging
only.

**Instrumentation (the payload of the feature).** Chunk 3 touches every
currently-swallowed failure the exploration mapped — capture first, and the
capture sites are the non-negotiable core (the rest is severable if scope
needs cutting):

- `Services/CaptureUploadCoordinator.swift`: `handleCompletion` /
  `handleFailure` record (awaitable tier) the classified outcome with HTTP
  status and `URLError.Code` captured *at the classify boundary* (today
  `CaptureAPI.classify` flattens to `localizedDescription` before anything can
  see the status); the `try? store.recordUploadFailure` swallow — where a
  persistence error currently drops the failure record entirely — becomes
  log-and-continue; `start()`'s catch logs before surfacing.
- `Views/NativeCaptureController.swift`: every `surfaceState.phase = .failed` /
  `showError` site also logs (session id, phase, operation); the nine `try?`
  swallow sites log at `warn`.
- `Services/CaptureAcquisition.swift`: `CaptureAudioRecorder` `lifecycle.fail`
  paths and importer failure collection log with segment sizes/durations.
- Bulk path (`BulkUploadCoordinator` / `BulkUploadAPI` /
  `NativeComposerView.uploadPhotoBatch`): terminal `recordFailure`, the
  `catch { .retryable }` that discards the `URLError`, the
  `stageComposerImage` `catch { return nil }` that loses the error entirely,
  and the final `.failed` outcome (photo count, total bytes).
- `Services/ChatAPI.swift`: `resolvedSession()`'s silent non-2xx → `"new"`
  degradation logs a `warn` (contract §5.3 marks this drift SILENT today);
  `uploadFile` / `transcribeAudio` failures log.
- `Views/ChatWebView.swift`: `webViewWebContentProcessDidTerminate` and
  provisional-navigation failures log — native-only visibility the web
  forwarder structurally cannot have.

**Server + docs.** The `submit` schema extension (enum level, datetime `at`,
`source`, caps), strict-append durability, control-char normalization,
`source`/`at` line rendering; `docs/client-debug-log.md` gains an iOS section;
`docs/mobile-contract.md` gains §5.7 (H5 in §7), the §8 mirrored wire-shape
constants, and anchor-manifest entries for
`callback-box/src/webapp/trpc/routers/debugLog.ts` +
`ios-app/CallbackBox/Services/LogForwarder.swift`.

## Subplans

None. The one candidate — a user-exportable diagnostic bundle from the 2026-07-27
issue — is explicitly NOT in scope rather than a subplan.

## Failure modes

> **Critical gap (accepted, documented):** entries for a box whose token was
> never valid (pairing itself failed) cannot be forwarded — there is no
> credential to send them with. They stay in unified logging on-device only.
> No forwarding design can fix this; the pairing-failure story remains
> Xcode-attached diagnosis.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Flush POST fails (offline, box cold longer than timeout, 5xx, 408/429) | planned: `LogForwarderTests` stub transport | keep entries, retry on next trigger | silent to user, visible in unified logging (by design — logging must not toast) |
| Flush gets 401/403 (revoked device token) | planned: `LogForwarderTests` | drop that box's batch, os.Logger note | silent remotely; correct — a revoked device should stop writing to the box |
| App suspended right after backgrounding, before flush completes | planned: covered by persistence tests (flush is best-effort there) | entries persisted at enqueue; next launch/foreground flushes | clear — this is the designed path, not an edge case |
| Overlapping flush triggers / enqueue during in-flight flush (actor reentrancy) | planned: `LogForwarderTests` overlapping-flush + enqueue-during-flush cases | single in-flight batch per box; remove-by-id ack | clear by construction |
| Server filesystem write fails (disk full, permissions) | planned: route doctest for the strict-append variant | mutation rejects; client retains entries | LOUD (was the silent-loss mode — Codex finding 2) |
| Queue file corrupt / undecodable on launch | planned: `LogForwarderTests` decode-failure case | reset to empty, os.Logger error | silent remotely, clear locally |
| Queue overflow (error storm) | planned: bounds test (per-box + global) | drop-oldest + synthetic dropped-count marker entry | clear — the marker lands server-side |
| Box unpaired / re-paired with new UUID while entries queued | planned: purge-on-update test | purge entries for unknown boxIDs on box-map update | clear (locally logged) |
| Forwarding failure triggers its own error log → loop | planned: loop-guard test | forwarder never enqueues about itself | clear by construction |
| Crash immediately after a fire-and-forget `BoxLog.error` | not testable cheaply | capture-failure boundaries use the awaitable persist tier instead; only the casual tier can lose its one entry | accepted residual loss, documented in `BoxLog.swift` header |
| Device token appears in a message string | planned: redaction test | forwarder redacts known token substrings before send | clear |
| Server: oversized/malformed batch | planned: route doctest | Zod enum/datetime/caps → tRPC 400; client caps make it unreachable from conforming clients | LOUD |
| Multiline/control-char message forging log lines | planned: route doctest | normalization to spaces at render | clear |
| `at` far in the past (stale flush) | planned: route doctest for rendering | `[source@<at>]` rendering keeps incident time | clear |
| Web client unaffected by schema change | planned: doctest asserts web-shaped input renders as today (modulo control-char normalization) | `source`/`at` optional; level enum matches the four web levels | clear |
| Log POST wakes an idle box (hub lazy-start) | n/a | inherent to any HTTP forward; error-volume is low and error/warn-only | accepted; noted in client-debug-log.md |

## Agent-flow / user-flow edge cases

Most of the template's seven target card-vocabulary work; the ones that apply:

- **Two writers, one file** — web and iOS forward concurrently to the same
  rolling log. ADDRESSED: `appendRollingLog` serializes writers through its
  in-process promise chain (not append-only semantics — it rewrites on
  truncation); the `source` tag disambiguates. Interleaving is fine — the
  file is already multi-tab concurrent today.
- **Stale ref / partial state** — an entry can describe a capture session the
  box never saw (the exact driver incident). ADDRESSED: that asymmetry is the
  feature; entries carry the session id so an agent can confirm absence
  server-side.
- **Fabricated free-form value** — instrumentation messages are
  developer-authored format strings, not model output. Not applicable.
- **Validation error UX** — a 400 from the caps lands in unified logging only
  (the forwarder treats it as a bug signal). ADDRESSED; an agent-facing 400 is
  not possible (agents don't call submit).
- **Partial migration / transition state** — old installed iOS builds simply
  don't call the endpoint. New phone against a not-yet-deployed box: the plan
  uses plain `z.object` (non-strict), so unknown `source`/`at` keys are
  stripped and entries still land, untagged — degrades to today's behavior.
  ADDRESSED; the doctest pins it.

## NOT in scope

- **User-exportable diagnostic bundle / share sheet** (the larger design in
  `issues/bugs/2026-07-27-ios-native-runtime-errors-not-observable.md`) — this
  plan gives the server-side trace; an on-device export UI is separate work.
  The issue stays open, annotated.
- **Typed event constructors with per-field allowlists** (Codex finding 6's
  full remedy) — declined. The destination is the boxholder's own box;
  server-authored error text originates from that box, and filenames are
  already destined for it. The real risk is accidentally logging
  transcript/composer text, which is a site-discipline property no field
  schema can verify either (the string field would carry it just the same).
  Adopted instead: the device-token redaction guard + caps + per-site review.
- **Verbose/info forwarding or a native debug panel** — the web's
  verbose-when-panel-open mode has no native equivalent yet; error/warn only.
- **Capture/bulk retry-behavior changes** — instrumentation only; fixing e.g.
  the bulk path's lost `URLError` *type* for retry decisions, or issue
  2026-07-31's recorder-stops-silently detection, are separate fixes (logging
  their symptoms is in scope).
- **A shared native HTTP client beyond the auth helper** — extracting
  `BoxRequest` is justified by a fourth duplication site (Codex correctly
  notes the three existing sites drift slightly — consolidating drift is the
  point); unifying `ChatTransport`/`CaptureTransport` is not this plan's job.
- **Cutting to a capture-only v1** (Codex finding 7) — declined as a plan
  change. The briefing's shape is a small general forwarder the app reuses,
  and the non-capture instrumentation is where today's other silent swallows
  live (`resolvedSession` → `"new"`, `stageComposerImage` → `nil`). The
  concession: instrumentation order puts capture first and marks the rest
  severable, so if implementation pressure hits, the cut line is pre-drawn.
- **Android** — the contract rows are written platform-neutrally (§10);
  implementation is iOS-only.
- **Keychain migration for the token** (open risk I6) — untouched.

## Open design questions

- Whether `webview` category should also log `didFailProvisionalNavigation`
  for the *initial* load (fires routinely offline; could be noisy). Lean: log
  it at `warn` with the noise-filter lesson from `DebugLog.tsx` ·
  `isNetworkNoise` in mind — one entry per transition to failure, not per
  retry. Decided enough to not block chunk 1.

## Knowledge audits

No new agent-facing *concept*: agents already know "check
`.callback-box/client-debug.log`" from `callback-box/CLAUDE.md`; iOS entries
appear in the same place with a `[ios]` tag, and `docs/client-debug-log.md` is
updated in chunk 1. Skip a knowledge-audit entry with that rationale — the
convention being audited (read the client debug log) already exists and is
unchanged; only its coverage grew.

## Implementation order

1. **Server + contract docs.** `debugLog.submit` schema (`source`, `at` as
   real datetime, closed level enum, caps), strict-append variant in
   `src/lib/rolling-log.ts` used by this route, control-char normalization,
   line rendering; route doctest (web-shape unchanged, ios-shape tagged, caps
   and enum enforced, strict-append failure rejects, non-strict
   forward-compat, exact Swift-shaped raw-HTTP body decodes);
   `docs/client-debug-log.md`; `docs/mobile-contract.md` (§5.7/H5/§8/§11
   anchors). The tripwire forces the contract doc co-stage.
2. **iOS forwarding core.** `BoxRequest` extraction (refactor the three
   drifting auth appliers onto it), `BoxLog` (two tiers: fire-and-forget +
   awaitable `record`), `LogForwarder` (ids, single in-flight batch per box,
   persist-on-enqueue, purge-on-box-map-update, token redaction, response
   classification), lifecycle wiring (launch flush, foreground flush,
   foreground debounce, best-effort background attempt under
   `beginBackgroundTask`, background-session completion persist-before-release),
   `LogForwarderTests` (stub transport + injected sleep: debounce, per-box and
   global bounds, persistence roundtrip, decode-failure reset, overlapping
   flushes, enqueue-during-flush, remove-by-id ack, keep-on-5xx/408/429/network,
   drop-on-401/403, loop guard, token redaction, purge-on-unpair).
3. **Instrumentation.** Capture path first (the non-negotiable core, awaitable
   tier at the upload-failure boundaries), then bulk path, ChatAPI, webview
   process termination — the site list under Direction. No behavior changes,
   logging only.
4. **Verification + review.** Run iOS test suite + box test suite; manual
   iPhone pass (below); Codex review of the full diff; update/annotate
   `issues/bugs/2026-07-27-ios-native-runtime-errors-not-observable.md`.

Chunk 2 depends on 1 only for end-to-end testing (the Swift side can build
against the non-strict old server). Chunk 3 depends on 2.

## Rollout shape

- **Tests first**: the route doctest (chunk 1) and `LogForwarderTests`
  (chunk 2) are named above and encode the done-when: *a simulated capture
  upload failure with the network stubbed down produces, after a stubbed
  reconnect flush, `[error] [ios] capture: …` lines in the box's
  client-debug.log* (asserted end-to-end in a doctest via a direct HTTP POST
  shaped exactly like the Swift caller, plus unit-level in Swift).
- **Manual iPhone verification** (required — the point is a real failure
  landing): (a) pair to a dev box through the router; (b) start a capture,
  enable airplane mode mid-upload, wait for failure UI, re-enable network,
  reopen app → check `~/src/box-worktrees/ios-log-forwarding/test1/.callback-box/client-debug.log`
  for the tagged entries with correct `at` times; (c) force-kill the app after
  a failed capture, relaunch → entries still arrive (persistence); (d) a
  normal successful capture produces *no* forwarded entries (noise check);
  (e) photo-batch over the inline limit with the box stopped → bulk failure
  entries arrive after restart.
- **Migration**: none — additive schema, no data shape changes, old clients
  and old servers both degrade cleanly (pinned by the non-strict doctest).
- **Ships as one unit** from this worktree when all chunks and the manual pass
  complete; merge only on the boxholder's signal.
