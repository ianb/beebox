---
title: "Dropping files into web chat works only on the textbox; a drop that misses it opens the file and leaves the chat"
workstream: unattached
area: beebox
labels: [chat, attachments]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder question, 2026-09-29
priority: backlog
---

The boxholder asked whether files and images can be dragged into the web chat. They can, onto the textbox. `handleDrop` (`beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/actions.ts`) passes every dropped file to `addFiles`, so images become `[image#N]` and other files `[file#N]`. Checked 2026-09-29 on test1 with a simulated drop of a PNG and a text file; both attached.

Two gaps make it hard to use:

- **Only the textbox is a target.** Nothing on the page calls `preventDefault` on `dragover` or `drop` outside it. A drop on the transcript, the attachment tray, or a workspace pane falls through to the browser, which opens the file and navigates away from the chat. The draft survives in sessionStorage, but the move is disorienting. At minimum, a drop anywhere in the chat column should attach, and a drop elsewhere on the page should do nothing instead of navigating.
- **No feedback while dragging.** No drop zone appears when files are dragged over the page, so it isn't obvious that dropping is supported or where to let go.

Out of scope: dropping onto a card pane to attach the file to that card. That's a different destination and would need its own design.
