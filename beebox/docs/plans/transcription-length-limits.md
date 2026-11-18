---
title: "Per-service length limits for the HQ transcription job"
status: draft
workstream: transcription-length-limits
issues: []
---
# Per-service length limits for the HQ transcription job

The HQ recording job cuts every recording into 300-second pieces, whatever
service transcribes it. A diarized recording then comes back in parts
(`— part N of M —`), and each part names its speakers with a new letter, so
one person becomes several speakers. The 300 s figure answers an OpenRouter
request-size limit. Voxtral goes direct to Mistral and does not have that
limit. This plan records each HQ service's length limits beside the service
vocabulary and makes the job cut pieces from the chosen service's limits.

**Issues addressed:** none filed. Searched `issues/` (excluding `closed/`)
for "part N of", "part 1 of", "HQ_PIECE", "piece.*diariz", "speaker letter",
"speaker.*drift", and "voxtral". Related, not addressed:
`issues/features/2026-10-20-same-speaker-names-across-recordings.md` (speaker
identity across separate requests; this plan reduces the number of separate
requests but does not join identity across them);
`issues/features/2026-10-20-upgrade-transcription-to-voxtral-3.md` (a model
change needs the Voxtral entries re-measured; see Failure modes);
`issues/deferred/2026-09-06-openai-batch-stt-retirement.md` (the Whisper-family
models retire 2027-02-26; their entries go with them).

## Design

No design section: a person sees one transcript instead of parts for a
Voxtral recording up to 60 minutes. That restores the behavior a single
recording is meant to have. No surface, card, or wording changes.

## Smallest fix and budget

Smallest fix: change `HQ_PIECE_SECONDS` to depend on `hqRequest.service`
with an inline `service === "voxtral" ? … : 300`. The developer ruled this out
("Do not hard-code a Voxtral special case").

Chosen design, one track:

- `HQ_SERVICE_LENGTH_LIMITS` in `shared/transcription-services.ts`: for each
  HQ service, the list of limits on the routes it can take. A limit is a
  duration or an upload size, with its route and source.
- `hqPieceSeconds(service)` in `hq-job/pieces.ts` converts each limit to
  seconds of 16 kHz mono WAV and takes the smallest. The job starts there.
- The halving retry stays. It now skips steps that would resend the same
  audio, and a resumed job never uses more than the current limit.
- The HQ arms read an error body once, so a plain-text 413 keeps its status
  and still halves.
- The direct Voxtral arm scales its request timeout with the upload size.

Estimate: source and tests about 250 changed lines; authored docs about 20
(the what's-new line and corrected comments in `openrouter.ts` and
`pieces.ts`); generated output 0.

## Stated preferences this plan trades against

- The developer, via the handoff (faithful paraphrase): limit metadata for
  each service, in one place, next to the existing service definitions,
  reusing that registry rather than a parallel table; the job plans pieces
  from it; no Voxtral special case; keep halving as the safety net; each entry
  cites a doc URL or dated measurement; express the limit that binds, by route
  and as bytes or duration; check upload time and request timeout.
- `docs/engineering-principles.md` #2 (exhaustiveness): the limits object
  `satisfies Record<HqTranscriptionService, …>`, so a missing or extra service
  fails compilation.
- #8 (one way): one table of limits; one error-body reader for the HQ arms;
  the job's halving logic is reused.
- #4 (resilient AND never silent): a capacity 429 keeps the existing
  transient-retry path, which shows "retrying" in the status.
- Monorepo memory "stop over-engineering rare failures": no route resolution
  before planning (see NOT in scope).

**Registry shape.** The handoff asks to reuse the service registry rather
than add a parallel table. The registry is the `as const` array
`HQ_TRANSCRIPTION_SERVICES`, which `z.enum` and the frontend picker consume.
Deriving that array from an object's keys needs a type assertion, which the
lint preset forbids (`personal-vibe-check/preset/enabled-rules.ts:40`). The
limits therefore sit directly under the array in the same file, typed
`satisfies Record<HqTranscriptionService, …>`. The compiler rejects a
service with no limits and a limit for a service that does not exist, so
the two cannot drift.

## What already exists

- `beebox/src/shared/transcription-services.ts:39-41`:
  `export const HQ_TRANSCRIPTION_SERVICES = ["whisper", "whisper-llm",
  "whisper-llm-mini", "voxtral", "voxtral-diarized", "mai", "mai-diarized",
  ] as const;` — the closed set.
