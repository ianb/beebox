# Plan Engineering Review — Native iOS capture mode

Review of `docs/plans/ios-native-capture-mode.md`, performed against the shipped
capture implementation and the current iOS code. Every citation below was
re-read from source; the plan's own citations were checked line-by-line rather
than trusted.

**Verdict up front:** the plan's architecture is sound and its reuse claims are
almost all genuine — the box-side pipeline, staging store, finalize CAS,
pending selectors, and web UX references all check out at the cited lines. But
two of its load-bearing "already exists — reuse" claims are wrong in ways that
change Track 1's scope: the raw-body upload path is unreachable dead code today
(Finding 1), and mobile-bearer requests carry no user identity, which breaks
the resume scoping the plan builds Track 5 on (Finding 2). The plan is **not
ready to implement** until those two are resolved in the plan text; the
remaining findings are failure-mode rows and clarifications that can be folded
in at the same time.

## What already exists

The plan's inventory is accurate with the exceptions called out in Findings.
Verified directly:

- `src/webapp/routes/capture.ts:124-272` — create/upload/finalize/cancel exist
  exactly as described; finalize's compare-and-swap seal is
  `staging-store.ts:356-375` ("*Compare-and-swap the session into `sealed` so
  exactly one concurrent finalize fires preparation*"), and an already-sealed
  session returns the same success shape without re-firing
  (`capture.ts:256-270`). Idempotent-finalize-retry (Track 5) is real.
- `src/core/capture/staging-store.ts:33` — segments are
  `{ id, startedAt, chunks }` with no format field, and
  `src/core/capture/write-cards.ts:105-106` hardcodes
  `` `${audioBasename}.webm` `` — the plan's premise that relabeling AAC bytes
  would corrupt cards is correct.
- `src/core/capture/pending.ts:85-106` — `selectResumableCaptures` filters
  `open`, non-empty, `createdBy === requestingUser`, matched by
  `targetSessionId` or `clientSessionId`. Matches the plan's description; see
  Finding 2 for the identity problem underneath it.
- `src/core/capture/prepare.ts` — write → transcribe → assemble → validate →
  commit → deliver, idempotent per step, exactly as cited
  (`prepare.ts:196-312`).
- Web client behavior: all four frontend citations (`capture-api.ts`,
  `useCaptureSession.ts`, `useCaptureUploads.ts`, `CaptureOverlay.tsx` /
  `CaptureControls.tsx`, `CaptureResumeDialog.tsx`) verified accurate,
  including the count-based filename premise — photos are
  `photo-001.jpg`-style, audio `audio-<segment>-001.webm`
  (`useCaptureUploads.ts:91,112`), so the plan's UUID-filename rationale for
  cross-client resume is grounded in a real collision mechanism (the web
  resume flow works around it by seeding counters).
- `InteractiveChat.tsx:279-284` — capture bubbles are passed unconditionally
  (`captureBubbles={captureBubbleList}` at line 279) while
  `captureEnabled={!usesNativeShell}` and the overlay render
  (`captureMode && !usesNativeShell`, line 284) are the only things native-shell
  mode suppresses. The plan's "suppresses only the web capture overlay, not
  those bubbles" is correct.
- iOS citations: `NativeComposerView.swift`, `ChatAPI.swift` (bearer at
  `applyAuth`, whole-file in-memory multipart at `multipartAudioBody` line 72
  `Data(contentsOf: fileURL)`), `RootView.swift` (visible session via an
  injected `WKUserScript` posting history changes to a
  `callbackboxSession` message handler), `ComposerActionsView.swift`
  (`UIImagePickerController` one-shot wrapper), and `CameraImageEncoder`
  (orientation-flattening `UIGraphicsImageRenderer` re-render, tested in
  `CameraImageEncoderTests`) all check out. Note `CameraImageEncoder` is a
  nested enum at the bottom of `NativeComposerView.swift:407-420`, not its own
  file, and it currently applies only to the camera path — gallery-picked
  images bypass it, consistent with the plan treating gallery normalization as
  new Track 3 work.
- Multi-box management ("Pair or Manage Boxes", box switching, removal) already
  exists (`ComposerActionsView.swift:36-56`, `PairedBoxStore`); the plan's
  Track 5 reference to routing there is consistent with existing surface, not
  new work.
- Doc references exist: `docs/implemented-plans/capture-mode.md`,
  `issues/bugs/2026-07-17-image-orientation-exif-boundaries.md`.

## Prior art (external) — verified

The plan's Apple citations are the right ones and their operational claims are
correct as stated (AVCaptureSession `startRunning` off-main, preview layer via
`UIViewRepresentable`, `AVAudioRecorder` closing a complete file on `stop()`,
background `URLSessionUploadTask` from a file URL surviving suspension,
`PhotosPicker` iCloud retrieval failures). Two gaps in the search:

- **The plan did not check the Fastify side of "raw body upload".** Fastify
  rejects any request whose content type has no registered parser (415) before
  the handler runs; the search that would have surfaced this
  ("fastify raw body" / `addContentTypeParser`) wasn't done, and it invalidates
  the claim Finding 1 covers.
- **No search on what an unfinalized AVAudioRecorder M4A looks like after a
  crash.** The container is finalized on `stop()`; a process killed
  mid-recording leaves a file that fails the plan's own "exactly one complete
  file per segment" contract. See Finding 4.

## Stated preferences this plan trades against

The plan's list is appropriate and the sections it traces to are real. The
findings below trace primarily to **#3 validate at boundaries**, **#4 resilient
and never silent**, **#5 failure paths in signatures**, and the cb-plan
citation discipline ("claims of safety must cite the line where Y handles it").

## Failure modes

The table is well-constructed and most rows are backed by real handling I
verified (413 mapping at `capture.ts:217`, 409-on-sealed at `capture.ts:147-151`,
sweep-partial seal at `staging-store.ts:356-375`, delivery-target fallback in
`prepare.ts:174-177`). Three rows are missing and one is mislabeled — see
Findings 1, 3, 4, and 7. With Finding 1 unfixed, the first row ("Old server
does not advertise `m4a-aac` → photos/files remain available") is itself wrong:
against an old server, *no* native raw upload works at all.

## Agent-flow / user-flow edge cases

The plan's ADDRESSED claims hold with one exception:

- **Wrong tag / hand-edit / fabricated value — ADDRESSED by construction**:
  confirmed; native never writes cards, `prepareCaptureSession` is the only
  producer.
- **Two agents or clients touching the same capture — partially undermined.**
  Byte-level safety (UUID filenames, per-session lock at
  `staging-store.ts:173-187`, CAS finalize) is real, but the *visibility* half
  of the story — web and iOS both seeing the same resumable session — is
  broken by the identity gap in Finding 2.
- **Partial migration — ADDRESSED**: the `format` default-on-read approach is
  the same pattern `createdBy`/`totalBytes` already use
  (`staging-store.ts:73,76` — `.default(null)` / `.optional()`), so the
  transition claim is credible.

## Findings

### 1. The raw-body upload path is unreachable — "upload a file URL directly" is not existing capability

**Location in plan:** "What already exists" — *Raw-body upload — reuse*
(`ios-native-capture-mode.md:53-57`); also Failure-modes row 1 and Rollout
("Photos/files work against the older route shape").
**Citation:** Plan: *"The upload route accepts either multipart or a raw
`Buffer` (`src/webapp/routes/capture.ts:112-118`). Native background
`URLSessionUploadTask` can therefore upload a file URL directly."* Code:
`capture.ts:113-119` does check `request.body instanceof Buffer` — but no
binary content-type parser is registered anywhere.
`src/webapp/server.ts:94-98` registers only `@fastify/multipart`; the sole
`addContentTypeParser` in the codebase is scoped to CSP report types
(`src/webapp/routes/api-csp-report.ts:87-99`). Every capture upload test sends
multipart (`test/webapp/routes/capture-routes.doctest.md:32-34`).
**Issue:** Fastify rejects a POST whose content type has no registered parser
with 415 before the handler runs. A native `URLSessionUploadTask` sending
`Content-Type: image/jpeg` (or `application/octet-stream`) never reaches
`readUploadBuffer`; the raw-Buffer branch is dead code with zero test coverage.
The "therefore" in the plan is false: raw file-URL upload requires new server
work the plan doesn't scope. It also falsifies the compatibility claims — an
old server (pre-Track-1) 415s every native upload, so "photos/files work
against the older route shape" does not hold, and the failure-mode row that
promises photos/files remain available against an old server is wrong.
**Why it matters:** Track 2's entire transport design (file-backed background
uploads) rests on this; discovering it mid-implementation forces an unplanned
server change or a redesign of the upload encoding, and the old-server
degradation story collapses silently (every upload fails, not just Record).
**Suggested action:** Amend Track 1 to include registering a binary
content-type parser (buffered to `Buffer`, scoped tightly — e.g. the capture
upload content types) with a doctest exercising the raw path; note the 50 MB
`bodyLimit` (`server.ts:57`) as the effective per-request cap on that path.
Decide the old-server story explicitly: either gate *all* native capture
uploads on the create-response capability (not just Record), or have native
build a multipart body into a temp file and background-upload that file (works
against old servers, no parser needed) — either is fine, but the plan must
pick. Also verify during implementation that `request.file()` on a
non-multipart request returns undefined rather than throwing
(`readUploadBuffer` calls it first); @fastify/multipart's behavior here should
be pinned by the doctest.
**Traces to preference:** Citation discipline — "this case can't happen because
Y handles it" must cite where Y handles it; the cited lines exist but the
claimed behavior was never exercised (engineering-principles #3,
validate-at-boundaries, cuts both ways: the boundary rejects what you didn't
register).

### 2. Mobile-bearer requests have no user identity — resume scoping and the cross-client story break

**Location in plan:** "What already exists" — *Crash resume and pending UI*
(`ios-native-capture-mode.md:58-66`); Track 1's resumable REST route
(`:174-179`); Track 5's cross-client resume (`:355-359`).
**Citation:** Plan: *"It delegates to `selectResumableCaptures`, scopes by
`getSessionUser(request)`"*. Code: `src/webapp/auth.ts:192-196` —
`getSessionUser` reads only the session **cookie**. Mobile bearer auth is a
separate check with no user attached (`src/webapp/server-box-scope.ts:88` —
`verifyMobileBearer(box.boxRoot, request.headers["authorization"])`), and the
persisted device record has no user field
(`src/core/mobile/pairing.ts:22-29,35-42` — `MobileDevice` is
`{id, label, tokenHash, createdAt, ...}`; the pairing ticket's `createdBy` is
never persisted onto the device).
**Issue:** For an iOS request, `getSessionUser(request)` returns `null`. So:
(a) iOS-created staging sessions get `createdBy: null`
(`capture.ts:131` — `getSessionUser(request)?.email ?? null`); (b) the planned
resumable route scopes iOS callers to `requestingUser: null`, which matches
only `null`-created sessions (`pending.ts:94`). On an authenticated box, a web
user (cookie → email) can never see an iOS-created capture in the resume
prompt and vice versa. Track 5's premise — "A simultaneous web client may also
resume the same server session" — cannot happen; and every paired device on
the box shares the anonymous `null` identity with any unauthenticated caller.
**Why it matters:** The plan's headline durability story ("an offline phone may
retain items… another capture client may also resume the same server session")
silently degrades to iOS-only resume, and the `createdBy` isolation the shipped
plan built (X4) treats the boxholder's own phone as an anonymous stranger. This
is a design decision the plan must make, not an implementation detail.
**Suggested action:** Add to Track 1 an identity design for mobile bearer:
persist the pairing ticket's `createdBy` onto the `MobileDevice` record at
redemption, and introduce one request-identity helper that resolves cookie OR
mobile-bearer to the same user value, used by session create, the new resumable
route, and (opportunistically) the tRPC procedure until it's removed. If the
plan instead accepts iOS-as-null, it must say so and drop/qualify the Track 5
cross-client-resume scenario.
**Traces to preference:** engineering-principles #4 (resilient and never
silent) — the current design fails silently by returning an empty resumable
list; and #8 (one way to do each thing) — two auth paths must resolve to one
identity concept before a second client joins the lifecycle.

