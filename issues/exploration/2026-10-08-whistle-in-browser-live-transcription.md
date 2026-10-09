---
title: "Consider Cactus's Whistle (17 MB on-device speech model) for live transcription in the web client"
workstream: unattached
area: beebox
labels: [voice, transcription]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder shared the Whistle announcement
---

Cactus Compute announced **Whistle**
([blog](https://cactuscompute.com/blog/whistle); weights `Cactus-Compute/whistle`
on Hugging Face, code `cactus-compute/needle` on GitHub). Claims from the post,
unverified:

- One **16.9 MB** file; runs on the CPU with no dependencies.
- 11 ms to first token and about 1,300 tokens per second on an M4 Pro CPU.
- Ahead of comparable small models on LibriSpeech test-clean and test-other;
  Whisper base (145 MB) is better on some benchmarks.
- English, German, French, Spanish, Italian, Dutch, Polish, with language
  detection.
- **Batch, not streaming:** up to 30 seconds per pass.
- Seventeen targets including **the browser** and a WASI component, through
  Cactus's C++ engine.

## Why it is interesting here

The web client's live transcription streams audio to a server provider
(Voxtral, Deepgram, OpenAI Realtime; `beebox/src/shared/transcription-services.ts`).
The [browser STT issue](../features/2026-09-18-chrome-web-speech-stt-no-key.md)
chose the built-in Web Speech API with on-device processing and rejected
shipping our own model, mainly because candidate models (Moonshine and
others) are a download of a few hundred MB plus GPU load. Whistle's size
removes most of that objection: 17 MB is cheaper than many web pages' images.

## What to find out

- Whether it can run in the page: is the browser target WebAssembly (and
  WebGPU-accelerated or CPU-only), how big the runtime is besides the model,
  and its license and the engine's license.
- **Live behavior from a batch model:** with voice-activity segmentation and
  overlapping short windows, does 11 ms first token make it feel live? How
  are words revised between windows, and does that break spoken-keyword
  detection (`beebox/src/frontend/src/lib/audio/speech-keywords.ts`), which
  runs on live text?
- Accuracy against current live text (Voxtral, Deepgram) on real dictation,
  not LibriSpeech; CPU and battery cost on a laptop; English versus the other
  languages.
- How it would sit next to Web Speech: Whistle works the same in every
  browser (including Firefox, which has no Web Speech recognition), with no
  Google or Apple involvement, at the cost of a download and CPU.

A short spike answers most of this: load it in a scratch page, feed recorded
dictation in short windows, and measure latency, accuracy, and CPU.
