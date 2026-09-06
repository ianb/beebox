---
title: "TTS backend selection, and per-backend style direction"
status: partial
workstream: unattached
issues:
  - ../../../issues/features/2026-09-06-gemini-tts-over-openrouter.md
---
# TTS backend selection, and per-backend style direction

> When the box speaks a reply I want it to sound right for the moment — hushed
> because it is late and the house is asleep, brisk because I am on my way out,
> gentle because the news is bad. I say so in plain words on the personality
> card, and the voice changes.

That already works, on exactly one vendor. This plan gives text-to-speech the
backend selection transcription already has, and makes the style direction the
boxholder writes survive the choice of backend — translated into whatever form
that backend understands, or refused visibly where it has none.

**Issues addressed:**
[gemini-tts-over-openrouter](../../../issues/features/2026-09-06-gemini-tts-over-openrouter.md).
Grepped the queue for `tts`, `speech`, `voice`, `prosody`, `speaking-voice`: the
only other live items are
[openrouter-diarizing-stt-backend](../../../issues/exploration/2026-09-06-openrouter-diarizing-stt-backend.md)
and the deferred
[openai-batch-stt-retirement](../../../issues/deferred/2026-09-06-openai-batch-stt-retirement.md),
both speech-to-text and neither resolved here. No duplicate found.

## Stated preferences this plan trades against

- **Principle 4, resilient AND never silent** (`docs/engineering-principles.md:49`):
  *"Degradation is allowed for failures that can genuinely happen; invisible
  degradation is not."* This is the plan's spine. OpenRouter's speech request
  has no `instructions` field and **ignores one silently** — HTTP 200 with
  audio. A backend that cannot honor the boxholder's style direction must say
  so, not quietly speak flat.
- **Principle 13, a control shows the state the system is in**
  (`docs/engineering-principles.md:151`): *"An affordance may display only what
  is actually true."* The picker must show the backend actually in use and
  whether style direction reaches it.
- **Principle 8, one way to do each thing** (`docs/engineering-principles.md:95`):
  *"Consolidate over blast-radius fear."* There are currently three copies of
  the default instructions string and two different default voices; this plan
  does not get to add a fourth.
- **Principle 10, testability is architectural** (`docs/engineering-principles.md:116`):
  *"a pure decision core extracted from an IO shell."* The style-translation
  decision is the risky part and must be a pure function.
- **Precedent**: the transcription backend seam shipped in this workstream —
  `_config/transcription.json`, `publicProcedure` read / `ownerProcedure` write
  (`src/webapp/trpc/routers/transcription.ts:29-35`), a picker deriving its
  union from `shared/`, and a `bbx health` line naming the live route. TTS
  should look like that, not like something new.

## What already exists

- **A service interface that production does not use.**
  `src/services/openai-audio.ts:22-27` defines `OpenAIAudioService`, and
  `createOpenAIAudioService(apiKey)` at `:29` is **never called anywhere in
  `src/`** — only the fake is, in tests. The live path is an inline `ky.post`
  in the route's fallback branch (`src/webapp/routes/chat-audio-routes.ts:150-166`),
  reached because `ctx.openaiAudio` is always `undefined` in production. **Reuse
  by making it real**, not by adding a parallel path: the seam this plan needs
  is already declared, just unwired.
- **Three copies of one default.** `"Fast and concise, but with a friendly
  lilting tone."` appears at `src/services/openai-audio.ts:44`,
  `src/webapp/routes/chat-audio-routes.ts:165`, and
  `src/frontend/src/lib/audio/tts-client.ts:28`. Two different default voices:
  `"alloy"` (`openai-audio.ts:43`) and `"marin"` (`chat-audio-routes.ts:143`,
  `tts-client.ts`). Consolidate per principle 8.
