---
title: "Network trouble in live transcription takes the HQ pass down with it — the local recording should not depend on the live channel"
workstream: hq-recording-resilience
design: ../../beebox/docs/plans/resilient-voice-recording.md
area: beebox
priority: important
labels: [transcription, diarization, resilience, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "I was using diarization to record a conversation, and there were several network failures and issues. These were probably in the live transcription, but the hq transcription didn't go through as a result."
---

Recording a conversation with diarization on, the boxholder hit several network
failures. His read is that they were in the **live** transcription — the
Deepgram/realtime socket — but the consequence was that the **HQ** pass never
went through, so the good transcript was lost along with the flaky one.

His principle, and it is the right one: **the local recording should be more
resilient than that.** The audio is captured locally by `MediaRecorder`
(`beebox/src/frontend/src/lib/audio/recorder.ts`) and sits in memory as a blob.
Nothing about turning that blob into an HQ transcript needs the live socket to
have behaved. A conversation is also the highest-value thing to record and the
most annoying to be asked to repeat.

## What the code shows

The HQ pass is reached only from inside the voice-submit flow
(`beebox/src/frontend/src/components/chat/voice-keyword-send.ts`): when
`runHq && audioBlob`, it calls `prepareVoiceSubmitEmission({ …, transcribe:
(blob) => postAudioForHqTranscription(blob, { sessionId }) })`. That promise's
`.catch` releases the dispatch and shows "Voice message kept for recovery".
So the HQ attempt is one branch of a submit that the realtime machine drives —
if the realtime side errors or the flow never reaches that branch, the blob is
never offered to the HQ endpoint at all.

There is a second, quieter path to the same outcome:
`postAudioForHqTranscription` returns `null` on any non-OK response, and `null`
means "fall back to the realtime transcript" — filed separately as
[HQ transcription fails silently](2026-09-09-hq-transcription-fails-silently.md).
During a network-flaky stretch that fallback is exactly wrong: the realtime
text is the degraded artifact, and it silently becomes the kept one.

I have not reproduced the failure, so which of these fired — or whether the
recording was lost earlier, in the recorder or the machine's teardown — is
unestablished. That is the first thing to find out.

## What the logs show (2026-09-10)

The failure was traced in the box's client and server logs. The HQ pass was
not skipped. It ran and the provider rejected it:

- A deploy restarted the hub (SIGTERM 18:55:03, serving again 18:56:06 UTC).
  The realtime service was `voxtral`, which is proxied through the box
  server, so the live socket died with it.
- 18:56:20 — the server logged `HQ transcription failed: Request failed with
  status code 400 Bad Request: POST https://openrouter.ai/api/v1/audio/transcriptions`
  (HQ service `mai-diarized`). The client logged `falling back to realtime`.
- 18:56:31 — the message arrived as 1288 words of realtime text. The segment
  was about 11 minutes: ~21 MB of 16 kHz WAV, ~28 MB after base64. The
  6-minute diarized recordings before and after it succeeded.
- The upstream reason is lost: the error keeps only the status line. Size is
  the likely cause, but unverified.

The code also shows real paths where the live channel does lose the
recording, which did not fire this time: reconnect-window expiry (8 s),
connect failure at segment start, the 15-minute cap, and errors that bubble to
the machine's `active` level. Each ends the segment with text only. The plan
lists them with citations.

The chat voice recording is not a `MediaRecorder` blob, as the text above
assumed. It is PCM held inside the transcription actor
(`transcription-actor.ts`). `MediaRecorder` is capture mode's recorder.

## What a fix needs to establish

- **Decouple the HQ pass from the live channel's health.** A completed local
  recording should get its HQ attempt regardless of what the realtime socket
  did. Whether that means the HQ pass moves out of the submit flow, or the
  submit flow stops being conditional on realtime success, is a design call.
- **Retry the HQ upload.** A transient network failure on `POST
  /api/chat/transcribe-audio` should not be terminal. Same reasoning as
  [transient 502s aren't retried](2026-09-09-deploy-restart-502-surfaces-as-json-parse-error.md);
  this is a mutation, so it needs its own deliberate policy rather than the
  query retry that issue installs.
- **Don't discard the audio on failure.** The blob is already retained
  per-emission for `bbx chat get-last-audio` via `retainVoiceAudio`. If the HQ
  pass fails, that retained audio is the recovery material — say so, and make
  re-running HQ against it possible, rather than leaving the boxholder with
  realtime text and no way back.
- **A long conversation is the hard case.** Diarized recording of an actual
  conversation runs far longer than a dictated message: more chances for the
  socket to drop, a bigger blob to upload, and more lost if it goes. Whatever
  is built should be evaluated against that shape, not against a ten-second
  dictation.
