---
title: "Text-to-speech over OpenRouter — real options, three blockers"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: worktree-openrouter-services — boxholder asked whether OpenRouter has any TTS options
labels: [providers, voice]
---

The OpenRouter consolidation work concluded that chat text-to-speech stays on
OpenAI because "OpenRouter carries no OpenAI TTS model." That is true and it was
the wrong conclusion to stop at: OpenRouter carries **eighteen** TTS models from
other vendors, and most of them work well. What is actually missing is not a
model — it is a seam to select one, a voice vocabulary that survives the switch,
and the style prompt we send on every call.

## What works (measured 2026-09-06)

One sentence, `response_format: "mp3"`, round-tripped through
`microsoft/mai-transcribe-2` to check the audio was intelligible.

| Model | Latency | Round-trip | $/M | Voices |
|---|---|---|---|---|
| `x-ai/grok-voice-tts-1.0` | 1.24s | clean | 15 | 5 |
| `microsoft/mai-voice-2-flash` | 1.18s | clean | 15 | 4 |
| `hexgrad/kokoro-82m` | 1.24s | clean | 0.62 | 54 |
| `minimax/speech-2.8-turbo` | 1.41s | clean | 60 | 45 |
| `deepgram/aura-2` | 1.54s | clean | 30 | 90 |
| `fish-audio/s2.1-pro` | 2.26s | clean | 15 | voice cloning |
| `deepgram/flux-tts:free` | 2.61s | clean | free | 36 |
| `mistralai/voxtral-mini-tts-2603` | 2.33s | **truncated the sentence** | 16 | 30 |
| `google/gemini-3.1-flash-tts-preview` | — | **rejects mp3, pcm only** | 1 | 30 |

"Clean" means the round-trip differed only by "two" transcribed as "2".

**Voice ids are discoverable but undocumented in the spec.** Every model object
carries a `supported_voices` array (`GET /models?output_modalities=speech`),
which the OpenAPI document does not mention. Without an explicit `voice` every
one of these fails with "An explicit voice is required for this TTS provider."

## The three blockers

1. **`instructions` is silently dropped.** OpenRouter's speech request has no
   such field, and sending it returns 200 with audio rather than an error —
   accepted, ignored. `services/openai-audio.ts` sends a style prompt on every
   call (defaulting to "Fast and concise, but with a friendly lilting tone"),
   and a personality card can override it. Over OpenRouter that silently stops
   having any effect, which is the exact failure mode this workstream spent its
   time avoiding elsewhere.
2. **The voice vocabulary does not survive.** `VOICE_MODELS`
   (`shared/voice-models.ts`: alloy…verse) is a closed set in the personality
   card schema, and no OpenRouter model uses those names — each has its own,
   from 4 to 90 of them. Adopting one means a schema change plus a migration for
   every box whose personality card names a voice (`bbx-migration` territory).
3. **There is no TTS backend seam.** Transcription has `hqService` in
   `_config/transcription.json`; TTS has a hardcoded model
   (`gpt-4o-mini-tts-2025-03-20`) and no selector at all. Adding one means new
   config, and a voice list whose valid values depend on the selection — a
   validation shape the personality schema does not currently have.

## The tension

Blocker 3 is the real work, and it is worth asking whether it earns its keep
before doing it. The plausible motivations, honestly weighted:

- **Cost.** `kokoro-82m` at $0.62/M against OpenAI's TTS is a large multiple,
  but chat TTS volume on a personal box is small, so the absolute saving is
  probably pennies. Weak motivation on its own.
- **One fewer key.** A box that has moved everything else to OpenRouter still
  needs `openai-thinking` solely for TTS and the realtime mint. Removing TTS
  from that list does not remove the key, because realtime still needs it — so
  this only pays off for a box that also does not use realtime dictation.
- **Voices.** 90 Deepgram voices or Fish's voice cloning is a genuinely
  different capability from OpenAI's 13, and is the one motivation that is
  about the product rather than the plumbing. If the boxholder wants a
  particular voice, that is the reason to build the seam.

If the seam gets built, follow the shape the MAI transcription work settled on:
an explicit selection the boxholder makes, never a silent substitution when a
key is absent, and a health line naming what is actually in use. And decide what
happens to `instructions` — either map it onto whatever the chosen provider's
style mechanism is, or say plainly in the UI that it does nothing for that
backend.
