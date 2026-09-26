---
title: "Completed agent bookkeeping interrupts the document reading view"
workstream: todos-ui
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — F newcomer journey
resolution: implemented
---

**Closed (2026-09-25, todos-ui Track 2/1).** Finished agent-assigned todos are
now hidden from the reading view (Track 2 unified todo rendering), and
agent-scoped todos are out of boxholder-facing scope by default (Track 1
scope prefilter, `beebox/docs/implemented-plans/todos-ui.md`). A person
reading a card no longer sees completed agent bookkeeping.

Completed todos assigned to `agent` are rendered in the same document view as
the boxholder's learning note. The result exposes internal bookkeeping that a
person did not ask to manage: F's Spanish card shows a struck-through “Record
how the two practice questions went once answered” row with an `agent` badge.
The completed state is correct; the open question is whether agent-owned
annotations should be hidden, collapsed, or separated from user content.

## Research (2026-09-21)

- F's `_content/spanish/Ser_vs_Estar.doc.card:35-37` persists the completed
  `assigned="agent"` todo.
- `beebox/src/frontend/src/components/Todo.tsx:45-57` renders `assigned` as a
  visible badge, and lines 25-29/93-105 render `done` as struck-through content.
- Screenshot 16 shows the completed `todo` + `agent` row above “Still shaky”.
- This differs from the closed chat-narration issue
  ([chat bookkeeping](../docs-and-chores/2026-08-06-chat-agent-narrates-internal-bookkeeping.md)):
  the current problem is card-view visibility, not prose about the edit in chat.

Evidence: [journey F report](../../../beebox/user-stories/journeys/F-newcomer/reports/2026-09-21.md).
