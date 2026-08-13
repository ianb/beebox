---
title: "Evaluate Deepgram Flux — conversational STT, TTS, and turn-taking"
workstream: unattached
area: callback-box
needs: [design]
labels: [research, voice, deepgram]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder note
---

Deepgram has a **Flux** family worth looking at: Flux STT, Flux TTS, and
built-in turn-taking. We already use Deepgram
(`src/core/transcription/deepgram.ts`, with a `deepgram-key.ts` on the frontend
audio side), so this is evaluating a newer model from an existing vendor rather
than adding one.

## What it claims to be

From Deepgram's own material (verify against docs before designing anything):

- **Flux STT** is pitched as conversational speech recognition built for voice
  agents rather than transcription — understanding conversational flow and
  handling **turn-taking and interruptions** natively, which they frame as *the*
  problem in voice agents.
- **Flux TTS** is "conversation-native" text-to-speech, holding tone,
  expression, and continuity across a whole session. Notable implementation
  detail: a **Mamba state-space backbone with fixed-size memory**, so
  session-long context doesn't carry quadratic cost.
- The two run as **one integrated stack on a single connection**, with Deepgram
  orchestrating the timing between listening and speaking.
- Free tier for building through 2026-09-12 (45 concurrent streaming
  connections globally, 5 in EU/AU) — so an evaluation is cheap if done soon.

## Why turn-taking is the interesting part here

Turn-taking is where callback-box's voice UX actually hurts, and the evidence is
already filed:

- **"clear message" stops the microphone on iOS** but not on web — a spoken
  keyword ending the turn when it shouldn't (fixed in the `ios-clear-mic`
  workstream, 2026-08-12; the `.erase` intent emitted
  `applyVoiceTurn(.microphoneStopped)`, the same transition `.micOff` uses
  deliberately).
- The keyword vocabulary itself (`SpeechKeywords.swift`) is a **hand-rolled
  turn-taking layer**: `send and close`, `send and stop`, `mic off`, `erase` —
  spoken commands compensating for a recognizer that doesn't know when a turn
  ended.
- Narration mode, earcons, and the mic-tab lock (`mic-tab-lock.ts`) are all
  scaffolding around "who is speaking now".

If Flux handles turn detection natively, some of that hand-rolled layer could
retire. That's the question worth answering — not "is the transcription better".

## What an evaluation should establish

- **Turn-taking**: does its end-of-turn detection actually beat the current
  keyword-plus-heuristics approach, on real dictation with pauses, thinking
  aloud, and mid-sentence corrections?
- **Where it runs.** The iOS app currently uses on-device `SpeechAnalyzer` with a
  legacy `SFSpeechRecognizer` fallback. Flux is a streaming cloud service, so
  adopting it for dictation is a **privacy posture change** — there's already a
  filed concern about the legacy fallback streaming audio to Apple, and this
  would be streaming to Deepgram deliberately. Name that trade explicitly.
- **Does Flux STT replace or complement Voxtral?** `cb chat retranscribe` runs a
  high-quality pass; that's a different job (accuracy on demand) from live
  conversational STT, and they may coexist.
- **TTS**: what do we use today, and is session-long tonal continuity worth
  switching for? Narration is the obvious consumer.
- **Cost and failure modes** — a single connection carrying both directions is
  elegant until it drops.

Land findings in `research/` per `research/CLAUDE.md`, then link back with a
recommendation.

Sources: [Introducing Flux](https://deepgram.com/learn/introducing-flux-conversational-speech-recognition),
[Flux TTS](https://deepgram.com/learn/introducing-flux-tts-conversation-native-text-to-speech-for-real-time-voice-agents),
[Flux docs](https://developers.deepgram.com/docs/flux/quickstart).