- `beebox/src/core/voice-recording/hq-job/pieces.ts:21`:
  `export const HQ_PIECE_SECONDS = 300;`, `:24`
  `export const HQ_PIECE_FLOOR_SECONDS = 150;`, and `nextPieceSeconds`
  (`:56-59`), which halves toward the floor.
- `hq-job/core.ts:214`: `let pieceSeconds = HQ_PIECE_SECONDS;` — the only
  source-code read of the default. Searched `src` for `HQ_PIECE_SECONDS`:
  this line, its import at `:40`, and a comment at `dispatch/openrouter.ts:41`.
  Tests: `test/core/voice-recording/hq-job/pieces.test.ts`.
- `hq-job/core.ts:215-217`: a resumed job (`transcribing`/`retrying`) takes
  the stored `pieceSeconds`.
- `hq-job/core.ts:297-325`: on `piece-too-long`, `nextPieceSeconds(pieceSeconds)`
  sets the new length and the job restarts from piece 1.
- `dispatch/core.ts:285-289`: `hqRoutesThroughOpenRouter` is true for every
  service except `voxtral` and `voxtral-diarized`. `:305-318`: the Whisper
  family picks direct or OpenRouter per call from key presence. MAI is
  OpenRouter only (`:301-307`).
- `voxtral/core.ts:62-71`: the direct Voxtral arm posts multipart with
  `timeout: 120_000`.
- Error-body parsers: `voxtral-errors.ts:54-76`, `dispatch/whisper.ts:201-222`,
  `dispatch/openrouter.ts:126-141`, `dispatch/deepgram.ts:208-227`. Each
  calls `response.json()` and, on failure, `response.text()` on the same
  consumed body. ky 1.14.3's `HTTPError` passes the raw `Response` through
  (`node_modules/ky/distribution/errors/HTTPError.js`), so the second read
  throws, the status is lost, and the job classifies the failure as transient.
- `upstream-body.ts`: the leaf module the arms share for error bodies.
- `classify.ts`: 429 and 5xx (except 501) are `transient`; 408, 413, and MAI's
  `diarization_unavailable` 503 are `piece-too-long`; other 4xx `permanent`.
- `deploy/systemd/box-sandbox.conf:42-43`: `MemoryHigh=2G`,
  `MemoryMax=2560M` per box.

## Prior art (external)

- Mistral audio overview, https://docs.mistral.ai/studio-api/audio/overview —
  Voxtral Mini Transcribe V2 accepts recordings "up to 3 hours" per request,
  with diarization. Adopted as one Voxtral entry; the measurement adds a
  lower one.
- OpenAI speech-to-text guide,
  https://developers.openai.com/api/docs/guides/speech-to-text — "File
  uploads are currently limited to 25 MB" (the Audio API FAQ states 25 MiB for
  `whisper-1`). Adopted as the direct OpenAI entry, at 25,000,000 bytes, the
  smaller reading.
- OpenRouter JSON route, measured 2026-09-10
  (`docs/implemented-plans/resilient-voice-recording.md`, incident section):
  600 s of WAV (25.6 MB JSON) rejected with 400; ~6 min (~15 MB JSON)
  accepted. The exact limit and its reason are not documented. Adopted as the
  OpenRouter entry at 300 s (12.8 MB JSON), the length in production since.
- MAI-Transcribe-2 diarization ceiling "about 15 minutes" (same plan, prior
  art). Adopted as a `mai-diarized` entry; the OpenRouter entry binds first.

### Measurement: Voxtral, direct (2026-11-18)

Synthetic two-voice audio (macOS `say`, Samantha and Daniel alternating
paragraphs of man-page prose), 16 kHz mono s16le WAV, sent with the box's own
`buildVoxtralRequestBody` to `https://api.mistral.ai/v1/audio/transcriptions`,
model `voxtral-mini-latest`, test box key. Probe and analysis scripts were
scratch files and are not kept. "diar" is `diarization: true` (segment
granularity); "word" is `wordTimestamps: true`, the call-recording mode,
which sends no `diarize`; "plain" is neither.

