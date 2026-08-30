# TiddlyWiki review

**Snapshot: 2026-08-19.** Read against the TiddlyWiki5 repository at `master`
(`5.5.0-prerelease`) — the documentation tiddlers under
`editions/tw5.com/tiddlers/` and the implementation under `core/modules/`,
rather than tiddlywiki.com's rendered pages or third-party summaries.

## Why

Collection views in beebox have no first-class definition
([issue](../../issues/features/2026-08-19-collection-views-are-badly-defined.md)),
and the design question — what selects a set, what renders it, what labels it,
and how it degrades on mixed types — has a working twenty-year-old answer here:
a filter expression selects tiddlers, a widget renders the set, a template
controls each item. Secondarily, the plugin system tells us whether an extension
surface can reach the query and rendering layers, which is where our own
[plugin design](../../issues/exploration/2026-08-19-plugins-and-the-medium-content-line.md)
is stuck.

## Documents

| Document | Covers | Status |
|---|---|---|
| [expressing-content.md](expressing-content.md) | Filters, the list widget, transclusion, cascades, grouping/labels, WikiText as a whole | 9 dispositions: 3 adopt, 3 adapt, 2 later, 3 reject |
| [plugins.md](plugins.md) | Plugin structure, module types, wikitext-level extension, sharing and installation | 5 dispositions: 2 adopt, 2 adapt, 2 reject, 1 open |
| [side-by-side.md](side-by-side.md) | Seven jobs a box already does, in TiddlyWiki markup and in ours: links, embeds, live-query cards, grouped collections, card-type interfaces, chrome, search | reference |

## The three findings that matter most

1. **A collection is not an object.** `{{{ [tag[mechanism]]||TemplateTitle }}}`
   desugars — the documentation says so explicitly — to `<$list>` wrapping
   `<$transclude>`. Selection, iteration, and per-item rendering compose, and
   nothing named "collection" exists. This supports the issue's cheapest
   version: a collection view that ships its own queries, with no separate query
   object to design, address, or store.

2. **Per-item type dispatch belongs below the collection, not inside it.** The
   list widget knows nothing about item types; a cascade — a filter-conditioned,
   neighbour-ordered, runtime-inspectable rule chain — decides what renders a
   given item. Our `file-type-registry` priority chain is the same mechanism
   with a narrower condition and a magic-number ordering. A collection view that
   accepts everything and degrades per item falls out of this rather than being
   a concession.

3. **Extension reaches the query and rendering layers at two tiers.** JS module
   types `filteroperator` / `widget` / `wikirule`, and — without any JavaScript
   — `\function my.op` callable as `[my.op[x]]` and `\widget $my.widget`
   callable as `<$my.widget/>`. A box's own plugin should be authorable in the
   box's own materials and reach the same extension points that code does.

## What does not transfer

Everything downstream of "no types". TiddlyWiki cannot express the constraint
our issue treats as load-bearing — that a collection view declares what it can
display and a query feeding it something else is an authoring-time error — and
does not try to. A collection there also has no address: it exists only as
markup inside whatever tiddler contains it. Our card-anchored `?view=foo`
invariant and `rendersCardTypes` + `bbx view-lint` typing are both stronger, and
the review argues for extending them rather than trading them for
expressiveness. The open question they leave — where a *conventional* collection
lives in URL space when no card exists to hang it off — gets no help from here,
because TiddlyWiki never had the invariant.

## Where findings landed

- `issues/features/2026-08-19-collection-views-are-badly-defined.md` — prior-art
  section updated to point here; the group-by-derived-collection and
  neighbour-ordering findings recorded.
- `issues/exploration/2026-08-19-plugins-and-the-medium-content-line.md` — the
  two-tier extension surface and the overlay-not-fork finding recorded against
  "what a plugin can extend" and "the extraction path".
