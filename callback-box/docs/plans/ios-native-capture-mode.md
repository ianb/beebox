# Native iOS capture mode

**Status:** active — reviewed and ready to implement; the review findings in
`ios-native-capture-mode.review.md` are incorporated below.

This plan adds a native, full-screen capture mode to the iOS companion app. It
reuses the box's existing capture staging, preparation, delivery, and pending
chat UI; adds the smallest server contract needed for native AAC audio and
mobile resume; and keeps unacknowledged media durable on the phone so an iOS
suspension or network loss cannot silently discard a capture.

## Stated preferences this plan trades against

- `docs/engineering-principles.md`: **#1 types are structure** (native capture
  and upload phases are closed enums, not correlated booleans), **#3 validate at
  boundaries** (audio format, upload metadata, and resume responses), **#4
  resilient and never silent** (local media survives failed uploads and every
  degradation is visible), **#5 failure paths in signatures** (the client
  branches on rejected, retryable, and already-sealed outcomes), **#8 one way to
  do each thing** (native capture enters the existing staging/preparation path),
  **#9 formal structure for essential complexity** (one explicit capture state
  machine), and **#10 testability is architectural** (camera, recorder, disk,
  and transport are injected behind narrow protocols).
- `code-style.md`: standard TypeScript validation, Result/error, exhaustiveness,
  and logging rules apply to the box-side contract changes. Swift code follows
  the same intent with exhaustive enums and localized errors.
- `docs/adding-api-endpoints.md`: capture uploads remain raw Fastify because
  they are file transfers. The existing capture lifecycle deliberately keeps
  create/upload/finalize/cancel together in REST
  (`src/frontend/src/pages/capture/capture-api.ts:7-23`); the mobile resume read
  joins that same lifecycle rather than exposing tRPC's internal HTTP wire
  format to Swift.
- `docs/testing.md`: route and filesystem behavior gets doctests; pure state
  transitions and native persistence get XCTest; camera, interruption, and
  background-transfer behavior gets an explicit real-device acceptance pass.
- Shipped precedent: `docs/implemented-plans/capture-mode.md` owns the capture
  semantics. This plan ports the client stance, not the preparation pipeline.
  The native composer's existing one-off photo and voice paths remain feeders
  for ordinary chat emissions, not substitutes for capture mode.

## What already exists

- **The complete box-side capture pipeline — reuse.** Raw routes create a
  staging session, eagerly accept media, seal it, and fire preparation
  (`src/webapp/routes/capture.ts:1-14,124-221,236-270`). The preparation worker
  writes and validates a capture document, commits it, and delivers a
  `<capture>` message (`src/core/capture/prepare.ts:226-312`). Native iOS must
  call this path; it must not assemble cards or wrappers itself.
- **Durable server staging and concurrency — reuse.** Sessions live under
  `tmp/capture-staging/` and are validated from `session.json`
  (`src/core/capture/staging-store.ts:1-12,71-78,96-128`). Per-session mutation
  is serialized (`staging-store.ts:167-180`), and limits are 1 GiB / 500 items
  (`src/core/capture/staging-limits.ts:1-14,37-51`).
- **Raw-body upload branch — repair before reuse.** The upload handler can read
  a raw `Buffer` (`src/webapp/routes/capture.ts:112-118`), but the server
  registers multipart only (`src/webapp/server.ts:93-98`), so Fastify rejects
  an unregistered binary content type before that branch runs. Track 1 adds one
  exact `application/octet-stream` parser and a route doctest before native
  background uploads rely on this path. Fastify's 50 MiB body limit
  (`src/webapp/server.ts:53-57`) is also the effective per-item native limit.
- **Crash resume and pending UI — reuse after unifying request identity.** The
  pure selectors already scope resumable sessions by authenticated user and
  visible chat (`src/core/capture/pending.ts:63-105`). The web capture overlay
  offers Resume / Submit now / Discard
  (`src/frontend/src/components/capture/CaptureResumeDialog.tsx:1-58`). After
  finalize, the embedded web chat already renders server-derived pending and
  retry bubbles; native-shell mode suppresses only the web capture overlay, not
  those bubbles (`src/frontend/src/components/chat/InteractiveChat.tsx:135-140,
  174-175,279-284`). Native code should not build a second pending-chat model.
  Today `getSessionUser` reads only the cookie (`src/webapp/auth.ts:189-196`),
  while mobile bearer authorization returns only a boolean
  (`src/webapp/server-box-scope.ts:82-90`); Track 1 must resolve both credentials
  to the same capture owner before mobile resume can reuse the selector safely.