| Length | Mode | Results (in order) |
|---|---|---|
| 30 min | word, diar, plain, word | 429 cap; 200 in 26 s; 200 in 13 s; 200 in 32 s |
| 43 min | diar | 200 in 23 s; 200 in 37 s |
| 60 min | diar | 429 cap; 200 in 29 s; 200 in 31 s; 429 (5 s, after a back-to-back request) |
| 60 min | word | 429 cap; 429 cap; 200 in 36 s |
| 60 min | plain | 429 cap; 200 in 26 s |
| 75 min | diar | 200 in 38 s; 200 in 38 s |
| 90 min | diar | 429 cap; 429 `rate_limited`; 429; 200 in 43 s |
| 175 min | diar | 429 cap, 4 of 4, after 78–90 s |

"429 cap" is `{"type":"backend_out_of_capacity","code":"3505",
"message":"Not enough capacity available for this request, please retry
later."}`. Uploads took 5–22 s for 115 MB and 14–28 s for 335 MB on this
machine.

Quality:

- 43 min diarized: 7,030 words out against 7,076 in; timestamps monotonic;
  every segment's speaker matches its paragraph's voice.
- 75 min diarized: 12,448 out against about 12,536 in; the same clean speaker
  split across 50 internal Mistral sub-requests (`usage.request_count: 50`).
- 60 min word: 9,956 words; the last word ends at 3,599.6 s.

A first probe with near-identical repeated sentences produced a repetition
loop (one sentence 98 times, timestamps past the end of the audio). The same
audio cut to 300 s looped the same way, so the loop comes from the repeated
content, not from length.

Conclusion: Voxtral's limit is 60 minutes. Capacity refusals appeared at
every length from 30 minutes up and cleared on a later try. At 175 minutes
every request was refused. A 429 is `transient`, so a 3-hour piece would
retry until the 24-hour bound. At 60 minutes the retry path recovers. The
value is provisional, and its `source` says so.

## Ontology

- **HQ service** (`HqTranscriptionService`, `shared/transcription-services.ts:42`):
  existing.
- **Piece** and **piece length** (`pieceSeconds`, `hq-job/pieces.ts`):
  existing. Seconds of 16 kHz mono s16le audio.
- **Length limit** (new, `HqLengthLimit`): one constraint on one request
  to a service on one route. Either
  `{ kind: "seconds"; maxSeconds }` or `{ kind: "file-bytes"; maxFileBytes }`,
  plus `route` (a short label such as "Mistral direct") and `source`. It is
  not a timeout and not a piece length. A service has one or more.
- **HQ piece seconds** (new, `hqPieceSeconds(service)`): the starting piece
  length, the smallest of the service's limits converted to seconds of WAV.

## Tracks / scope

### Track 1 — per-service piece length

- **What.** Add the limits, start the job from them, fix the halving steps and
  the resume, read error bodies once, and scale the Voxtral timeout.
- **Why.** Diarized Voxtral recordings longer than 5 minutes come back in
  parts with drifting speaker letters, for a limit Voxtral does not have.
  The halving fixes keep the safety net working once pieces can be long.
