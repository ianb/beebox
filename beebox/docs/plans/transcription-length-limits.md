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
limit. This plan records each HQ service's length limit beside the service
vocabulary and makes the job cut pieces from the chosen service's limit.

**Issues addressed:** none filed. Searched `issues/` (excluding `closed/`)
for "part N of", "part 1 of", "HQ_PIECE", "piece.*diariz", "speaker letter",
"speaker.*drift", and "voxtral". Related, not addressed:
`issues/features/2026-10-20-same-speaker-names-across-recordings.md` (speaker
identity across separate requests; this plan reduces the number of separate
requests but does not join identity across them);
`issues/features/2026-10-20-upgrade-transcription-to-voxtral-3.md` (a model
change would need the Voxtral entry re-measured; see Failure modes).

## Design

No design section: a person sees one transcript instead of parts for a
Voxtral recording up to 60 minutes. That restores the behavior a single
recording is meant to have. No surface, card, or wording changes.

## Smallest fix and budget

Smallest fix: change `HQ_PIECE_SECONDS` to depend on `hqRequest.service`
with an inline `service === "voxtral" ? … : 300`. The developer ruled this out
("Do not hard-code a Voxtral special case").

Chosen design, one track:

- A `HQ_SERVICE_LENGTH_LIMITS` record in `shared/transcription-services.ts`,
  keyed by `HqTranscriptionService`, each entry a `maxPieceSeconds` and a
  `source` string.
- The HQ job starts at `HQ_SERVICE_LENGTH_LIMITS[service].maxPieceSeconds`
  instead of `HQ_PIECE_SECONDS`. The halving retry stays as it is.
- The direct Voxtral arm scales its request timeout with the request size.

Estimate: source and tests about 120 changed lines; authored docs about 15
(the what's-new line and the corrected comments in `openrouter.ts` and
`pieces.ts`); generated output 0.

## Stated preferences this plan trades against

- The developer, via the handoff: "metadata on each transcription
  service/model's length limits, kept in one place, and the code to use it";
  "Reuse that registry instead of creating a parallel table"; "Keep the
  halving retry as the safety net"; "Each entry cites its source".
- `docs/engineering-principles.md` #2 (exhaustiveness): the record is typed
  `Record<HqTranscriptionService, …>`, so adding a service without a limit
  fails compilation.
- #8 (one way): one table of limits; the job's halving logic is reused.
- #4 (resilient AND never silent): the measured Voxtral 429 behavior keeps
  the existing transient-retry path; nothing new is swallowed.
- Monorepo memory "stop over-engineering rare failures": the plan does not
  add route resolution for the Whisper family (see NOT in scope).

## What already exists

- `beebox/src/shared/transcription-services.ts:39-41`:
  `export const HQ_TRANSCRIPTION_SERVICES = ["whisper", "whisper-llm",
  "whisper-llm-mini", "voxtral", "voxtral-diarized", "mai", "mai-diarized",
  ] as const;` — the closed set. Reuse: the limits record lives in this file
  and is keyed by its type.
- `beebox/src/core/voice-recording/hq-job/pieces.ts:21`:
  `export const HQ_PIECE_SECONDS = 300;` and `:24`
  `export const HQ_PIECE_FLOOR_SECONDS = 150;`. `nextPieceSeconds` (`:56-59`)
  halves toward the floor. Reuse the floor and halving; replace the single
  default.
- `beebox/src/core/voice-recording/hq-job/core.ts:214`:
  `let pieceSeconds = HQ_PIECE_SECONDS;` — the only read of the default.
  Searched `src` for `HQ_PIECE_SECONDS`: hits are this line, its import at
  `:40`, and a comment in `dispatch/openrouter.ts:41`. Tests use it in
  `test/core/voice-recording/hq-job/pieces.test.ts`.
- `hq-job/core.ts:215-217`: a resumed job (`transcribing`/`retrying`) keeps
  the stored `pieceSeconds`. A recording in flight across the deploy finishes
  at 300 s pieces. That is correct and needs no migration.