- **Web capture UX — behavioral reference.** Capture is a full-screen,
  text-free stance with repeat photos, gallery/files, multiple audio segments,
  Done, Cancel, counts, and visible upload failures
  (`src/frontend/src/components/capture/CaptureOverlay.tsx:104-159` and
  `CaptureControls.tsx:21-72`). Each recording start creates a segment and Done
  waits for the recording tail and pending uploads
  (`src/frontend/src/pages/capture/useCaptureSession.ts:102-133,168-187`).
- **Web upload retry — reference, not enough for iOS.** Web payloads live in
  memory while upload state and retry registries are tracked
  (`src/frontend/src/pages/capture/useCaptureUploads.ts:77-131,167-207`). A web
  page reload can rely on already-acknowledged server staging; iOS suspension
  can occur between acquisition and acknowledgement, so the native client adds
  a small on-disk queue.
- **Native composer and auth — extend.** `NativeComposerView` already owns the
  `+` sheet, one-off camera/gallery attachments, native dictation, and the
  bottom dock (`../../../ios-app/CallbackBox/Views/NativeComposerView.swift:13-23,
  25-58,101-122`). `ChatAPI` already applies the paired bearer token
  (`../../../ios-app/CallbackBox/Services/ChatAPI.swift:25-43,64-69`). The capture
  API should extract and reuse a shared authenticated request builder rather
  than copy auth logic.
- **Visible chat identity — reuse.** `RootView` supplies the composer with the
  session currently visible in the webview
  (`../../../ios-app/CallbackBox/Views/RootView.swift:15-24,38-50`). A capture is
  bound to an immutable snapshot of that box and session when it opens.
- **Camera and orientation helpers — replace/extend.** The one-shot
  `UIImagePickerController` wrapper is suitable for ordinary attachments
  (`../../../ios-app/CallbackBox/Views/ComposerActionsView.swift:75-115`) but not a
  persistent viewfinder. `CameraImageEncoder` already flattens orientation into
  JPEG pixels before upload; capture mode reuses that visual invariant. The
  broader EXIF contract remains tracked in
  `../../../issues/bugs/2026-07-17-image-orientation-exif-boundaries.md`.
- **Test corpus — extend.** Capture already has route, staging, concat,
  preparation, resume, pending, and tour coverage under `test/core/capture/`,
  `test/webapp/`, and `test/tours/capture.tour.ts`. The iOS target currently has
  XCTest coverage for speech, URL/session parsing, and image orientation in
  `../../../ios-app/CallbackBoxTests/SpeechKeywordsTests.swift`.

## Prior art (external)

- Apple's `AVCapturePhotoOutput` is the still-photo API for a persistent capture
  session and supports explicit JPEG output. `AVCaptureSession.startRunning()`
  is blocking and belongs on a serial queue, not the main thread.
  <https://developer.apple.com/documentation/avfoundation/avcapturephotooutput>
  and <https://developer.apple.com/documentation/avfoundation/avcapturesession>
- Apple's AVCam sample uses `AVCaptureVideoPreviewLayer` hosted in a `UIView`
  and wrapped with `UIViewRepresentable`, the appropriate SwiftUI viewfinder
  shape. <https://developer.apple.com/documentation/avfoundation/avcam-building-a-camera-app>
- `AVAudioRecorder` records directly to a file, supports metering, and closes a
  complete file on `stop()`. It is sufficient here; `AVAudioEngine` would add
  processing complexity capture mode does not need.
  <https://developer.apple.com/documentation/avfaudio/avaudiorecorder>
- Camera access is interrupted when the app moves to the background, and audio
  sessions can be interrupted by calls, route changes, suspension, and scene
  backgrounding. Capture must seal the current local audio file and visibly
  pause rather than pretending recording continued.
  <https://developer.apple.com/documentation/avfoundation/avcapturesessioninterruptionreason>
  and <https://developer.apple.com/documentation/avfaudio/avaudiosession/interruptionnotification>
- Background `URLSession` upload tasks can send file-backed content while the
  app is suspended or terminated. This fits the local-file queue once Track 1
  registers and advertises the raw-body contract.
  <https://developer.apple.com/documentation/foundation/urlsession>
