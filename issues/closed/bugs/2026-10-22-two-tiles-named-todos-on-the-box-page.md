---
title: "The Box page lists two tiles named \"Todos\""
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — C-reconnecting walk, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct fix commit. Box-agent guidance (`docs/box/todos.md`): where a standalone todo goes, and no card is titled "Todos".

The person asked: "Can you just put a line in Todos for Nov 5". The agent made `_content/todos/Todos.doc.card` with `title: Todos` and one todo (box commit `6f56299`). A new box already has the todo view `_content/plate.todo-view.card`, also titled "Todos" (`installTodoView`, `beebox/src/core/box/structure/defaults.ts:305-311`). The Box page's "Also here" then showed two tiles named "Todos". The chat's "Todos" link opened the doc card. A person cannot tell the two apart.

A new box also ships an empty `_content/todos/` folder (`.gitkeep` in the init commit), which invites a card there.

Report: [C-reconnecting](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-22.md) (row 44).

## Why the fix is not obvious

Options: say in `beebox/box-docs/todos.md` where a standalone todo goes and what to name its card; title the todo view differently; or mark the todo view on the place page as the list of all todos. Find out first what `_content/todos/` is for.
