---
title: "Directories as viewable things in browse/ (+ in-place lenses like a card's own todo view)"
area: callback-box
filed-by: agent
discovered-in: worktree-todo-annotation — designing the todo-view card surface
needs: [design]
---

Two related wants surfaced while designing the
[todo-annotation](../../callback-box/docs/implemented-plans/todo-annotation.md) surface,
both deferred because they're a big thing on their own:

1. **See a card's todo view from inside the card itself** — the aggregated
   lens over *this* card's todos, on the card's own page, without creating a
   separate `todo-view` card. The natural mechanism already exists in spirit:
   views are `?view=…` on a card's browse path, so a core `?view=todos` lens
   available on any card would cover it. Small on its own, but it drags in
   the second item:
2. **Directories should be viewable things.** Boxholder: *"We don't really
   have directory views inside browse/, but we should; directories should be
   a viewable-thing."* Today a directory renders as a listing
   (`src/frontend/src/renderers/directory.tsx`) but it isn't a first-class
   view target — you can't attach a view/lens to a directory the way you can
   to a card (`?view=todos` on `projects/tahoe-trip/` showing the subtree's
   plate is the motivating example). Making directories view-attachable is
   the substantial design: what's the schema/instructions story for a thing
   with no frontmatter, how do `?view=` params resolve, does a directory get
   landmarks/commentary too, etc.

Interim answer shipped by the todo plan: drop a `todo-view` card *in* the
directory (subtree-scoped by default) — a durable card stands in for the
directory lens. This issue is about not needing the stand-in.
