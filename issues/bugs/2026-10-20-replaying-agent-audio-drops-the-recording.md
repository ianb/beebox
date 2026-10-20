---
title: "Replaying the agent's audio while recording drops the recording made so far"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main-checkout conversation, 2026-10-20
priority: normal
---

Reported by the developer: while the recorder is on, replaying one of the
agent's spoken replies drops the recording up to that point. The person loses
what they had already said.

Not established when filed: which client (web or the iOS app), whether the
recording stops or continues after the replay, and whether the lost audio is
gone or only detached from the message. The expected behaviour is that
recording and playback can happen together, or that playback is refused or
paused while recording, with the recording kept either way.

Related, closed:
[iOS recorder stops silently](../closed/bugs/2026-07-31-ios-capture-recorder-stops-silently.md),
[recording-drop alarm](../closed/bugs/2026-09-30-recording-drop-klaxon-conflates-mic-and-live-text-loss.md).