- `PhotosPicker` supports multiple selection and asynchronous `Transferable`
  loading; retrieval itself can fail, including when an iCloud asset is not
  locally available. <https://developer.apple.com/documentation/photosui/photospicker>
- Fastify requires a content-type parser before a nonstandard request body can
  reach a handler; `parseAs: "buffer"` is the supported buffered raw-body shape.
  Track 1 registers only `application/octet-stream`, rather than treating the
  existing dead `Buffer` branch as capability.
  <https://fastify.dev/docs/latest/Reference/ContentTypeParser/>
- `AVAudioRecorder.stop()` closes the recording file. A process killed before
  `stop()` may therefore leave an unusable M4A container; the local manifest
  must distinguish an in-progress recording from a closed uploadable segment.
  <https://developer.apple.com/documentation/avfaudio/avaudiorecorder/stop()>

No external protocol or third-party capture library is needed. The server
already owns resumable staging, and AVFoundation/Foundation cover the native
acquisition and transfer boundaries.

## Tracks / scope

### Track 1 — Make capture transport and identity explicit

**What.** Extend the existing capture REST contract so browser WebM/Opus and
native M4A/AAC segments share one staging and preparation pipeline. Make raw
file upload reachable and advertised, resolve paired mobile credentials to the
pairing user, and add a mobile-friendly resumable-session read to the same REST
lifecycle.

**Why this needs to change.** Staged segments currently store only chunk names
(`src/core/capture/staging-store.ts:32-34`), and preparation unconditionally
concatenates bytes and writes `.webm`
(`src/core/capture/write-cards.ts:81-119`). Relabeling AAC bytes as WebM would
produce corrupt cards. The existing resume selector is exposed only through a
tRPC React query (`src/frontend/src/components/capture/useCaptureResume.ts:37-54`),
whose transport encoding should not become a Swift API contract. The apparent
raw-body branch has no registered parser, and mobile bearer auth currently has
no user identity; both must be corrected before the native queue and
cross-client resume can rely on them.

**Direction.** Add a closed staging field:

```ts
type CaptureAudioFormat = "webm-opus" | "m4a-aac";

interface StagingSegment {
  id: string;
  startedAt: string;
  format: CaptureAudioFormat; // defaults to webm-opus on old manifests
  chunks: string[];
}
```

The upload route accepts `X-Capture-Audio-Format`; omission means
`webm-opus` for existing web clients/manifests. Every chunk added to an existing
segment must match its format. `webm-opus` retains ordered byte concatenation;
`m4a-aac` requires exactly one complete file per segment and writes `.m4a`.
Unsupported or mixed formats return a clear 400/409 before bytes mutate the
session. The create response adds
`capabilities.acceptedAudioFormats`; native recording is enabled only when
`m4a-aac` is advertised, so an older box cannot silently mislabel audio.

Register `application/octet-stream` with `parseAs: "buffer"` before capture
routes and exercise the non-multipart path in a route doctest, including the
behavior of `request.file()` on a non-multipart request. All native capture
payloads use that content type; `X-Capture-Mime-Type` retains the media's real
type. The create response also adds
`capabilities.acceptedUploadEncodings: ["raw-body-v1"]`. Native capture proceeds
only when both `m4a-aac` and `raw-body-v1` are advertised. Against an older
server, the app cancels the just-created empty session and shows an update-server
message; ordinary one-off composer attachments remain available.

Persist the pairing ticket's `createdBy` on the redeemed `MobileDevice` record
as `createdBy: string | null`; old device records default to `null`. Add one
request-owner helper that resolves a session cookie or a verified mobile bearer
to the same email. Capture session creation, the new resumable route, and the
temporary tRPC resumable procedure use that helper. On an auth-enabled box, a
mobile device whose old record has no owner receives a clear 403 requiring
re-pairing; `null` remains valid only when box auth is disabled. This prevents
all legacy devices from silently sharing one anonymous resume scope.

Add `GET /api/capture/sessions/resumable?targetSessionId=&clientSessionId=` to
the cohesive REST family. It delegates to `selectResumableCaptures`, scopes by
the unified request owner, and validates query strings at the route boundary.
Move the web resume hook to this REST read and remove only the tRPC
`resumableSessions` procedure; keep tRPC `pendingSessions`, which is web-chat UI
state and needs no native duplicate.

