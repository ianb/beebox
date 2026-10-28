---
title: "The web live recorder closes the microphone after about 5 minutes with no new live text"
workstream: mic-idle-close
area: beebox
labels: [voice, frontend]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request, 2026-10-28
---

When the web live recorder is open and no new live text has come in for about
5 minutes, it should close the microphone on its own. Today it stays open until
the person stops it: nothing in the live transcription machine
(`beebox/src/frontend/src/machines/realtime-transcription-live/`) ends a
recording for inactivity, and `transcription-connections.ts` sends Deepgram a
KeepAlive frame so that the provider does not close an idle stream either. A
forgotten recorder keeps the mic, the browser's recording indicator, and the
live-transcription connection open.

"Idle" means no new live text, not silence on the mic. Background noise that
transcribes to nothing should still count as idle.

To decide when this is built:

- What happens to the recording so far. The lean: stop as if the person
  pressed stop, without sending. Text already in the composer stays there, and
  the HQ pass runs on the audio as it would after a manual stop.
- What the person sees: a short notice that the mic closed because nothing was
  said, so a closed mic is not mistaken for a dropped one
  ([the recording-drop alarm](../closed/bugs/2026-09-30-recording-drop-klaxon-conflates-mic-and-live-text-loss.md)
  separated those two cases already).
- Whether the iOS app needs the same limit. Its open-mic sleep problem is a
  separate issue ([iOS sleeps with the mic open](../bugs/2026-08-18-ios-sleeps-with-the-mic-open.md)).

## Decided (2026-10-28)

- The machine already had a 5-minute auto-stop on `recording`, but every
  live-text update restarted it, including Deepgram's empty results for noise
  and unchanged re-sends. Now only new words restart it
  (`NO_LIVE_TEXT_TIMEOUT_MS` in
  `beebox/src/frontend/src/machines/transcription-events.ts`).
- The timer also runs while live text is down (`recordingLocal`). A box
  whose live text never connects otherwise kept the mic open for the
  hour-long segment limit. The cost: a person who talks through more than 5
  minutes of a network outage has the mic closed on them. The audio up to
  that point is kept.
- The close ends the segment the way a manual stop does: the text goes to
  the composer and the recording is sealed. A manual stop does not run the
  HQ pass (the recording is sealed with `hq: null`), so neither does this.
  The lean above was wrong about that.
- It also ends the voice turn, so a reply that arrives later does not reopen
  the mic.
- The notice is a warning in the chat bar: "Mic closed — no new words for 5
  minutes". It plays the normal mic-off sound, not the mic-lost cue.
- iOS: under the native composer the microphone is native, and this web
  machine does not run there. No bridge or HTTP surface changed. Whether the
  native recorder needs the same limit stays open.
