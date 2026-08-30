---
title: "iOS: pressing record while the box is speaking starts a turn that doesn't listen — it silently waits instead of interrupting"
workstream: voice-barge-in
area: beebox
needs: [manual-testing]
labels: [ios, voice, chat, mobile-contract]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder pressed record during speech playback with the volume down
---

> **⏳ Awaiting manual testing** — fix landed in `bd8b5bb4`; on a real phone,
> press record while the box is speaking and check that dictation starts at once
> and the speech stops. Only the developer clears this.

On iOS, pressing the record button while speech playback is active started a
voice turn that **did not listen**. The microphone UI came up, nothing was
transcribed, and dictation only began once the box finished talking.

The boxholder hit this with the device volume turned down, so the speech was
inaudible and the wait had no visible cause: the record button simply appeared
not to work.

## The mechanism (before the fix)

`ios-app/BeeBox/Services/SpeechDictation.swift:27-29`:

```swift
case .microphoneStarted:
    isActive = true
    return speechPlaybackActive ? .none : .startDictation
```

The turn is marked active but **no command is issued**. Dictation starts later,
when `.speechPlaybackChanged(playing: false)` arrives and returns
`.startDictation` (`:39-48`).

This is deliberate and documented — `beebox/docs/mobile-contract.md` §4.5:

> An active native continuous-dictation turn pauses while `playing:true` and
> resumes when the final queued speech segment reports `playing:false`. The
> microphone remains active while waiting for speech to begin.

The intent is sound: keep the mic from transcribing the box's own voice. But it
resolves the conflict by **making the user wait for the machine**, and it does
so with no signal that waiting is what's happening.

## The web already does the opposite, and it's the better answer

`src/frontend/src/machines/composerMachine.ts:190, 200`:

```
START_DICTATION: { target: "idle", actions: ["stopSpeech", "beginTurn", "startMic"] }
```

Starting dictation **stops speech and opens the mic immediately** — real
barge-in. So the two composers disagree about what pressing record means, and
the native one is the one that surprises.

Worth noting because it inverts an assumption: the web is not "allowing
crosstalk" here. It is preventing crosstalk by *ending* the speech, which is
also what a person does when they start talking over you.

Adopting the web's behavior on iOS removes the reason for the pause entirely:
if speech stops, there is nothing for the microphone to overhear, so the
`speechPlaybackActive` gate on `.microphoneStarted` stops being needed at all.

## What makes this a contract change

There is currently **no way for native to tell the web to stop speaking.**
§4.5 is web → native state only (`{playing: boolean}` on
`beeboxSpeechPlaybackState`), and no native → web speech-control row
exists in the bridge table (§ B-rows). So barge-in from the native record
button needs a new contract row plus its web handler — which puts this in
`bbx-ios-overlap` territory rather than being a local Swift fix.

An explicit press is distinguishable from the automatic resume, which the fix
depends on: `.microphoneStarted` is the user acting, while
`.speechPlaybackChanged(playing: false)` is the system resuming. Only the first
should count as barge-in.

## What landed

Barge-in, plus the honest control the wait exposed:

- **Contract §4.9, a new native→web row.** Native had no way to stop the page's
  speech, and the page is the speaker (`lib/audio/tts-client.ts`).
  `window.beeboxNativeSpeechCommand({version:1,action:"stop"})` with the
  same queue-plus-wake-event transport as the other native→web rows;
  `useNativeSpeechCommandBridge` handles it as `STOP_SPEECH`. Not
  `START_DICTATION` — its `beginTurn`/`startMic` would open the *web*
  microphone inside a native shell. No acknowledgement channel: §4.5's
  `{playing:false}` already reports the stop and native does not wait for it, so
  a lost command costs an overheard utterance rather than the user's turn.
- **Only an explicit press interrupts.** Every automatic reopen — after speech
  ends, after a send that keeps the mic, after an erase — still waits;
  interrupting the box's reply to a message just sent is the opposite of what
  was asked. `NativeVoiceTurnState` now records whether it deferred a mic *for*
  the speech, so the `playing:false` edge a barge-in itself produces cannot
  restart the dictation the press already began. There is no keyword-initiated
  start to decide about: keywords are only detected over a live recognizer.
- **A pending control instead of the recording face.** The trailing button
  showed the red stop whenever the turn was active, including while the
  recognizer was still starting (permissions, the on-device analyzer session,
  the audio engine) — the control claiming to listen was the visible defect, and
  barge-in alone would not have removed it. It now shows a pending face that
  still stops the turn on tap. A `--composer-fixture=starting-dictation` layout
  fixture renders it without device timing.
- **Written up as a principle.** `beebox/docs/engineering-principles.md`
  #13 — a control shows the state the system is in, never the one it intends —
  with this issue and
  [capture success is invisible](2026-08-20-capture-success-is-invisible.md) as
  the two halves of the same failure.

Automated coverage: `NativeVoiceTurnTests` (barge-in, no self-restart, both
automatic-resume paths), the `speech-command` golden fixtures on both sides, and
a composer-machine doctest pinning that `STOP_SPEECH` opens no web mic and
leaves `turnTaking` false.

## Manual testing

Needs a real device — the simulator does not reproduce the audio routing.

1. Turn the device volume **down**, send something that makes the box speak, and
   press record while it is still talking. Dictation should begin immediately;
   turn the volume back up on a second run to hear that the speech stops.
2. Send a voice message and let the box reply out loud without touching
   anything. The mic should stay closed until the reply finishes, then reopen —
   the automatic path must not have become an interruption.
3. Watch the record button through a cold start (first dictation after launch,
   or after granting permissions). It should show the pending face, not the red
   stop, until it is actually listening.
