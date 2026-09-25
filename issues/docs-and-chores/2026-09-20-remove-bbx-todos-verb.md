---
title: "Remove the `bbx todos` verb now that `bbx query todos` exists"
workstream: unattached
area: beebox
labels: [todos, cli]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-collection-views — boxholder decision while approving the todo-collection plan
---

The [todo collection plan](../../beebox/docs/implemented-plans/todo-collection.md) added
`bbx query <collection>` and re-based `bbx todos` on the same runner. The
boxholder's decision (2026-09-20): "leave bbx todos but plan to delete it
later". This issue is the "later".

The agent guide, the ambient prompt line, and the knowledge audits already
teach `bbx query todos`. `bbx todos` remains as a second spelling with its old
flags and output. One difference to keep in mind when removing it: `bbx todos`
defaults to `--status open`, and `bbx query todos` defaults to open plus parked.

## What names the verb

- `beebox/src/cli/commands/todos.ts` and its registration.
- The smoke entry in `beebox/src/cli/surface-data.ts` and
  `beebox/test/cli/surface.doctest.md`.
- `beebox/test/cli/todos.doctest.md`.
- Comments in `beebox/src/core/todo/` and `beebox/src/shared/todo-model.ts`.
- `beebox/src/schemas/todo-review-job.ts` instructions, if they still name it.
- `beebox/docs/cards/format.md` and the implemented todo-annotation plan
  (history; leave the plan alone).

Run `grep -rn "bbx todos" beebox/src beebox/docs beebox/test` for the current
list.

## What to decide

The CLI has no hint for a retired verb. `beebox/src/cli/legacy-argv.ts`
rewrites only the `migrate`/`init` handoff. Either remove the verb outright and
let the unknown-command error stand, or add a small retired-verb table that
answers "use `bbx query todos`". The table is reusable for the next rename. A
live box agent that learned the old verb from an old session is the only
reader of that hint.

Wait until boxes in the field run a build whose guide teaches the new verb.
