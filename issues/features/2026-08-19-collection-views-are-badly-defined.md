---
title: "Collection views are badly defined — there is no first-class view over a set of cards"
workstream: unattached
area: callback-box
needs: [design]
labels: [views, cards, plugins]
filed-by: agent
discovered-by: Ian
discovered-in: main session — while defining what a plugin may contain
---

Boxholder, listing what a plugin should be able to contribute: *"New view types
of collections (these are badly defined currently, I guess we need an issue for
that)."*

He is right, and the vagueness will be inherited by the plugin design unless it
is settled first — a plugin cannot contribute a kind of thing the system has no
name for.

## What exists today, and why none of it is quite this

Three unrelated mechanisms currently do collection-shaped work:

- **A filesystem directory listing** — `src/frontend/src/renderers/directory.tsx`
  renders whatever is in a directory. Structural, not semantic: it knows about
  paths, not about what the cards mean.
- **Card types that happen to enumerate** — `todo-view`, `nav`,
  `tab-arrangement` each model a collection *as a card*, with their own schema
  and renderer. Every new collection shape therefore costs a card type.
- **Views attached to a card** — a view is `?view=foo` on a card path (the
  standalone card-less view was deliberately removed, letting the `view:` scheme
  die). So a view always hangs off exactly one card.

Nothing here expresses **"a view over a set of cards selected by something"** —
every recipe, this month's memos, everything tagged a certain way. The closest
you can get is to create a card whose *content* is the collection, which means
the selection is authored by hand rather than derived, and it goes stale.

## Why this matters beyond tidiness

- **It is the natural shape for a domain plugin.** A recipes plugin wants a
  recipe *index*; an education plugin wants a course roster. Under the current
  model each has to invent a card type to hold a list, which is why collection
  card types keep accreting.
- **The search index already knows how to select cards** (`cb search`, Orama).
  A collection view is arguably a saved query plus a rendering, and most of the
  machinery exists.
- **The card-anchored constraint was a deliberate simplification** — views
  attach to cards so that every view has an address and an owner. A collection
  view has to either respect that (hang off an index card) or make a principled
  exception. That choice is the design.

## What the design has to settle

- **What selects the set.** A query, a directory, a card type, a tag, an
  explicit list? Derived selection is what makes it not-stale; explicit lists
  are what make it predictable.
- **Where it lives, given views attach to cards.** Either a collection view is
  a view on an *index card* — preserving the invariant, at the cost of a card
  existing to be pointed at — or collection views are a second kind of thing
  with their own addressing. Do not let this get decided by accident.
- **What a plugin contributes**: the renderer, the selection, or both? A plugin
  shipping "a way to display a set of recipes" is different from one shipping
  "the set of recipes".
- **Whether the existing collection-ish card types collapse into it.**
  `todo-view`, `nav`, and `tab-arrangement` may be three instances of the
  general thing, in which case this is a consolidation rather than an addition —
  and that is the version worth wanting.

## Design direction (boxholder, 2026-08-19)

**Two kinds of query, not one.**

- **Conventional / static** — a shape you don't author: *all `**/*.image.card`,
  anywhere in the box, so long as any exist*. Zero configuration; the collection
  simply exists when the box has content for it, and doesn't when it doesn't.
- **Reified** — a query you create and keep: a union of directories, or
  something fancier, fed into a collection view.

The first covers the common case for free and is the one that makes a card type
feel first-class the moment it appears. The second is the escape hatch for a
collection nobody could have anticipated.

**The view is typed, and the query has to satisfy it.**

> The collection view would need to be typed as to what it could accept (if your
> query gave unrenderable items, that's not very helpful).

This is the load-bearing constraint, and it is what stops the feature becoming
"arbitrary query, arbitrary render, hope for the best". A collection view
declares what it can display; a query that would feed it something else is an
error at authoring time, not a broken page.

**Worth knowing: the vocabulary for this already exists.** Box-local views
already declare `export const rendersCardTypes = ["<type>"]`, and
`useCardViewBinding` (`src/frontend/src/lib/view-bindings.ts`, used from
`FileView.tsx:344-360`) binds them ahead of the built-in renderers — with
`cb view-lint` enforcing that every view attaches to a type. So single-card
views are already typed and already pluggable. A collection view is plausibly
the same declaration widened from "the type I render" to "the types I accept a
set of", which would make this an extension of a working mechanism rather than
a new one.

**Maybe the view ships its own queries.**

> Maybe the collection view just ships with its own built-in queries.

This is the cheapest coherent version and worth trying first: a collection view
carries the queries it knows how to satisfy, so the type contract is trivially
held (the view wrote the query), and there is no separate query object to
design, address, or store. Authored queries then become a later addition for the
cases the shipped ones miss — rather than the foundation everything else waits
on.

If that holds, the first shippable slice is small: a view that declares the
types it accepts and a built-in convention query, appearing only when the box
has matching cards.

## Open questions this raises

- **Where does a conventional collection live in the URL space**, given views
  attach to cards? "All images anywhere" has no card to hang off. This is the
  crux from the section above, and the conventional-query case makes it
  unavoidable rather than theoretical.
- **What is the query language?** `cb search` already selects cards (Orama,
  full-text plus vector). A glob over card types is a different axis from a
  text query, and "union of directories" is a third. Whether these are one
  language or three matters more for the reified case than the conventional one.
- **Does an empty result hide the view or show an empty state?** The
  "so long as any exist" phrasing suggests hide — which is a real behavioral
  choice, and different from how single-card views work.

Related: [plugins and the medium/content line](../exploration/2026-08-19-plugins-and-the-medium-content-line.md),
which is where this came up and which is blocked on it for the "views" half.
