---
title: "A citable link to one turn of a chat"
workstream: unattached
needs: [design]
area: beebox
labels: [chat, provenance]
filed-by: agent
discovered-by: Ian
discovered-in: "courseware box feedback — Links_To_A_Moment_In_Chat, 2026-11-09"
---

The boxholder asked for a way to take "this moment" in a chat as a link: the
chat card plus the turn. A record written during a conversation could then
cite the exchange that produced it. The case was a progress record whose
evidence is one exchange; a date is a weak pointer to it.

## What exists

- Each chat has a card under `/_content/chat/web/` that holds the session id.
- Voice messages carry a `message-id` the agent can read.
- `{% source ref=… %}` can cite the chat card as a whole. A source chip reads
  "chat, <date>".
- No anchor addresses one turn, and the agent cannot learn the id of the
  current turn for a typed message.

## Directions

- A ref form such as `<chat card>#turn-<id>` that opens the chat scrolled to
  that turn, and that `bbx refs` and provenance understand.
- A way for the agent to learn the current turn's id, for every message.
- Optionally a `{% source %}` at the turn with `{% quote %}` for exact words.

Related: [selection provenance canonical anchors](2026-07-08-selection-provenance-canonical-anchors.md).
