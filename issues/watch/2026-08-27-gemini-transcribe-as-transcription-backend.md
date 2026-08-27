---
title: "Gemini 3.5 Transcribe — evaluate against Voxtral for the chat transcription paths"
workstream: unattached
area: callback-box
labels: [voice]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder shared the announcement
---

Google announced Gemini 3.5 Transcribe
(https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-5-transcribe/):
speech-to-text in two forms — pre-recorded and **Transcribe Live** (streaming,
sub-second latency via the Live API). Claims: 85+ languages with auto-detect,
diarization with word-level timestamps (up to three speakers), 4.0% WER
streaming / 2.6% non-streaming, "smart transcription" (drops filler words,
handles self-corrections), custom vocabulary, 70% latency improvement over
Chirp 3. Public preview; **no pricing disclosed yet**.

Where it would slot in: both chat transcription paths in
`src/webapp/routes/chat-audio-routes.ts` — the realtime WebSocket path
(Mistral Voxtral Realtime, `core/transcription/voxtral.ts`) and the HQ
checkpoint pass (`POST /api/chat/transcribe-audio`, the configured HQ
transcriber). "Smart transcription" and custom vocabulary are interesting for
the HQ pass; sub-second streaming for the realtime one.

Watch-triggers before evaluating seriously:
- Pricing published, and general availability past "public preview".
- A plain API path (AI Studio / Gemini API), not just Antigravity/Enterprise.

When triggered, the evaluation is: WER on the boxholder's actual audio vs
Voxtral (the retranscribe/ask-about-audio machinery keeps real samples),
streaming latency on the transcribe-ws path, and whether "smart transcription"
fights the verbatim needs of `cb chat retranscribe`. Note the adjacent
`codex-native-audio` workstream (agent reads raw audio) reduces how much a
transcript's fidelity matters on codex boxes — weigh both before switching
anything. Also `exploration/2026-06-15-fish-audio-s2-streaming-transcription.md`
is the same kind of watch item; evaluate together.
