---
title: "iOS: input pauses while the box speaks, but the UI still looks like an open mic"
workstream: unattached
area: beebox
labels: [ios, voice, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "iOS pauses input while there is speech, but doesn't show it"
---

On iOS, when the box's speech playback starts mid-voice-turn, dictation input
pauses — by design, the turn stays open across the pause
(`NativeComposerView.swift` ~:988: "the turn stays open across the pause for
the box's speech and the reply streaming in before that speech starts") — but
the composer keeps its listening face. It **looks like the mic is open** while
nothing the user says is being heard.

The honest state is "paused while the box speaks", and it needs a face:
distinct mic-button state (paused, not recording, not idle), and ideally a
one-word label so the user knows speaking is futile until playback ends.

Boundaries with the siblings, so three issues don't fight over one control:

- [record-button-silently-waits](2026-08-20-ios-record-button-silently-waits-for-speech.md)
  (`voice-barge-in`, fix awaiting manual test) is about *pressing record
  during speech* — barge-in. This issue is the *already-open* turn's face
  during the pause.
- [narration icon ambiguity](2026-08-06-narration-mode-icon-ambiguous-with-mic.md)
  is the same control's iconography from another angle; whoever designs the
  paused state should check all three states read distinctly.

If barge-in lands fully (speech stops when you talk/press), the paused state
may become rarer but not gone — the pause still exists between reply
streaming and playback start. The `voice-barge-in` dormant stream is the
natural owner if it resumes; otherwise standalone.