**Vocabulary lock-ins.** Wire/staging values `webm-opus` and `m4a-aac`;
header `X-Capture-Audio-Format`; upload encoding `raw-body-v1`; create-response
fields `capabilities.acceptedAudioFormats` and
`capabilities.acceptedUploadEncodings`; paired-device field `createdBy`.

**First implementation chunk.** Add the format schema/default, format-aware
writer, exact binary parser, route/header validation, both create capabilities,
paired-device owner persistence, and the unified request-owner helper. Doctests
cover a raw JPEG body, a WebM multi-chunk segment, one single-file M4A segment,
cookie/mobile owner equivalence, a legacy ownerless device on an auth-enabled
box, and the 50 MiB boundary. No native code is in this chunk.

### Track 2 — Native capture domain, durable queue, and API client

**What.** Build the native capture state model before camera UI: authenticated
session lifecycle calls, a file-backed local manifest, and a background upload
coordinator.

**Why this needs to change.** `ChatAPI` currently has one in-memory
request/response path and reads whole transcription audio into a multipart body
(`../../../ios-app/CallbackBox/Services/ChatAPI.swift:25-43,71-83`). Capture media
can be large and may outlive the foreground scene. An unacknowledged photo or
recording must survive process termination.

**Direction.** Introduce these boundaries:

```swift
enum CapturePhase {
    case bootstrapping
    case choosingResume([ResumableCapture])
    case active(CaptureSessionID)
    case sealing(CaptureSessionID)
    case recovery(CaptureRecovery)
    case failed(CaptureFailure)
}

enum CaptureItemState: Codable {
    case recording
    case local
    case uploading(taskIdentifier: Int)
    case uploaded
    case failed(message: String)
}
```

`CaptureStore` is an actor owning
`Application Support/Capture/<box-id>/<session-id>/manifest.json` and local
media. Each item records a UUID filename, kind, capture time, source, MIME type,
audio format/segment id when applicable, and upload state. Writes are atomic.
Audio creates and persists a `recording` row before `AVAudioRecorder` starts;
only a successful Stop transitions it to `local` and therefore uploadable.
The file stays local until a 2xx upload acknowledgement; then its manifest row
remains but the payload can be deleted. Failed/local payloads remain until the
user retries, submits/discards them explicitly, or moves them to a follow-up
capture.

`CaptureAPI` reuses a shared paired-box request builder for bearer auth. Uploads
use raw file bodies and `URLSessionConfiguration.background`, with task metadata
mapped back to manifest item IDs. The app delegate forwards background-session
completion. Retryable network/408/429/5xx outcomes return to `local` with bounded
backoff; 400/401/403/404/409/413 become typed, visible failures. Uploads use one
background `URLSession` with one fixed app identifier across launches and boxes;
task metadata carries box/session/item IDs. Startup reconciles persisted
manifests with that session's `URLSession.getAllTasks()` before scheduling
anything. An `uploading` row whose task identifier is absent returns to `local`
instead of remaining orphaned. Imported or closed files are size-checked before
enqueueing against the server's 50 MiB per-request cap; oversize items fail
terminally without consuming retries.

Native filenames are UUID-based (`ios-photo-<uuid>.jpg`,
`ios-audio-<uuid>.m4a`, `ios-file-<uuid>-<sanitized-name>`) so simultaneous web
and phone resume cannot overwrite count-based names. Timeline order continues
to come from capture timestamps, not filenames. Every staged photo is normalized
to JPEG, or PNG when alpha must be retained, and its filename extension matches
its encoded bytes. HEIC is converted before staging; MIME headers do not replace
the writer's filename-extension contract.

**Vocabulary lock-ins.** `CaptureStore`, `CapturePhase`, `CaptureItemState`, and
`CaptureAPI`; one local manifest per box/server staging session; one fixed
background-session identifier per app; 50 MiB maximum per native upload item;
JPEG/PNG photo bytes with matching `.jpg`/`.png` extensions.

**First implementation chunk.** Implement Codable wire models, pure request
builders, the atomic local store, and a fake transport. XCTest proves auth
headers, raw upload metadata, atomic reload, task reconciliation, idempotent
upload acknowledgement, missing background-task recovery, 404/409 terminal
classification, size preflight, and exhaustive transition behavior before any
camera code lands.

