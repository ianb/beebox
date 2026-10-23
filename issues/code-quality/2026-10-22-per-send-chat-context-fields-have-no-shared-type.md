---
title: "Per-send chat context fields have no shared type, so a new field is a dozen edits"
workstream: unattached
area: beebox
labels: [chat, types]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261022-232146
---

The fields a chat send carries beside the message (`openCard`, `openQuestion`,
`cardActivity`, `cardState`, `viewContext`) are declared separately on the
client SEND event, the HTTP body, and `ChatSendInput`. `openQuestion` alone
appears in 23 files under `beebox/src/`. Adding one field took twelve edits
where the plan counted five, and a missing hop drops the field without a type
error (the queued-send combiner did this once).

Coding feedback: front-door/20261019T182938Z-implemented.md,
front-door/20261019T213611Z-plan-reviewed.md,
front-door/20261020T121003Z-implemented.md.

Direction: one named type for the per-send context, shared by the client event,
the request body, and the server input, with the combiner built over its keys.
