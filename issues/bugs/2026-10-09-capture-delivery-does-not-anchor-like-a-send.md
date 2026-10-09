---
title: "Delivering a capture does not anchor the chat to the new message like a send does"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory journey walks, 2026-10-09
---

In the B-inventory walk, the walker pressed Done in capture. The chat stayed on the previous answer, with "Thinking…" below it, and the capture message was out of view. The walker had to press the scroll-down arrow.

A typed send puts the new user message at the top of the viewport. That anchor runs on `sendSignal` (`beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/messages.tsx:217-224`). Only the composer's `onSent` bumps it (`.../InteractiveChat/shell.tsx:248`, `onSent: bumpSendSignal`). The server delivers a capture (`deliver-send` in `capture-timing.log`), so Done never bumps the signal. Done is still the person's own action, so it should anchor the same way.

Not checked: whether the capture message is already in the list when Done returns, or arrives later. That decides whether the fix bumps the signal on Done or on the message's arrival.

Report: [B](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) (row 17, shot 06).
