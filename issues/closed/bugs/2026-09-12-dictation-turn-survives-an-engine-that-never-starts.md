---
title: "A dictation turn stays open when the engine never starts, leaving a stop control over an editable composer"
workstream: ios-pairing-papercuts
area: beebox
labels: [ios, voice]
filed-by: agent
resolution: implemented
discovered-by: agent
discovered-in: worktree-ios-pairing-papercuts — verifying the dictation keyboard fix on a simulator
---

Tapping the microphone opens a voice turn (`voiceTurn.isActive`) and asks the
dictation engine to start. When the engine then fails to come up, nothing closes
the turn: `dictation.isRecording` and `dictation.isStarting` both go false while
`voiceTurn.isActive` stays true.

The composer's trailing control shows the red stop square for
`voiceTurn.isActive || isVoiceRecording || isVoiceStarting`, but
`isTextEntryLocked` is scoped to the two narrower terms. So the composer offers
to stop a recording that is not happening, over a text field that is editable —
and the screen is held awake for the turn.

Observed on an iPhone 17 simulator, where audio input does not work: the client
debug log shows `audio: audio session role=recording` followed by
`role=idle` in the same millisecond, with no `dictationFailed` in between.
The simulator is not the interesting part — it is the demonstration that
`.dictationFailed` does not fire for every way a start can fail. A device whose
microphone is taken by another app, or whose session is interrupted during
bring-up, reaches the same shape.

Fixed 2026-09-12 with the first of the two below. `NativeVoiceTurnEvent` gained
`.dictationWentIdle`, which the composer sends when `dictation.state` reaches
`.idle` with no start pending; the turn closes unless it is the deliberate pause
while the box speaks, which `waitingForSpeech` already names. The hands-free
reopen after a send does not trip it — that path commands the next start before
the state change is observed, so `isStarting` is already true. Covered by
`NativeVoiceTurnTests` (the unexpected idle, the speech pause surviving it and
still resuming, and idle after the turn already closed).

The two candidates were:

- Close the turn when the engine reports it is neither recording nor starting
  after a start was requested — the turn's state machine currently trusts the
  start to either succeed or report failure, and this is the third case.
- Widen `isTextEntryLocked` to `voiceTurn.isActive`. This is the blunter one and
  it costs something real: a turn stays open across the box's reply and its
  speech, which is ordinary typing time, so the composer would lock when nothing
  is listening. Rejected as the primary fix for that reason.

Anchors: `ios-app/BeeBox/Views/NativeComposerView.swift` —
`isTextEntryLocked`, `trailingControl`, `applyVoiceTurn`;
`ios-app/BeeBox/Models/NativeComposerContract.swift` — the voice-turn state.
