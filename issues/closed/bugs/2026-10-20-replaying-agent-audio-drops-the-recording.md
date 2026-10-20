---
title: "Replaying the agent's audio while recording drops the recording made so far"
workstream: replay-recording
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main-checkout conversation, 2026-10-20
priority: normal
resolution: implemented
---

Closed by 4215e5fbc and 5cad1ba41: speech playback while recording now holds the mic (recording silence) instead of cancelling it, and the silence auto-stop is skipped while held. Web only; iOS not changed. Manual check with a real mic, live text and real TTS is still open.

Reported by the developer: while the recorder is on, replaying one of the
agent's spoken replies drops the recording up to that point. The person loses
what they had already said.

Details from the developer: this is the web client (iOS not checked). After
the replay the recorder comes back, but reset: it starts over from empty. The
HQ transcription pass does not recover the earlier audio either, so it is lost. The expected behaviour is that
recording and playback can happen together, or that playback is refused or
paused while recording, with the recording kept either way.

Related, closed:
[iOS recorder stops silently](2026-07-31-ios-capture-recorder-stops-silently.md),
[recording-drop alarm](2026-09-30-recording-drop-klaxon-conflates-mic-and-live-text-loss.md).
