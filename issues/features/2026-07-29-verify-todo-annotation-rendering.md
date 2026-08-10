---
title: "Manually verify {% todo %} rendering and the stock todo-view plate card"
workstream: todo-annotation
area: callback-box
filed-by: agent
discovered-in: worktree-todo-annotation — landing the todo-annotation system
needs: [manual-testing]
design: ../../callback-box/docs/implemented-plans/todo-annotation.md
---

The todo-annotation system (`{% todo %}`/`{% see-also %}` tags, `cb todos`,
the review sweep, the `todos.list` tRPC route, and the `TodoViewCard`/`Todo`/
`SeeAlso` React components + the `AppNav` plate badge) landed with full green
tests (5174/5174), clean typecheck/lint, 5/5 knowledge audits, and an
adversarial cross-model review whose 8 findings were all fixed. **None of the
frontend surfaces were exercised in a real browser** — no visual/interaction
verification happened.

## What to try

- Author a card body with a `{% todo %}` annotation (inline and block forms,
  a few with `due`/`start`/`status`/`by` attributes) and confirm it renders
  sensibly — checkbox/badge treatment, status styling, no layout breakage.
- Add a `{% see-also %}` reference and confirm the `SeeAlso` component
  resolves and links correctly.
- Check the stock plate card (`store/plate.todo-view.card`, provisioned by
  `src/core/box/defaults.ts`) renders as the on-plate todo surface in the app
  — the `TodoViewCard` component pulling from `todos.list`.
- Check the `AppNav` plate badge (todo count indicator) updates as todos are
  added/completed/parked.

## What should happen

Rendering matches the plan's design intent (`docs/implemented-plans/todo-annotation.md`)
with no visual glitches, broken links, or badge miscounts. If something's off,
it's a real bug even though it passed automated review — automated review
didn't look at pixels.

## Manual testing

Follow the concrete reproduction or verification steps above. Confirm the
observed result matches the expected behavior described in this issue before
clearing the manual-testing flag.
