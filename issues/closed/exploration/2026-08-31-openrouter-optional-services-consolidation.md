---
title: "Consolidate optional model services under OpenRouter where practical"
workstream: openrouter-services
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main session — reducing billing and configuration overhead during the external cutover
labels: [providers, configuration]
priority: important
resolution: implemented
---

**Closing note (finish, 2026-09-06):** resolved by the `openrouter-services`
workstream — merge commit `6d11c1a2a` (worktree branch `worktree-openrouter-services`,
squashing in `10c6425d3..HEAD`). The research inventory, three-way grouping, and
live-API verification below are all recorded in this issue; the OpenRouter
fallback route shipped for semantic-search embeddings, `ask-about-audio`, the
opt-in Gemini scan-vision backend, and Whisper HQ transcription, plus
`mai`/`mai-diarized` as new HQ services. Diverges from the original ask only in
scope of what actually consolidated: Voxtral stays Mistral-only (OpenRouter
cannot serve `verbose_json` for it), and diarization ships on a new model
(`microsoft/mai-transcribe-2`) rather than an existing route, tracked
separately: [openrouter-diarizing-stt-backend](../../exploration/2026-09-06-openrouter-diarizing-stt-backend.md).

Bee Box can require separate provider accounts, API keys, configuration, and
bills for auxiliary model-backed services. Determine which of these workloads
can use one OpenRouter account without losing important behavior. Consolidation
is the goal. Using OpenRouter for every workload is not a requirement.

This question is separate from routing the main agent model through OpenRouter.
That work belongs to [provider-endpoint config](../../features/2026-07-18-provider-endpoint-config.md).
This issue covers optional services around the agent:

- OpenAI embeddings for semantic search.
- Gemini or Claude scan vision.
- OpenAI HQ transcription and text-to-speech.
- Mistral Voxtral, Deepgram, and OpenAI Realtime transcription paths.
- Other model-backed helpers found during the inventory.

Do not include non-model connectors such as Google Workspace, Telegram, web
push, Cloudflare publishing, or git remotes. OpenRouter cannot replace their
service-specific APIs.

Voice needs its own conclusion. An OpenRouter model that accepts audio is not
necessarily a replacement for a speech API. Check realtime streaming, partial
and final transcript boundaries, word timing and confidence, diarization,
custom vocabulary, text-to-speech output, latency, and browser-safe ephemeral
credentials. It is acceptable for voice to remain on specialist providers.
Compare the findings with the existing [Gemini transcription watch](../../watch/2026-08-27-gemini-transcribe-as-transcription-backend.md),
[Deepgram Flux exploration](../../exploration/2026-08-13-deepgram-flux-stt-tts-turn-taking.md),
and [Fish Audio exploration](../../exploration/2026-06-15-fish-audio-s2-streaming-transcription.md).

## Research

Checked 2026-09-06 against OpenRouter's live `openapi.json` and model catalog,
and against the code as of `10c6425d3`. Nothing in the repo references
OpenRouter today, so this is greenfield on our side.

### What OpenRouter actually offers now

It is no longer chat-completions-only. The live spec exposes `POST /embeddings`,
`POST /audio/transcriptions`, `POST /audio/speech`, `POST /rerank`,
`POST /images`, `POST /videos`, plus `/chat/completions`, `/responses`, and an
Anthropic-shaped `/messages`. There is **no websocket or realtime surface at
all** — the strings "realtime" and "websocket" do not appear anywhere in the
OpenAPI document.

Pricing is pass-through with no inference markup; the cost is 5.5% ($0.80
minimum) on credit top-ups. Provider routing is controllable per request via
`provider: { only, order, zdr, data_collection }`, so an aggregator does not
have to mean an unknown egress path — a request can be pinned to one named
provider and to ZDR endpoints in code.

### Inventory