- **The voice vocabulary and its schema.** `src/shared/voice-models.ts:10-14`
  holds the 13 names; `src/schemas/personality.tsx:46-49` validates them:
  `model: z.enum(VOICE_MODELS).optional()` inside `SpeakingVoiceEntry`,
  registered at `:98` as `"speaking-voice": SpeakingVoiceEntry.optional()`.
  `src/frontend/src/lib/audio/speech-parsing.ts:9-16` validates the `voice`
  attribute of a `<speech>` tag against the same set.
- **Instructions are assembled client-side, not server-side.** The personality
  card's `speaking-voice.instructions[]` is compiled to
  `_content/docs/generated/speaking-voice.json`
  (`src/schemas/personality.tsx:145-151`, `src/core/docs-gen/compile.ts:382-386`),
  served by `GET /api/chat/voice-config`
  (`src/webapp/routes/chat-audio-routes.ts:113-127`), joined and merged with any
  per-segment `<instructions>` tag in
  `src/frontend/src/lib/audio/tts-client.ts:78-83`, and sent as one string.
  `override-instructions="1"` replaces the base instead of appending
  (`speech-parsing.ts:124`). **The server receives a finished string** — this
  plan does not need to touch the composition, only the translation.
- **Playback is coupled to `audio/mpeg`.** `src/frontend/src/lib/audio/context.ts:111-117`
  gates MediaSource streaming on `MediaSource.isTypeSupported("audio/mpeg")`,
  and `:339` calls `addSourceBuffer(mimeType)` with the same literal; `:198` and
  `:285` default the mime type to it. A WAV-returning backend must fall to
  `playAudioBlob`, which is already the non-MediaSource path
  (`tts-client.ts:205-248`).
- **The config precedent.** `loadTranscriptionConfig` /
  `updateTranscriptionConfig` (`src/core/transcription/index.ts:138-188`) —
  `withCardLock` read-merge-write, `ENOENT` means defaults, parse errors bubble.
  `_config/box.json` is the other backend-choice file
  (`agentEngine`) but goes through a git-committing writer
  (`src/webapp/box-config-write.ts:17`); transcription's lighter shape is the
  right precedent here, since a voice choice is not history worth committing.

## Prior art (external)

- **Google documents prompt-embedded style control as a supported feature**, not
  an emergent trick: *"Text-to-speech (TTS) generation is controllable, meaning
  you can use natural language to structure interactions and guide the style,
  accent, pace, and tone of the audio"* —
  https://ai.google.dev/gemini-api/docs/speech-generation. Their own example is
  `Say in an spooky whisper: "…"`. It also documents inline tags (`[whispers]`,
  `[laughs]`). **This corrects a risk stated in the issue**: the style prefix is
  a documented contract, not a fragile convention.
- **SSML is the named standard for prosody control, and is useless here.** Of
  the OpenRouter TTS backends tested, `microsoft/mai-voice-2` reads SSML aloud
  verbatim (`<speak version="1.0" xmlns…` narrated character by character, HTTP
  200, no error), as do Aura-2 and Kokoro with a plain-English instruction. No
  backend on OpenRouter accepts SSML. Searched for a cross-vendor prosody
  interchange format other than SSML and found none — the field has converged on
  per-vendor natural language, which is why translation-per-backend is the shape
  rather than a normalized prosody model.
- **OpenAI's `instructions` is free-form natural language too**, with the same
  documented scope (accent, emotional range, intonation, impressions, speed,
  tone, whispering). So OpenAI→Gemini translation is close to identity; the hard
  cases are backends with no mechanism at all.

## Tracks / scope

Ordered by dependency: nothing else can be built until the service the route
ignores is actually wired up.

### Track 1 — make the declared service seam real

**What.** Wire `ctx.openaiAudio` so the route stops using its inline fallback,
and collapse the duplicated defaults into one place.

**Why this needs to change.** `createOpenAIAudioService` has never run in
production (`src/services/openai-audio.ts:29`). Adding a second backend to the
route's inline branch would make two dead abstractions and one live `if`-ladder.
Every later track depends on there being one place where a TTS request is built.

**Direction.** Rename the interface to `TtsService` (it will no longer be
OpenAI-specific) and give the factory a route, mirroring embeddings:

