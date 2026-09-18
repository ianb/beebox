---
title: "Make HQ dictation the default whenever a transcription key is configured"
workstream: unattached
area: beebox
labels: [voice, transcription]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder asking to reconsider HQ as the default, not the exception
---

HQ dictation is opt-in: a per-chat value with landmark and box defaults above
it, resolved server-side
([sticky HQ preference](2026-08-26-sticky-hq-transcription-preference.md),
[the switch](../closed/features/2026-08-22-hq-dictation-switch-separate-from-narration.md)).
The boxholder wants the opposite default considered: **if a key is configured,
use HQ in all cases.**

The argument for it is that a wrong transcript is expensive in a way a slower
one is not. A misheard name or number becomes a card, and the boxholder then
edits text instead of speaking. A setting that has to be switched on per chat
is a setting most utterances never get.

## What exists today

- `loadTranscriptionConfig` (`beebox/src/core/transcription/index.ts:175`)
  defaults to `service: "voxtral"` for streaming and `hqService: "whisper"`
  for the HQ pass, overridable in `_config/transcription.json`.
- The HQ pass is a separate call (`POST /api/chat/transcribe-audio`) over the
  captured audio, independent of the streaming service.
- `whisper` resolves its key from the machine secret store, then the
  environment (`transcription/whisper.ts:94`). So "is a key configured" is
  already a question the server can answer.

## What to work out

1. **Where the default lives.** Making it a resolution rule ("no explicit
   value and a key exists → HQ") is smaller than adding another scope level,
   and keeps the existing per-chat and landmark overrides meaningful.
2. **Which paths are covered.** Chat dictation, spoken send, the iOS native
   composer, voice memos, and capture audio do not all go through one place
   today. A default that only reaches web chat is the same ritual with a
   different starting point.
3. **Cost and latency.** HQ adds a second provider call per utterance. Worth
   measuring against real recordings before making it universal, and worth
   saying plainly what it costs per minute of speech.
4. **What happens when the key stops working.** A revoked or rate-limited key
   must fall back to the streaming transcript rather than losing the utterance.
   The secret probe registry (`transcription/deepgram.ts:19`,
   `markSecretVerificationFailed`) already tracks auth rejections; a default
   that silently degrades to non-HQ should still say so through the existing
   `HQ` provenance marker, whose absence is currently the only signal.
5. **Does the provenance marker still earn its place** when HQ is the norm?
   It was designed as evidence of an exceptional pass.

Related: [a no-key STT path](2026-09-18-chrome-web-speech-stt-no-key.md),
[diarization as a capability](2026-08-31-request-diarization-as-capability-not-model.md).