- `dispatch/core.ts:285-289`: `hqRoutesThroughOpenRouter` returns true for
  every service except `voxtral` and `voxtral-diarized`. `:305-318`: the
  Whisper family picks direct or OpenRouter per call from key presence.
- `voxtral/core.ts:62-71`: the direct Voxtral arm posts multipart with
  `timeout: 120_000`. ky's default retry does not retry POST, so `retry: 2`
  has no effect here (ky documentation; not changed by this plan).
- `classify.ts`: 429 and 5xx (except 501) are `transient`; 408, 413, and MAI's
  `diarization_unavailable` 503 are `piece-too-long`; other 4xx are
  `permanent`. A ky timeout has no status and is `transient`.
- `deploy/systemd/box-sandbox.conf:42-43`: `MemoryHigh=2G`,
  `MemoryMax=2560M` per box.

## Prior art (external)

- Mistral audio overview, https://docs.mistral.ai/studio-api/audio/overview —
  Voxtral Mini Transcribe V2 accepts recordings "up to 3 hours" per request,
  with diarization. Evaluated; the measurement below shows the 3-hour figure
  does not hold in practice for this account.
- OpenRouter STT guide (cited in `docs/implemented-plans/resilient-voice-recording.md`,
  Prior art): 25 MB multipart cap. The box's JSON route was measured to fail
  between ~15 MB and ~25.6 MB of JSON (same plan, incident section).
- OpenAI audio API: 25 MB upload limit per file (UNVERIFIED in this session;
  cited from the handoff). It does not bind, because the OpenRouter route is
  stricter and the Whisper family can take either route.

### Measurement: Voxtral, direct, diarized (2026-11-18)

Synthetic two-voice audio (macOS `say`, Samantha and Daniel alternating
paragraphs of man-page prose), 16 kHz mono s16le WAV, sent with the box's own
`buildVoxtralRequestBody` (`diarization: true`) to
`https://api.mistral.ai/v1/audio/transcriptions`, model
`voxtral-mini-latest`, test box key. Probe and analysis scripts were scratch
files and are not kept.

| Length | WAV MB | Upload s | Result |
|---|---|---|---|
| 43 min | 82 | 4.6, 9.3 | 200 in 22.6 s; 200 in 36.9 s |
| 60 min | 115 | 8.7 | 429 `backend_out_of_capacity` after 30 s; then 200 in 29 s; 200 in 31 s |
| 75 min | 144 | 7.0 | 200 in 38 s; 200 in 38 s |
| 90 min | 173 | 8.7–9 | 429 capacity after 38 s; 429 `rate_limited`; 429; 200 in 43 s |
| 175 min | 335 | 14–27 | 429 `backend_out_of_capacity` after 78–90 s, 4 of 4 |
| 187 min | 359 | 28 | 429 capacity (sent concurrently with a 175 min request) |

Quality, scored against the source text and the known speaker order:

- 43 min: 7,030 words out against 7,076 in; timestamps monotonic; every
  segment's speaker matches its paragraph's voice (odd paragraphs all
  `speaker_1`, even all `speaker_2`).
- 75 min: 12,448 out against about 12,536 in; same clean result over 50
  internal Mistral sub-requests (`usage.request_count: 50`). Speaker labels
  stay consistent across Mistral's own internal chunks.

A first probe with near-identical repeated sentences produced a runaway
repetition loop (one sentence 98 times, timestamps past the end of the
audio). The same audio cut to 300 s looped the same way, so the loop comes
from the repetitive content, not from length. Real speech is not that
repetitive; the content artifact is noted, not designed for.

Conclusion: 60 minutes is the Voxtral limit this plan records. At 60 and 75
minutes most requests succeed and a 429 cleared on the next try. From 90
minutes up, capacity refusals dominate, and at 175 minutes every request was
refused. A 429 is `transient` today, so a 3-hour piece would retry the same
refused request until the 24-hour bound expired.

Timing: a 60–90 min request took 29–43 s, of which upload was 7–9 s on this
machine. The 120 s timeout leaves about 3× headroom; the size-scaled timeout
below widens it for a slower upload.

## Ontology

- **HQ service** (`HqTranscriptionService`, `shared/transcription-services.ts:42`):
  existing.