### Track 3 — Native camera, gallery, files, and segmented audio

**What.** Add injected native acquisition services that write complete local
files into `CaptureStore` and immediately enqueue them for upload.

**Why this needs to change.** `UIImagePickerController` dismisses after one
photo and cannot provide the persistent repeat-shot stance. `SpeechDictation`
produces chat text and HQ voice messages; capture audio is a different artifact
that must remain a media segment for server transcription and timeline
assembly.

**Direction.**

- `CaptureCamera` owns a video-only `AVCaptureSession`, configured and started on
  a serial queue, with `AVCapturePhotoOutput` and a preview-layer-backed
  `UIViewRepresentable`. It supports front/rear switching and repeat photos.
  Photos are normalized to upright JPEG pixels through the existing encoder
  invariant before entering the local queue. Camera and gallery sources remain
  distinct (`camera-user`, `camera-environment`, `gallery`).
- Gallery uses multi-select `PhotosPicker`; each result is copied/normalized to
  JPEG or PNG in the app container before the picker object is released. HEIC
  and other decodable formats are converted, and each output extension matches
  its encoded bytes. Individual iCloud or decode failures appear beside the
  affected selection and do not cancel other items.
- File import copies every security-scoped URL into the app container
  immediately, preserves original filename/MIME metadata, and then releases the
  external URL.
- `CaptureAudioRecorder` uses `AVAudioRecorder` with mono AAC-LC in an M4A
  container (44.1 kHz, 64 kbps). Every Start creates a UUID segment; Stop closes
  one complete `.m4a` file and queues it as one `m4a-aac` upload. Start/Stop can
  repeat. The camera session contains no audio input, so the user can take
  photos while an audio segment records. The recorder persists the segment as
  `recording` before acquisition and transitions it to `local` only after Stop.
  On relaunch, a row still marked `recording` is treated as an interrupted,
  potentially unfinalized M4A: exclude it from upload and show that the
  interrupted recording could not be saved. Do not repeatedly retry or silently
  delete it. Monitor file size and stop the segment visibly before the 50 MiB
  request boundary; a new segment can then be started.
- Entering capture stops `SpeechDictation` first. Audio interruptions stop and
  preserve the current segment, deactivate the audio session, and visibly mark
  recording paused; resumption is always a new segment.
- Scene backgrounding stops camera preview and the current recording segment.
  It does not enable background audio recording. Already-created file uploads
  may continue through the background URL session.

**First implementation chunk.** Add protocol-backed fake camera/recorder and
real AVFoundation services. XCTest covers file creation, segment identity,
interruption transitions, relaunch with a stale `recording` row, format/extension
matching, size-limit stopping, and permission-denied results; a device smoke
check proves repeated photos while recording one audio segment.

### Track 4 — Full-screen native capture UI and composer entry

**What.** Add the actual native capture stance and connect it to the input
widget.

**Why this needs to change.** The native `+` sheet currently offers only
one-off Take Photo, Choose Photos, and Share Location
(`../../../ios-app/CallbackBox/Views/ComposerActionsView.swift:14-34`). Those
produce one chat emission; they do not support a prepared multi-media capture.

**Direction.** Add **Capture** as the first row of the `+` sheet, visually
separate from one-off attachment actions. It is disabled with "Send a message
first" until the webview reports a real visible session, matching the web
composer (`src/frontend/src/components/chat/InteractiveChat.tsx:279-281`).

Opening it snapshots the paired box and visible session, stops dictation and
keyboard focus, dismisses the action sheet, and presents
`NativeCaptureView` full-screen. The surface is text-free and contains:

- a full-bleed live viewfinder; tap/shutter for repeat photos and a camera-flip
  icon;
- a compact status strip with elapsed recording time and uploaded/uploading/
  failed counts for recordings, photos, and files;
- gallery and file-import icon actions;
- bottom Cancel, Record/Stop, and Done controls with stable dimensions;
- a visible permission/interruption/network banner and a Retry action for
  failed uploads;
- an unfinished-capture decision sheet with Resume, Submit uploaded items, and
  Discard, matching the web vocabulary.

Done first stops a recording, waits for active uploads to settle, and then:

1. finalizes immediately when every item is acknowledged;
2. if some items failed, offers Retry, Submit uploaded items, or Stay here;
3. never enables Submit uploaded items when the server has acknowledged zero
   media.

