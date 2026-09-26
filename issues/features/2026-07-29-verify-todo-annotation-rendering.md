---
title: "Manually verify {% todo %} rendering and the stock todo-view plate card"
workstream: todo-annotation
area: beebox
filed-by: agent
discovered-in: worktree-todo-annotation — landing the todo-annotation system
needs: [manual-testing]
design: ../../beebox/docs/implemented-plans/todo-annotation.md
priority: important
---

The todo-annotation system (`{% todo %}`/`{% see-also %}` tags, `bbx todos`,
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

The [todos-ui plan](../../beebox/docs/implemented-plans/todos-ui.md) (2026-09-25) replaced
the rendering this issue gates: one `TodoItem` component now renders a todo in
a card body, in frontmatter, and in the list, and todos can be ticked. The
steps below describe the current behaviour. Use the worktree or main test1 box
on the shared dev router; card URLs need the `_content/` segment.

1. Open `/browse/_content/projects/porch-rebuild/Plan.doc.card`. Expect a
   quiet line under the title, "N open · N overdue · N parked · N done";
   each todo has a checkbox (no `todo` pill); "Order the decking" reads
   "overdue · Sep 15" in the warning style; the agent's permit todo is quiet
   with an "agent" chip; finished agent todos do not appear.
2. Tick an open todo. Expect it to strike through at once, the summary count
   to drop, and the card file to gain `status="done"` with a box commit
   "Mark todo done: …". Untick it: the attribute is removed.
3. Hover a todo and press "+". Expect the todo to appear in the chat
   composer as a selection, with the cursor in the composer.
4. Open `/browse/_content/projects/porch-rebuild/Tomas.person.card`. Expect
   its frontmatter todos to render as todos, not as `text:`/`due:` rows.
5. Open `/browse/_content/plate.todo-view.card`. Expect a headline "N on
   your plate · N later · N for the agent" whose first number equals the
   nav badge; the badge has a dot when something is overdue; an "N done"
   action at the bottom reveals finished todos; clicking a card header or
   a todo opens the card in the other pane.
6. Open the directory `/browse/_content/projects/porch-rebuild`. Expect the
   same summary line; "N open" opens the project's todo list beside it.

Confirm the observed result matches the expected behaviour above before
clearing the manual-testing flag.
