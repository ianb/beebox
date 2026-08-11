---
title: "iOS: native audio capture can stop recording while the UI still says recording"
workstream: ios-audio-session-fix
area: callback-box
filed-by: agent
discovered-in: worktree-ios-audio-session-fix — Codex review of the audio-session fix
labels: [mobile]
---

`CaptureAudioRecorder` starts an `AVAudioRecorder` and then watches only the
file size (`CaptureAcquisition.swift:801` `startSizeTimer`). It sets no
`AVAudioRecorderDelegate`, so it never learns about
`audioRecorderDidFinishRecording(_:successfully:)` or
`audioRecorderEncodeErrorDidOccur(_:error:)`.

If the recorder stops on its own — an encode failure, or a route change that
ends the recording — the file stops growing, `lifecycle.state` stays
`.recording`, and the UI keeps showing an active capture. The user gets no
notice and the segment is silently truncated.

Two cheap detections exist:

1. The existing size timer can also check `recorder.isRecording`
   (`CaptureAudioRecording.isRecording` is already on the protocol at
   `CaptureAcquisition.swift:604`) and stop with a notice when it goes false.
2. Set a delegate and route both callbacks into
   `stop(reason:)` / `lifecycle.fail`.

Option 1 needs no new protocol surface and fits the injected fake used by
`CaptureAudioSessionTests`. Option 2 is more precise but `AVAudioRecorder` is
behind the `CaptureAudioRecording` protocol, so the delegate has to be wired
in `AVAudioRecorderFactory` without leaking `AVFoundation` into the recorder
model.

Out of scope for the audio-session routing work
([plan](../../callback-box/docs/implemented-plans/ios-audio-session-routing.md)), which
only changed which category and options the session uses. Found by a
cross-model review of that change.
