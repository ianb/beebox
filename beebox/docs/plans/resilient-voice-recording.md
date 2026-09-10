---
title: "Resilient voice recording and HQ transcription"
status: draft
workstream: hq-recording-resilience
issues:
  - ../../../issues/bugs/2026-09-10-live-transcription-failure-loses-the-hq-pass.md
  - ../../../issues/bugs/2026-09-09-hq-transcription-fails-silently.md
---
# Resilient voice recording and HQ transcription

A chat voice recording today lives inside the live-transcription socket's
machinery and reaches the HQ transcriber as one upload attempt at the end. This
plan makes the recording the durable artifact: it keeps recording when the live
socket dies, it reaches the box in small pieces while it records, and the box
runs the HQ pass as a job that retries. The realtime transcript becomes a
preview and a last-resort fallback, never a silent substitute.

- When I record a conversation with two other people and the network drops
  for a minute, I want the recording to continue without me noticing, so the
  conversation is not lost and I do not ask everyone to repeat themselves.
- When the box restarts for a deploy while I dictate, I want my words to
  arrive with HQ quality once it is back, so a restart costs me a delay, not
  the good transcript.
- When the HQ transcriber is down or rejects my audio, I want to see that and
  get the HQ text later when it works, so I know which text the agent is
  reading and I can trust the transcript I keep.
- When I finish a long recording on my phone and lock the screen, I want the
  audio to reach the box anyway, so a closed tab or an app suspension does not
  throw away the recording. The box keeps it; sending the message still
  needs the tab.

**Issues addressed:**

- `issues/bugs/2026-09-10-live-transcription-failure-loses-the-hq-pass.md` —
  resolved by all tracks.
- `issues/bugs/2026-09-09-hq-transcription-fails-silently.md` — **partially**:
  item 1 ("Report a permanent HQ failure, visibly and once") is resolved by
  Track 4. Items 2 and 3 (disable unusable services in the picker; refuse to
  save an unusable setting) are not in scope. `/finish` must amend that issue
  with a note, **not close it**.
- Related, not addressed: `issues/closed/bugs/2026-09-09-deploy-restart-502-surfaces-as-json-parse-error.md`
  (its query retry is reused, Track 2);
  `issues/bugs/2026-08-03-capture-upload-error-retry-affordance-weak.md` (web
  capture keeps its manual retry; see NOT in scope);
  `issues/exploration/2026-09-06-openrouter-diarizing-stt-backend.md` (the MAI
  backend whose limits this plan works within).

## The incident this plan answers

On 2026-09-10 a boxholder recorded a diarized conversation in the web chat
(HQ service `mai-diarized`, realtime service `voxtral`). The evidence, from the
box's `client-debug.log` and `hub-child.log` and the chat transcript
(structural facts only):

- 18:45:31 — a 921-word diarized message arrived with `stt="hq"`. A live
  socket drop at 18:40 had reconnected.
- 18:55:03 — a deploy sent SIGTERM to the hub. 18:56:06 — the hub served
  again. The `voxtral` live socket is proxied through the box server
  (`chat-audio-routes.ts:202-203`, `GET /api/chat/transcribe-ws`), so the
  restart killed it. The client logged failed reconnect attempts 3–5.
- 18:56:20 — the HQ pass ran and the server logged
  `HQ transcription failed: Request failed with status code 400 Bad Request:
  POST https://openrouter.ai/api/v1/audio/transcriptions`. The client logged
  `[hq-transcribe] unavailable — falling back to realtime`.
- 18:56:31 — the message arrived as 1288 words of realtime text with no
  `stt` attribute. The segment ran about 11 minutes: about 21 MB of 16 kHz
  WAV, about 28 MB after base64.

The HQ pass did not fail because of the live socket. It ran and the provider
rejected it. The upstream reason is lost: our error carries only the status
line. The likely cause is size. The OpenRouter STT guide says a 16 kHz mono WAV
fits its 25 MB multipart cap for "about 13 minutes", and base64 adds ~33%
(see Prior art). This is **unverified**: no provider page confirms which limit
the JSON path enforces.

Separately, on 2026-09-08 the iOS app logged `transcribe-audio transport failed
bytes=27134031 urlError=-1001: The request timed out.` That is the same failure
class (one large upload at the end) on the native path.

## Stated preferences this plan trades against

- `docs/engineering-principles.md`:
  - **#4** (resilient AND never silent). The main driver: the fallback to realtime
    text is allowed, but only visibly. Retries are bounded and end in a visible
    terminal state (monorepo memory: nothing retries forever).
  - **#5** (failure paths in signatures). The HQ job's failure classification is
    a discriminated union the job branches on.
  - **#8** (one way). Voice staging reuses capture's staging store, upload route,
    resume scan and delivery path instead of adding a second upload story. One
    backoff helper serves the frontend actor and the server job.
  - **#9** (formal structure). The server-side voice recording has an explicit
    state union and a pure transition function. The realtime machine gains one
    named state.
  - **#10** (testability). Piece planning, error classification and state
    transitions are pure functions reached by doctests.
  - **#12** (the maintainer is an agent). Sealing a recording is carried by the
    type of the segment-end event, so no consumer can forget it.
  - **#13** (a control shows the real state). "Recording locally", "HQ pending"
    and "HQ failed" are all shown.
  - **#2** (exhaustiveness). The new staging kind fails compilation at every
    kind switch.
- `beebox/CLAUDE.md`: "HTTP endpoints go in tRPC by default … Raw Fastify
  routes … are only for … file upload/download". Chunk upload stays on the raw
  capture route; status, claim and fall-back are tRPC. "Time discipline … Long-running timeouts must count only awake time via
  `startAwakeTimeout`".
- `beebox/code-style.md`: "`Promise.allSettled` is the default", "Every
  non-rethrowing catch logs", `assertNever` terminators.
- Most recent shipped precedents:
  - `docs/implemented-plans/capture-mode.md`: server-side staging, crash-resumable
    preparation, at-most-once delivery.
  - `docs/implemented-plans/retranscription-in-chat.md`: `message-id` identity on
    `<speech>`, and correcting a message's text after it was sent.
  - `docs/implemented-plans/hq-dictation-switch.md`: `stt="hq"` provenance.
- Monorepo memory: "Nothing retries forever" (bound retries in time, then go
  to a visible terminal state). "Minimize invented concepts; prefer primitives"
  (a new attribute on `<speech>` rather than a new tag). "Consolidate over
  blast-radius fear".

## What already exists

**The recording lives in the live-socket actor.**
- `transcription-actor.ts:175` keeps `private readonly audioChunks:
  ArrayBuffer[] = []`: every 300 ms PCM frame of the segment, in memory.
- `takeAudioBlob()` (`:181-186`) turns it into a WAV only when the segment ends.
- `start()` calls `trpcClient.transcription.config.query()` (`:358`) *before*
  it acquires the mic (`:383`), so a box that is down at segment start records
  nothing.
- If no socket opens, `:418-421` emits `WS_ERROR` and `cleanup()`, which drops
  the captured audio.

**Segment ends that discard the audio.** In `realtimeTranscriptionMachine.ts`:
- `CONNECT_TIMEOUT` (`:232-241`) goes to idle.
- `RECONNECT_WINDOW: 8000` (`:169`): on expiry, `reconnecting` goes to
  `finalizing` (`:326-335`).
