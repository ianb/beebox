---
title: "Gemini TTS over OpenRouter — a prosody-steerable speech backend that isn't OpenAI"
workstream: openrouter-services
area: beebox
needs: [design]
design: ../../../beebox/docs/plans/tts-backend-selection.md
filed-by: agent
discovered-by: Ian
discovered-in: worktree-openrouter-services — boxholder asked whether OpenRouter has any TTS options
labels: [providers, voice]
resolution: implemented
---

> When the box speaks a reply and I want it to sound a particular way — hushed
> because it is late and the house is asleep, brisk because I am walking out the
> door, gentle because the message is bad news — I want to say so in plain words
> and have the voice actually change, so the assistant sounds like it is reading
> the room instead of reciting.

That is what OpenAI's `instructions` field buys us today, and it is the reason
chat text-to-speech was the one service the OpenRouter consolidation work left
alone. **Google's `gemini-3.1-flash-tts-preview`, over OpenRouter, does the same
thing in the same shape** — free-form natural-language style direction — which
makes it the first credible non-OpenAI path for this.

Adopting it is not a routing change. It needs a backend seam that does not exist.

## Why this one and not the other seventeen

Measured 2026-09-06 against the live API. Of the eighteen TTS models OpenRouter
carries, exactly one takes free-form style direction:

- **`google/gemini-3.1-flash-tts-preview` obeys the instruction and does not
  speak it.** Verified by transcribing every output. Against a neutral baseline:
  a whisper instruction dropped amplitude 6.7x, "slowly, sadly, subdued" more
  than doubled duration (2.68s to 5.72s), "flat robotic monotone" measurably
  reduced pitch variation. $1/M, 30 voices.
- **`microsoft/mai-voice-2`, `deepgram/aura-2`, `hexgrad/kokoro-82m` read the
  instruction aloud** as though it were part of the script. MAI narrates SSML
  markup too — `<speak version="1.0" xmlns…` spoken character by character, no
  error. There is no prosody control on these beyond `speed`, and Aura-2 rejects
  even that with a 400.
- **`mistralai/voxtral-mini-tts` has discrete emotion presets** baked into voice
  ids (`en_paul_sad`, `_happy`, `_frustrated`, `_neutral`) which do render
  differently — but it truncated the test sentence on every run.

A listening comparison against OpenAI's `instructions` on the same sentence and
the same five style prompts is in the workstream exhibit store — `bin/exhibits
list --workstream openrouter-services`, "TTS prosody: OpenAI instructions vs
Gemini via OpenRouter". Numbers show the direction and magnitude of the
response; only ears settle whether it is good enough.

**Designed:** [tts-backend-selection](../../../beebox/docs/plans/tts-backend-selection.md).

**Closing note (finish, 2026-09-06):** built per
[tts-backend-selection](../../../beebox/docs/plans/tts-backend-selection.md) — merge
commit `6d11c1a2a` (worktree branch `worktree-openrouter-services`). All four
build items shipped: the backend seam (`core/tts/resolve.ts`,
`_config/tts.json`), per-backend voice resolution with an explicit
substitution/mapping report rather than a silent one (`core/tts/voices.ts`),
style-instruction translation per backend (`core/tts/style.ts`), and the PCM→WAV
wrapper (`core/tts/wav.ts`). One thing not yet true: nobody has heard Gemini TTS
in the live chat UI, and the voice-menu picker hasn't been exercised in a
browser — both are automated/API-verified only. See the plan's own
"Done-when" for that gap.

## What has to be built

1. **A TTS backend seam.** There is none. `services/openai-audio.ts` hardcodes
   `gpt-4o-mini-tts-2025-03-20`, and unlike transcription there is no
   `ttsService` config. Follow the shape the MAI transcription work settled on:
   an explicit value the boxholder selects, never a silent substitution when a
   key is absent, and a `bbx health` line naming what is actually in use.
2. **A voice vocabulary that varies by backend.** `VOICE_MODELS`
   (`shared/voice-models.ts`: alloy…verse) is a closed set validated by the
   personality card schema, and Gemini's 30 voices share none of those names.
   This is the part that needs design: a per-backend valid-voice set is a
   validation shape the personality schema does not have today, and switching
   backends has to do something defined with a card that names a voice the new
   backend does not have. Existing cards need a migration (`bbx-migration`).
3. **`instructions` has to go somewhere.** OpenRouter's speech request has no
   such field and **silently ignores one** — HTTP 200 with audio, no error.
   Gemini takes the style as a prefix inside `input` instead, so the adapter
   maps our `instructions` onto that. For any backend with no style mechanism at
   all, the UI must say the field does nothing there rather than letting a
   personality card carry a setting with no effect.
4. **PCM to WAV.** Gemini TTS is `pcm` only and rejects `mp3`. Wrapping raw PCM
   in a WAV header is cheap and lossless, but it changes the content type the
   chat player receives from `audio/mpeg`.

## Risks to weigh before building

- **It is a preview model, and it silently returns nothing on some inputs.**
  Across two measurement sessions it answered **HTTP 200 with a zero-length
  body**, with no error and no pattern that survived a second run: a styled
  85-character sentence failed 3 of 4, a styled 59-character sentence failed 5
  of 5, while styled 94- and 218-character sentences succeeded 5 of 5 and every
  unstyled input succeeded at all lengths. Two inputs failed all five
  consecutive attempts, so it may not even be retryable. A silent success is the
  worst failure shape for a speech path — the boxholder hears nothing and blames
  their speakers.
- **Correction (2026-09-06): the style prefix IS a documented contract.** An
  earlier version of this issue called it a fragile prompt convention. Google
  documents prompt-embedded style control as supported — *"you can use natural
  language to structure interactions and guide the style, accent, pace, and tone
  of the audio"* (ai.google.dev/gemini-api/docs/speech-generation) — with
  `Say in an spooky whisper: "…"` as their own example, plus inline tags such as
  `[whispers]`. Both forms were verified working through OpenRouter. The
  residual risk is only that OpenRouter sits between us and that contract.
- **Third-party comparisons no longer put OpenAI clearly ahead** on prosody
  (ElevenLabs measured higher on prosody accuracy; Hume exposes explicit
  parameters), so "match OpenAI" may be the wrong bar — worth deciding what the
  bar actually is before building to it.

## What would make this worth doing

Cost is not the reason: chat TTS volume on a personal box makes even a large
per-token multiple worth pennies, and the `openai-thinking` key stays required
for realtime dictation regardless, so this does not remove a credential. The
honest motivations are **voice range** (30 Gemini voices, or 90 on Aura-2, versus
OpenAI's 13) and **not being single-sourced** on a speech vendor whose December
2025 snapshot drew practitioner reports of truncation, silent output, and
degraded instruction compliance — see the OpenAI TTS notes on
[the consolidation issue](../exploration/2026-08-31-openrouter-optional-services-consolidation.md).
