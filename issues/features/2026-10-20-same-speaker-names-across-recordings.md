---
title: "Label the same speaker the same way across recordings, using Voxtral 3 speaker references"
workstream: unattached
area: beebox
needs: [design]
labels: [voice, transcription]
filed-by: agent
discovered-by: Ian
discovered-in: main-checkout conversation, 2026-10-20 (Voxtral 3 release)
priority: normal
---

Voxtral diarization labels speakers `speaker_1`, `speaker_2` and so on. The
labels hold only within one request: `speaker_1` in two recordings can be two
different people. The developer asked whether diarization can work across
samples.

## What Voxtral 3 offers

`speaker_references`
([docs](https://docs.mistral.ai/studio/audio/speech-to-text/diarize-speakers)):

- Up to 8 named clips per request, 3–15 seconds each, at least 85% speech.
  WAV, Opus, MP3 or FLAC, base64-encoded.
- Segments then carry the clip's name in place of a generic label.
- Works for file transcription (`diarize: true` with segment timestamps) and
  in realtime sessions (`diarize: true`, set before audio starts).
- At most 10 speakers per request, references included.
- Nothing is kept between requests. Each request sends the clips again.

So identity across recordings is the box's job: keep a voice clip per person
and attach the relevant ones to each diarized request. The box sends no
references today (`beebox/src/core/transcription/voxtral/request.ts`).

## Questions

- **Where a clip comes from.** A segment of an earlier diarized recording
  that the boxholder labels ("this is Sam"), cut to 3–15 seconds. The box
  already has segment times to cut on.
- **Where it lives.** Probably beside the person's card, so a person card
  carries their voice reference.
- **Which clips to send.** Eight at most. The boxholder's own clip is likely
  always included; the rest might come from the chat's subject or recent
  participants.
- **Consent.** A stored voice sample of another person is sensitive data. Say
  in the UI what is stored and let a person remove it.
- **Realtime.** Realtime diarization cannot run with turn detection, and its
  segments have no start and end times.

Related: [listening/note mode](2026-08-29-listening-note-mode.md),
[diarization as a capability](2026-08-31-request-diarization-as-capability-not-model.md),
[move to Voxtral 3](2026-10-20-upgrade-transcription-to-voxtral-3.md).