### 3. Recovery model handles 409 but not 404 — the likeliest "phone was away" outcome

**Location in plan:** Track 5 (`ios-native-capture-mode.md:361-368`) and the
Failure-modes row "Server session is already sealed (409)".
**Citation:** Plan: *"If an upload receives 409 because the session was
sealed/prepared while the app was away…"* Code: after successful delivery the
staging directory is **removed** — `prepare.ts:341-342` "*Only now that
delivery landed do we discard the raw staging media*" →
`cleanupStagingSession`; likewise cancel (`capture.ts:229-232`) deletes it.
Subsequent uploads and finalizes then hit `capture.ts:141-142` /
`:243-244`: `return reply.status(404).send({ error: "Session not found" })`.
**Issue:** 409 is only the *transient* window (sealed → delivering). Once the
sweep-sealed capture is prepared and delivered — the normal outcome when a
phone is away past the ~10-minute sweep (`capture.ts:40`) plus preparation —
late uploads get **404**, which is indistinguishable from "another client
cancelled it" and from "never existed". Track 2 classifies 404 nowhere, and the
plan's follow-up-or-discard recovery is keyed to 409 only.
**Why it matters:** The most common real-world sequence (record in a dead zone,
phone suspends, sweep submits the acknowledged subset, phone returns an hour
later) produces exactly the response the plan doesn't handle. If 404 falls into
the retryable or generic-failure bucket, unacknowledged local media is stranded
behind a retry loop against a session that will never exist again.
**Suggested action:** Extend Track 2's outcome typing and Track 5's
reconciliation to treat upload/finalize 404 as a terminal "session gone"
outcome with the same follow-up-or-discard recovery as 409, with copy
acknowledging the ambiguity ("this capture was already submitted or
cancelled"). Add a failure-mode row for it. The resumable query can partially
disambiguate (a still-open session id appearing there is neither).
**Traces to preference:** engineering-principles #5 (failure paths in
signatures) — the plan's outcome enum must include the failure the server
actually returns, not just the one that's easiest to reason about.

