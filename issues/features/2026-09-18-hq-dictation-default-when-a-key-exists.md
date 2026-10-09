---
title: "Make HQ dictation the default whenever a transcription key is configured"
workstream: hq-always
area: beebox
labels: [voice, transcription]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder asking to reconsider HQ as the default, not the exception
needs: [manual-testing]
---

HQ dictation is opt-in: a per-chat value with landmark and box defaults above
it, resolved server-side
([sticky HQ preference](../closed/features/2026-08-26-sticky-hq-transcription-preference.md),
[the switch](../closed/features/2026-08-22-hq-dictation-switch-separate-from-narration.md)).
The boxholder wants the opposite default considered: **if a key is configured,
use HQ in all cases.**

The argument for it is that a wrong transcript is expensive in a way a slower
one is not. A misheard name or number becomes a card, and the boxholder then
edits text instead of speaking. A setting that has to be switched on per chat
is a setting most utterances never get.

## What exists today

- `loadTranscriptionConfig` (`beebox/src/core/transcription/dispatch/core.ts:175`)
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

## Decision (2026-10-06)

Not combined with the `ios-on-device-hq` workstream, which is nearly finished. The direction stands: HQ dictation should not be an opt-in setting. Removing the setting is the remaining work, not yet started.

## Implementation (2026-10-09, hq-always)

Built on `worktree-hq-always` per [the plan](../../beebox/docs/plans/hq-always.md).
Answers to "What to work out":

1. **Where the default lives.** Nowhere: there is no setting. Every voice send
   with a recording requests HQ, and the box decides availability — a box
   with no usable key fails the job on the first piece and the client sends
   the live text. The chat feature, box default, landmark seed, their routes,
   and the voice-menu row are removed; stored values are ignored on read.
2. **Paths.** Web keyword send, Send button, and max-duration all run through
   `runKeywordSend`, now always HQ. The iOS conversation composer always runs
   its durable preparation (on-device, server, live). iOS quick chat stays
   live and is marked so ([follow-up](2026-10-09-ios-quick-chat-on-device-hq.md)).
   Capture clips and the transcribe preaction already batch-transcribe whole
   recordings and are unchanged.
3. **Cost.** Noted in the plan, `docs/chat/composer.md`, and contract §4.4a:
   about $0.006/min on `whisper`/`whisper-llm`, $0.003/min on
   `whisper-llm-mini`; on-device passes cost nothing.
4. **Key stops working.** Revoked or missing key: permanent failure, live text
   sent, one dismissible voice notice. Rate limit or 5xx: the job retries; the
   pending bubble offers "Send live text now"; the 5-minute budget sends live.
5. **Provenance marker.** Flipped: `<speech stt="live">` marks the exception,
   HQ text carries only `stt-service`. A send keyword the HQ text lacks is
   appended as `<send-message … heard="live" />`.

## Manual testing

Web (desktop or phone browser, a box with an HQ key):

1. Dictate a sentence and say "send message". Expected: the pending bubble
   shows "Transcribing…", then the message sends with the HQ text; the voice
   menu has no HQ dictation row; the message has the small "HQ" badge and no
   "Live text" line.
2. Dictate and tap Send. Expected: same as 1, with no send tag.
3. Tap "Send live text now" on a pending bubble. Expected: the live text sends
   with "Live text — HQ transcript unavailable" under it.
4. On a box with the HQ key removed (or `hqService` set to a service the box
   has no key for), dictate and send. Expected: the message sends within a
   second or two with the "Live text" line, and one voice notice names the
   missing key.

iOS (iOS 26 device):

5. In a chat, dictate and say "send message" with narration off. Expected: the
   composer shows the voice message being prepared, then the chat shows the
   HQ text with the "HQ" badge (on-device service `apple-speech-transcriber`
   on hover/long-press title).
6. Dictate and tap Send. Expected: same as 5.
7. On a box whose HQ service diarizes (`voxtral-diarized`) and has no
   `mistral` key, dictate and send. Expected: the on-device pass is skipped
   (diarized service), the server pass fails, and the live transcript is sent
   with the "Live text" line.
8. On the box screen, dictate a quick chat thought. Expected: it sends at once
   (live), as before.