After a successful idempotent finalize response, dismiss capture and remove the
local manifest. The embedded web chat remains responsible for the pending
capture bubble and eventual delivered message. Cancel confirms only when media
exists, deletes the server staging session, cancels matching upload tasks, then
removes local files.

**First implementation chunk.** Render `NativeCaptureView` entirely from the
fake Track-2/3 model with dev fixtures for empty, recording, mixed-upload,
failure, resume, and sealing states. Verify those states on iPhone SE-size,
current iPhone, and iPad simulator viewports before wiring the real services.

### Track 5 — Recovery, cross-client races, and end-to-end verification

**What.** Close lifecycle gaps that only appear when iOS, the server sweep, and
another capture client act at different times.

**Why this needs to change.** Server staging is durable, but an offline phone
may retain items the server has never seen. The abandonment sweep can submit
the acknowledged subset while the phone is away. A simultaneous web client may
also resume the same server session. Treating these as ordinary retries would
produce terminal 404/409 responses or silent local loss.

**Direction.**

- On entry, query resumable sessions using both the visible target session and
  the locally persisted server session ID; offer the newest candidate, as the
  web overlay does. A server-only resumed capture shows counts but no fabricated
  thumbnails. New UUID filenames avoid cross-client overwrite.
- If an upload receives 409 because the session was sealed/prepared while the
  app was away, stop scheduling that session and retain every unacknowledged
  local file. Show: "This capture was already submitted." Offer **Send remaining
  items as a follow-up** (create a new session bound to the same chat and move
  local rows) or **Discard remaining items**. Never silently attach them to a
  different capture.
- Treat upload/finalize 404 as the same terminal recovery class because a
  delivered or cancelled session has already had staging removed
  (`src/core/capture/prepare.ts:333-342`,
  `src/webapp/routes/capture.ts:141-142,229-232,243-244`). The copy acknowledges
  the ambiguity: "This capture was already submitted or cancelled." Offer the
  same follow-up-or-discard actions for local items. A resumable response that
  still lists the ID wins over a stale 404 result; otherwise never retry a gone
  staging ID.
- A lost finalize response is retried against the same ID; the server's
  compare-and-swap finalize remains authoritative and idempotent
  (`src/webapp/routes/capture.ts:252-270`).
- Switching boxes is unavailable while the full-screen capture is active. A
  stale auth token leaves local media intact and routes the user to Pair or
  Manage Boxes after dismissal.
- Add one local-server integration fixture that creates a native-format session,
  raw-uploads JPEG + M4A + a file, finalizes, observes the web pending bubble,
  and verifies the resulting capture card references correctly typed media.

**First implementation chunk.** Implement pure reconciliation of local
manifest + resumable response + 404/gone + 409/already-sealed outcomes, with
XCTest tables for resume, follow-up, discard, ambiguous gone sessions, and
duplicate completion. Then wire the route and device integration pass.

## Subplans (when a sub-question needs its own design step)

No subplan is required. The box-side changes are bounded to the closed audio
format discriminant, one binary parser/capability, paired-device ownership, and
a REST projection of an existing pure selector. The native camera, recorder,
queue, and UI are one cohesive client feature and are fully directed above.

## Failure modes (the load-bearing section)