### 4. Death mid-recording leaves a corrupt M4A that violates the plan's own segment contract

**Location in plan:** Track 3 (`ios-native-capture-mode.md:278-281`) and the
Failure-modes row "App dies after acquisition but before upload".
**Citation:** Plan: *"`m4a-aac` requires exactly one complete file per segment"*
and *"Stop closes one complete `.m4a` file"*; the failure table covers only
death *after* acquisition.
**Issue:** `AVAudioRecorder` finalizes the M4A container on `stop()`. A crash,
force-quit, or battery death *during* recording leaves an unfinalized file —
not "one complete file". The web design bounds this loss to ≤5 s via timeslice
chunk uploads (`useCaptureSession.ts` / `ChunkedRecorder`,
`CAPTURE_TIMESLICE_MS`); the native single-file design loses (or worse,
uploads and fails preparation with) the entire segment, and the relaunch
recovery path will find a manifest row pointing at a damaged payload.
**Why it matters:** This is the one durability regression native introduces
relative to web, in a plan whose stated purpose is that "an iOS suspension or
network loss cannot silently discard a capture." Unhandled, the recovery flow
either uploads a corrupt file (server-side preparation failure, visible but
confusing) or silently retries forever.
**Suggested action:** Add a failure-mode row. Minimum viable handling: mark the
manifest row "recording" at Start and "closed" at Stop; on relaunch, treat a
still-"recording" row as damaged — surface it visibly ("a recording was
interrupted and could not be saved") and exclude it from upload. If the loss is
instead accepted, say so as a documented risk with the web-vs-native asymmetry
stated.
**Traces to preference:** engineering-principles #4 — the degradation exists
either way; the plan must make it visible rather than let a corrupt upload or
a stuck retry report it.

### 5. Track 1's first chunk understates its scope — two server designs are missing from it

**Location in plan:** Track 1 "First implementation chunk"
(`ios-native-capture-mode.md:185-189`) and Implementation order steps 1-2.
**Citation:** *"Add the format schema/default, format-aware writer, route
header validation, create capability response, and doctests… No native code in
this chunk."*
**Issue:** Findings 1 and 2 both land in Track 1's territory (a content-type
parser + raw-body doctest; a bearer-identity design touching pairing and the
new route) but appear nowhere in the chunk or the implementation order. Per the
plan skill, open questions inside the first chunk mean the design isn't done —
these aren't open questions yet only because the plan doesn't know it has them.
**Why it matters:** Step realism: steps 1-2 are currently sized as
schema-plus-projection work; with the missing pieces they also touch
`server.ts`/route registration and `core/mobile/pairing.ts`, which changes
their review surface and test posture.
**Suggested action:** Fold Findings 1-2's resolutions into Track 1's Direction
and first chunk; adjust implementation-order steps 1-2 accordingly. The rest of
the order (models → transport → acquisition → UI → reconciliation → device
pass) is sensibly dependency-sorted and realistic.
**Traces to preference:** cb-plan's first-chunk rule — no open questions inside
the first implementation chunk.

