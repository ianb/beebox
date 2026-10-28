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
