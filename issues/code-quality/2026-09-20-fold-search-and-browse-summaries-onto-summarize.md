---
title: "Two hand-written per-type summaries remain beside `summarize`: search folding and the browse listing"
workstream: unattached
area: beebox
labels: [schemas, cards]
filed-by: agent
discovered-by: agent
discovered-in: worktree-collection-views — code survey for the todo-collection plan
---

A card type now owns its summary: `cardSchema`'s `summarize(card, base)` hook
(`beebox/src/cards/schema.ts`), resolved by `beebox/src/core/loader-registry.ts`.
Two older mechanisms still describe a card per type, by hand, outside the type:

- `foldFields` in `beebox/src/core/search/extract.ts` — a `switch` over nine
  kinds that picks the fields worth indexing. Its `default` returns nothing, so
  a box-local type contributes only its title, `contains`, and body to search.
- `buildBrowseCard` in `beebox/src/webapp/trpc/routers/status.ts` — reads
  `status` and `title` by string key for the directory listing.

Both take untyped fields and parse by hand, which is what `summarize` removed
for list summaries. Both exclude box-local types.

## Why this is not a one-line move

- Search folding answers a different question from a list summary: which text
  is worth finding, not what to show. Email bodies are excluded on purpose
  ("would re-inject untrusted text into agent context via search excerpts").
  It may want its own hook on the schema (`searchText`?) and not a reuse of
  `summarize`.
- Changing what is indexed changes the search index content, so the index
  schema version has to move.
- `buildBrowseCard` could read `FileSummary` directly; the directory listing
  would then show `detail` and the type's `attrs`, which is a visible change.

Decide per mechanism: move it onto the type, or record why it stays separate.
