---
title: "A todo's assigned field takes any string and shows it as a badge"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — C-reconnecting journey walk, 2026-10-08
resolution: implemented
---

Fixed 2026-10-08: boxholder decision — `assigned` may name a person; whether
as a plain name or a ref is not settled. Absent = the boxholder, `"agent"` =
the box agent, any other value names a person, stated in
`beebox/docs/box/todos.md`, `beebox/docs/cards/format.md`, and the todo tag
schema. `todoAssignedWarning` (`beebox/src/shared/todo-model.ts`) makes
`user`, `me`, `boxholder`, `you`, and `owner` (any case) a card-lint warning;
the todo is still collected. The badge still renders any value. Covered in
`beebox/test/shared/markdoc-config.todo.doctest.md`.
Frontmatter `todos:` entries get the same warning.

2026-10-09: boxholder decision — another person's todo stays off the
boxholder's plate but stays visible. `isBoxholderTodo` now admits only an
absent or empty `assigned` or a boxholder placeholder word; `"agent"` and a
person's name are excluded. The nav badge, The Plate, a card's and a
directory's todo line, and the unreviewed-todos health check all read it. The
todo still renders on its card with its assignee badge. Covered in
`beebox/test/core/todo/count.doctest.md`.

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
[agent-assigned todos have no pickup](../../features/2026-09-24-agent-assigned-todos-have-no-pickup.md).

Report: [C](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md).

## 2026-10-08: needs a decision before a fix

Left open by the fix batch. The defined values are not settled.
`beebox/docs/cards/format.md` defines `assigned` as a plain string and its
example assigns a person (`assigned="Dana"`); `isBoxholderTodo` in
`beebox/src/shared/todo-model.ts` treats any value but `"agent"` as the
boxholder's. Only `box-docs/todos.md` limits it to absent or `"agent"`. A
closed set would reject person names; a badge for `"agent"` only would hide
them. Decide whether `assigned` may name a person. If it may, the narrower
fix is to reject the boxholder words an agent invents (`user`, `me`,
`boxholder`) in `validateTodoAttributes`, and to say in `box-docs/todos.md`
that `assigned` names someone other than the boxholder.
