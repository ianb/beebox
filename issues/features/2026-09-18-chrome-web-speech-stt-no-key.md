---
title: "Offer browser Web Speech as a live-transcription option, and as the no-key fallback"
workstream: unattached
area: beebox
labels: [voice, transcription]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder wants a no-key dictation path on the web
priority: normal
---

Every dictation path today needs a provider key. `loadTranscriptionConfig`
(`beebox/src/core/transcription/dispatch/core.ts:175`) defaults to `voxtral` for
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

## Re-encounter (2026-10-06): an option for live transcription, not only a fallback

The boxholder raised this again with a wider goal: browser speech recognition
as an **option for live transcription even when a key is configured**, "even
if it only replaces live transcription". The HQ pass stays as it is. This
changes the "fallback, not a competitor" framing above: the browser engine is
a candidate for the live path, and the server provider keeps HQ.

New facts (web research, 2026-10-06; verify in the browsers):

- **On-device mode.** Chrome 139 added `processLocally` on
  `SpeechRecognition`: with a downloaded language pack, audio stays on the
  device. That answers most of the "where the audio goes" question above for
  Chrome. Safari reportedly works offline only for English.
- **Session limits.** The boxholder recalls a limit of about five minutes.
  Chrome is known to end a session after a stretch of silence even with
  `continuous = true`, and historically capped sessions (about 60 s in older
  reports). Live dictation would need to restart the recognizer
  transparently and stitch results without dropping or duplicating words.
  Measure the real limits in current Chrome and Safari.
- **iPhone Safari.** Reports say `continuous` keeps the mic open on iPhone
  without delivering final results. The native iOS composer has its own path
  (Apple's SpeechAnalyzer), so this is likely desktop web and Android only.

What to establish, in addition to the list above: a browser-speech choice in
the transcription settings (or per device) that replaces only the streaming
service; restart and stitching behavior at the session limit; how live text
from the browser feeds the existing HQ flow and voice keywords
(`beebox/src/frontend/src/lib/audio/speech-keywords.ts`); and provenance on
the message so the box knows which engine produced it.

Priority may be stale given the wider goal.
