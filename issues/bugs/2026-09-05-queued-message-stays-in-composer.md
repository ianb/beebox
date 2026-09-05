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
