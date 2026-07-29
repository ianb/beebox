---
title: "Retire the todo-list card schema, superseded by {% todo %}"
area: callback-box
filed-by: agent
discovered-in: worktree-todo-annotation — follow-up named in the todo-annotation plan's NOT-in-scope list
needs: [decision]
design: ../../callback-box/docs/implemented-plans/todo-annotation.md
---

The universal `{% todo %}` annotation (`src/schemas/todo-view.ts` +
`src/shared/todo-model.ts`, `docs/implemented-plans/todo-annotation.md`)
supersedes `src/schemas/todo-list.ts` — the original motivation for
`{% todo %}` was explicitly that the dedicated `todo-list` card type "exists
and is unused" (see the plan's goal 1). Nothing about this work changed
`todo-list` — it keeps validating and rendering — but the plan named retiring
it as deliberately out of scope, to be filed as a follow-up once it landed.
This is that follow-up.

## What retiring it actually involves

- `src/schemas/todo-list.ts` (schema) and
  `src/frontend/src/renderers/todo-list.tsx` (renderer) are the two source
  files.
- **Not a code-only removal** — any real box may have existing
  `*.todo-list.card` files on disk. Per `docs/migrations.md` (cb-migration
  territory), retiring the schema needs either:
  - a scripted migration that converts each `todo-list` card's items into
    `{% todo %}`-annotated content in a suitable target card (there's no
    obvious 1:1 target — a todo-list groups several items, so this may mean
    synthesizing a small card per list, or inlining items as todos on
    whatever card references the list), or
  - confirming (e.g. via a knowledge audit / box scan) that no real box has
    any `*.todo-list.card` files left, and only then deleting the schema.
- Decide whether any live boxes actually have `todo-list` cards before
  designing a migration — if none do, this is a straight deletion instead
  of a data migration.

## Why this is `needs: [decision]` rather than ready-to-build

The migration shape depends on whether real `todo-list` cards exist and what
they contain — worth checking box content before designing a converter that
may not be needed.
