---
title: "Gemini speech: play streamed PCM as it arrives (first audio in about 1 s)"
workstream: gemini-tts-38
area: beebox
filed-by: agent
discovered-in: gemini-tts-38 — Gemini 3.8 TTS benchmark
resolution: implemented
---

**Closed:** Resolved by the plan `beebox/docs/implemented-plans/tts-streamed-playback.md` (commits 794204cae, 70fe47f69, dcca0f8c7). Divergence: the server encodes Gemini PCM to MP3 with ffmpeg and streams it, rather than playing PCM through Web Audio. iOS keeps buffered playback by decision.

The direct Gemini speech route (`beebox/src/services/tts.ts`) already asks
Google for a stream, but the server buffers the whole clip and sends one WAV,
because the chat client cannot stream WAV: `MediaSource` supports no WAV type,
so `playable.ts` downloads the clip in full before playing it.

Measured 2026-10-04 on `gemini-3.8-flash-lite-tts` (synthetic text, medians of
five): streamed, the first audio arrives in about 1.0 s for 3, 10, and 27
seconds of speech. Today the boxholder waits for the whole clip, which takes
1.9, 3.2, and 6.2 s. The plan's progress section has the full table
(`beebox/docs/plans/tts-backend-selection.md`, 2026-10-04).

## What it would take

- The route passes the stream through instead of buffering: chunked raw 16-bit
  24 kHz PCM, labeled as such (for example `audio/L16; rate=24000`).
- The client plays PCM chunks through Web Audio (an `AudioWorklet` or queued
  `AudioBufferSourceNode`s) when the content type says PCM, keeping the
  existing blob path for WAV and `MediaSource` for MP3.
- Caching, replay, stop and fast-forward (`tts-client/client.ts`,
  `speechPlaybackMachine.ts`) have to work on accumulated PCM.
- The iOS app plays the same audio inside the web view, so it needs a check on
  device. The `/api/chat/tts` route is not in the mobile contract today.

## Open questions

- Whether the empty-clip guard (`MIN_PLAUSIBLE_AUDIO_BYTES`) still applies once
  bytes are already flowing to the browser, or becomes a mid-stream error.
- Whether to stream the OpenRouter route too. Its endpoint returns raw PCM over
  HTTP, but in the benchmark its first byte arrived only slightly before its
  last.