### 6. Native photo naming must satisfy the writer's extension sniff — an unstated wire constraint

**Location in plan:** Track 2 filenames (`ios-native-capture-mode.md:238-241`).
**Citation:** `src/core/capture/write-cards.ts:133` — ``const ext =
photo.filename.endsWith(".png") ? ".png" : ".jpg";`` — the card's media
extension is derived solely from the staged *filename*; the optional
`X-Capture-Mime-Type` is stored but unused for photos. The web client also
never sends a mime type for audio (`useCaptureUploads.ts:118-121` omits it).
**Issue:** The plan's `ios-photo-<uuid>.jpg` happens to satisfy this, but the
constraint is nowhere stated: a native gallery import that stages a HEIC or
names a PNG without `.png` gets silently relabeled `.jpg`. Since Track 3
promises gallery items are "copied/normalized to the app container", the plan
should pin the normalization target (JPEG or PNG, correctly-extensioned) as
part of the vocabulary lock-ins, not leave it implicit.
**Why it matters:** A mismatch here isn't rejected at the boundary — it flows
through as a wrong-extension media file in a committed card.
**Suggested action:** One sentence in Track 2/3 locking the photo wire format:
uploads are always JPEG or PNG with matching filename extension; HEIC is
converted before staging.
**Traces to preference:** engineering-principles #3 — the boundary contract
exists in code but not in the plan's vocabulary lock-ins.

