---
title: "Chat image alt text numbers content blocks, so the first image reads Attached image 2"
workstream: unattached
area: beebox
labels: [low, accessibility]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory journey walk (second walk), 2026-10-08
resolution: implemented
---

Fixed 2026-10-08: Image alt text now counts image blocks only (`Attached image 1` for the first image).

Two attached images read "Attached image 2" and "Attached image 3" in the
chat. The walker noticed the off-by-one.

`beebox/src/frontend/src/components/chat/user-message/user-entry-content.tsx:128`
sets `alt={`Attached image ${i + 1}`}` where `i` is the index of the content
block in the message. Block 0 is the text, so the first image is block 1.
Count image blocks only. Related:
[composer attach UX](../../bugs/2026-08-08-chat-composer-attach-ux.md).

Report: [B2](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (row 20; first report R8).
