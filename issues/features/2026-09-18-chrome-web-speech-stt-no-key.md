---
title: "Offer browser Web Speech dictation so the web works with no transcription key"
workstream: unattached
area: beebox
labels: [voice, transcription]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder wants a no-key dictation path on the web
---

Every dictation path today needs a provider key. `loadTranscriptionConfig`
(`beebox/src/core/transcription/index.ts:175`) defaults to `voxtral` for
streaming and `whisper` for the HQ pass, and each resolves a key from the
machine secret store or the environment
(`transcription/whisper.ts:94`). A box with no key configured has no dictation
at all.

Chrome (and other Chromium browsers, plus Safari) expose the Web Speech API
(`webkitSpeechRecognition`), which does speech-to-text with no key and no
account. Nothing in `beebox/src/frontend` references it today. Adding it gives
a new box, or a box whose owner has not set up a provider, working dictation
on the web immediately.

## What to establish

- **Where the audio goes.** Chrome's implementation has historically sent
  audio to Google's servers rather than transcribing on-device. That is a
  different egress story from a box's chosen provider, and it happens in the
  browser rather than through the box. Whether that is acceptable is the
  boxholder's decision, and the UI should not present it as equivalent to a
  configured provider.
- **Browser support and behavior.** Availability, language handling, whether
  it stops on silence, and whether continuous mode is reliable enough for
  dictation of more than a sentence.
- **How it fits the existing shape.** The transcription config names services
  (`voxtral`, `deepgram`, `openai-realtime`, `whisper`). A browser-side source
  is not a service the server can call, so it does not slot in as another
  enum value; it is a different transport whose text arrives already
  transcribed. Work out where that joins the pipeline, and what a message
  transcribed that way carries as provenance.
- **Interaction with HQ.** If a key is configured, the server path is better;
  this is a fallback, not a competitor. See
  [HQ by default](2026-09-18-hq-dictation-default-when-a-key-exists.md).
- **Mobile.** iOS Safari's support differs, and the native iOS composer has
  its own audio path, so this may be desktop-web only.
