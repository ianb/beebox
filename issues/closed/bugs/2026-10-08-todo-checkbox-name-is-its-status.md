---
title: "A todo checkbox's accessible name is its status, not the todo"
workstream: unattached
area: beebox
labels: [accessibility]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — C-reconnecting journey walk, 2026-10-08
resolution: implemented
---

Fixed 2026-10-08: The checkbox is named by the todo's words (`checkboxName` in `item-logic.ts`); parked and dropped todos lead with their status; covered in `TodoItem.todo-item.doctest.md`.

A todo checkbox is announced as "Open" or "Done". The name should identify the
todo the box controls. A screen-reader user, or an agent driving the page by
accessible name, sees a list of identical "Open" checkboxes.

`beebox/src/frontend/src/components/todo/TodoItem.tsx:102` sets
`aria-label={STATUS_LABEL[status]}`. `item-logic.ts:26-27` documents the choice:
the status also names a parked or dropped todo, which the checkbox cannot
express. A name like "Done: <todo text>" would carry both.

The live snapshot in the walk showed the name "Open"/"Done" for each box.

Related: [todo checkboxes under the composer band are not clickable](../../bugs/2026-10-08-browse-ref-click-checks-only-geometry.md).

Report: [C](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md).
