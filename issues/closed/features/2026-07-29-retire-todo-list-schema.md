---
title: "Retire the todo-list card schema, superseded by {% todo %}"
workstream: todo-annotation
area: callback-box
filed-by: agent
discovered-in: worktree-todo-annotation — follow-up named in the todo-annotation plan's NOT-in-scope list
design: ../../../callback-box/docs/implemented-plans/todo-annotation.md
resolution: implemented
---

**Resolved 2026-07-29** (worktree-todo-annotation): the decision was made —
the type dies, and the suggested way to make a todo list is a simple
`.doc.card` with embedded `{% todo %}` items. Implemented as a script
migration (`scripts/migrate/todo-list-to-doc.ts` /
`todo-list-to-doc-run.ts`, registered as `todo-list-to-doc` in
`src/core/migrations.ts`) that converts every `*.todo-list.card` into a
sibling `*.doc.card`, plus removal of the schema, its template, the frontend
renderer (`TodoListView`), and `todosRouter.updateItem`. Run for real on
test1 via `cb migrate --apply` (see `docs/migrations.md`'s `todo-list-to-doc`
entry). Agent guide, `docs/cards-as-markdown.md`, and `knowledge-audits.yaml`
updated to match.

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
