---
title: "Universal {% todo %} Markdoc annotation wrapping an item, metadata in attributes"
workstream: unknown
area: beebox
filed-by: agent
discovered-in: main session — boxholder idea
needs: [design]
design: ../../../beebox/docs/implemented-plans/todo-annotation.md
resolution: implemented
---

> **Closed (2026-07-28):** implemented per
> [todo-annotation](../../../beebox/docs/implemented-plans/todo-annotation.md)
> (worktree-todo-annotation), commits `01307f98..b5aa6378` (the seven
> plan-chunk commits — tags + rendering, universal body Markdoc validation,
> frontmatter `todos:`, collector + `bbx todos`, review sweep + agent
> guidance, `todos.list` + `todo-view` surface, docs + knowledge audits).
> The mechanism sketch below is superseded by the plan.

> **Design written (2026-07-28):** goals-first design in
> [todo-annotation](../../../beebox/docs/implemented-plans/todo-annotation.md)
> (worktree-todo-annotation), Codex-cross-reviewed. The plan supersedes the
> mechanism sketch below.

Want a **`{% todo %}` annotation** that's somewhat universal — the same shape as
the existing `{% quote %}` tag — that **surrounds "the item"** and carries
**metadata in attributes**. So an inline or block wrapper marking arbitrary
content as a todo, with attributes for the todo's metadata.

```
{% todo due="2026-08-01" priority="high" owner="me" %}
Call the vet about the prescription refill
{% /todo %}
```

## Where this fits (precedent already exists)

The shared Markdoc vocabulary lives in `src/shared/markdoc-config.ts` — one
config used by the frontend renderer, `bbx validate`'s body-ref walker, and the
dev-doc renderer, so **adding a tag there makes it universal by construction**
(available in every card body + docs). Emission is in
`src/core/markdoc/emit-tags.ts` (`emitUniversalln` / briefing / recipe groups).

Existing tags to model on / reconcile with:

- **`{% quote %}`** — the pattern the boxholder cited: a wrapper that renders
  **inline OR block** (`QuoteInline` / `QuoteBlock`). `{% todo %}` should follow
  this inline/block-wrapper shape.
- **`{% source %}`** — same inline/block wrapper pattern, with attributes.
- **`{% task %}`** — ⚠️ **already exists, but it's `selfClosing: true`** — a
  *marker that creates a task* (`new Tag("Task", …, [])`, no children), plus a
  `[x]` checkbox → `Task` rewrite. It does **not** wrap existing content.

## The central design question: todo vs. the existing task marker

`{% task %}` (self-closing marker: "here *is* a task") and the proposed
`{% todo %}` (wrapper: "*this* item is a todo") are different shapes for a
related concept. This needs a decision before building:

- Are they distinct — a self-closing task marker *and* a wrapping todo
  annotation coexisting — or does `{% todo %}` **generalize/replace** `{% task %}`
  (allow both self-closing and wrapping forms under one name)?
- Two names for near-identical concepts is exactly the drift we avoid; but
  "create a task" vs. "annotate an existing item as a todo" may be genuinely
  different intents. Resolve deliberately, don't accrete a parallel vocabulary.

## Other design points

- **Attributes** (TBD): `status`/`done`, `due`, `priority`, `owner`, `id`, free
  tags. Define the attribute schema like the other tags do (`attributes: { … }`
  with types + `render`).
- **Rendering**: inline vs. block treatment (mirror the `QuoteInline`/
  `QuoteBlock` split); visual form (checkbox? badge? callout?).
- **The real payoff — machine-collectable todos.** Because it's a *universal*
  annotation, todos scattered across any card body become aggregatable: the box
  agent (or a view) could collect every open `{% todo %}` in the box into one
  place. That aggregation is where the value is, and it's a natural feed for the
  [Echo Show dashboard view](../../features/2026-07-27-echo-show-display-dashboard-view.md)
  (a "what's on my plate" tile). Worth designing the attributes with that
  collection in mind (a stable `id`, a queryable `status`).