- `MAX_DURATION: 15 * 60 * 1000` (`:165`).
- `SILENCE_TIMEOUT` (`:272-279`).
- An error that bubbles to the `active` level (`:215-223`) goes to idle
  without a final event.

Every end other than a send reaches `onUnconsumedTranscript(transcript)`
(`useRealtimeTranscription.ts:378-386`) with **text only**. The chat folds that
text into the composer (`InteractiveChat-voice.ts:187-197`), and the blob stays
in machine context until the next `START` clears it (`:83`
`clearTranscript`).

**The HQ call is one attempt made while the send waits.**
`voice-keyword-send.ts:107-129` runs `prepareVoiceSubmitEmission(... transcribe:
(blob) => postAudioForHqTranscription(blob, { sessionId }))`.
`postAudioForHqTranscription` (`api-chat.ts:171-174`) returns `null` on any
non-OK response. `prepareVoiceSubmitEmission` (`voice-intent.ts:131-136`)
swallows a rejection: "The realtime transcript below is the durable failure
fallback." The composer's `hq` region (`composerMachine.ts:205-211`) has
`idle`/`inFlight` and no timeout.

**Server HQ route.**
- `POST /api/chat/transcribe-audio` (`chat-audio-routes.ts:93-128`) calls
  `transcribeAudioHq` once.
- It relabels diarized speakers with a letter taken from the session log tail
  (`:117-121`).
- The OpenRouter arm (`transcription/openrouter.ts:140-156`) sends JSON with
  base64 audio. Its header says (`:32-34`): "the multipart one caps at 25 MB
  where the JSON one does not — a recording long enough to hit that is the
  ordinary case here, so JSON it is." The incident contradicts the premise
  (unverified).
- Its error is ky's default `HTTPError` message, without the response body.

**Capture staging — reuse.** Capture mode already has the durable server half:
- *Sessions.* `<boxRoot>/_tmp/capture-staging/<uuid>/` with a `session.json`
  manifest; `_tmp` survives restarts.
- *Kinds.* `StagingSessionKindSchema = z.enum(["capture", "bulk"])`
  (`staging-schema.ts:70`). `isCaptureSession`/`isBulkSession` switch with
  `assertNever` (`:156-179`), so a new kind forces every dispatch site to
  decide.
- *Upload.* Raw `application/octet-stream` with `X-Capture-*` headers
  (`capture-upload.ts`). Replay is idempotent by filename + bytes
  (`upload-replay.ts:12-32`). Formats are per-segment (`staging-store.ts:227-241`).
- *Limits.* `MAX_STAGED_BYTES = 1 GiB`, `MAX_STAGED_ITEMS = 500`
  (`staging-limits.ts:13-14`).
- *Resume.* The startup scan (`resume.ts`, `resumeStagingSessions`) skips
  non-capture sessions: "Capture-only resume: bulk-upload sessions resume
  through their own path".
- *Sweep.* The abandonment sweep filters `isCaptureSession`
  (`sweep.ts:92`), so it will not touch voice sessions.
- *Delivery.* `deliverUserMessage` (`core/chat/session/deliver-user-message.ts`)
  is "The generic resolve→emit `chat-user-message`→busy?enqueue:send core
  shared by capture delivery … and bulk-upload delivery". The at-most-once
  probe `userMessageAlreadyLanded` matches a unique `docPath` substring in the
  transcript (`:55-70`). A busy session gets an in-memory enqueue
  (`:182-186`), which capture counts as delivered.

Reuse all of it. What capture lacks for this job (research findings):
- the web client queue is in-memory with manual Retry only
  (`useCaptureUploads.ts:223-233`)
- transcription uses `transcribeAudio`, not the HQ service, and never diarizes
  (`transcribe-clips.ts:106-111`)
- recordings are webm/opus, which MAI does not accept (Prior art)

**Pending sends — reuse.** `pending-sends.ts:22` already defines `prepare`:
"Durable realtime snapshot before HQ replaces its text under the same ID". The
store lives in `sessionStorage`. On reload a `preparing` row becomes `recovered`
with "Delivery was interrupted. Review before retrying." (`:84-86`). Extend it
to resume the HQ wait instead.

**Wrapper vocabulary — extend.** `chat-assemble.ts:106-127` stamps
`stt="hq"`, `stt-service`, `diarized="1"` and `message-id` on `<speech>`. The
agent learns them from the chat prompt (`core/chat/session/prompts.ts:54,58`):
"skip it when the wrapper says stt="hq""; "the letter changes per recording —
so `1A` and `1B` **cannot be assumed to be the same person**".

**Retry idioms — consolidate.**
- `lib/trpc/transient.ts` classifies unreachable-box failures
  (`BoxUnreachableError`, 502/503/504, fetch `TypeError`).
- Its fixed schedule `RETRY_DELAYS_MS = [1_000, … 30_000]` spans ~91 s, and it
  retries queries only: "a mutation that hit a 502 *probably* never reached
  the app — not a basis for replaying a send."
- `machines/transcription-backoff.ts` has `jitteredBackoff(attempt, { baseMs,
  capMs })` (full jitter) for the live-socket actor.
- `shared/awake-timeout.ts` `startAwakeTimeout` is sleep-immune and lives in
  `shared/`, so the frontend can use it.

**Mic graph.** `MicCapture.reacquire()` (`transcription-mic.ts:153-170`) swaps a
new `MediaStreamAudioSourceNode` into the *same* `AudioContext` and worklet. The
worklet emits 16 kHz mono frames of 300 ms (`pcm-processor.worklet.js`:
`TARGET_SAMPLE_RATE = 16000`, `CHUNK_DURATION_MS = 300`). The PCM stream is
therefore continuous across mic recoveries, and it is the one audio pipeline
both the live socket and staging can read.

**Retention.** The web tab holds recordings for `bbx chat get-last-audio` in
memory only, capacity 5 (`lib/audio/last-audio.ts:42-43`, and `:10-12`
"Recordings live only in this tab's memory (gone on reload)"). The iOS
counterpart `VoiceAudioRetentionStore` persists to disk, capacity 5.

**iOS.**
- `ChatAPI.transcribeAudio` (`ios-app/BeeBox/Services/ChatAPI.swift:109-157`)
  posts one WAV over `URLSession.shared`.
- `NativeComposerView`'s voice preparation catches any failure once and falls
  back with "HQ transcription failed; sending live dictation."
- Native capture already has a background `URLSession` upload queue with
  persistence and retry classification (`CaptureAPI.swift`,
  `CaptureUploadCoordinator.swift`). The voice track reuses it.

**Searched, found nothing:**
- No IndexedDB use anywhere in `beebox/src/frontend/src` (grep `indexedDB`,
  `idb`). The client queue introduces it.
- No existing server-side retry job for transcription.
- No `ffmpeg` in `package.json`. Prod has `/usr/bin/ffmpeg` 6.1.1, but this
  plan does not depend on it.

## Prior art (external)

- **OpenRouter STT limits.** From <https://openrouter.ai/docs/guides/overview/multimodal/stt>:
  - "Multipart uploads are limited to 25 MB".
  - Base64 "increases payload size by ~33%" and can yield 413.
  - 16 kHz mono WAV fits "about 13 minutes".
  - "upstream providers time out after 60 seconds per request … should be
    split".
  - Accepted formats include wav, mp3, flac, m4a, ogg, webm, aac.
  - Verified.