No unresolved critical gap remains in the proposed design. Device-only behavior
still requires the real-device acceptance pass; simulator tests cannot prove
camera hardware, audio interruption, or background transfer scheduling.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Old server lacks `m4a-aac` or `raw-body-v1` | Planned route + decode tests | Cancel empty staging session; disable native Capture only | Clear: update-server message |
| Raw binary content type is rejected before the upload handler | Planned raw-body route doctest | Exact parser registered before routes; capability advertised only with support | Clear contract failure |
| Legacy paired device has no authenticated owner | Planned pairing/auth doctests | Reject capture on auth-enabled box; preserve ordinary app access | Clear re-pair action |
| Mixed/unknown audio format reaches a segment | Planned route/store doctests | Reject before manifest mutation | Clear 400/409 |
| Camera or microphone permission denied | Planned fake/XCTest + device pass | Leave other acquisition actions usable | Clear banner + Settings link |
| Photo-library item cannot download/decode | Planned fake/XCTest | Fail that item only; retain other selections | Clear per-item failure |
| Security-scoped file copy fails or disk is full | Planned store tests | Do not enqueue; keep capture open | Clear filename-specific error |
| App dies after acquisition but before upload | Planned persistence/relaunch XCTest | Atomic local manifest + payload recovery | Clear resumable capture |
| App dies during recording before M4A is closed | Planned stale-recording-row XCTest | Exclude damaged row from upload; retain it until explicit dismissal | Clear interrupted-recording error |
| Upload loses network / times out / returns 5xx | Planned transport tests | Bounded retry; payload stays local | Clear uploading/failed state |
| Auth is revoked during background upload | Planned 401/403 test | Stop retries; preserve local payload | Clear re-pair action |
| Item reaches 50 MiB request cap or server returns 413 | Planned preflight + route/client tests | Stop/reject before enqueue when possible; never retry 413 | Clear per-item limit message |
| Server session is already sealed (409) | Planned reconciliation table | Follow-up-or-discard recovery | Clear, never auto-moved |
| Server staging is gone after delivery/cancel (404) | Planned reconciliation table | Terminal follow-up-or-discard recovery | Clear submitted-or-cancelled ambiguity |
| Persisted background task ID has no live task | Planned task reconciliation XCTest | Return item to `local` and reschedule once | Clear uploading state resolves |
| Background task completes after Cancel | Planned task-generation XCTest | Ignore stale completion; local/server tombstone wins | Clear through stable cancelled state |
| Phone call/route change interrupts recording | Planned fake + device pass | Stop and preserve complete segment; resume creates new one | Clear paused banner |
| Scene backgrounds while camera/recording active | Planned lifecycle XCTest + device pass | Stop preview and current segment; uploads continue | Clear on return |
| JPEG orientation metadata is ignored downstream | Existing encoder regression + device photo pass | Flatten visual orientation before queueing | Clear/correct pixels; EXIF debt linked |
| Finalize response is lost | Existing server idempotency + planned client retry | Retry same staging ID | Clear sealing state |
| Preparation or delivery later fails | Existing pending bubble/retry coverage | Webview shows server-derived retry bubble | Clear in transcript |
| Visible chat changes or disappears during capture | Existing server target fallback + planned snapshot test | Capture remains bound to opening session; server resolves fallback | Clear destination label in capture UI |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** Native code never builds
  `<capture>` or card fields; `prepareCaptureSession` remains the only producer
  (Track 1 and What already exists).
- **Stale ref — ADDRESSED.** The capture snapshots a session ID, while existing
  server delivery resolves a missing target through its fallback path. Native
  never rewrites a document ref (Track 5).
- **Two agents or clients touching the same capture — ADDRESSED.** Server
  staging mutation is locked; native media filenames and segment IDs are UUIDs;
  finalize is compare-and-swap/idempotent. Simultaneous clients may append, but
  cannot overwrite each other's bytes (Tracks 1, 2, and 5).
- **Hand-edit drift — ADDRESSED by construction.** Native writes no card or
  staging JSON directly to the box; validated server functions own both.
- **Fabricated free-form value — ADDRESSED by construction.** Capture metadata
  comes from device time/source and selected files. There is no native summary
  text or agent-authored value.
- **Validation error UX — ADDRESSED.** Typed client failures map
  400/401/403/404/409/413 to actionable banners or recovery sheets, while
  unexpected response shapes fail loudly and preserve local media (Tracks 1,
  2, and Failure modes).
- **Partial migration / transition state — ADDRESSED.** Existing manifests
  default missing format to `webm-opus`; old mobile-device records default
  `createdBy` to `null`; and web uploads remain compatible. Native capture waits
  for both advertised capabilities and requires re-pairing an ownerless device
  only on auth-enabled boxes (Track 1).
- **Cross-box confusion — ADDRESSED.** Local manifests are keyed by paired-box
  ID and server staging ID; a full-screen capture holds an immutable box/session
  snapshot and disables switching (Tracks 2, 4, and 5).

## NOT in scope

- **Replacing one-off photo attachments.** Take Photo / Choose Photos still add
  to an ordinary message; capture mode is for a prepared multi-media document.
- **Video capture or Live Photos.** The shipped server vocabulary is
  audio/photos/files, and video would require new preparation/transcription and
  size policy.