```ts
export interface TtsService {
  readonly backend: TtsBackend;
  /** Whether this backend can honor style direction at all. */
  readonly stylable: boolean;
  textToSpeech(text: string, opts?: { voice?: string; instructions?: string }): Promise<TTSResult>;
}
export function createTtsService(opts: { backend: TtsBackend; route: ModelRoute }): TtsService;
```

The route resolves the backend from config and the key from
`core/openrouter.ts`'s `routeVia`, then calls the service. The inline
`ky.post` at `chat-audio-routes.ts:150-166` is deleted, not kept as a fallback.
One `DEFAULT_TTS_INSTRUCTIONS` and one `DEFAULT_VOICE` constant in `shared/`,
imported by all three current copies.

**Vocabulary lock-ins.** `TtsService`, `TtsBackend`, `stylable`,
`DEFAULT_TTS_INSTRUCTIONS`, `DEFAULT_VOICE`.

**First implementation chunk.** Wire the existing OpenAI implementation through
`ctx.openaiAudio`, delete the inline branch, unify the two default constants.
No new backend, no config, no behavior change — `test/webapp/routes/chat-tts.doctest.md`
must pass unchanged.

### Track 2 — the backend vocabulary and its config

**What.** `_config/tts.json` holding one field, and a `shared/tts-backends.ts`
vocabulary, exactly mirroring transcription.

**Why this needs to change.** There is no way to express "this box speaks with
X". The boxholder constraint is that the preference is exposed, so it needs a
stored value before it can have a control.

**Direction.**

```ts
// shared/tts-backends.ts
export const TTS_BACKENDS = ["openai", "gemini"] as const;
export type TtsBackend = (typeof TTS_BACKENDS)[number];
```

`loadTtsConfig` / `updateTtsConfig` in `src/core/tts/config.ts`, copying
`transcription/index.ts:138-188` including `withCardLock` and the ENOENT-means-
defaults rule. Default `"openai"` — an existing box must not change how it
sounds because this shipped. tRPC `tts.config` (`publicProcedure`) and
`tts.setBackend` (`ownerProcedure`), with the same reasoning the transcription
router records at `:29-35`: choosing which provider the box spends against is
credential-adjacent and therefore the boxholder's.

**Vocabulary lock-ins.** `_config/tts.json`, the field name `backend`, the
values `openai` and `gemini`, `TTS_BACKENDS`.

**First implementation chunk.** The shared vocabulary, the config module, and
its doctest. No UI, no second backend.

### Track 3 — style translation as a pure function

**What.** One pure function that turns the boxholder's `instructions` string
into whatever the chosen backend takes, or reports that the backend takes
nothing.

**Why this needs to change.** This is the boxholder's second constraint, and the
place principle 4 is at stake: today a wrong answer here is inaudible to us and
audible to them.

**Direction.**

```ts
export type StyleDelivery =
  | { kind: "field"; instructions: string }      // OpenAI: its own `instructions` field
  | { kind: "prefix"; input: string }            // Gemini: prepended to `input`, per Google's docs
  | { kind: "unsupported"; dropped: string };    // no mechanism — the caller must surface this

export function deliverStyle(opts: {
  backend: TtsBackend;
  text: string;
  instructions: string | undefined;
}): StyleDelivery;
```