| # | Workload | Today | OpenRouter equivalent | Adoption cost |
|---|---|---|---|---|
| 1 | Semantic/hybrid search embeddings | `POST api.openai.com/v1/embeddings`, `text-embedding-3-small` @512 dims, secret `openai`, automatic on index refresh (`src/services/openai-embeddings.ts:125`) | `POST /embeddings`, model `openai/text-embedding-3-small`, `dimensions` supported, $0.02/M — the same list price | base URL + model prefix + a provider pin |
| 2 | View/dashboard API adapter proxy | `ANY /api/adapters/:adapter/*` → replicate/mistral/anthropic/openai (`src/webapp/routes/api-adapters.ts:39`) | `/chat/completions`, `/messages`, `/responses` all exist | one `ADAPTERS` entry |
| 3 | Scan-import photo analysis, Gemini backend | `@google/genai` `generateContent`, `gemini-2.5-flash`, image input + JSON-schema output, opt-in via `BBX_SCAN_VISION=gemini` (`src/core/commands/scan-import-gemini.ts:225`) | `google/gemini-2.5-flash` on `/chat/completions`, image input and `structured_outputs` both supported | SDK → HTTP rewrite |
| 4 | `bbx chat ask-about-audio` | `@google/genai`, `gemini-3.7-flash`, base64 `inlineData` audio, manual CLI (`src/core/audio-question.ts:13,69`) | `google/gemini-3.7-flash` accepts audio input on `/chat/completions` | SDK → HTTP rewrite |
| 5 | HQ batch transcription — Whisper family | multipart `api.openai.com/v1/audio/transcriptions`, `whisper-1` / `gpt-4o-transcribe` / `gpt-4o-mini-transcribe`, secret `openai-thinking` (`src/core/transcription/index.ts:63,288`) | all three model ids present; `verbose_json`, `timestamp_granularities` supported | adapter, with losses (below) |
| 6 | Batch transcription — Voxtral | multipart `api.mistral.ai/v1/audio/transcriptions`, diarization flag, secret `mistral` (`src/core/transcription/voxtral.ts:37`) | `mistralai/voxtral-mini-transcribe`, `mistralai/voxtral-small-24b-2507-stt`; diarization surfaces as `speaker` on words/segments | adapter, with losses |
| 7 | Batch transcription — Deepgram | `POST api.deepgram.com/v1/listen`, `nova-3`, per-word confidence (`src/core/transcription/deepgram.ts:22`) | `deepgram/nova-3` present | adapter, **loses per-word confidence** |
| 8 | Chat text-to-speech | `POST api.openai.com/v1/audio/speech`, `gpt-4o-mini-tts-2025-03-20`, 13-voice vocabulary (`src/services/openai-audio.ts:41`, `src/shared/voice-models.ts`) | **no OpenAI TTS model on OpenRouter at all** — the speech catalog is Deepgram/Fish/MiniMax/Qwen/Gemini/Voxtral/Kokoro | no path |
| 9 | Realtime dictation — Voxtral WS | server proxies `wss://api.mistral.ai/v1/audio/transcriptions/realtime` (`src/webapp/routes/chat-audio-routes.ts:182`) | none | no path |
| 10 | Realtime dictation — Deepgram | server mints a 20-min scoped key, browser opens `wss://api.deepgram.com/v1/listen` (`src/webapp/trpc/routers/transcription.ts:69`) | none | no path |
| 11 | Realtime dictation — OpenAI | server mints `/v1/realtime/client_secrets`, browser opens `wss://api.openai.com/v1/realtime`, `gpt-realtime-whisper` (`transcription.ts:131,138`) | none | no path |

The default scan-vision backend is Claude through the Agent SDK on subscription
auth, so it is out of scope with the main agent model.

### Parity gaps that decide the grouping

- **Embedding vector identity.** `EMBEDDER_ID` is
  `openai:text-embedding-3-small@512` and is hashed into every card's embed
  record (`src/core/search/embed-pass.ts:42`); a change re-embeds every card in
  every box. Routing must therefore produce byte-comparable vectors and leave
  the id alone. `openai/text-embedding-3-small` on OpenRouter routes to **OpenAI
  or Azure**, so the request has to pin `provider: { only: ["openai"] }`. One
  empirical check settles it: embed the same string both ways and compare.