### 7. The 413 row cites the wrong cap for native uploads

**Location in plan:** Failure-modes row "Server cap returns 413"; Rollout.
**Citation:** Plan traces 413 to staging limits
(`staging-limits.ts:13-14`, 1 GiB / 500 items). Code: `server.ts:57`
`bodyLimit: 50 * 1024 * 1024` and the multipart `fileSize` limit
(`server.ts:94-98`) also both produce 413s, per-request.
**Issue:** For the web client (5 s chunks) the 50 MB caps are unreachable; for
native single-file M4A segments they are the *operative* cap — 64 kbps mono
hits 50 MB around 100 minutes, and a large gallery video—well, video is out of
scope, but large files aren't. The client will see 413 far below the staging
limits the plan cites, and "do not retry; preserve/discard explicitly" needs to
apply to that case too.
**Why it matters:** Minor in likelihood, but the failure copy ("limit message")
would cite the wrong limit, and a >50 MB file import fails on every retry with
no path forward unless the client treats it terminally.
**Suggested action:** Note the 50 MB per-request body cap in the failure row
and have the native client pre-check file size before enqueueing.
**Traces to preference:** engineering-principles #5 — the failure path is in
the signature only if it names the failure that actually fires.

### 8. Persisted `taskIdentifier` needs its scoping rule stated