- **Piece** and **piece length** (`pieceSeconds`, `hq-job/pieces.ts`):
  existing. Seconds of 16 kHz mono s16le audio.
- **Length limit** (new): `{ maxPieceSeconds: number; source: string }`, one
  per HQ service. It is the longest piece the job sends that service in one
  request, already reduced to whichever route or rule binds. It is not a hard
  provider limit and not a timeout. `source` names the provider document or
  dated measurement.

## Tracks / scope

### Track 1 — per-service piece length

- **What.** Add the limits record, start the job from it, and scale the
  Voxtral arm's timeout.
- **Why.** Diarized Voxtral recordings longer than 5 minutes come back in
  parts with drifting speaker letters, for a limit Voxtral does not have.
- **Direction.**
  - `shared/transcription-services.ts`:
    ```ts
    export interface HqServiceLengthLimit {
      /** Longest piece, in seconds of 16 kHz mono WAV, the HQ job sends in one request. */
      maxPieceSeconds: number;
      /** Where the figure comes from: a provider doc URL or a dated measurement. */
      source: string;
    }
    export const HQ_SERVICE_LENGTH_LIMITS: Record<HqTranscriptionService, HqServiceLengthLimit> = { … };
    ```
    Values: Whisper family 300 (OpenRouter JSON ceiling binds; direct
    OpenAI 25 MB would allow ~13 min, but the route is chosen per call);
    `mai`/`mai-diarized` 300 (OpenRouter only; same ceiling; MAI diarization
    documents ~15 min); `voxtral`/`voxtral-diarized` 3600 (measurement above).
  - `hq-job/pieces.ts`: remove `HQ_PIECE_SECONDS`. Keep the floor and halving.
  - `hq-job/core.ts:214`:
    `let pieceSeconds = HQ_SERVICE_LENGTH_LIMITS[hqRequest.service].maxPieceSeconds;`
  - `voxtral/core.ts`: `timeout: voxtralTimeoutMs(body.length)`, with
    `voxtralTimeoutMs(bytes) = 120_000 + 1_000 per MB` (115 MB → 235 s).
    Exported for a test. Upload time scales with bytes; a compressed
    upload from the chat route keeps roughly today's 120 s.
  - Correct the comments that state 300 s as the job's universal piece length
    (`dispatch/openrouter.ts:41-43`, `hq-job/pieces.ts:1-12`).
- **Vocabulary lock-ins.** `HQ_SERVICE_LENGTH_LIMITS`,
  `HqServiceLengthLimit.maxPieceSeconds`, `.source`.
- **Depends on.**
  - The default piece length has one consumer: searched `src` for
    `HQ_PIECE_SECONDS` (listed under What already exists).
  - The service reaches the job: `hqRequest.service` is passed to
    `transcribePiece` at `hq-job/core.ts:271`, and `realTranscribePiece`
    passes it to `transcribeAudioHq` as `overrides.service` (`:79`), which
    dispatches on it (`dispatch/core.ts:262`).
  - Voxtral never routes through OpenRouter: `hqRoutesThroughOpenRouter`
    (`dispatch/core.ts:285-289`) and `dispatchHqTranscription` (`:291-297`)
    send both Voxtral services to `transcribeAudioVoxtral`.
  - Voxtral accepts 60–75 min diarized requests and labels speakers
    consistently: the measurement above.
  - A 429 is transient and retries the same piece: `classify.ts`, and the
    transient branch at `hq-job/core.ts:334-345`.
  - Halving from 3600 reaches 1800, 900, 450, 225, then `null`
    (112.5 < 150): `nextPieceSeconds` at `pieces.ts:56-59`.
- **First implementation chunk.** The record, the job change, the timeout,
  the comment corrections, and the tests below. One commit.

## Could this be simpler?