- **`prompt` is not in OpenRouter's STT request.** Its transcription schema is
  `file`/`model`/`language`/`response_format`/`temperature`/
  `timestamp_granularities[]` — no `prompt`, and so no Voxtral `context_bias`
  either. This is narrower than it first looks: **no HQ caller passes a
  prompt.** `transcribeAudioHq` is reached from `POST /api/chat/transcribe-audio`
  and `bbx chat retranscribe`, and neither sets one. The only call site that
  does is the batch transcribe preaction, which passes existing card content
  (`src/core/preactions/transcribe.ts:96`) into either Whisper's `prompt` or
  Voxtral's `context_bias` (`src/core/transcription/voxtral-request.ts:101`).
  The HQ pass can therefore move to OpenRouter with no feature loss; the batch
  path is the one that would lose something.
- **Per-word confidence is dropped.** OpenRouter's normalized `STTWord` is
  `{word, start, end, speaker}`. Deepgram's own response carries per-word
  confidence, which is exactly the signal the transcript-`<unsure>` work needs
  (see the Gemini transcription watch item).
- **No realtime, at all.** All three live-dictation paths are websocket
  protocols with provider-specific message shapes and browser-side ephemeral
  credentials. OpenRouter can mint expiring API keys (`POST /keys` takes
  `expires_at`), but that needs a *provisioning* key — a second credential
  class — and there is no stream to point it at anyway.
- **No OpenAI TTS.** Not a quality trade-off; the model is absent. Our
  `VOICE_MODELS` vocabulary (alloy…verse) is a closed set in the personality
  card schema, so any substitute is a schema and content migration, not a
  routing change. **Corrected 2026-09-06:** "no model" was too strong —
  OpenRouter carries eighteen TTS models from other vendors and most work well
  (measured in
  [Gemini TTS over OpenRouter](../features/2026-09-06-gemini-tts-over-openrouter.md)). What is missing
  is an OpenAI model, a backend seam to select a substitute, and the
  `instructions` style prompt, which OpenRouter's speech request drops silently.

### Egress, retention, cost, concentration

- **Egress** gains one intermediary. Mitigable in code per request with
  `provider: { zdr: true, data_collection: "deny", only: [...] }`; OpenRouter's
  own logging is governed by account settings rather than the request, and its
  docs are explicit that the provider-policy toggle "has no bearing on
  OpenRouter's own policies".
- **Cost** is list price + 5.5% on top-up. Embeddings at $0.02/M and the
  occasional scan or `ask-about-audio` call are rounding errors either way; the
  saving is accounts and keys, not dollars.
- **Concentration.** A negative OpenRouter balance returns 402 for *every*
  model including free ones. Consolidating embeddings + scan vision +
  `ask-about-audio` behind one balance means one unpaid invoice takes out
  semantic search, scan import, and audio Q&A together, where today each fails
  independently. Voice staying on specialist providers limits the blast radius
  usefully.
- **Keys removable.** None outright. `openai` (embeddings) becomes optional;
  `gemini` becomes optional if both Gemini call sites move. `openai-thinking`
  stays for TTS and realtime minting, `mistral` and `deepgram` stay for
  realtime, and the adapter secrets stay because views name their provider.

### Grouping

**Consolidate now** — exact endpoint, exact model, no feature loss.

