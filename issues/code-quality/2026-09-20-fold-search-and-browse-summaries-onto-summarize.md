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

- `foldFields` in `beebox/src/core/search/extract/core.ts` — a `switch` over nine
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

## Re-encounter 2026-10-22 (journey walks): a user-facing consequence

In [B-inventory](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-22.md) (rows 13, 14) the box agent wrote a box-local `storage` type whose items live in a frontmatter array. `bbx search "tweezers"` returned "No results" while the row existed, because `foldFields` (`beebox/src/core/search/extract/core.ts:216-265`) returns nothing for a type it does not name. The agent told the person: "the box's general search only finds a drawer by its short description, not by every item in it". The walker called this jargon and worrying ("will 'tweezers' be found later?"). The agent wrote a grep instruction into the schema to make up for it. A box-local type has no way to declare its searchable text, and `beebox/box-docs/schemas.md` does not say that its fields are not searched. This makes the schema hook option ("own hook on the schema (`searchText`?)") more pressing.
