---
title: "fish audio s2 streaming transcription"
area: callback-box
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