The simplest version is the inline Voxtral special case, which the developer
rejected. Next simplest: the record without the timeout change. The 120 s
timeout covered every 60–90 min request measured here (≤ 43 s) on this
machine's upload. On a slower uplink, a 115 MB upload alone could approach
120 s. A timeout is `transient` and repeats the same billed request, so the
one-line timeout scaling costs less than the failure it prevents.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A 60 min Voxtral piece gets 429 `backend_out_of_capacity` | yes (hq-job transient-retry test) | transient retry with backoff | clear: status shows retrying |
| Mistral refuses 60 min pieces persistently (capacity changes) | no | transient retries until the 24 h bound, then `expired` | clear, slow; each refusal returned no usage, so probably unbilled (UNVERIFIED) |
| A service is added without a limit | compile error | `Record<HqTranscriptionService, …>` | clear |
| Voxtral model changes (Voxtral 3 issue) and limits differ | no | 413/408 halve; 429 retries | the `source` line says what was measured and when |
| A 60 min piece's WAV and multipart copies raise memory (~350 MB peak) | no | box `MemoryHigh=2G` | throttles, logs |
| Slow uplink: a 115 MB upload exceeds the timeout | test for `voxtralTimeoutMs` | scaled timeout (235 s); then transient retry | clear |

No critical gap. The persistent-refusal row is accepted: the recording
stays on the box for `bbx chat retranscribe`, and the 24-hour bound is
existing behavior.

## Agent-flow / user-flow edge cases

Walk, the way in (a 40-minute diarized conversation on `voxtral-diarized`):

1. The client seals the recording with an HQ request naming
   `voxtral-diarized`; `hqRequest.service` is stored
   (`voice-staging/state.ts`, `requested` event).
2. `runHqJob` reads the PCM (76.8 MB) and sets `pieceSeconds = 3600`
   (`hq-job/core.ts:214`, new).
3. `planPieces(76_800_000, 3600)` returns one piece. The status reads
   "Transcribing…" (`frontend/src/lib/audio/hq-wait.ts:97`: `pieces > 1`
   shows "part N of M").
4. One request; `joinPieceTexts` gets one diarized piece, so no
   `— part 1 of 1 —` marker (`hq-job/core.ts:194`).
5. The person sees one transcript with consistent speaker letters.

The way out: a 2-hour recording plans two 60-minute pieces and still shows
two parts. A 429 moves to `retrying` and retries the same piece after
backoff. A deploy mid-job resumes at the stored `pieceSeconds`.

- Wrong tag / wrong field: ADDRESSED — typed record keyed by the service union.
- Stale ref: not applicable — no references.
- Two agents touching the same card: not applicable — the job's in-flight set
  is unchanged.
- Hand-edit drift: not applicable — no hand-edited data.
- Fabricated free-form value: not applicable.
- Validation error UX: not applicable.
- Partial migration / transition state: ADDRESSED — resumed jobs keep their
  stored `pieceSeconds`.
- Stored state that never clears: none added.

## NOT in scope

- Resolving the Whisper family's route before planning pieces, to give the
  direct OpenAI route ~13 min pieces. Non-diarized parts join without markers
  or speaker letters, so a person sees no difference.
- Moving MAI to multipart to allow longer pieces: unmeasured (named NOT in
  scope by `dispatch/openrouter.ts`).
- Speaker identity across pieces of a recording longer than 60 minutes: the
  speaker-references issue covers it.
- Lengths for the chat route and CLI retranscribe, which send one file whole:
  unchanged by this plan.

## Open design questions

None.

## Knowledge audits

Skip: infrastructure only. No agent-facing concept changes.

## What will hold this after it ships

- `test/core/voice-recording/hq-job.test.ts`: a `voxtral-diarized` recording
  of 600 s plans one piece and joins without a part marker; a `mai-diarized`
  recording of the same size plans two pieces. The scripted `transcribePiece`
  already records the service it was called with.
- `pieces.test.ts`: existing cases switch from `HQ_PIECE_SECONDS` to the
  literal 300 they assert.
- A test of `voxtralTimeoutMs` at 0 bytes and 115 MB.
- A test that halving from 3600 reaches `null` after 225.

## Implementation order

1. Record + job + timeout + comments + tests (one commit).
2. What's-new line: long diarized Voxtral recordings come back as one
   transcript instead of 5-minute parts.

## Rollout shape

Done when the tests above pass with `pnpm typecheck` and `pnpm layout-check`.
No data migration: stored `pieceSeconds` on in-flight recordings stay valid.