- **MAI-Transcribe-2.** From <https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe>:
  - Input "WAV, MP3, or FLAC".
  - Diarized requests "fail for recordings of about 15 minutes and longer,
    returning HTTP 408 with a `Timeout` error, HTTP 500, or HTTP 503 with a
    `diarization_unavailable` error".
  - Verified. It sets this plan's piece length and its "piece too long"
    classification.
- **MediaRecorder chunks are not independently decodable.** Only the first
  timesliced chunk carries the container header
  (<https://github.com/chrisguttandin/extendable-media-recorder/issues/638>).
  Verified. This is why capture concatenates within a segment, and one reason
  this plan stages raw PCM instead.
- **Safari MediaRecorder** produced only MP4/AAC through Safari 18.3; WebM/Opus
  arrived in 18.4 (WebKit blog, MDN). A compressed web path would need two
  formats. Another reason to stage PCM.
- **IndexedDB on iOS/WKWebView.** Storage quota is a fraction of disk, and
  Safari evicts an origin's data after seven days without interaction
  (<https://webkit.org/blog/14403/updates-to-storage-policy/>). The client
  queue therefore holds only unsent audio, briefly, and never serves as the
  archive.
- **Long-form diarization.** The standard technique is chunk-then-cluster:
  per-chunk diarization plus speaker-embedding clustering across chunks
  (arXiv 2509.26177). No off-the-shelf tool for our stack was found.
  Cross-piece speaker reconciliation is NOT in scope.
- **Resumable uploads (tus).** tus is the named pattern for offset-resumable
  upload. Our per-chunk idempotent replay (`upload-replay.ts`) covers the same
  need at chunk granularity, so we do not adopt tus. No public architecture
  from Otter, Granola or Fireflies was found.

## Tracks / scope

Order: server (unblocks everything), client queue, recorder, submit flow,
audio lookup, iOS.

### Track 1 — Server: voice recordings and the HQ job

**What.** A voice recording is a staging session of a new kind, `voice`. It
holds raw PCM chunks, is sealed at segment end, and, when HQ is requested, a
server job transcribes it in pieces with retries. The result is either
claimed by the client or delivered late by the server as a correction message.

**Why this needs to change.** Today the audio exists only in the tab until one
upload succeeds. The server holds nothing to retry with, and a restart or one
provider error ends the attempt.

**Direction.**

- Staging schema:
  - `StagingSessionKindSchema = z.enum(["capture", "bulk", "voice"])`.
  - Add `isVoiceSession`, and make the three predicate switches exhaustive.
  - A voice manifest adds a `voice` object:
    ```ts
    voice: {
      targetSessionId: string;           // chat session the recording belongs to
      startedAt: string;                 // ISO, client clock
      hq: VoiceHqState;                  // see union below
      handoff: VoiceHandoff;
      sealedAt?: string;
    }
    type VoiceHqState =
      | { state: "none" }                                   // HQ not requested (yet)
      | { state: "queued"; requestedAt: string; service: HqTranscriptionService }
      | { state: "transcribing"; piece: number; pieces: number; attempt: number }
      | { state: "retrying"; attempt: number; nextAttemptAt: string; failure: HqFailure; pieceSeconds: number }
      | { state: "ready"; result: VoiceHqResult }
      | { state: "failed"; failure: HqFailure };            // terminal
    type VoiceHandoff =
      | { mode: "open" }
      | { mode: "claimed"; emissionId: string }             // client sent HQ text itself
      | { mode: "late"; emissionId: string }                // client sent realtime; server delivers HQ
      | { mode: "delivered"; emissionId: string; messageId: string };
    interface HqFailure { kind: "transient" | "permanent" | "exhausted"; code: string;
      message: string; upstreamStatus?: number; upstreamBody?: string /* ≤500 chars */ }
    interface VoiceHqResult { text: string; diarized: boolean; service: string; pieces: number }
    ```
- Session create:
  - `POST /api/capture/sessions` accepts an optional client-generated `id`
    (UUID v4) with `kind: "voice"` and `targetSessionId`.
  - Creation is idempotent. The same id, kind and owner return the existing
    session with 200. A different owner or kind returns 409.
  - The client needs this to start recording while the box is unreachable.
- Upload: the existing raw route with `X-Capture-Kind: audio` and
  `X-Capture-Audio-Format: pcm-s16le-16k`, a single segment whose id is the
  recording id, chunk filenames `pcm-000001.raw` in sequence. The format enum
  gains `pcm-s16le-16k`.
- Seal: `POST /api/capture/sessions/:id/finalize` dispatches by kind.
  - A voice seal carries `{ chunkCount, hq: null | { emissionId, sessionId } }`,
    and finalize is idempotent: a repeat returns the current state.
  - **Finalize verifies contiguity.** Uploads are refused once a session is
    not `open` (`capture-upload.ts:51-55`), so a chunk that arrives after the
    seal is lost for good. Finalize therefore checks that the manifest holds
    exactly `pcm-000001 … pcm-<chunkCount>`. On a gap it answers 409
    `missing-chunks` and does not seal.
  - The client queue is strictly ordered, so a gap means an evicted or lost
    op. The client treats it as terminal: the recording fails visibly as
    "audio incomplete", and the send falls back with `hq="failed"`.
  - `chunkCount` is a request parameter, not new manifest state.
  - With `hq` set, the state becomes `queued` and `handoff` records the
    emission id as `open`. The HQ service is resolved once at request time and
    recorded.
- `src/core/voice-recording/` (new):
  - `pieces.ts` (pure):
    - `planPieces(totalBytes, pieceSeconds)` returns byte ranges on sample
      boundaries.
    - `wavHeader(byteLength)` builds the header.
    - The header builder moves to `src/shared/wav.ts` and is used by both this
      module and the frontend `wav-encode.ts` (#8).
  - `classify.ts` (pure): `classifyHqError(error): "transient" | "permanent" |
    "piece-too-long"`.
    - transient: network errors and timeouts, 5xx except 501, 429.
    - piece-too-long: 408, 413, MAI 503 `diarization_unavailable`.
    - permanent: 401, 403, `MissingOpenRouterKeyError`, any other 4xx.
  - `state.ts` (pure): `nextVoiceState(session.voice, event)` over events
    `requested | pieceStarted | pieceFailed | allPiecesDone | claimRequested |
    fallBackRequested | lateDelivered | expired`. Unit-checked, including the
    claim/fall-back race.
  - `hq-job.ts`: the IO shell.
    - It concatenates chunks, cuts pieces of at most `pieceSeconds` (default
      **600**, the MAI diarization ceiling "about 15 minutes" minus margin),
      wraps each in a WAV header, and calls `transcribeAudioHq` piece by piece
      in order.
    - On a transient failure it backs off with the shared `jitteredBackoff`
      (moved to `src/shared/backoff.ts`; base 5 s, cap 5 min) until
      **24 hours** after `requestedAt`, then `failed/exhausted`.
    - On piece-too-long it halves `pieceSeconds` and restarts from piece 1,
      down to a floor of **150 s**, then `failed/permanent`.
    - On permanent it goes straight to `failed`.
    - Diarized pieces are joined in order (boxholder decision 2). Each piece
      is relabeled with the next letter from `nextSpeakerLetter`: piece 1
      gets the letter after the session's last one, piece 2 the one after
      that. A line `— part N of M —` precedes each piece when M > 1.
      Today's guidance (`prompts.ts:58`) ties a letter to a *recording*;
      Track 4 extends it to parts.
    - It emits `voice-recording-status` on the event bus after every
      transition.
  - `deliver-late.ts`: when `handoff.mode === "late"` and the result is ready,
    deliver `<speech stt="hq" stt-service="…" [diarized="1"] message-id="<recordingId>"
    corrects="<emissionId>">…</speech>` to `targetSessionId`.
    - It calls the existing shared `deliverUserMessage`
      (`core/chat/session/deliver-user-message.ts`, already used by capture and
      bulk upload) directly. Nothing is extracted.
    - **A busy session is not "delivered".** `deliverUserMessage` enqueues in
      memory when the agent is busy and returns `{ queued: true }` (`:182-186`).
      Capture accepts losing that on a crash (`prepare.ts`: "the queue is
      in-memory only, so a crash before drain loses the notification
      (accepted …)"). A correction may not be lost.
    - So the handoff moves `late → delivering` before the call, and to
      `delivered` only when the landed probe finds the message in the
      transcript. The probe runs on startup resume and on each voice-sweep
      tick; if the message has not landed and the session is idle, it
      re-delivers.
    - The landed probe: `userMessageAlreadyLanded` today takes a `docPath`
      and matches it as a bare substring (`:55-70`). Its parameter is
      generalized to `marker: string`, and capture/bulk pass their `docPath`
      unchanged. Voice passes the recording id, a UUID that appears in the
      transcript only in the correction's `message-id`.
- Resume: `resumeStagingSessions` switches on kind. Voice sessions in
  `queued | transcribing | retrying` resume the job. Voice sessions with a
  ready result and `handoff.mode === "late"` resume late delivery.
- GC: a voice sweep deletes voice sessions 7 days after they reach a terminal
  handoff (`claimed`/`delivered`/terminal `failed`) or 7 days after creation
  if never sealed. It runs on the same awake-timeout cadence as the capture
  sweep.
- tRPC router `voiceRecording`:
  - `status({ recordingId })` query.
  - `statusByMessage({ messageId })` query, for a fallback bubble's badge.
    It maps `handoff.emissionId`.
  - `claim({ recordingId, emissionId })` mutation: CAS `open → claimed`.
    Returns the result, or the current state if not ready.
  - `fallBack({ recordingId, emissionId })` mutation: CAS `open → late`. If
    the result is already `ready`, it returns the result instead and marks
    `claimed`, so the client sends HQ text after all.
  - Both mutations are idempotent by `(recordingId, emissionId)`.
- Upstream detail:
  - The OpenRouter arm reads the error response body into a typed
    `TranscriptionError` with `upstreamStatus` and a 500-char `upstreamBody`.
  - It switches from JSON/base64 to multipart, the documented 25 MB path. A
    600 s piece is 19.2 MB of WAV, under the documented cap. As JSON it would
    be ~25.6 MB, over the size that just failed.
  - The header comment `:32-34` is rewritten with the incident as evidence.
- `POST /api/chat/transcribe-audio` is unchanged. iOS builds in the field
  still call it until Track 6 ships (see Rollout).

**Vocabulary lock-ins.** Staging kind `voice`; audio format `pcm-s16le-16k`;
`VoiceHqState` / `VoiceHandoff` / `HqFailure` shapes above; tRPC
`voiceRecording.{status,statusByMessage,claim,fallBack}`; bus event
`voice-recording-status { recordingId, sessionId, hq, handoff }`; `<speech
corrects="<message-id>">`; constants `HQ_PIECE_SECONDS = 600`,
`HQ_PIECE_FLOOR_SECONDS = 150`, `HQ_RETRY_BOUND_MS = 24h`,
`VOICE_STAGING_RETENTION_MS = 7d`.

**First implementation chunk.** Add kind `voice`, the `voice` manifest object
with `hq: none`/`handoff: open`, idempotent client-id create, the
`pcm-s16le-16k` format, and the exhaustive predicate switches. Route doctests
cover: create twice returns the same session; a different owner gets 409; a
PCM chunk replays idempotently; the capture sweep and resume skip voice
sessions. No open questions.

### Track 2 — Client: a durable upload queue for voice staging

**What.** A module-level queue that persists staging operations for voice
recordings in IndexedDB and drains them to the box with bounded retries. Its
*uploads* outlive the transcription actor, a reload and a closed tab. The
*send* handoff does not: the pending row lives in per-tab `sessionStorage`. By
boxholder decision (Open design questions, decision 1), a message whose tab
is closed is never sent. Its recording stays on the box for 7 days.

**Why this needs to change.** Capture's web queue is in-memory with manual
retry (`useCaptureUploads.ts:223-233`). A voice recording made during a deploy
would lose every chunk that failed during the restart.

**Direction.**

- `src/frontend/src/lib/audio/voice-staging-queue.ts`:
  - IndexedDB database `beebox-voice-staging`, one object store `ops` keyed by
    `[apiBase, recordingId, seq]`.
  - Op kinds: `create { targetSessionId }`, `chunk { bytes: ArrayBuffer }`,
    `finalize { hq: null | { emissionId, sessionId } }`, `discard`.
  - `apiBase` scopes ops per box, since path-prefixed boxes share one origin.
- The drainer:
  - Within a recording, ops go strictly in `seq` order. One recording drains
    at a time; this bounds bandwidth on a phone.
  - It starts on module load and on every enqueue, and uploads with the
    existing `uploadBinary` (`binary-upload.ts`, stall deadline rather than a
    wall timeout).
  - Two tabs of the same origin may both drain. That is safe because every op
    is idempotent server-side (filename+bytes replay; idempotent create and
    finalize). Nothing extra single-flights it.
- Retry:
  - Classification reuses `transient.ts`'s unreachable test, exported as
    `isBoxUnreachable(error)`, and adds `UploadStalledError`/`UploadNetworkError`.
  - A transient failure waits `retryDelayMs(attempt)` for the first 7 retries,
    then a steady 30 s, until the op is **7 days** old. The op then fails
    terminally.
  - A 4xx fails the recording terminally (409 conflict, 413 limit, 403).
  - Terminal failures are reported through a `voiceStagingFailures` store.
    The voice chip shows it (Track 4).
- Chunk cadence: the stager enqueues one `chunk` every **15 s** of audio
  (480 KB). A 60-minute recording is 240 items, under `MAX_STAGED_ITEMS =
  500`.
- `transient.ts` gains opt-in idempotent mutation retry. The retry link
  already receives the whole operation (`lib/trpc/index.ts`: `retry: ({ op,
  attempts, error }) => shouldRetryOperation({ type: op.type, attempts, error
  })`).
  - It passes `idempotent: op.context["idempotent"] === true`, and
    `shouldRetryOperation` retries a mutation only when that is set.
  - Callers opt in per call:
    `trpcClient.voiceRecording.claim.mutate(input, { context: { idempotent:
    true } })`. Server-side procedure `meta` is not visible to client links,
    so the flag must travel on the call.
  - This extends the idiom rather than adding a second one (#8). The comment
    at `shouldRetryOperation` changes to say why an idempotent mutation is a
    safe replay.

**Vocabulary lock-ins.** `voice-staging-queue` op kinds above;
`VOICE_UPLOAD_BATCH_SECONDS = 15`; `VOICE_QUEUE_BOUND_MS = 7d`; tRPC operation
context `idempotent: true`.

**First implementation chunk.** A pure drainer core,
`nextDrainStep(ops, now, lastOutcome)`, returns the next op to send or the
wait. Doctest it over: ordered ops; a transient 502 then success; the
steady-state delay after the table runs out; a terminal 409; the 7-day expiry.
Then the IndexedDB shell. No open questions.

### Track 3 — The recording outlives the live socket

**What.** The segment's audio is staged from the first PCM frame, whether or
not a live socket exists. The machine gains a `recordingLocal` state.
Network-caused ends stop ending the segment.

**Why this needs to change.** A socket that cannot open ends the segment
(`CONNECT_TIMEOUT` → idle). A socket that stays down for 8 s ends it
(`RECONNECT_WINDOW`). Both discard or strand the audio. A deploy restart
(~63 s in the incident) always exceeds 8 s.

**Direction.**

- `TranscriptionSession.start()` changes order:
  1. `crypto.randomUUID()` → `recordingId`.
  2. Enqueue `create` (does not wait for the box).
  3. `mic.start()`, then emit `MIC_LIVE`.
  4. Fetch the transcription config (the query retries as today; the
     last-known config is cached in `localStorage` so a restart does not block
     the live service choice).
  5. Open the socket.
  If step 4 or 5 fails, recording continues locally.
- A `VoiceStager` (`lib/audio/voice-stager.ts`):
  - It receives every PCM frame via `onPcm`, batches 15 s, and enqueues
    `chunk` ops.
  - `audioChunks` becomes a ring buffer of the last **30 s**
    (`REPLAY_CAP_CHUNKS = 100`), used only to replay onto a reconnected socket.
  - `takeAudioBlob` and the whole-segment WAV go away.
- Segment end hands off a sealing obligation, not a blob:
  - `TRANSCRIPTION_DONE` carries `recording: PendingRecording` instead of
    `audioBlob`.
  - `PendingRecording` is `{ recordingId, seal(hq: null | { emissionId,
    sessionId }): void, discard(): void }`, and each method is idempotent.
  - The hook's unconsumed-transcript effect seals with `hq: null`, and
    `CANCEL`/erase call `discard`. A consumer that receives the event cannot
    ignore the obligation without the type showing it unused (#12).
  - Any recording still unsealed when the hook unmounts is sealed with
    `hq: null`.
- Machine (`realtimeTranscriptionMachine.ts`):
  - `connecting` exits to `recordingLocal` on `MIC_LIVE`, and `recordingLocal`
    goes to `recording` on `WS_CONNECTED`.
  - `recordingLocal` handles `STOP` → `finalizing`, `CANCEL` → idle, and
    `CONNECTION_RESTORED` → `recording`. It has no `SILENCE_TIMEOUT`: no live
    text arrives to reset it.
  - `reconnecting`'s `RECONNECT_WINDOW` expiry goes to `recordingLocal` when
    `dropCause === "network"`, and stays `finalizing` for `"microphone"`
    (no audio is flowing).
  - A non-retryable close (`1003`/`1008`) in `recording` goes to
    `recordingLocal` and stops the reconnect loop.
  - The actor's reconnect loop runs until `stop`/`cleanup`, with backoff
    capped at 30 s.
  - Replay on reconnect sends at most the ring buffer. The live transcript
    gets a gap, which HQ covers.
- The recording-start earcon plays on `MIC_LIVE`, not on socket open. The
  recording is truly live at that point (#13).
- **The hook, not only the machine.** `useRealtimeTranscription` special-cases
  segment states by name:
  - the state mapping (`:297-306`)
  - keyword spotting (`:145`, `:153`)
  - the earcon effect (`:398`)
  - `stop()` (`:422`)
  - `submitSegment` (`:460`)
  - the mic-tab-lock eviction (`:483`)
  - `isTranscribing` in `InteractiveChat-voice.ts:202-206`
  Every one of these checks moves to one exported predicate,
  `segmentCapturing(state)`, which is true for `recording | reconnecting |
  recordingLocal`. `TranscriptionState` gains `"recordingLocal"`. The
  predicate and the state mapping get doctests. Keyword spotting stays gated on
  `recording`, since no live text exists in `recordingLocal`.
- The voice chip shows "Recording · live text paused" in `recordingLocal`, and
  says that spoken commands are unavailable. The manual send and stop buttons
  work.
- `MAX_DURATION` rises to **60 minutes**. Memory no longer grows with the
  segment. On expiry the segment is **submitted and the mic re-arms** (the
  same path as a spoken "send"), not folded into the composer. A conversation
  is sent in hour-long parts rather than stopping after 15 minutes.

**Vocabulary lock-ins.** Machine state `recordingLocal`; events `MIC_LIVE`,
`TRANSCRIPTION_DONE { text?, words?, recording }`; `PendingRecording`;
`REPLAY_CAP_CHUNKS = 100`; `MAX_DURATION = 60 min`.

**First implementation chunk.** Machine changes only, with the actor faked:
- the new state and transitions
- a doctest over each scenario: connect failure after mic-live; window expiry
  with network vs microphone cause; non-retryable close; STOP from
  `recordingLocal`

No open questions.

### Track 4 — Submit: wait for HQ, fall back visibly, correct late

**What.** A voice send with HQ on seals its recording with an HQ request, then
waits for the server's result within a bounded budget. The wait ends one of
three ways:
- The result arrives: send the HQ text.
- The budget runs out, or the user taps "Send live text now": send the realtime
  text marked `hq="pending"`. The server delivers the HQ text later as a
  `corrects` message.
- The failure is permanent: send the realtime text marked `hq="failed"` and
  show why.

**Why this needs to change.** The boxholder's preference (2026-09-10): "The
realtime recording of course is a good fallback if necessary. But in this case
I'd rather the audio be retried." Today one failure silently makes the realtime
text the kept text (`api-chat.ts:171-174`, `voice-intent.ts:131-136`).

**Direction.**

- `runKeywordSend` (`voice-keyword-send.ts`), when `runHq`:
  - `recording.seal({ emissionId: prepared.id, sessionId })`.
  - `composerSend({ type: "START_HQ", id, text })`.
  - `awaitHq({ recordingId, emissionId, budgetMs: HQ_WAIT_BUDGET_MS, onStatus })`
    in a new `lib/audio/await-hq.ts`.
- `awaitHq`:
  - It subscribes to `voice-recording-status` on the existing
    `events.subscribe` stream, and re-queries `voiceRecording.status` on every
    (re)subscribe, so a restart's missed events are recovered.
  - On `ready` → `claim` → HQ emission.
  - On budget expiry (`startAwakeTimeout`, **5 minutes**) or an
    `HQ_SEND_LIVE` event → `fallBack`. If `fallBack` answers with a result,
    use it.
  - On `failed` with `kind: "permanent"` → realtime with `hq="failed"`.
  - Returns `{ kind: "hq", result } | { kind: "fallback", reason: "budget" |
    "user" | HqFailure }`.
- `prepareVoiceSubmitEmission` takes that outcome in place of `transcribe`.
  Its swallow-all catch goes away.
- Emission fields:
  - Add `hqFallback?: "pending" | "failed"`, mutually exclusive with `hqText`.
    `createVoiceEmission` asserts the exclusion with `invariant`.
  - `chat-assemble.ts` stamps `hq="pending"` or `hq="failed"` on `<speech>`.
  - `pending-sends.ts`'s `emissionSchema` gains `hqFallback` (optional; legacy
    rows parse unchanged).
- Pending sends:
  - A `preparing` row gains `recordingId?`.
  - The store's rule stays: "No load path sends anything"
    (`pending-sends.ts:1-4`).
  - On reload, a `preparing` row with a `recordingId` becomes a visible
    pending-HQ item. It shows the server's status and never sends on its
    own (boxholder decision 1). It offers two actions:
    - "Send HQ transcript", enabled once the status is `ready`, calls
      `claim`.
    - "Send live text" calls `fallBack`, which returns the HQ result instead
      if it is ready.
    Both then dispatch through the normal path. Dismissing the item leaves
    the recording on the box for 7 days.
  - Rows without a `recordingId` keep today's `recovered` path.
- Ordering: voice dispatches are FIFO per conversation.
  - A module-level `voiceSendSequencer` chains each send's dispatch behind the
    previous voice send's dispatch-or-fallback.
  - HQ waits still run concurrently. Without this, segment 2's fast HQ would
    land before segment 1's retried one.
- Composer machine `hq` region:
  - `pendingHqText: string | null` becomes `pendingHq: Array<{ id, text,
    status }>`.
  - Events: `START_HQ { id, text }`, `HQ_STATUS { id, status }`,
    `HQ_DONE { id }`, and `HQ_SEND_LIVE { id }` (the user control).
- The pending bubble shows the status line: "Uploading audio…",
  "Transcribing part 2 of 3", "HQ retry in 40 s — provider timed out",
  "Box restarting — audio saved on this device". It also shows a "Send live
  text now" button.
- Permanent failure notice (subsumes item 1 of the silent-fails issue):
  - The voice chip shows a persistent notice with the failure's `message`,
    e.g. the existing `MissingOpenRouterKeyError` text. It shows once per
    `(service, code)` until dismissed.
  - The terminal-upload-failure store from Track 2 shows through the same
    notice.
- Rendering:
  - A `<speech hq="pending">` bubble gets a badge whose state comes from
    `voiceRecording.statusByMessage`: "Live text · HQ coming",
    "HQ failed: <message>", "HQ transcript below".
  - A `<speech corrects="X">` message renders as a compact user bubble,
    "HQ transcript of your message at 18:56", collapsed after 6 lines. It
    anchors to X's bubble.
  - Both reuse `AckBadgeCluster`.
- Agent guidance (`prompts.ts`, in the voice paragraph): one sentence each for:
  - `hq="pending"`: better text will follow as a `corrects` message, so don't
    run `retranscribe`.
  - `hq="failed"`: the realtime text is all there is.
  - `corrects="<id>"`: this is the authoritative text of message `<id>`. Revise
    what you understood only where it changes the meaning; do not answer the
    earlier message again.
  - `— part N of M —` in a diarized message: one long recording transcribed
    in parts. Each part has a fresh letter, and the same people may recur
    under a new letter, so `1A` and `1B` may or may not be one person.
    This extends the existing letter sentence at `prompts.ts:58`.

**Vocabulary lock-ins.** `hq="pending" | "failed"`, `corrects`;
`Emission.hqFallback`; `HQ_WAIT_BUDGET_MS = 5 min`; composer events above;
`awaitHq` outcome union.

**First implementation chunk.** The emission field, the invariant and the
`chat-assemble.ts` attributes, with doctests on the `voice-intent`/`chat-assemble`
fixtures for all four provenance shapes. Then `awaitHq` with a fake status
source (pure outcome decision extracted). No open questions.

### Track 5 — The server answers `get-last-audio` for staged recordings

**What.** `bbx chat get-last-audio` / `retranscribe --message <id>` first look
for a voice staging session whose `handoff.emissionId` (or recording id) is
`<id>`, and serve its audio as a WAV. The tab relay remains only for iOS native
recordings and old web tabs.

**Why this needs to change.** Today the audio for a message lives only in the
tab that sent it, capacity 5, gone on reload (`last-audio.ts:10-12,42-43`). The
recovery material the issue names depends on the tab staying open.

This track is also forced by Track 3, so it is not optional scope. Track 3
replaces the whole-segment in-memory PCM with a 30 s ring buffer, so no
whole-recording blob exists for `retainVoiceAudio` to hold. Keeping web
retention would mean keeping 115 MB/hour in memory, which is what Track 3
removes. Without Track 5, `get-last-audio` would break for web recordings.

**Direction.**
- The server's last-audio resolution first checks staging with the same
  message-id verification the relay uses.
- The web `retainVoiceAudio`/`markVoiceAudioAbsent` calls and the retention
  singleton are removed (#8: the server holds the recording). The native relay
  in `fulfillLastAudioRequest` stays.
- A recording whose chunks are still in a client queue answers
  `none: "still uploading"`.

**First implementation chunk.** Server lookup plus a filesystem doctest: a
staged recording is found by emission id and by recording id, and an unknown id
falls through to the relay. No open questions.

### Track 6 — iOS: native recordings use voice staging

**What.** The native composer stages its recording as `pcm-s16le-16k` chunks
through the capture background upload queue. It then waits, claims or falls
back exactly as the web does.

**Why this needs to change.** Native HQ is one `URLSession.shared` upload of a
full-format WAV (27 MB timed out on 2026-09-08). Its failure is caught once and
never retried.

**Direction.**
- `SpeechDictation` adds an `AVAudioConverter` tap output at 16 kHz s16 mono
  and writes 15 s chunk files beside the existing WAV.
- A **new native voice-staging model**, `VoiceStagingStore` +
  `VoiceStagingCoordinator`. It shares only the lower layers of capture: the
  background `URLSession` configuration (`CaptureAPI.swift`) and the
  retryable/terminal HTTP classification.
  - It does not reuse `CaptureStore`. That store validates audio as
    `.m4aAAC` only (`CaptureStore.swift:499-501`). `CaptureAudioFormat` has
    no PCM case (`CaptureModels.swift:61-64`). Filenames are fixed to `.m4a`
    (`CaptureModels.swift:229-231`). Retry stops at
    `maximumUploadAttempts = 4` (`CaptureStore.swift:15`).
  - Changing those semantics would alter native capture, which is out of
    scope.
  - The voice store's retry bound matches the web queue: 7 days, steady
    cadence after the backoff table.
  - It creates, uploads and finalizes with the same headers and bodies as the
    web, including `chunkCount`.
- `prepareVoiceMessage` replaces `ChatAPI.transcribeAudio` with a wait on
  `voiceRecording.status`, then claim or fall back. It carries the same
  budget, calls `voiceRecording.*` over HTTP, and stamps `hqFallback` into
  `NativeChatEmission`.
- `mobile-contract.md` gains a voice staging section. §5.2 is marked "legacy,
  kept for shipped builds". Shared fixtures under `test/mobile-contract/fixtures/`
  cover the voice create/finalize bodies and the emission's `hqFallback`.

**First implementation chunk.** The converter plus chunk writer, with an XCTest
over sample-accurate 15 s chunking of a synthetic buffer. No open questions.
The HTTP shape of the `voiceRecording` tRPC calls from Swift is settled in
Track 1 (tRPC over HTTP: GET query / POST mutation, the documented tRPC wire
format).

## Could this be simpler?

The simplest version that could work runs entirely in the client:
1. retry `postAudioForHqTranscription` with backoff
2. hand the blob of every segment end to HQ
3. cut long blobs into WAV pieces of ≤10 minutes in the browser
4. show failures

It fails on these cases:
- **A reload or a closed tab** loses the audio: memory only (#4, the job's
  "closed tab" situation).
- **A deploy longer than the retry budget** still ends in silent realtime text,
  unless the tab keeps retrying indefinitely with 20+ MB in memory.
- **A phone that sleeps the tab** stops both recording and retry.
- **It keeps two upload stories.** Capture already has server staging (#8).

The fuller plan buys a recording that survives every one of these, for the cost
of one server job and one client queue.

Choices made to stay small:
- **Raw PCM, not Opus.** Staging the worklet's existing 16 kHz PCM needs no
  encoder, no MediaRecorder, no ffmpeg dependency and no Safari format split.
  MAI accepts WAV (Prior art). The cost is bandwidth: ~1.9 MB per minute, spread
  over the recording (~32 KB/s). Compression is NOT in scope.
- **No server-driven send.** The client still assembles and sends the message.
  The server delivers only the late correction, which carries no attachments or
  selections. Moving assembly to the server would duplicate `chat-assemble.ts`.
- **No cross-piece speaker matching.** Letters advance per piece and the
  existing guidance covers it.
- **No deploy drain.** With Track 3, a restart costs only live-preview latency.

## Subplans

None. The piece length and transport are settled in Track 1, backed by the
provider documentation above. The one remaining measurement is listed in Open
design questions with its contingency.

## Failure modes

> **Critical gap (resolved in plan):** the capture abandonment sweep
> (`sweep.ts:92`) and resume scan skip non-capture sessions. Without Track 1's
> voice GC and voice resume, a sealed voice recording would never resume after
> a restart and would never be collected. Both are in Track 1's direction.

> **Accepted risk (boxholder decision 1):** a tab closed (not reloaded) while
> `awaitHq` is waiting loses the `sessionStorage` pending row, so the message
> is never sent, as today. The recording and HQ result stay on the box for
> 7 days. No UI lists them yet (NOT in scope; filed at /finish).

> **Critical gap (resolved in plan):** a late correction delivered while the
> agent is busy sits in an in-memory queue, and a crash before drain would
> lose it silently. Track 1 now keeps the handoff in `delivering` until the
> landed probe confirms it.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Box unreachable at segment start (deploy) | Track 3 machine doctest | `create` queued; mic starts first; `recordingLocal` | Clear: chip "live text paused" |
| Live socket down longer than 8 s | Track 3 doctest | `RECONNECT_WINDOW` → `recordingLocal`; reconnect loop continues | Clear |
| Chunk upload fails during a restart | Track 2 drainer doctest | Transient retry, then steady 30 s | Clear: pending bubble "audio saved on this device" |
| Chunk upload rejected (409/413) | Track 2 doctest | Terminal; `voiceStagingFailures` notice | Clear |
| Queue op older than 7 days | Track 2 doctest | Terminal; notice; op deleted | Clear |
| iOS/Safari evicts IndexedDB before upload | None (platform) | Ops drain within minutes normally | Silent: accepted; the queue is a buffer, not an archive |
| Two tabs drain the same op | Route doctest (idempotent replay) | Filename+bytes replay; idempotent create/finalize | Clear (no effect) |
| Provider 400 on size | `classify` doctest | Pieces ≤600 s; multipart | Clear: `upstreamBody` logged |
| MAI diarized 408 / 503 `diarization_unavailable` | `classify` + job doctest (fake service) | Halve piece, floor 150 s | Clear: status "retrying" |
| Missing OpenRouter key (permanent) | Job doctest | `failed/permanent` → `hq="failed"`; chip notice | Clear |
| Provider down for a day | Job doctest (injected clock) | `failed/exhausted` at 24 h | Clear: badge "HQ failed" |
| Server restarts mid-job | Resume doctest (filesystem) | Resume scan by kind; piece work is idempotent | Clear |
| Client budget expires as the result lands | `state` doctest (race) | CAS: `fallBack` returns the result if `ready` | Clear |
| Late delivery crashes after send | Deliver doctest | `delivering` marker + landed probe on the recording id | Clear |
| Late delivery while the agent is busy, then a crash | Deliver doctest (busy fake session) | Stays `delivering`; resume/sweep re-probes and re-delivers | Clear |
| Finalize before every chunk landed | Route doctest (`chunkCount` gap) | 409 `missing-chunks`; no seal | Clear: "audio incomplete" |
| Hook check misses `recordingLocal` | `segmentCapturing` doctest | One predicate for every hook check | Clear |
| Segment 2's HQ beats segment 1's | Sequencer doctest | FIFO dispatch | Clear |
| A consumer forgets to seal | Type (`PendingRecording`) + hook-unmount seal | Unsealed → sealed `hq: null` on unmount; GC at 7 days | Clear |
| Reload during the HQ wait | pending-sends doctest | Row stays `preparing`; `awaitHq` resumes | Clear |
| Speaker letters out of order for late delivery | None needed | Letter computed at delivery from the log tail; each piece gets a fresh letter | Clear (letters name recordings, not order) |
| Words cut at a piece boundary | None | Accepted | Silent: accepted; one word per 10 minutes |
| `recordingLocal` hides the silence timeout during a real silence | Machine doctest | `MAX_DURATION` still bounds it | Clear |
| Disk: 115 MB/hour staged | None | 7-day GC; prod has ~32 GB free (2026-08-04) | Clear via disk alerts |
| iOS build without Track 6 calls `transcribe-audio` | Existing route tests | Route kept unchanged | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** An agent could read `hq="pending"` text as
  final and act on a misheard number before the correction lands. ADDRESSED:
  the prompt sentence (Track 4) plus a knowledge audit. Consequence if missed:
  the agent answers twice, which `corrects` guidance limits.
- **Stale ref.** A `corrects="X"` whose message X scrolled out of the loaded
  window. ADDRESSED: the correction bubble renders standalone with the time.
  The anchor is best-effort.
- **Two agents touching the same card.** Not applicable: no cards are
  written. Late delivery goes through the same busy? enqueue : send path as
  capture, so it queues behind an agent turn in progress.
- **Hand-edit drift.** Not applicable: `session.json` is machine-owned under
  `_tmp`. A corrupt manifest fails schema parse at read. The job logs and
  skips it, as capture does today.
- **Fabricated free-form value.** Not applicable: all new values are
  machine-written.
- **Validation error UX.** A permanent failure's message reaches the chip and
  the badge verbatim. The server already writes it for humans
  (`MissingOpenRouterKeyError`).
- **Partial migration / transition state.**
  - A web tab loaded before the deploy keeps the old one-shot path until
    reload. It never touches voice staging.
  - iOS builds keep `transcribe-audio`.
  - Servers without Track 5 fall back to the relay.
  - ADDRESSED in Rollout.
- **Hands-free conversation while live text is paused.** Spoken "send" is
  undetectable in `recordingLocal`. DEFERRED: the chip says so; the manual
  control works; `MAX_DURATION` submission bounds the worst case.

## NOT in scope

- **Picker disables unusable HQ services; refuse to save them** (silent-fails
  issue, items 2–3). A separate UI change, already filed; that issue stays open.
- **Compressed staging (Opus/AAC).** It needs an encoder or ffmpeg and a Safari
  format split. Revisit if a queue depth on cellular shows PCM bandwidth
  lagging.
- **Cross-piece speaker reconciliation** (embedding clustering). Real
  research-grade work; letters per piece are honest in the meantime.
- **HQ for segments that ended without a send** (silence, mic loss, tab
  eviction). They are sealed with `hq: null` and kept 7 days. Merging HQ text
  into an edited composer draft needs span tracking that this plan does not
  design.
- **Listing and recovering unsent recordings** (the closed-tab case). File as
  an issue at /finish.
- **Moving web capture's upload lanes onto the durable queue.** Capture also
  uploads photos/files with their own lanes. Moving the audio lane alone would
  split capture across two queues. File as an issue.
- **Renaming `/api/capture/sessions` to a neutral staging path.** Shipped iOS
  builds call it. Principle #7's name promise is kept inside the code
  (`staging-*`) and documented at the route.
- **Deploy drain (delay restarts while recordings are open).** Track 3 makes it
  unnecessary for correctness.
- **Server-driven delivery of an unclaimed HQ result with its attachments.**
  It would duplicate client assembly.
- **Retiring `POST /api/chat/transcribe-audio`.** Only after the iOS build with
  Track 6 has rolled out. File as a follow-up issue.

## Open design questions

Decided by the boxholder, 2026-09-10 (recorded here, applied in the tracks):

1. **A voice message whose tab is gone is never sent by the box.** A closed
   tab's message stays unsent, as today. The recording and any HQ result stay
   on the box for 7 days. A reloaded tab shows the pending item with explicit
   actions (Track 4). The rejected alternative was a server backstop that
   delivers the HQ text itself after the wait budget; it would drop the
   message's selections and attachments and send on the user's behalf. A
   recovery list for unsent recordings is NOT in scope.
2. **Diarized parts get fresh letters.** Each piece of one recording takes the
   next speaker letter (`1A`, `2A`, then `1B`, `2B`). A marker line `— part 2
   of 3 —` separates pieces. The prompt gains one sentence (Track 4). It never
   asserts a false identity. The rejected option kept one letter with
   part-local numbers, where `1A` could name different people in different
   parts.

Still open:
- **Does a 600 s WAV piece via multipart succeed on `mai-diarized` within
  OpenRouter's 60 s upstream timeout?**
  - Lean: yes. The incident's 6-minute recordings succeeded via JSON, and
    multipart removes the base64 overhead.
  - Measure it in Track 1 before the job lands: send a 10-minute synthetic WAV.
    This needs the boxholder's approval to spend on the OpenRouter key; it
    costs cents.
  - If it fails, set `HQ_PIECE_SECONDS = 300`. The halving logic then
    becomes a safety net rather than the normal path.
- **`HQ_WAIT_BUDGET_MS` = 5 minutes.**
  - Lean: keep it. The boxholder prefers retry, and the "Send live text now"
    control covers impatience.
  - A per-box setting is NOT in scope unless the default is wrong in use.

## Knowledge audits

New agent-facing vocabulary: `hq="pending"`, `hq="failed"`, `corrects`. Add to
`beebox/src/dev/knowledge-audits.yaml`:
- `voice-hq-pending-defers` (knows_directly): given a `<speech hq="pending">`
  message with a garbled name, the agent does not run `bbx chat retranscribe`
  and says a corrected transcript is coming.
- `voice-corrects-supersedes` (knows_directly): given a `<speech corrects="X">`
  that changes a date in X, the agent updates the date and does not re-answer
  X from scratch.
- `voice-diarized-parts` (knows_directly): given a diarized message with
  `— part 2 of 2 —` and speakers `1A`/`1B`, the agent does not assert that
  they are the same person or different people.

Both run against test1 before the plan is done
(`pnpm knowledge-audit run --box <abs test1 path> --filter voice-`), with the
status comments recorded.

## What will hold this after it ships

- Pure cores, reached by doctests:
  - `planPieces`, `wavHeader`, `classifyHqError`, `nextVoiceState`
    (`test/core/voice-recording/*.doctest.md`).
  - `nextDrainStep` (`test/frontend/voice-staging-queue.doctest.md`).
  - The `awaitHq` outcome decision (`test/frontend/await-hq.doctest.md`).
  - Machine transitions: a new
    `test/frontend/realtime-transcription-machine.doctest.md`. No doctest
    covers this machine today (searched `test/frontend/`).
  - The composer `hq` region: extend the existing
    `test/frontend/composer-machine.doctest.md`.
- Filesystem tier (`makeTmpBox()`): the job with the fake transcription service
  (`src/core/transcription/fake.ts`) and an injected sleep/clock covers
  retries, piece halving, exhaustion, restart resume and late delivery.
- Route tier (`makeTestServer()`): voice create/upload/finalize/idempotency;
  the tRPC `claim`/`fallBack` CAS.
- No new tier and no new mock. The fake transcription service already exists,
  and its failure modes gain scripted errors (status + body). They are
  written from the provider documentation cited above, not from our own
  assumptions.
- The real evaluation the issue demands cannot be a doctest: a 20+ minute
  diarized conversation on a phone, with a deploy and a network drop in the
  middle. That is `needs: [manual-testing]` on the issue once code lands, with
  the exact script in its `## Manual testing` section.

## Implementation order

1. Track 1 chunk 1: kind `voice`, manifest object, idempotent create, PCM
   format, predicate switches. Route doctests.
2. Track 1: `src/shared/wav.ts`, `src/shared/backoff.ts` moves; `pieces.ts`,
   `classify.ts`, `state.ts` with doctests.
3. Track 1: OpenRouter multipart + upstream body. **Measurement** (with
   approval). Set `HQ_PIECE_SECONDS`.
4. Track 1: `hq-job.ts`, finalize dispatch, resume by kind, voice GC, bus
   event. Filesystem doctests.
5. Track 1: `voiceRecording` tRPC router; `userMessageAlreadyLanded`
   `docPath` → `marker` (capture and bulk doctests stay green);
   `deliver-late.ts` with the durable `delivering` state.
6. Track 2: drainer core + IndexedDB shell; `transient.ts` idempotent-mutation
   meta.
7. Track 3: machine states; actor reorder; `VoiceStager`; `PendingRecording`;
   ring buffer; `MAX_DURATION` submit.
8. Track 4: emission field + attributes; `awaitHq`; sequencer; composer `hq`
   region; pending-sends resume; chip notice; badges and correction bubble;
   prompt sentences; knowledge audits run.
9. Track 5: server last-audio lookup; remove web retention.
10. Track 6: iOS converter, coordinator, preparation, contract doc and
    fixtures.
11. Cross-model review of the diff; manual-testing section on the issue.

## Rollout shape

- **Tests first.** Each chunk lands with its named doctest.
- **Done when:**
  - every doctest above passes
  - `pnpm typecheck` and lint are clean
  - both knowledge audits pass on test1
  - a bin/browse run on the worktree records a segment with the fake mic
    (`lib/audio/fake-mic.ts`) while the live socket is blocked, and shows the
    staged session and a delivered HQ message
- **Data shape.**
  - New manifests only. Existing staging manifests parse unchanged
    (`kind` already defaults to `"capture"`, `staging-schema.ts:122`).
  - `sessionStorage` pending rows gain optional fields; legacy rows parse.
  - No box data migration.
- **Transition.**
  - Server and web ship together in one bundle.
  - Web tabs loaded before the deploy keep the old path until they reload.
  - `transcribe-audio` stays for iOS.
  - The iOS track ships in the same plan but reaches devices on the next app
    build. Retiring the old route is a follow-up issue.
- **Manual testing** (set on the issue after code lands):
  - A diarized conversation of at least 20 minutes on the phone.
  - Block the network for 2 minutes in the middle.
  - Trigger a deploy near the end.
  - Expected: recording never stops; the chip shows "live text paused" during
    the outage; the message arrives with `stt="hq"`, or with `hq="pending"`
    followed by a `corrects` message; no words are lost across the outage.
