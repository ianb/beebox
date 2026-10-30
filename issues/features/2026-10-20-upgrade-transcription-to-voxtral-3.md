---
title: "Move transcription to Voxtral 3: Small 3 for the HQ pass, Realtime 3 for live, segment timing for clips"
workstream: unattached
area: beebox
labels: [voice, transcription]
filed-by: agent
discovered-by: Ian
discovered-in: main-checkout conversation, 2026-10-20 (Voxtral 3 release)
priority: normal
---

Mistral released Voxtral 3 ([announcement](https://mistral.ai/news/voxtral-3/),
[speech-to-text docs](https://docs.mistral.ai/studio/audio/speech-to-text/overview)).
The box already uses Voxtral for both passes:

- Live: the WebSocket proxy in `beebox/src/webapp/routes/chat/audio-routes.ts`
  pins `voxtral-mini-transcribe-realtime-2602`.
- HQ and clip transcription: `beebox/src/core/transcription/voxtral/request.ts`
  sends `voxtral-mini-latest`, with `context_bias` when a prompt is given and
  `diarize` for `voxtral-diarized`.

The developer wants the HQ pass on `voxtral-small-transcribe-3-0`. At $0.004/min
against Mini 3's $0.0035/min, the cost difference is small.

## Changes

1. **HQ pass to Small 3.** Diarization is listed for both file models, so
   `voxtral-diarized` should carry over. Confirm with a real request.
2. **Live to `voxtral-mini-transcribe-realtime-3-0`.** Session settings are
   fixed once audio starts. `target_streaming_delay_ms` (80–1,200 or 2,400;
   default 480) trades latency for accuracy. Text is append-only: "A delta
   never corrects earlier text." The HQ pass stays the corrective pass.
3. **Clip timing becomes segment timing.** The docs say Voxtral 3 file models
   refuse `timestamp_granularities=word` with a 400. Capture asks for word
   timestamps (`beebox/src/core/capture/prepare/transcribe-clips.ts:113`) and
   writes them to a `.timing.json` beside the audio card. The developer:
   segment timing is fine. Request `segment`, store segments, and update what
   reads `.timing.json`. `granularityFor` in `request.ts` no longer needs the
   word-or-segment choice for Voxtral.
4. **Check `voxtral-mini-latest` now.** If it already serves version 3, clip
   transcription may be failing today on the word request. Check before the
   rest.

Pin explicit model ids, not `-latest`, so a vendor change does not silently
change behavior.

## End-of-turn detection (open, not part of the upgrade)

Realtime 3 has turn detection
([docs](https://docs.mistral.ai/studio/audio/speech-to-text/turn-detection)).
It is a model that scores whether the person is still mid-utterance, from
sound and meaning, not silence detection. Settings: `start_threshold`,
`eager_end_threshold`, `end_threshold`, `min_silence_ms` (500),
`end_timeout_ms` (3,000). Events: `turn.start`, `turn.eager_end`,
`turn.resume`, `turn.end`. It cannot share a session with diarization.

The developer likes the send keyword and keeps it. Turn detection is worth
considering only because it is semantic. Possible uses, none decided:

- Start the HQ pass on `turn.eager_end`, so the result is ready sooner after
  the keyword.
- A separate opt-in mode that sends on `turn.end`.

Neither should send on a weaker signal than `turn.end`; Mistral's docs give the
same advice for actions that cannot be undone.

## Not in this issue

- Context biasing from box content:
  [bias speech with box vocabulary](2026-09-11-bias-apple-speech-with-box-vocabulary.md).
- Same speaker names across recordings:
  [speaker references](2026-10-20-same-speaker-names-across-recordings.md).
- Speech output: [inline delivery markup](../exploration/2026-10-20-tts-inline-delivery-markup.md).
- Diarization in settings: [diarization as a capability](2026-08-31-request-diarization-as-capability-not-model.md).

Re-reviewed 2026-10-30: Nothing changed yet. `bbx chat retranscribe --timestamps` (beebox/src/cli/commands/chat/audio.ts:212) also requests word timing and belongs in step 3.