Gemini's `prefix` follows the documented form **exactly** — `<instruction>:
"<text>"`, colon and quotes. This is load-bearing, not cosmetic: a period
separator before a short text returns empty audio every time (Failure modes),
so the separator is the function's whole reason to exist rather than a detail
its callers could choose. A
`discriminated union` rather than an optional field so a new backend cannot be
added without deciding — principle 2, exhaustiveness. `unsupported` carries the
dropped text so the log line can name what was lost rather than saying
"instructions ignored".

**Vocabulary lock-ins.** `StyleDelivery`, the three `kind` values, `deliverStyle`.

**First implementation chunk.** `deliverStyle` plus its doctest, covering all
three kinds and the no-instructions case. Pure function, no callers yet.

### Track 4 — the Gemini backend

**What.** The second `TtsService` implementation, PCM→WAV, and the empty-body
guard.

**Why this needs to change.** It is the point of the plan, and it is last
because it is the only track that can fail for reasons outside our control.

**Direction.** `POST {OPENROUTER_BASE_URL}/audio/speech`, model
`google/gemini-3.1-flash-tts-preview`, `provider: openRouterProvider("google-ai-studio")`,
`response_format: "pcm"`, style via `deliverStyle`. Wrap the PCM in a 24 kHz
mono 16-bit WAV header — lossless, no transcoding — and return
`contentType: "audio/wav"`. **A zero-length or implausibly short body is a typed
error, never a returned buffer** (see Failure modes).

**Vocabulary lock-ins.** Backend id `gemini`; `audio/wav` as a second content
type the frontend must accept.

**First implementation chunk.** The Gemini service against a fake HTTP layer,
plus the WAV wrapper as a pure function with its own doctest.

### Track 5 — the control and the health line

**What.** The backend picker in the voice menu, and `bbx health` naming the live
TTS route.

**Direction.** Extend `VoiceChip-panels.tsx`'s existing menu with a third
section, deriving its union from `shared/tts-backends.ts` — never a hand-written
copy, per the comment already at `:15-17`. Where the selected backend is not
`stylable`, the menu item says so on its own line rather than leaving the
boxholder to discover it. `modelRoutesCheck`
(`src/webapp/trpc/routers/health-model-routes.ts`) gains a TTS line.

**First implementation chunk.** The picker section and its tRPC wiring.

## Could this be simpler?

**The simplest version** is one line: change the hardcoded model in
`chat-audio-routes.ts:164` to Gemini's, prepend the instructions to the input,
and wrap PCM as WAV. No config, no vocabulary, no picker. About thirty lines.

**What it fails on, specifically.** It is a silent, unannounced change of who
speaks in the boxholder's house, applied to every box on merge. The whole
OpenRouter workstream held one line — a credential or a deploy never changes
which model runs without the boxholder choosing it — and this would break it
louder than anything else, because the change is *audible*. It also strands the
`instructions` a personality card already carries: Gemini needs them in a
different position, so a one-line swap either drops them or speaks them aloud.

**What the fuller plan buys, and what it does not.** Tracks 1-3 are the minimum
that satisfies the two stated constraints; Track 1 is not extra scope but the
removal of a dead abstraction that would otherwise be duplicated. **Track 5 is
the genuinely cuttable one** — the config could ship editable-by-hand only, and
the picker follow later, if the boxholder would rather see the backend working
before it gets a control. Recommend keeping it, per principle 13, since a
preference with no visible state is exactly the affordance that rule is about.

## Subplans

**None, in the end.** One was planned — `tts-backend-selection.voices.subplan.md`,
the per-backend voice vocabulary — and it was made unnecessary by the boxholder
mapping the voices directly (see Progress). The original framing, kept because
it explains why the question looked like a design step:
`VOICE_MODELS` is a closed `z.enum` in a card schema
(`src/schemas/personality.tsx:47`), Gemini's 30 voices share none of those
names, and the questions are a decision table, not an implementation: does the
enum become a union of per-backend sets, or a loose string validated at the
seam; what does a card naming `alloy` do when the backend is Gemini (refuse,
fall back to a default, or map to a nearest voice); and does the existing card
corpus need a migration or only new writes. Tracks 1-3 do not depend on it —
they carry the voice through unchanged — so it can be designed while they are
built. **Track 4 must not ship without it**, because a Gemini backend that
silently ignores `speaking-voice.model` is the same silent-drop bug in a
different field.

## Failure modes

> **Resolved, and it was our bug, not theirs.** Gemini returned **HTTP 200 with
> a zero-length body** on some inputs, and two rounds of measurement failed to
> characterize it — first blamed on style-plus-length, then refuted. A third
> round found the actual rule: a style sentence ending in a **period**, followed
> by a **short** text, yields empty audio deterministically (0 of 10 on one
> input, and 0 of 6 on another). Every other combination is fine, and the
> separator is the whole story:
>
> | Text | `style. text` | `style: text` | `style: "text"` | `style\ntext` |
> |---|---|---|---|---|
> | short (29 chars) | **0/6** | 6/6 | 6/6 | 6/6 |
> | long (85 chars) | 6/6 | 6/6 | 6/6 | 6/6 |
>
> The failing form is one I invented; **Google's documented form is the colon**
> (`Say in an spooky whisper: "…"`). So `deliverStyle` emits colon-and-quotes,
> and the failure disappears. This is why the plan's Track 3 fixes the prefix
> format rather than leaving it to the caller.
>
> **The empty-body guard is still built.** Not because this failure remains
> reachable, but because a zero-length buffer returned as success is inaudible
> to us and reaches the boxholder as silence they will blame on their speakers
> (principle 4). A guard whose trigger we think we have eliminated is cheap; a
> silent speech path is not.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Gemini returns 200 + empty body | `deliverStyle` doctest asserts the colon form; Track 4 doctest asserts the throw | trigger removed by the prefix format, plus `EmptyTtsResponseError` below a byte floor | clear once built |
| Backend has no style mechanism, `instructions` dropped | to write (Track 3 doctest, `unsupported` kind) | `StyleDelivery.unsupported` + one warn + a menu note | clear once built |
| `speaking-voice.model` names a voice the backend lacks | `tts-voices.doctest.md` | boxholder's mapping for all 13; `substituted` + warn otherwise | clear |
| WAV-returning backend hits the MediaSource path | to write (frontend doctest) | route on `contentType`, not on `supportsMediaSource()` alone (`context.ts:111-117`) | clear: playback throws today rather than silently failing |
| OpenRouter key absent, backend is `gemini` | to write (config doctest) | typed error naming the secret, as `MissingOpenRouterKeyError` does for MAI | clear |
| Gemini preview model withdrawn or renamed | none possible | health line shows the live backend; error surfaces on next speak | clear |
| Style prefix starts being spoken aloud after a model revision | none possible | — | **silent to us, audible to the boxholder** — accepted risk, documented below |

The last row is accepted rather than fixed: detecting "the model read the
instruction aloud" needs a transcription round-trip on every utterance, which
costs more than the failure. Google documents the behavior as supported
(Prior art), which is the mitigation available.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED. The agent writes `<speech>` and
  `<instructions>` tags; neither changes. The new vocabulary (`backend`) is
  boxholder-facing config, not agent-facing.
- **Stale ref** — not applicable: no card refs are involved. Noting rather than
  omitting.
- **Two agents touching the same card** — ADDRESSED for config by `withCardLock`
  in `updateTtsConfig` (copying `transcription/index.ts:162`). The personality
  card is unchanged by this plan.
- **Hand-edit drift** — ADDRESSED. A hand-written `_config/tts.json` with an
  unknown backend fails the zod parse loudly, matching
  `storedTranscriptionConfigSchema`'s behavior (`transcription/index.ts:132-135`,
  where "parse / schema errors are a real bug — let them bubble").
- **Fabricated free-form value** — ADDRESSED by the closed `TTS_BACKENDS` enum.
- **Validation error UX** — ADDRESSED: the missing-key error names the secret to
  grant, following `MissingOpenRouterKeyError`.
- **Partial migration / transition state** — ADDRESSED. Default is `openai`, so
  a box that never touches the setting behaves exactly as today; there is no
  data migration in Tracks 1-5. The voice vocabulary migration is the subplan's.
- **A box switches backend mid-session** — GAP. `tts-client.ts` caches audio by
  a key built from text+voice+instructions (`resolveKey`, `:318-329`), which does
  not include the backend, so cached clips from the previous backend keep
  playing in the same session. Fix in Track 5 by folding the backend into the
  cache key; recorded here because it is exactly the kind of thing that would
  otherwise be found by ear.

## NOT in scope

- ~~**Per-backend voice vocabulary**~~ — settled by the boxholder's mapping; no
  subplan and no card migration needed. See Progress.
- **The other sixteen OpenRouter TTS backends.** Two backends prove the seam;
  Aura-2's 90 voices are attractive but it has no style mechanism at all, so it
  should land after `unsupported` has been seen working.
- **Inline `[whispers]`-style tags.** Google documents them and they work
  through OpenRouter (verified), but they are a per-utterance authoring feature
  for the agent, not a backend concern. Separate change.
- **Voice cloning** (`input_references`, Fish Audio) — a different product
  question, no current demand.
- **Bumping the OpenAI TTS snapshot** to `gpt-4o-mini-tts-2025-12-15`.
  Independent of this plan, and carries its own practitioner-reported
  regressions; leave the pin where it is and decide separately.
- **Streaming for Gemini.** The blob path works; MediaSource is an mp3-shaped
  optimization and WAV can wait.

## Open design questions

- ~~**Is the empty-body failure retryable at all?**~~ **Settled 2026-09-06
  before implementation, and it is not a retry question.** Retrying the failing
  input failed 0 of 10, and changing the voice did not help — but changing the
  separator from a period to a colon fixed it 6 of 6. The trigger is a prompt
  form this plan controls, so Gemini ships as a selectable backend rather than
  an experimental one, and Track 4 is no longer gated on this. Detail in Failure
  modes.

- **Should `stylable: false` be selectable at all?** A backend that cannot honor
  the boxholder's stated style is arguably not a valid choice for a box whose
  personality card sets one. **Lean:** allow it, note it in the menu — refusing
  a choice the boxholder explicitly made is worse than telling them the
  consequence.

## Knowledge audits

Skip-with-rationale for Tracks 1-5: this is boxholder-facing configuration and
engine plumbing, not agent-facing vocabulary. The agent's surface — `<speech>`,
`<instructions>`, `override-instructions` — is unchanged, and
`src/core/chat/voice-doc.ts` still describes it correctly.

**The subplan is different and must not inherit this skip.** If the per-backend
voice vocabulary changes what an agent may write into
`speaking-voice.model`, that is agent-facing and needs a `knows_directly` entry
in `src/dev/knowledge-audits.yaml` — there are none for voice today (grepped:
294 audits, none touching TTS or `speaking-voice`) — landed RUN, not just
written.

## What will hold this after it ships

- **`deliverStyle` is a pure function precisely so the cheapest tier reaches the
  risky decision** (principle 10). A pure-function doctest covers all three
  `kind`s; no server, no network.
- **The WAV wrapper is likewise pure** — bytes in, bytes out — so the header is
  asserted directly rather than inferred from playback.
- **The empty-body guard needs the byte floor to be a constant a doctest can
  assert against**, not an inline literal.
- **Route behavior** goes in a route doctest via `makeTestServer()` and the
  existing fake, extending `test/webapp/routes/chat-tts.doctest.md` rather than
  starting a tier.
- **No new test tier and no new mock.** The `TtsService` fake already exists
  (`openai-audio.ts:62-79`) and gains a `backend`/`stylable` field. Worth saying
  plainly: a mock written by the bug's author encodes the bug, so the empty-body
  case is asserted against a fake that returns a real zero-length buffer rather
  than a flag meaning "pretend it was empty".
- **Not a tour.** Playback is audible, not visual; a tour would not catch a
  wrong prosody.

## Implementation order

1. **Track 1** — wire the service, delete the inline branch, unify defaults.
   Behavior-neutral; existing tests must pass untouched.
2. **Track 2** — `shared/tts-backends.ts`, `_config/tts.json`, load/update, tRPC.
3. **Track 3** — `deliverStyle` + doctest. Independent of 2; can be concurrent.
4. ~~Measure the retry question~~ — **done before implementation started**; the
   answer changed Track 3's output format (colon, not period) and removed the
   gate on Track 4. See Failure modes.
5. **Subplan** — per-backend voices, designed and reviewed.
6. **Track 4** — the Gemini backend, WAV wrapper, empty-body guard. Gated on 3,
   4 and 5.
7. **Track 5** — picker, health line, cache-key fix.

Tracks 1-3 are useful on their own and could be merged as a unit if the
boxholder wants the dead abstraction removed before deciding about Gemini —
but the plan ships as one piece unless they say otherwise.

## Progress

Tracks 1, 2, 3 and 5 are built; the doctests named below pass and
`pnpm test:changed` is green (2574).

Track 4 (the Gemini backend) is written and verified end-to-end against the
live API — both backends resolve from config, Gemini's WAV parses as 24 kHz
mono 16-bit, and a round-trip transcription confirms the style direction is
obeyed without being spoken.

**A voice seam had to be built alongside it, ahead of the subplan.** The design
assumed an unmapped voice would degrade; measured, it does not — Gemini answers
**HTTP 400** to every `VOICE_MODELS` name, including the `marin` the route
sends when a box has set no voice. Selecting Gemini would therefore have broken
speech outright for essentially every box. `core/tts/voices.ts` now resolves a
voice per backend and reports a substitution rather than performing it quietly,
mirroring `style.ts`. Two related surprises: the OpenAI and Gemini voice sets
overlap in **zero** names, and OpenRouter's `supported_voices` cannot be used to
validate — `nova` is absent from its list for this model and renders anyway.

**The subplan is no longer needed, and the mapping is why.** Its three open
questions were whether `onyx` should map semantically, what the personality
schema accepts once voices are per-backend, and whether cards migrate. The
boxholder settled the first by ear — auditioning all 43 voices in the
`voice-mapping-openai-to-gemini` exhibit and choosing an equivalent for each of
ours — and that answer collapses the other two: cards keep naming
`VOICE_MODELS`, the translation happens at the seam, and nothing migrates.

The mapping is theirs, not a heuristic, and the difference is visible in the
data: several picks sit four to six semitones from the nearest candidate by
measured pitch, and `nova` maps to the 29th-nearest of thirty. Character, not
frequency. All 13 were verified rendering through the live API.

`resolveVoice` therefore has three outcomes rather than two: `as-requested`,
`mapped` (silent — the boxholder chose it), and `substituted` (warned — nobody
did).

Two things the build changed from the design:

- **`createTtsService` takes an `apiKey`, not a `ModelRoute`.** Passing a route
  was actively wrong: with no `openai-thinking` key, `routeVia` returned the
  box's OpenRouter credential and the OpenAI backend sent it to
  `api.openai.com` for a 401. Neither backend has a fallback — OpenRouter
  carries no OpenAI speech model — so each takes exactly one credential.
  Caught by an end-to-end probe, not by the doctests.
- **The empty-body floor is 512 bytes, not zero.** A four-byte "success" is as
  useless as an empty one, and the fake returns a genuinely short buffer so the
  guard is asserted against the real shape.

## Rollout shape

Tests named while designing, per `docs/testing.md`:

- `test/core/tts-config.doctest.md` — defaults, ENOENT, unknown backend bubbles,
  merge-on-update.
- `test/core/tts-style-delivery.doctest.md` — `deliverStyle` across all three
  kinds, with and without instructions.
- `test/core/tts-wav-wrapper.doctest.md` — header fields for a known PCM buffer.
- `test/services/service-tts.doctest.md` — extends the existing fake test with
  `backend`/`stylable`, and asserts the empty-body throw.
- `test/webapp/routes/chat-tts.doctest.md` — extended: backend selection honored,
  content type follows the backend, missing-key error names the secret.

**Done-when:** those five pass, `pnpm test:changed` is green, and a real Gemini
utterance has been heard by the boxholder — the plan's whole subject is how
something sounds, and no test asserts that.

**Migration:** none in this plan. Default `openai` means an untouched box is
byte-identical. The voice vocabulary migration belongs to the subplan and is
scripted-and-atomic there or not at all.

**Knowledge audits:** none for this plan (rationale above); the subplan lands at
least one, RUN.
