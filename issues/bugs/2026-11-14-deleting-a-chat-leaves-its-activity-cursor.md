---
title: "Deleting a chat leaves its activity cursor file behind"
workstream: unattached
area: beebox
labels: [activity, chat]
filed-by: agent
discovered-by: agent
discovered-in: worktree-activity-triggers — reading the chat delete path while planning activity triggers, 2026-11-14
---

The activity log keeps one cursor per chat session at
`.beebox/activity-cursor/<session>.json` (`beebox/src/core/activity/cursor.ts`).
Deleting a chat removes its other per-session files
(`beebox/src/core/chat/session/delete/apply/core.ts`, the `rm` of the chat
model file around line 255) but not this one. Each deleted chat leaves a small
orphan file, and a later session that reused the id would start from a stale
cursor. Session ids are not reused today, so the cost is clutter, not wrong
hints.

Fix: remove the cursor file in the same place the chat model file is removed.
The activity-triggers plan removes its own per-session file there and names
this as a separate fix.
