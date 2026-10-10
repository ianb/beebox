---
title: "iOS quick chat thoughts could run the on-device HQ pass"
workstream: unattached
area: ios
labels: [voice, transcription, ios]
filed-by: agent
discovered-in: hq-always — covering every dictated-audio path
priority: backlog
needs: [manual-testing]
---

Every dictated conversation message now gets the HQ pass
(`beebox/docs/plans/hq-always.md`). The iOS quick chat composer on the box
screen (`NativeComposerSubmitTarget.quickChat`) is the one dictation path left
on live text: a quick chat thought is text only, its recording is deleted in
`NativeComposerView.submitQuickChat`, and no recording reaches the box, so the
server HQ pass cannot run. The box marks such a thought
`<speech source="box-screen" stt="live">`.

The on-device pass (`Services/OnDeviceHqTranscriber.swift`) needs no box and
could run before `submitQuickChat` hands the text to its closure, with the
live text as the fallback when the pass is skipped. What it would take:

- Run the pass in `submitQuickChat` for a voice thought with a recording,
  bounded as it is for conversation sends, and reapply the send keyword with
  the same `VoicePreparationResolver` rule (`heard="live"` when the HQ text
  lacks it).
- Tell the box which text it is: an optional field on `quickChat.submit`
  (contract §5.11) and on the stored record (`quick-chat-record.ts`), so the
  box omits `stt="live"` for an on-device HQ thought.
- Decide whether a quick thought should wait the extra seconds. The draft
  clears only after the box stores the thought, so a slow pass delays that.

Related: [HQ for every dictated message](2026-09-18-hq-dictation-default-when-a-key-exists.md),
[on-device HQ](2026-10-06-ios-on-device-hq-transcription.md).

## Implementation (2026-10-10)

Boxholder decision: "especially on ios the hq transcription is cheap, and it
should use it." Built per [the plan](../../beebox/docs/implemented-plans/ios-quick-chat-hq.md):
the quick chat composer runs the on-device pass on a dictated thought before
storing it, and sends `hqService` with it; the box frames it with
`stt-service` instead of `stt="live"`.

## Manual testing

On an iOS 26 device with on-device speech assets installed:

1. On the box screen, dictate "remind me to call Odette about the fourteenth
   send message". Expected: the composer shows "Transcribing…" briefly, the
   thought is stored, and in the chat it lands in, the message has no
   "Live text" line (the wrapper carries `stt-service="apple-speech-transcriber"`).
2. Dictate a thought and tap Send. Expected: same as 1, with no send tag.
3. Type a thought and send. Expected: unchanged, instant.
4. Kill the app while "Transcribing…" shows. Expected: on relaunch the live
   text is still in the box-screen composer.