**Location in plan:** Track 2 (`ios-native-capture-mode.md:214-219`) —
`case uploading(taskIdentifier: Int)` in a Codable, persisted manifest.
**Citation:** Plan: *"Startup reconciles persisted manifests with
`URLSession.getAllTasks()` before scheduling anything."*
**Issue:** `taskIdentifier` is unique only within one `URLSession` instance
(per Apple's URLSession documentation). Persisting it is sound only with a
single, stable background-session identifier recreated on launch — which the
plan implies but never states, and which the reconciliation XCTest should pin
(including the stale-identifier-after-Cancel row already in the table).
**Why it matters:** Two background sessions, or a recreated session with a new
identifier string, silently orphans every persisted `uploading` row.
**Suggested action:** One sentence in Track 2 locking "one background
`URLSession` with one fixed identifier per app" into the vocabulary, and an
XCTest case for a persisted identifier that no longer matches any live task.
**Traces to preference:** engineering-principles #9 — the state machine's
correctness depends on an invariant that should be formal, not implied.

## NOT in scope (verified)

The deferrals are genuine and well-reasoned. Spot-checks: video is indeed
absent from the server vocabulary (`write-cards.ts` writes audio/image/file
cards only); native pending bubbles are correctly excluded because
`InteractiveChat.tsx:279` passes capture bubbles unconditionally in native-shell
mode; the EXIF deferral matches the open issue file, which exists. No
NOT-in-scope entry conceals a dependency the plan actually needs — with the
caveat that "background audio recording" being out of scope is what makes
Finding 4's mid-recording-death window narrow (backgrounding stops the
recording cleanly), which is worth stating as the rationale.

## Things I checked and found clean

- **Finalize idempotency and races** — CAS seal (`staging-store.ts:356-375`),
  same-response-on-already-sealed (`capture.ts:256-270`), in-process
  `inFlightIds` guard and commit serialization (`prepare.ts:93-111`), and the
  `delivering`-state at-most-once probe (`prepare.ts:270-284`). The plan's
  reliance on retrying finalize against the same ID is safe.
- **Per-session mutation locking and limits under the lock**
  (`staging-store.ts:173-221`, `staging-limits.ts:48-52`) — concurrent
  web+iOS appends to one session cannot drop entries or jointly overshoot caps.
- **Transcription of M4A** — all three real services map the `.m4a` extension
  to a content type (`deepgram.ts:159-160`, `voxtral-request.ts:42-43`,
  `transcription/index.ts:357`), so the Track 1 writer change doesn't strand
  AAC at the transcription boundary. (The Track 5 end-to-end fixture should
  still exercise it with the fake service keyed on an `.m4a` filename.)
- **tRPC `resumableSessions` removal blast radius** — exactly two usages
  (`useCaptureResume.ts:39`, `trpc/routers/capture.ts:37`) plus one doctest
  (`test/webapp/capture-resumable-sessions.doctest.md`); `pendingSessions` is
  a fully independent consumer chain (`useCaptureBubbles.ts`). The plan's
  remove-one-keep-the-other split is correct and cheap.
- **Count-based filename collision premise** — real
  (`useCaptureUploads.ts:91,112,139`); UUID filenames resolve it; the server's
  path guard (`staging-store.ts:113-120`) accepts them.
- **Sweep semantics** — `requireOpen` + `partial: true` seal
  (`staging-store.ts:352-360`), 60-minute abandonment window with awake-time
  scheduling (`capture.ts:40-95`, `sweep.doctest.md`). Track 5's "sweep may
  submit the acknowledged subset" is accurately described.
- **Delivery-target fallback for a vanished chat**
  (`prepare.ts:174-177`, `deliver-message.doctest.md`: staging target →
  most-active → fresh session) — supports the plan's "visible chat disappears"
  row.
