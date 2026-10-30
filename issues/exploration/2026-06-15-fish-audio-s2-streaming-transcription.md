---
title: "fish audio s2 streaming transcription"
workstream: unknown
area: beebox
---

[Fish Audio S2](https://fish.audio/s2/) is a real-time speech-to-text service
worth evaluating as another option behind the realtime-transcription seam
(alongside the existing Voxtral WS proxy, Deepgram, and the OpenAI
realtime-whisper service). Motivation: realtime Whisper has been stubborn about
**short utterances** — a quick "send message" or a one-word reply can finalize
slowly or get smoothed away — which is exactly where a low-latency streaming
model with a clean partial/final boundary would help. The transcription layer is
already provider-pluggable (config-selected per box), so adding S2 is a WS
client adapter conforming to the same machine contract, not new architecture.

What to actually measure when prototyping: **short-utterance latency and
accuracy** (the failure mode that prompted this), partial-vs-final stability (do
interims thrash?), how cleanly STOP→final resolves (our slow-path keyword send
waits on the final), per-minute cost vs. Deepgram, and whether it offers a
temp-key/browser-direct path or needs a server proxy like Voxtral. File under
"curious how well it works" — a focused bake-off against the current providers
on a handful of real short voice commands, not a commitment to switch.

Re-reviewed 2026-10-30: The premise looks wrong. Elsewhere in the repo, Fish S2 is a text-to-speech model (tested as TTS in the TTS comparison), and Fish's transcription model is `transcribe-1`. Whether Fish offers streaming STT at all needs checking before any bake-off.

Out of date in the body above: Correct the premise: S2 is Fish Audio's TTS model. Re-point the evaluation at Fish's STT offering (transcribe-1) only if it has a realtime/streaming mode; otherwise close. Note that browser on-device STT (research/browser-live-stt) is now another short-utterance option.
