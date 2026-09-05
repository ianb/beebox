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