- **Background audio recording.** Backgrounding closes the current segment;
  only already-created uploads may continue. This avoids adding an audio
  background mode for a workflow that is visibly camera-led.
- **Native pending/delivered chat bubbles.** The embedded web chat already owns
  durable pending status, retries, and delivered transcript rendering.
- **Text annotation inside capture mode.** The shipped capture stance is
  camera/mic/files only. Ordinary text belongs in the composer after capture.
- **A comprehensive EXIF preservation policy.** This plan guarantees visual
  orientation for native JPEG output and leaves metadata semantics to the
  existing EXIF issue.
- **Changing capture preparation, agent instructions, `<capture>` vocabulary,
  placement, or abandonment timing.** Native becomes another staging client;
  server semantics stay authoritative.
- **Share Extension, widgets, push, TTS, or listening mode.** Those are separate
  iOS companion tracks and do not block capture mode.

## Open design questions

- **Should Capture eventually become a first-class dock button?** Lean: no for
  the initial implementation. Put it first under `+`, where related camera and
  file actions already live, and evaluate actual frequency on-device before
  crowding the stable `+ / Type / Mic-or-Send` dock.
- **Should original camera/gallery EXIF be retained alongside normalized
  pixels?** Lean: defer to
  `../../../issues/bugs/2026-07-17-image-orientation-exif-boundaries.md`. Capture's
  blocking invariant is visually correct pixels; metadata preservation needs a
  pipeline-wide answer rather than an iOS-only encoding choice.

Neither question is inside a first implementation chunk.

## Knowledge audits

No new box-agent concept is introduced. `<capture>`, capture-session cards,
`tmp-capture/`, and the agent's annotation/file-or-complete duties already have
schema instructions and audits from the shipped capture-mode plan. The new
audio-format discriminant and native queue are developer/client infrastructure,
not facts a box agent must recall. No knowledge-audit entry is needed.

## Implementation order

1. Track 1 binary parser, audio-format contract, paired-device owner identity,
   capabilities, and route/auth doctests.
2. Track 1 mobile resume REST projection using unified request ownership;
   migrate the web resume hook and its tests off the removed tRPC procedure.
3. Track 2 native models, shared auth request builder, atomic local store, fake
   transport, and XCTest.
4. Track 2 background upload coordinator and app-delegate completion wiring.
5. Track 3 fake + real camera/gallery/file/audio acquisition services.
6. Track 4 fixture-driven native capture UI and responsive simulator review.
7. Track 4 real-service wiring from the `+` menu through finalize/dismiss.
8. Track 5 reconciliation/follow-up behavior and local-box end-to-end fixture.
9. Real-device acceptance pass, docs reconciliation, and plan closeout.

These are commit boundaries, not shipping milestones. The feature ships only
when the entire plan is complete.

## Rollout and verification

- **Box-side automated:** focused capture doctests for schema defaulting,
  format mismatch, M4A output, both capability fields, raw upload/parser
  reachability, 50 MiB rejection, cookie/mobile owner equivalence, legacy-device
  rejection, resume auth scoping, and web resume compatibility; then full
  callback-box test/typecheck/lint.
- **iOS automated:** XCTest for request construction, reducer transitions,
  local manifest recovery, background-task reconciliation, interruption,
  interrupted-recording recovery, 404/409 follow-up decisions, size preflight,
  format/extension matching, and image orientation; then the full `CallbackBox`
  simulator suite.
- **Simulator visual:** fake-state captures at compact phone, current phone, and
  iPad sizes; verify controls never overlap the safe area, recording/upload
  state does not resize the dock, and permission/recovery sheets fit.
- **Real device:** pair to a test box; take repeated front/rear photos while
  recording; add gallery photos and files; background during recording; suspend
  during upload; disable networking and relaunch; interrupt with an audio-route
  change; force-quit during one disposable recording; retry/finalize; verify the
  webview pending bubble and resulting capture document. Repeat once against an
  old server to verify native Capture is blocked with an update-server message
  while ordinary composer attachments still work.
- **Rollout compatibility:** deploy the server contract before installing the
  app build. Old web clients continue defaulting to `webm-opus`; new iOS clients
  gate native Capture on both create-response capabilities. Existing paired
  devices on auth-enabled boxes must re-pair once so their device record gains
  an owner; open local boxes continue accepting `null`. No on-disk bulk
  migration is needed because old manifests and device records default on read.
