---
title: "A todo's assigned field takes any string and shows it as a badge"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — C-reconnecting journey walk, 2026-10-08
---

In the C-reconnecting walk the agent wrote `assigned="user"` on a todo. The
reading view and The Plate then printed a badge reading "user" next to the
todo. The person never chose that word and cannot tell what it means.

## Mechanism

`assigned` is a free string. `beebox/box-docs/todos.md:24` defines two states:
absent (the boxholder) and `"agent"`. Nothing validates the value.
`beebox/src/frontend/src/components/todo/TodoItem.tsx:149-150` renders any
non-empty value as a badge titled "Assigned". The agent invented a value for
"mine", and the UI displayed it.

## Options

Reject other values in the schema, or render a badge only for `"agent"`. The
second hides the typo but leaves bad data in the card. Related:
[agent-assigned todos have no pickup](../features/2026-09-24-agent-assigned-todos-have-no-pickup.md).

Report: [C](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md).
