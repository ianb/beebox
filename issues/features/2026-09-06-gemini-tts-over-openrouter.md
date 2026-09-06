---
title: "Gemini TTS over OpenRouter — a prosody-steerable speech backend that isn't OpenAI"
workstream: unattached
area: beebox
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-openrouter-services — boxholder asked whether OpenRouter has any TTS options
labels: [providers, voice]
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

- **It is a preview model.** During testing it returned an **empty audio stream
  with HTTP 200 and no error** on three different phrasings of a whisper
  instruction, having produced whispered audio for a shorter sentence minutes
  earlier. A silent success is the worst failure shape for a speech path, and
  whatever ships needs to detect a zero-length body and say so.
- **The style prefix is a prompt convention, not an API contract.** Nothing in
  OpenRouter's schema says the first sentence of `input` is direction rather
  than script. A model revision could start reading it aloud, and the failure
  would be audible to the user before it was visible to us.
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
