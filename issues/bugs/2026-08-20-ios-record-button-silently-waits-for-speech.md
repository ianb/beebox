---
title: "iOS: pressing record while the box is speaking starts a turn that doesn't listen — it silently waits instead of interrupting"
workstream: unattached
area: callback-box
labels: [ios, voice, chat, mobile-contract]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder pressed record during speech playback with the volume down
---

On iOS, pressing the record button while speech playback is active starts a
voice turn that **does not listen**. The microphone UI comes up, nothing is
transcribed, and dictation only begins once the box finishes talking.

The boxholder hit this with the device volume turned down, so the speech was
inaudible and the wait had no visible cause: the record button simply appeared
not to work.

## The mechanism, exactly

`ios-app/CallbackBox/Services/SpeechDictation.swift:27-29`:

```swift
case .microphoneStarted:
    isActive = true
    return speechPlaybackActive ? .none : .startDictation
```

The turn is marked active but **no command is issued**. Dictation starts later,
when `.speechPlaybackChanged(playing: false)` arrives and returns
`.startDictation` (`:39-48`).

This is deliberate and documented — `callback-box/docs/mobile-contract.md` §4.5:

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
`callbackboxSpeechPlaybackState`), and no native → web speech-control row
exists in the bridge table (§ B-rows). So barge-in from the native record
button needs a new contract row plus its web handler — which puts this in
`cb-ios-overlap` territory rather than being a local Swift fix.

An explicit press is distinguishable from the automatic resume, which the fix
depends on: `.microphoneStarted` is the user acting, while
`.speechPlaybackChanged(playing: false)` is the system resuming. Only the first
should count as barge-in.

## Two things to settle

- **Does every record press interrupt, or only a deliberate one?** Barge-in is
  right for a user tapping record. It may be wrong for the resume path, or for
  a keyword-triggered start, where interrupting the box mid-sentence is not
  what was asked for.
- **Should the waiting state ever be visible?** Even if barge-in is adopted,
  any state where the mic UI is up and nothing is being heard should say so.
  The current failure is not really the wait — it is that a control reported
  itself active while doing nothing, which is the same shape as
  [capture success is invisible](2026-08-20-capture-success-is-invisible.md):
  the UI's story and the system's state disagree, and the user pays for it.

## Manual testing

Not yet fixed — no label until a fix lands. When one does, the repro is:
turn the device volume **down**, send something that makes the box speak, and
press record while it is still talking. Dictation should begin immediately and
the speech should stop.
