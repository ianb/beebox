---
title: "Speech output: a standing style instruction, inline delivery markup, or both — and Voxtral TTS 3 as a backend"
workstream: unattached
area: beebox
needs: [design]
labels: [voice, tts]
filed-by: agent
discovered-by: Ian
discovered-in: main-checkout conversation, 2026-10-20 (Voxtral 3 release)
priority: backlog
---

Speech backends take delivery direction in two shapes:

- **Instruction:** one description that applies to a whole request or turn.
- **Inline markup:** tags in the text at the point they apply.

The box uses only the first. The boxholder writes direction once, on the
personality card's `speaking-voice.instructions`, and
`beebox/src/core/tts/style.ts` (`deliverStyle`) places it in each backend's
field. Nothing lets the agent mark delivery phrase by phrase.

## What each backend takes

| Backend | Instruction | Inline |
|---|---|---|
| OpenAI (default) | `instructions` field | none |
| Gemini 3.8 Flash-Lite (`gemini-3.8-flash-lite-tts`) | `speech_metadata.style`, per turn | sounds and pauses only: `<laugh>`, `<sigh>`, `<short pause>`, `<long pause>` |
| Voxtral TTS 3 (`voxtral-mini-tts-3-0`) | none documented | `[emotion=…]` (34 values) and `[pace=…]`, each in effect until the next tag; laughs and breaths in the same syntax |

Notes:

- Gemini 3.8 speaks other text in the input word for word, including written
  direction. That is why Gemini speech has no OpenRouter route (code comments
  in `beebox/src/services/tts.ts`). Gemini 3.1 used square-bracket tags that
  could change delivery mid-text; 3.8 split this into per-turn style plus
  sound tags. The 3.8 details come from a third-party guide
  ([philschmid.de](https://www.philschmid.de/gemini-3-8-tts)); Google's pages
  did not render for the fetch tool.
- Voxtral TTS 3
  ([docs](https://docs.mistral.ai/studio/audio/text-to-speech/overview),
  [tags](https://docs.mistral.ai/studio/audio/text-to-speech/emotion-tags))
  also has phoneme pronunciation hints, an expressiveness setting (≥ 1.0),
  preset and cloned voices, and a streaming model
  (`voxtral-mini-tts-realtime-3-0`). The announcement mentions emphasis
  control; the docs show no syntax for it. The docs disagree on the pace tags
  (overview: 2; tag page: five, `very-slow` to `very-fast`). Price: $13 per 1M
  characters. One Mistral key would then cover live transcription, HQ and
  speech.

## Design questions

- **Two layers.** The personality instruction stays the standing style. The
  agent adds inline markup in its spoken output. Is that worth the agent's
  attention, and in which cases (a joke, bad news, a list read slowly)?
- **One markup for the agent.** The agent should write one neutral form, and
  each backend maps it: Voxtral takes emotion, pace and sounds; Gemini takes
  sounds and pauses; OpenAI takes none. Unsupported marks must be stripped, as
  Gemini reads unknown text aloud. The chat display strips all of them.
- **Voxtral and the standing instruction.** Voxtral has no instruction field.
  `deliverStyle` would need an inline kind. The instruction is either dropped
  (and reported, as the `unsupported` kind does now) or becomes a default
  emotion and pace tag at the start.
- **Pronunciation.** Phoneme hints could fix names the box knows. This links
  to the box-level vocabulary in
  [bias speech with box vocabulary](../features/2026-09-11-bias-apple-speech-with-box-vocabulary.md).

Related: [Hume prosody](2026-05-28-hume-ai-prosody.md),
[move to Voxtral 3](../features/2026-10-20-upgrade-transcription-to-voxtral-3.md),
`beebox/docs/plans/tts-backend-selection.md`.