- **Visible-session plumbing on iOS** — the `WKUserScript`/message-handler
  bridge in `ChatWebView.swift` plus `RootView.swift:15-24` genuinely provides
  a current visible session for the capture snapshot; the visible box cannot
  change independently of `store.selectedBox`.
- **Permission strings** — camera, microphone, and speech entries already exist
  in `Info.plist`; `PhotosPicker` needs none. No new usage-description work is
  hidden in the plan.
- **Empty-session finalize** — server-side, a sealed empty session is silently
  cleaned up (`prepare.ts:161-164`), which backs the plan's client-side rule of
  never offering "Submit uploaded items" at zero acknowledged media.
- **Web resume UX vocabulary** — Resume / Submit now / Discard confirmed
  verbatim in `CaptureResumeDialog.tsx:41-53`; the plan's native sheet matches.
- **Knowledge-audits skip** — correct: the audio-format discriminant and the
  native queue are client/developer infrastructure; no box-agent-facing concept
  is introduced, and the skip is stated with rationale as the skill requires.

## Re-review of revision c2b3fc67 (2026-07-17)

The plan was revised on `main` ("Incorporate iOS capture plan review") and now
resolves every finding above:

- **Finding 1** — Track 1 now registers an exact `application/octet-stream`
  parser (`parseAs: "buffer"`), adds a raw-body route doctest that includes
  `request.file()` behavior on a non-multipart request, advertises
  `capabilities.acceptedUploadEncodings: ["raw-body-v1"]`, and gates *all*
  native capture (not just Record) on both capabilities against an old server —
  the previously false "photos/files remain available" row is corrected.
- **Finding 2** — pairing now persists `createdBy` on the `MobileDevice`
  record, a unified request-owner helper resolves cookie and bearer to one
  identity, and legacy ownerless devices get a fail-closed 403 (capture only)
  on auth-enabled boxes with a re-pair path; rollout notes the one-time
  re-pairing. Strict and explicit — the right call.
- **Finding 3** — upload/finalize 404 is a terminal recovery class with honest
  "submitted or cancelled" copy, a resumable-response-wins precedence rule, and
  its own failure row + XCTest table entries.
- **Finding 4** — `CaptureItemState` gains `recording`; the row persists before
  `AVAudioRecorder` starts and only Stop promotes it to `local`; relaunch
  treats a stale `recording` row as damaged (visible, excluded from upload,
  never silently deleted), with a failure row and prior-art citation.
- **Findings 5-8** — Track 1's first chunk and the implementation order now
  include the parser + identity work; the JPEG/PNG-with-matching-extension
  photo contract is a vocabulary lock-in; the 50 MiB per-request cap is named
  as the operative limit with client preflight and a recorder size stop; and
  the single fixed background-session identifier is locked in, with orphaned
  `uploading` rows returning to `local`.

One implementation-time watch item, already covered by the planned doctest:
`readUploadBuffer` (`capture.ts:113-119`) calls `request.file()` *before*
checking for a raw `Buffer`; if `@fastify/multipart` throws on a non-multipart
request rather than returning undefined, that call order must change (guard
with `request.isMultipart()` or check the Buffer first). The doctest the plan
now mandates will surface this on the first run.

**Revised verdict: ready to implement.** The revision's new citations were
spot-checked and are accurate; no new problems were introduced.

## Readiness (original review)

Not ready to implement as written. Findings 1 and 2 each invalidate a
"reuse, already exists" claim that Track 1/Track 5 build on, and both require
plan-level decisions (upload encoding + old-server gating; bearer identity),
not just extra code. Findings 3 and 4 are missing failure-mode rows in the
plan's own load-bearing section. Once those four are folded into the plan —
none of them changes the architecture, tracks, or ordering in any structural
way — the remainder (5-8) are one-sentence amendments, and the plan is in
genuinely good shape: the reuse posture is real, the state-machine and
persistence design is right-sized, and the implementation order is realistic.
