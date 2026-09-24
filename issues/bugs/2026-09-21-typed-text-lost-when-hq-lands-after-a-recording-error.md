---
title: "Text typed after a recording error is lost when the HQ transcription arrives"
workstream: unattached
area: beebox
labels: [voice, chat, transcription]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder describing it from their own use
priority: normal
---

Start a recording. The recording errors and stops. The composer is usable
again, so type a message. The HQ transcription then lands, and the typed text
is gone from what gets sent: it was not part of the transcription, and the HQ
result takes over.

The boxholder: "it stops the recording, and I can type. But then if it does an
HQ transcription, it loses what I typed, because that obviously is not part of
the transcription. And it's just kind of a weird state issue there."

## The rule that produces it

`prepareVoiceSubmitEmission` (`beebox/src/frontend/src/input/voice-intent.ts`)
builds the sent message from the realtime emission staged when the segment
ended, plus the HQ outcome. Its own doc comment states the rule:

> The id and the frozen composer context (typed prefix, selections,
> attachments) never change; composer input added during the wait belongs to
> the next message.

On the `hq` branch the text becomes `priorInput` — `realtime.text` sliced at
`spokenStart`, i.e. only what was typed **before** speaking — joined to the HQ
result. Anything typed after the segment was staged is not in that snapshot.

That rule is correct for the case it was written for: the user speaks, the HQ
pass runs for a second or two, and they start typing the *next* thing while it
finishes. It is wrong after an error, because the user has no reason to
believe a pass is still in flight. The recording visibly failed and stopped.
Typing is not "the next message" to them; it is the only message.

## What is not established

- Whether the error path cancels the HQ wait at all, or leaves it running
  invisibly. `lib/audio/hq-wait.ts` and `await-hq.ts` own the wait; the
  failure notices in `lib/audio/hq-failure-notices.ts` suggest failures are
  surfaced, but it is not established which errors stop a recording while
  leaving its HQ pass alive.
- Which error the boxholder hit. "There's an error" covers a mic-permission
  failure, a live-transcription socket drop, and a backend refusal, and they
  may not share a code path.
- Whether the typed text is destroyed or merely excluded — if it survives in
  the composer after the send, the loss is smaller than it appears, and the
  bug is that it silently moved to a different message.

Reproduce before designing: induce an error mid-recording, type, and watch
both what is sent and what remains in the composer.

## Why the fix is a decision

An errored recording could cancel its HQ pass outright, or the HQ result could
merge with text typed after the error rather than replacing it, or the send
could refuse to consume a snapshot the user has typed past. Each answers
"whose text wins" differently, and the same question decides what happens when
a recording succeeds and the user types during a slow HQ wait — the case the
current rule was written for. Do not fix the error case in a way that changes
the good case by accident.

Related: [sticky HQ preference](../features/2026-08-26-sticky-hq-transcription-preference.md)
(HQ state itself was reported broken on 2026-09-20),
[a failed recording start wipes the draft](../closed/bugs/2026-08-25-mic-misfire-wipes-the-composer-draft.md)
— closed as a harness artifact from an automated browser, but this report is
from the boxholder's own use and is a different mechanism: there the draft was
wiped at start, here it is dropped at send.
