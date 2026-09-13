---
title: "A message sent while the agent is thinking is queued but stays in the composer"
workstream: unattached
area: beebox
priority: normal
labels: [chat, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "when I submit a message while the agent is thinking, it goes into the queue but then also stays in the textbox (on the web, typing)"
---

On the web, typing a message and sending it while the agent is still working
puts it in the queue (the composer's send button reads "Queue message (still
thinking)" when the target is busy, `InteractiveChat-composer.tsx`), and the
queued message appears in the transcript — but the text also stays in the
composer. The immediate-send path clears the draft; the queued path does not.
A second Enter would queue it twice.

Where to look: the send handler's two branches. The immediate path ends by
clearing the editor (`emissionStore.editor.setText("")` plus
`clearDraftRef.current()`, the pattern `use-bulk-upload-launch.ts` also uses);
the busy path reaches the machine's `STREAM_QUEUED` state
(`machines/chatMachine.ts`) but the composer is evidently not told to clear
on that outcome — either the clear is conditioned on a non-queued result, or
the queued branch returns before it. Whether the same happens on iOS (native
composer) is unknown.

Reproduce: start a long turn, type a message, press Enter, watch the
composer.

## Seen (boxholder screenshot, 2026-09-05)

Mid-turn, after one Enter: the transcript shows the previous reply's activity
line ("thinking, ran 7 commands, used 6 tools"), then the new message as a
dimmed bubble labeled *queued — waiting*. The bar above the composer reads
**"1 message queued"** and nothing else. The composer still holds the exact
text of the queued bubble, and the send button is in its active (orange)
state, so a second Enter would queue a duplicate.

Second defect in the same shot: the bottom bar no longer says the agent is
working. Before the send it presumably showed the working/streaming status;
after it, the queue notice is the only line. Either the queued-count notice
replaces the working indicator instead of sitting beside it, or the busy
status is keyed off the same signal the queue path changes. The reader is
left with no sign the agent is still mid-turn — the queued bubble's "waiting"
is the only hint.

## Reconfirmed 2026-09-13 — could not reproduce, and neither stated mechanism exists in the code

Not closed, because I never got the box into the exact state the screenshot
shows. But both mechanisms this issue proposed are gone, and a live send during
streaming behaved correctly.

**The composer clear is unconditional now.** `submitTypedDraft`
(`src/frontend/src/components/chat/conversation/typed-submit.ts`) calls
`onCommitted()` straight after `dispatch(emission)` returns, and `runSend`'s
`onCommitted` is what does `inputStore.set("")`. There is no queued branch and no
result-conditioned clear — so "the immediate path clears the draft; the queued
path does not" cannot be the cause as written. The send path was reworked the day
after this was filed, in `d1556e750` ("close the send-path holes an adversarial
review found"), which is the likely resolver.

**The second defect's mechanism is also absent.** `TargetStrip.tsx:35-38` renders
`Thinking…` and `N message queued` as SIBLINGS in one flex row; the queue notice
does not replace the working indicator. For the screenshot to happen today,
`status.state` would have to stop being `busy` — the issue's own alternative
hypothesis, not the one it led with.

**What I ran.** In a fresh `/main/test1/chat`, sent "count from 1 to 600, one per
line", then mid-stream staged and sent a second message. The composer cleared
(typing mode closed, no text retained), the second message reached the transcript
and was answered, and the working indicator was still showing at the moment of
the second send.

**Why that is not conclusive.** No `N message queued` bar ever appeared
(`pendingCount` stayed 0), so the send was accepted live rather than queued — I
exercised send-while-streaming, not the queued path. The distinguishing state
needs a turn long enough that a send lands well before completion; counting to 600
was not long enough, and a first attempt at 120 finished before I could type.

Field removed. The cheapest way to settle it is one hand-test by the boxholder,
who hits this state in normal use: start a genuinely long turn, send while the
"1 message queued" bar is visible, and look at the composer. If it is clear, this
closes as fixed by the send-path rework; if it is not, the cause is somewhere
other than the two places this issue named, and that is worth knowing.
