---
title: "A todo start chip reads as when the job begins"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — F-newcomer journey walk, 2026-10-08
---

A todo with a `start` date shows a chip "starts <date>". A reader takes this as
the date the work begins. The field means something else: the date the todo
leaves quiet and joins the plate (`beebox/box-docs/todos.md:26-28`, "the
*surfacing* trigger"). Three words name that one state in the product:
"quiet", "later", and "starts".

In the F-newcomer walk the agent also set `start="-2w"` on a todo without
telling the person. The person saw "starts <date>" and could not tell why.

## Mechanism

`beebox/src/frontend/src/components/todo/item-logic.ts:111` builds the text
as `starts ${…}`. `beebox/src/frontend/src/components/todo-view/TodoViewControls.tsx:116`
uses "later" for the same state in the headline. The F box commit `1d8a151` (journey box history, not this repository) wrote `start="-2w"` on the todo.

## Fix direction

Pick one word for the state and use it in the chip, the headline and the
docs. A chip like "on your plate from <date>" says what happens. Related:
[todo checkbox name](../closed/bugs/2026-10-08-todo-checkbox-name-is-its-status.md).

Report: [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (shots 05, 07, 08, 28).
