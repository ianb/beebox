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

The todo-view list was rewritten by
[Todo collection](../../beebox/docs/implemented-plans/todo-collection.md)
(2026-09-20). The steps above describe the earlier rendering; check the new
list instead. Inline `{% todo %}` rendering inside a card body (the `Todo`
component) is unchanged by that work and still worth the earlier spot-check.

Open a todo-view card and expect:

- A scope line at the top naming what the collection covers.
- A dated strip when any open todo has a `start` or `due` date.
- One block per card that has matching todos, each with a header naming the
  card, and an "N open · M done" summary.
- Within a card, sections with their own "x of y" count.
- Nested items showing the note after the item's closing tag, not before it.
- A card that only refers to this place (via `{% see-also %}` or a ref, not
  physically here) marked "refers here" and sorted after the place's own
  cards.
- A By place / By date toggle and a Show finished switch, both keeping their
  state in the URL across reload.

Fixture content for a walkthrough (a project with open todos across several
sections) landed on `main`'s test1 (`~/src/boxes/test1`, commit `526e68c3`,
carried over from the `keep` branch of this workstream's isolated clone):
`_content/projects/porch-rebuild/Porch.todo-view.card`. Try
`/main/test1/browse/projects/porch-rebuild/Porch.todo-view.card` on the
shared dev router.

Confirm the observed result matches the expected behavior above before
clearing the manual-testing flag.
