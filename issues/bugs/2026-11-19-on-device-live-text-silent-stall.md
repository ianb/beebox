---
title: "On-device live text can stop returning words with no error"
workstream: unattached
area: beebox
labels: [voice, transcription]
filed-by: agent
discovered-by: agent
discovered-in: worktree-browser-live-text-option — making on-device live text a Voice settings choice
---

Chrome's on-device recognizer, used when a device picks "This device" under
Voice settings → While you speak, can stop returning results mid-recording
with no error and no `end` event. The research measured it in 1 of 8 runs with
5+ minutes of silence and did not reproduce it in 3 repeats
([research](../../research/browser-live-stt/README.md), "Silent failure").
When it happens, live text and spoken keywords stop; the recording continues.
The existing 5-minute idle close limits exposure.

`BrowserSpeechLink`
(`beebox/src/frontend/src/machines/realtime-transcription-live/transcription-browser-speech.ts`)
restarts only on `end`. A guard was drafted in the worktree above and left out
to keep that change small. Shape:

- On the link's existing 200 ms tick, add time while the mic hears speech
  (`getMicLevel()` above a threshold and the mic not held); any result, or a
  new recognizer, resets it.
- At about 4 s, drop the recognizer's handlers, abort it, fold its text, and
  restart through the same guarded path `onEnd` uses.
- Cap stall restarts per segment (about 3): the rapid-restart cap does not
  count restarts 4 s apart, so loud non-speech would otherwise restart forever.
- The actor's `abandonLive` should also clear `browserSpeech`, so mic recovery
  does not report a detached link as restored.

The threshold needs calibration against a real microphone's noise floor.