- **Direction.**
  - `shared/transcription-services.ts`:
    ```ts
    export type HqLengthLimit =
      | { kind: "seconds"; maxSeconds: number; route: string; source: string }
      | { kind: "file-bytes"; maxFileBytes: number; route: string; source: string };
    export const HQ_SERVICE_LENGTH_LIMITS = { … } satisfies Record<HqTranscriptionService, readonly HqLengthLimit[]>;
    ```
    Shared constants for the OpenRouter JSON limit (300 s), the OpenAI direct
    upload limit (25,000,000 bytes), the Mistral documented limit (10,800 s),
    the Mistral measured limit (3,600 s), and the MAI diarization ceiling
    (900 s). Whisper family: OpenAI direct and OpenRouter. `mai`: OpenRouter.
    `mai-diarized`: OpenRouter and the MAI ceiling. Both Voxtral services:
    Mistral documented and Mistral measured.
  - `hq-job/pieces.ts`: remove `HQ_PIECE_SECONDS`. Add
    `hqPieceSeconds(service)`: a `seconds` limit is `maxSeconds`; a
    `file-bytes` limit is `floor((maxFileBytes - WAV_HEADER_BYTES) / PCM_BYTES_PER_SECOND)`.
    Result: Whisper 300, MAI 300, Voxtral 3600.
  - `hq-job/pieces.ts`: `shorterPieceSeconds(current, rejectedSeconds)`
    halves `current` with `nextPieceSeconds` until the result is below
    `rejectedSeconds` (the rejected piece's actual length), or returns `null`
    at the floor. A 600 s recording at 3600 goes to 450, not 1800 and 900;
    a 200 s recording at 300 still goes to 150.
  - `hq-job/core.ts`: start at `hqPieceSeconds(hqRequest.service)`; on resume,
    `Math.min(stored, hqPieceSeconds(service))`; on `piece-too-long`, call
    `shorterPieceSeconds(pieceSeconds, pieceBytes.length / PCM_BYTES_PER_SECOND)`.
  - `upstream-body.ts`: `readUpstreamErrorBody(response)` reads `text()` once
    and returns `{ text, json }`, `json` being the parsed value or `undefined`.
    The four parsers above use it.
  - `voxtral/core.ts`: `timeout: voxtralTimeoutMs(body.length)`,
    `120_000 + 1_000 ms per 1,000,000 bytes` (115 MB → 235 s). This applies
    to every caller of the arm. A larger upload gets more time, and an upload
    under 1 MB keeps today's 120 s.
  - Correct the comments that call 300 s the job's universal piece length
    (`dispatch/openrouter.ts:41-43`, `hq-job/pieces.ts:1-12`).
- **Vocabulary lock-ins.** `HQ_SERVICE_LENGTH_LIMITS`, `HqLengthLimit`
  (`kind: "seconds" | "file-bytes"`), `hqPieceSeconds`, `shorterPieceSeconds`,
  `readUpstreamErrorBody`.
- **Depends on.**
  - The default piece length has one source consumer (search above).
  - The service reaches the job and the dispatcher: `hqRequest.service` is
    passed to `transcribePiece` at `hq-job/core.ts:271`; `realTranscribePiece`
    passes it as `overrides.service` (`:79`); `transcribeAudioHq` uses it at
    `dispatch/core.ts:262`.
  - Voxtral never routes through OpenRouter: `dispatch/core.ts:285-297`.
  - Voxtral accepts 60-minute requests in all three modes, with consistent
    speaker labels when diarized: the measurement above.
  - A 429 retries the same piece: `classify.ts`, and the transient branch at
    `hq-job/core.ts:334-345`.
  - The double read loses the status: the reviewer reproduced it locally with
    a plain-text 413 `Response` (round 1); ky passes the raw response (above).
    The new test reproduces it before the fix.
- **First implementation chunk.** Everything above plus the tests below, in
  one or two commits.

## Could this be simpler?

Simplest: the inline Voxtral special case, rejected by the developer. Next:
one seconds number per service, which was the first draft. It loses which
route and which kind of limit binds, which the developer asked to keep; the
per-route list costs one conversion function.

The halving and resume fixes come from pieces becoming long. With a 3,600 s
start, a single 413 on a 10-minute recording would resend identical audio
twice before anything changed. The error-body fix keeps the safety net
working: without it, a plain-text 413 retries the same piece until the 24-hour
bound. The timeout scaling is one line; a timeout is transient and repeats a
billed request.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A 60 min Voxtral piece gets 429 `backend_out_of_capacity` | new job test (429 then success) | transient retry with backoff | clear: status shows retrying |
| Mistral refuses 60 min pieces for hours | no | transient retries until the 24 h bound, then `expired`; the recording stays for `bbx chat retranscribe` | clear, slow. Each refusal returned no `usage`, so probably unbilled (UNVERIFIED) |
| A plain-text 413 loses its status | new parser test | `readUpstreamErrorBody` | clear after fix |
| A service is added without limits | compile error | `satisfies Record<…>` | clear |
| Voxtral model changes (Voxtral 3 issue) and limits differ | no | 413/408 halve; 429 retries | the `source` line names model and date |
| A limit is lowered by a deploy while a job is mid-retry | new job test | resume takes the smaller | clear |
| Memory: a 2-hour recording holds 230 MB of PCM plus a 115 MB WAV copy and a 115 MB multipart copy (~460 MB before HTTP buffers) | no | box `MemoryHigh=2G` throttles | logged by systemd |
| Slow uplink: a 115 MB upload exceeds the timeout | `voxtralTimeoutMs` test | 235 s, then transient retry | clear |

No critical gap. Accepted risks:

- Persistent refusal. A capacity refusal recovered on a later try in every
  case measured at ≤ 90 min, and 24-hour retry is existing behavior.
- Memory. The full-PCM buffer predates this plan. The two extra copies are
  bounded at 60 minutes (~230 MB), under the 2 GB box ceiling. Streaming the
  upload is NOT in scope.

## Agent-flow / user-flow edge cases

Walk, the way in (a 40-minute diarized conversation on `voxtral-diarized`):

1. The client seals the recording with an HQ request naming
   `voxtral-diarized`; `hqRequest.service` is stored (`voice-staging/state.ts`,
   `requested` event).
2. `runHqJob` reads the PCM (76.8 MB) and starts at
   `hqPieceSeconds("voxtral-diarized")` = 3600 (`hq-job/core.ts:214`, new).
3. `planPieces(76_800_000, 3600)` returns one piece. The status reads
   "Transcribing…" (`frontend/src/lib/audio/hq-wait.ts:97` shows
   "part N of M" only when `pieces > 1`).
4. One request of about 25–40 s; the composer's 5-minute wait covers it.
   `joinPieceTexts` gets one diarized piece, so no part marker
   (`hq-job/core.ts:194`).
5. The person sees one transcript with consistent speaker letters.

The way out and side paths:

- A 2-hour recording plans two 60-minute pieces and shows two parts.
- A 429 moves to `retrying` and retries the same piece after backoff. If
  that runs past the composer's 5-minute wait, the message goes as live text
  and the HQ result stays on the box (existing behavior).
- A 413 on a 40-minute piece goes to 1800 s (one step below 2400 s), and the
  job restarts with two pieces.
- A deploy mid-job resumes at `min(stored, current limit)`. A job that was
  mid-flight at 300 s keeps 300 s.

Checklist:

- Wrong tag / wrong field: ADDRESSED — typed record keyed by the service union.
- Stale ref: not applicable — no references.
- Two agents touching the same card: not applicable — the job's in-flight set
  is unchanged.
- Hand-edit drift: not applicable — no hand-edited data.
- Fabricated free-form value: not applicable.
- Validation error UX: not applicable.
- Partial migration / transition state: ADDRESSED — resume takes the smaller
  of stored and current.
- Stored state that never clears: none added.

## NOT in scope

- Resolving the Whisper family's route before planning, to give the direct
  OpenAI route ~13-minute pieces. Non-diarized parts join without markers or
  speaker letters, so a person sees no difference.
- Moving OpenRouter to multipart to allow longer pieces: unmeasured (named NOT
  in scope by `dispatch/openrouter.ts`).
- Classifying a capacity 429 as `piece-too-long`. It would fail short
  recordings during a capacity blip (300 → 150 → permanent).
- Streaming the upload or limiting concurrent HQ jobs to cut memory.
- Speaker identity across pieces of a recording longer than 60 minutes: the
  speaker-references issue covers it.
- The chat route and CLI retranscribe, which send one file whole. They gain
  only the size-scaled Voxtral timeout and the error-body fix.

## Open design questions

None.

## Knowledge audits

Skip: infrastructure only. No agent-facing concept changes.

## What will hold this after it ships

- `pieces.test.ts`: `hqPieceSeconds` for every service (one whole-value
  check over the list: whisper 300, mai 300, voxtral 3600); `planPieces` at
  3600 s exactly and one sample over; `shorterPieceSeconds` for 3600/600 →
  450, 300/200 → 150, 300/120 → null.
- `hq-job.test.ts`, with a transcribe seam that records the service and WAV
  byte length of each call:
  - a 600 s `voxtral-diarized` recording sends one piece and joins without a
    part marker; the same recording on `mai-diarized` sends two;
  - a 413 on that single 600 s Voxtral piece sends 450 s pieces next;
  - a resumed `retrying` state with `pieceSeconds: 7200` on Voxtral resumes at
    3600.
- `upstream-body` test: a plain-text 413 `Response` through the Voxtral
  parser yields an error with `status: 413` and the text as `body`.
- `voxtralTimeoutMs` at 0 and 115,200,044 bytes.

## Implementation order

1. Error-body reader and its test (independent fix).
2. Limits, `hqPieceSeconds`, `shorterPieceSeconds`, job changes, timeout,
   comments, tests.
3. What's-new line: long diarized Voxtral recordings come back as one
   transcript, up to an hour, instead of 5-minute parts.

## Rollout shape

Done when the tests above pass with `pnpm typecheck`, `pnpm layout-check`, and
lint. No data migration: stored `pieceSeconds` on in-flight recordings stay
valid and are capped on resume.
