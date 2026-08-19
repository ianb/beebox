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

## Eclectic collections: the label is part of the thing (2026-08-19)

> How do I say "here's some images untriaged, here's some other images" and have
> that idea show up in the render? Not necessarily that triage/untriaged is
> something the image collection has any concept of, but bare collections
> aren't that interesting, everything can use a label.

This is the sharpest constraint yet, and it changes the model. A collection is
not a query — it is **(label, query, view)**, and several of them compose on one
surface. The label carries the meaning the query cannot: *untriaged* need not be
a concept the image collection knows about, it is what **this instance** of the
collection is for.

That also means the same query can appear twice with different labels and
different filters, and that is a normal thing to want rather than a degenerate
case.

## Prior art — query-as-link is a real tradition, mostly outside HTML

The boxholder's guess (`<a collection-href="**/*.image.card">`, "an alternate
hypertext from HTML", "Xanadu?") is well-founded. Four strands worth reading:

- **[XLink extended links and linkbases](https://www.w3.org/TR/xlink11/)** — a
  link may connect an *arbitrary number* of resources rather than two, and the
  links can live in a **linkbase** separate from the documents. The conceptual
  move is exactly the one here: a link stops being a pointer at one place and
  becomes a relation over a set.
- **[Microcosm / open hypermedia](https://mprove.de/visionreality/text/2.1.13_microcosm.html)**
  (Southampton, 1990s) — the closest match to the instinct. It has **generic
  links** (a link from a string *wherever it appears*) and **computed links**
  (content-based retrieval), with all link information held in a separate link
  service while documents stay in their native formats. A link that is a query,
  built and shipped thirty years ago.
- **[TiddlyWiki filters](https://tiddlywiki.com/static/Filters.html) with the
  [list widget](https://tiddlywiki.com/static/ListWidget.html) and
  [transclusion](https://tiddlywiki.com/static/TranscludeWidget.html)** — the
  living, working version of the proposed markup: a filter expression selects
  tiddlers, the list widget renders them, a template controls how each item
  looks. This is very nearly `<a collection-href>` with the render half solved.
- **Obsidian Dataview and Notion linked database views** — the mainstream
  instances. Notion is the direct answer to the labelling question: one page
  holds several *filtered views of the same source*, each with its own title and
  display type, which is precisely "untriaged images, then other images".

Xanadu's contribution is adjacent rather than central — **transclusion**
(content included by reference rather than copied) is about how an item appears
in two places at once, not about selecting a set. Worth knowing, not the model
to copy.

The consistent lesson across all four: **the query, the rendering, and the
labelling are three separate things**, and systems that fuse them get stuck.
TiddlyWiki keeps filter / widget / template apart; Notion keeps source /
view-type / view-title apart.

## Mixed types, and "I can't render this"

> Mixed type content is often interesting and good. A directory is one form of
> it. Maybe every collection view should accept every type, and just try its
> best (with a genuine capability to say "I can't render this", like if there's
> zero images).

This softens the typing constraint from the section above, and the two reconcile
into something better than either: a collection view **accepts anything**,
declares what it renders *well*, degrades per item, and can say honestly that it
has nothing to show.

That is already how single-card rendering works here — renderers register with a
priority and `renderers/builtins.tsx` is the low-priority fallback that shows
raw source for anything unclaimed. So per-item graceful degradation is the
established pattern, not a new mechanism. A collection view refusing the whole
set (zero images for an image-shaped view) is the one genuinely new signal, and
it connects to the "does an empty result hide the view" question below.

Worth noting a directory is the existing proof that mixed-type collections are
useful — it is a collection view that accepts everything and renders each item
by whatever knows how.

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

## Read: TiddlyWiki, in full (2026-08-19)

The TiddlyWiki strand above was researched properly against the source —
[`research/tiddlywiki/`](../../research/tiddlywiki/README.md). Four findings
change what this issue should decide.

**A collection is not an object there, and the sugar proves it.** The docs give
the desugaring explicitly: `{{{ [tag[mechanism]]||TemplateTitle }}}` expands to
`<$list filter="[tag[mechanism]]"><$transclude tiddler="TemplateTitle"/></$list>`.
Selection, iteration, and per-item rendering compose; nothing named "collection"
exists anywhere in the system. That is direct support for the cheapest version
already proposed here — a view that ships its own queries — and an argument
against introducing a stored collection object before one ships.

**Per-item type dispatch belongs below the collection.** The list widget knows
nothing about item types. Type dispatch is a separate mechanism (a *cascade*)
reached through the item template. So "accepts everything, degrades per item"
is not a softening of the typing constraint, it is what falls out of keeping
type knowledge in the renderer chain — which is where ours already lives
(`file-type-registry.ts`). The typing that stays useful is the view declaring
what it renders *well*, which is `rendersCardTypes` widened, exactly as guessed
above.

**The conventional/static query already exists there, and the label comes free.**
`$:/core/ui/MoreSideBar/Types` is one nested pair of list widgets: an outer list
over distinct values of the `type` field, a label that is the group key
rendered, an inner list re-querying members of that group. Groups that occur,
exist; no configuration anywhere. Group-by-a-field is a smaller and
better-defined first feature than a query language, and it yields the label as a
by-product. It does not solve the *authored* label ("untriaged") — for that
TiddlyWiki makes you write two sibling list blocks by hand, and nothing in the
system knows they are two views of one source. The `(label, query, view)` triple
in this issue is a stronger claim than TiddlyWiki makes; the gap is real and
ours to fill.

**Neighbour-relative ordering instead of priority numbers.** TiddlyWiki's rule
chains are ordered by per-item `list-before` / `list-after` fields naming a
*neighbour*, over a derived default order. Worth taking for the renderer chain
(where `priority: 50` is currently a guess) and for hand-arranging a
mostly-derived collection without it becoming a hand-authored list.

Two things explicitly do not transfer: a collection there has no address (it is
markup inside whatever tiddler contains it), and nothing can be checked before
it runs. Our card-anchored `?view=foo` invariant is the better choice and should
hold — which leaves the open question above unchanged and unhelped: where a
conventional collection lives in URL space when there is no card to hang it off.