1. Embeddings (#1), pinned to the OpenAI provider, gated on one vector-identity
   check.
2. An `openrouter` entry in the API-adapter table (#2).

**After a bounded adapter or test.**

3. Scan-import Gemini vision (#3) and `ask-about-audio` (#4) — both are
   SDK-to-HTTP rewrites onto endpoints and models that exist; both are opt-in
   or manual, so a regression is cheap.
4. Whisper HQ transcription (#5) — `transcribeAudioHq` passes no prompt, so the
   three Whisper variants move with no feature loss; word timestamps survive via
   `verbose_json` + `timestamp_granularities[]`, and the live check below
   confirms an exact match. The non-HQ batch path (`transcribeAudio`, reached
   from capture and the transcribe preaction) keeps its prompt/`context_bias`
   and stays direct.

**Keep on a specialist provider.**

5. Voxtral HQ transcription (#6) — moved here from the adapter group once the
   live check showed OpenRouter's Voxtral refuses `verbose_json` and cannot
   diarize; see below.
6. Deepgram batch (#7) — the model exists, but OpenRouter's normalized `STTWord`
   has no confidence field, and per-word confidence is the reason to run this
   backend.
7. All three realtime dictation paths (#9, #10, #11) — structural, not a gap
   that closes with a model release.
8. Text-to-speech (#8) — no *OpenAI* model, and the voice vocabulary is schema-level.

### Voice, as its own line

Voice stays where it is. The three realtime paths need a streaming protocol
OpenRouter does not have, and TTS needs a model it does not carry. OpenRouter
does not change the evaluations already filed — the Gemini transcription watch,
Deepgram Flux, and Fish Audio all remain judged on latency, partial/final
boundaries, confidence, and turn-taking against direct APIs. The only voice
workload OpenRouter could take is the HQ batch pass, and it takes it worse than
the direct call does.

### Decisions (2026-09-06)

- **Precedence: the service's own provider key wins; OpenRouter is the
  fallback.** Adding an OpenRouter key must never change what an already-working
  box does — the egress path and, for embeddings, the vector identity both stay
  put. Consolidating is then an explicit act: remove the direct key from the
  secret store and the service falls through to OpenRouter. No per-service
  provider field either way.
- **First build: the consolidate-now group, the two Gemini rewrites, and HQ
  transcription** — embeddings, an `openrouter` API-adapter entry, scan-import
  vision, `ask-about-audio`, and the Whisper HQ variants. HQ joined the set once
  it was clear that no HQ caller passes a prompt, so nothing is lost there.
  Voxtral HQ was in this set until the live check ruled it out. The non-HQ batch
  path, Deepgram batch, TTS, and all three realtime paths stay on their direct
  providers.

### Cross-model review (2026-09-06)

Codex reviewed the branch diff. Seven findings, all real; six fixed in the same
change:

- `voxtral-diarized` over OpenRouter never asked for diarization — segment
  timestamps are not speaker labels. It now sends Mistral's `diarize` through
  OpenRouter's provider-option passthrough, and warns when diarization was
  requested and nothing came back labeled, because an ignored passthrough option
  fails silently and an unlabeled transcript looks exactly like a one-speaker
  recording.
- `BBX_OPENROUTER_API_KEY` was read and documented but absent from all three env
  allowlists (`lib/env.ts` redaction, `hub/child-env.ts`, `core/script-env-allowlist.ts`),
  so a hub-level env var would never have reached the box child.
- The docs claimed granting the key lights up scan-import vision. It does not:
  `BBX_SCAN_VISION=gemini` still selects that backend, and the key only decides
  how it is reached. Claim narrowed rather than behavior widened — the default
  Claude backend needs no key and is the better one, and a granted credential
  must not quietly move scan import off it.
- `geminiKeyCheck` reported "audio questions will not work" on a box answering
  them through OpenRouter. It now resolves the same route its callers do.
- HQ transcription reported `0s` duration whenever OpenRouter omitted the
  top-level field. It now walks the same ladder the direct Voxtral arm does:
  `duration`, then `usage.seconds`, then the last timed segment or word.
- The view-authoring docs still listed four API adapters.

The seventh is the open one, below. The `whisper.ts` extraction was checked
against `main` and carries no behavior change.

## Live verification (2026-09-06)

The boxholder supplied an OpenRouter key, so every route was exercised against
the real API rather than reasoned about. This retires the manual-testing gate
this issue briefly carried.

**Embedding vectors are bit-identical.** The same two strings embedded direct
and through OpenRouter (`openai/text-embedding-3-small`, 512 dims, pinned
`only: ["openai"]`) came back with `maxAbsDiff` of exactly `0.000e+0` and cosine
`1.000000000000` on both. Keeping the route out of `EMBEDDER_ID` is correct: a
box that swaps an OpenAI key for an OpenRouter one keeps its index.

**All three Whisper HQ modes match the direct call exactly.** Every variant was
run on both routes, with and without word timestamps — twelve runs, identical in
all four result fields:

| HQ mode | Model | Result, both routes |
|---|---|---|
| `whisper` | `openai/whisper-1` | text, `duration` 3.21, `language` english, 9 word timestamps |
| `whisper-llm` | `openai/gpt-4o-transcribe` | text, `duration` 0, `language` `""` |
| `whisper-llm-mini` | `openai/gpt-4o-mini-transcribe` | text, `duration` 0, `language` `""` |

The empty duration and language on the two LLM variants are a property of those
models, not of OpenRouter — they answer in plain `json` on the direct route too.
`whisper` is the default `hqService`, so a box holding only an OpenRouter key
gets a working HQ pass with nothing else set.

**Voxtral cannot route, and this was the find that mattered.**
`mistralai/voxtral-mini-transcribe` answers a `verbose_json` request with
`400 The selected model does not support response_format "verbose_json"`, so
every Voxtral HQ pass through OpenRouter would have failed outright. In `json`
mode it returns text and nothing else — no segments, no words, no language, no
speaker labels. Mistral's `diarize` sent through OpenRouter's provider-option
passthrough produced byte-identical output and identical cost, which is exactly
how a silently-dropped passthrough behaves. So `voxtral-diarized` could not have
diarized at all. Both Voxtral variants now stay on Mistral, and `bbx health`
says so rather than naming a fallback that will never run.

**Diarization exists on OpenRouter, just not on any model we use.** Probed
because ruling Voxtral out left the box with no speaker-labeled route at all.
Only 9 of the 20 transcription models accept `verbose_json`, and of those,
`microsoft/mai-transcribe-2` with `azure.diarization.enabled` labeled a
four-turn two-voice clip correctly (`0,1,0,1`) for $0.00047, while
`x-ai/grok-stt-1.0` produced labels but over-split. `deepgram/nova-3` forwarded
the flag yet returned one speaker throughout — on synthetic test audio, so that
is not a verdict on the model. Written up as
[a diarizing HQ backend over OpenRouter](../../exploration/2026-09-06-openrouter-diarizing-stt-backend.md);
adopting one is a new-model decision, not a routing one.

The same probe settles a doubt worth recording: OpenRouter's speaker
normalization is sound. The field appears only when a diarize flag is sent —
never with `diarize: false`, a bogus option key, or empty options — so the
passthrough genuinely reaches the provider and real speaker values survive it.

**Both Gemini arms work.** `ask-about-audio` transcribed the clip correctly and
answered a question about the voice. Scan-import analyzed a two-image batch
through the JSON Schema derived from `rawScanAnalysisSchema`: the
`{ analyses: [...] }` wrapper round-tripped, batch alignment passed, and
reasoning tokens parsed (928 thinking tokens on that batch).

**One cross-route inconsistency, fixed.** The LLM transcription variants filled
`language: "unknown"` on the OpenRouter route where the direct arm fills `""`.
That value reaches a card's frontmatter, so the same recording would have
described itself differently depending on which key the box held. The OpenRouter
arm now matches `whisper.ts`.

All six request bodies were also validated against OpenRouter's published
OpenAPI schemas before any of this — worth noting that the schema check passed
the Voxtral request that the live API rejects. A published schema says what is
well-formed, not what a model supports.
