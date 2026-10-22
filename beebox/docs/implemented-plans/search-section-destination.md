---
title: "Search section results open at their heading"
status: implemented
workstream: journey-courseware
issues:
  - ../../../issues/closed/bugs/2026-09-21-search-section-results-drop-their-destination.md
---
# Search section results open at their heading

A search result labelled `Section: /Doc/Heading` opened the card at its top.
This plan gives a view target one optional `fragment` (a place inside the
target, as written after `#` in a ref). `FileView` resolves it against the
DOM it rendered and scrolls there. Search puts its existing section path in
the slot; markdown links put a heading id there. No search index change. The
same slot fixes in-card links such as `Other.doc.card#heading`, which opened a
not-found state.

**State (2026-10-18):** implemented and landed. Tests, typecheck, lint, and a
browser walk are recorded under *Rollout shape*.

**Issues addressed:**
`issues/closed/bugs/2026-09-21-search-section-results-drop-their-destination.md`.
Queue searches (`bin/issues search` for "fragment", "heading", "anchor",
"scroll to", "#heading", "markdown link hash", "link to heading") found no
duplicate. Related, not closed: `issues/features/2026-10-05-markdown-toc-navigation.md`
(a TOC can reuse the resolver) and
`issues/features/2026-09-24-todo-list-preview-shows-the-todo-in-place.md`
(needs a per-item preview).

**Revision history.**
- Draft 1 stored a heading id in the search index (schema v6).
- Draft 2, after cross-model review round 1
  (`scratch/cross-model/2026-10-18T00-40-25-366Z-codex.md`): render-time
  mapping by source line instead (comparison under *Could this be
  simpler?*); gdoc narrowing; tests through the real `CardBody`; stable URL;
  a visible miss note; `?fragment=` precedence; fragment decoding.
- Draft 3, after round 2 (`scratch/cross-model/2026-10-18T00-50-50-276Z-codex.md`)
  and the coordinator's adjudication: one generic DOM-based consumer in
  `FileView` instead of per-view hooks and a `sections` registration flag
  (this also covers Webpage cards, which round 2 found missing); no "can't
  open at a section" note; no `SidecarTab.openedAt`; miss wording "Couldn't
  find that section in this card."; `fragment` stays a reserved query key,
  no invariant.

## Design

No design section for a new surface: the search result already promises the
section (`SearchResults.tsx:35` before this change: *"`· Section: ${result.fragment}`"*),
and a markdown link that names `Card.card#heading` already asks for that
heading. Two small things a person can meet follow from that promise: a
one-line note when a section cannot be found ("Couldn't find that section in
this card."), and gdoc results that say "Synced document text" instead of
"Section: …", because their text is not in the card they open.

## Smallest fix and budget

Actual changed lines (additions + deletions, `git diff --numstat -M` plus new
files; the plan file excluded):

| Area | Source | Tests |
|---|---|---|
| Splitter moved to `shared/`, numbering and lines (A) | 37 (rename) + 8 in `extract/core.ts` | 53 new + 2 (doctest import) |
| `ViewTarget.fragment`, serialization, reducer, pane (B, D) | 70 + 11 + 5 + 5 | 62 + 21 |
| Resolver, hook, `FileView` notice, search target (C) | 71 + 70 + 55 + 33 + 16 | 116 + 26 |
| **Total** | **~381** (about 150 of it comments) | **~280** |

About 660 lines, under the 2,000-line BIG CHANGE line. The draft-2 estimate
was about 510; the difference is module comments and the larger CardBody-path
test harness (router + query client). No authored docs beyond module
comments; no generated output.

## Stated preferences this plan trades against

- `beebox/AGENTS.md:56`: *"All box ref parsing and resolution goes through
  `parseRef` and `resolveRefPath` ... Never reproduce it with ... manual
  fragment/query stripping."* `resolveContentTarget` did a manual `?` split;
  it now uses `parseRef`.
- `docs/engineering-principles.md` §8, *"One way to do each thing"*: one
  slot for search and links; one splitter for the indexer and the view; one
  consumer (`FileView`) for every renderer.
- §4, *"Resilient AND never silent"*: a section that cannot be found shows a
  one-line note in the view and a `console.warn`.
- §10: section-line lookup, fragment resolution, and the search target are
  pure functions with tests.
- Memory rules "prefer primitives" / "minimize invented concepts": resolution
  uses the DOM `id` and `data-line` the renderer already writes; the section
  path is existing vocabulary (`bbx search` prints it after `#`,
  `commands/search.ts:86`). The only new DOM marker is `data-fragment-root`,
  which scopes lookup to one view.
- Boxholder instruction: node/tap `.test.ts`, no new doctests.

## What already exists

- **Rendered headings carry their source line.**
  `shared/markdoc-config/tags/core.ts:124-130`: *"new Tag(`h${level}`, { id,
  "data-line": String(startLine + 1) }, children)"*. Every view that renders
  markdown through the shared `Markdown` component gets this.
- **Heading ids.** Same file, `:108-121` (`makeHeadingNode`). Used as-is for
  the `#heading` link form.
- **The view has the indexed text.** The indexer reads
  `card.fields[bodyName]` (`extract/core.ts`, `bodyTextFor`); `card.get`
  returns the same field as `body` (`webapp/trpc/routers/card.ts:76-78`).
  Standalone `.md`: both sides use the whole file. gdoc: the indexer reads the
  attachment; the card has no body (`schemas/gdoc.tsx:4-5`).
- **Title blanking keeps line numbers.** `shared/leading-title-heading.ts:41-43`.
- **Ref splitting.** `shared/ref-path/core.ts:100-119` (`parseRef`).
- **Fragments survive `bbx mv`.** `core/canonical-refs.ts:108`.
- **One serialization point for targets** (`serializeViewUrl` /
  `parseViewUrl`): tab storage (`workspace/storage.ts:42`, `:61`), the URL
  `card=` value (`lib/system-card-navigation.ts:140`), history fingerprints
  (`workspace/history.ts:125`), tab dedupe (`state-reducer.ts:24`), link
  hrefs (`markdown-link/link.tsx:37`).
- **Body notice slot.** `FileView/view.tsx` already composed `FileStaleNotice`
  above the body; the miss note joins it there.

Searched and found nothing: before this change no view read a fragment and
nothing scrolled to a heading after navigation. No code read
`params.fragment` (`grep -rn 'params\.fragment\|params\[.fragment.\]' src/frontend/src`
→ no hits; the test box's `.ts`/`.tsx`/`.card`/`.md` files have no
`?fragment=` or `&fragment=`).

## Prior art (external)

No decision depends on an external premise. Markdoc's 0-based `node.lines`
and line counting across frontmatter were checked by running them.

## Ontology

- **Fragment** (`ViewTarget.fragment?: string`): a place inside the rendered
  target, as written after `#` in a ref. Two forms, by first character:
  - **section path** — starts with `/`; a `SearchHit.fragment` value
    (`/Parent/Child`, `~N` for the Nth repeat).
  - **element id** — anything else; a DOM id, e.g. a heading id.
  Absent means the top.
- **Section path** (exists: `MarkdownSection.fragment`, `SearchHit.fragment`).
- **Section line** (`MarkdownSection.line`): 0-based heading line in the
  source text.
- **Fragment root** (`data-fragment-root`): the element `FileView` wraps a
  view's body in. Lookup counts only elements whose nearest fragment root is
  this one, so an embedded card's headings are not the host's.

## Tracks / scope (as implemented)

### Track A — the section splitter moves to `shared/`

- `src/core/search/extract/markdown-sections.ts` →
  `src/shared/markdown-sections.ts` (`git mv`).
- `MarkdownSection` gains `line`. The splitter numbers sections itself with
  `uniqueSectionPaths`: the Nth emitted section with an equal path gets `~N`
  (N ≥ 2), skipping any number already taken, so `/Notes`, an automatic
  `/Notes~2`, and a literal `## Notes~2` heading never share a path (the
  literal becomes `/Notes~2~2`). This is the only numbering; search's
  `dedupeDocIds` was removed because ids are now unique by construction.
  Bodies without such a collision index exactly as before.
- `sectionLines(source): Map<string, number>`.
- Search output is unchanged: `SEARCH_SCHEMA_VERSION` stays 5, and the
  existing extract doctest passes with only its import path changed.

### Track B — `ViewTarget.fragment` and its serialization

- `ViewTarget.fragment?: string`; `withoutFragment(target)`.
- Reserved query key `fragment` (documented in `view-url.ts`'s header with
  the reservation date and the grep result above). `parseViewQuery` reads it
  into the slot, never `params`; empty means absent. `serializeViewUrl`
  writes it after `viewState`, `encodeURIComponent`-encoded. No invariant: a
  target built in code with `params.fragment` serializes both keys, and on
  parse the slot takes it.
- Query key, not a URL `#`: `parseViewUrl` keeps a literal `#` in a path,
  and tab storage and the `card=` value go through it, so file names with
  `#` keep working. A `/views/X.card?fragment=h` URL reaches the slot through
  `workspaceRouteTarget`'s `searchStr` parse.
- `openCard` on an existing tab (`state-reducer.ts`): an explicit view
  replaces the target as before. Otherwise the tab keeps its view and takes
  the incoming fragment, so a search result reaches an already-open card,
  and a plain open clears an old fragment.
- Switching renderer in the pane drops the fragment
  (`WorkspaceCanvas/view.tsx`, `onSelectRenderer`).
- **Lifetime (decided).** The fragment stays in the tab target and the URL:
  copying the URL or reloading opens at the section. A jump happens when the
  view mounts with a fragment or the fragment value changes. Tab selection,
  live edits, and Back to a different card do not jump. **Accepted
  limitation:** picking the identical section again while the tab already
  holds it does not re-jump (the target does not change). A plain open of
  the card in between clears it, and then the same section jumps again.

### Track C — one consumer in `FileView`

- `lib/fragment-target.ts` `resolveFragment(root, { fragment, source })` →
  `element | top | pending | missing`:
  - Section path: look it up in `sectionLines(source)`; absent → `missing`.
    An owned heading whose `data-line` is exactly line + 1 → that heading.
    Otherwise, if only blank lines precede the line, the heading is a title
    that `CardBody` blanked → `top` (once any heading has rendered, or at the
    deadline). Otherwise the last owned `h1`–`h6[data-line]` with
    `data-line` ≤ line + 1; no owned headings yet → `pending`.
    Repeated headings resolve by distinct lines; headings with markup by
    line, not text; a fenced `# comment` pseudo-section lands on the heading
    of the section that contains it.
  - Element id: first owned element with `.id === fragment`; else `pending`.
- `hooks/useFragmentJump.ts`: tries at once, then on each DOM mutation under
  the root, and gives up after 2 s (renderers load lazily behind their own
  Suspense fallback). One attempt per `path#fragment`; `element` →
  `scrollIntoView({ block: "start" })`, `top` → the root's top; `missing` or
  still `pending` at the deadline → miss + `console.warn`. After a miss, a
  source change re-resolves; if the section now exists the miss clears
  without scrolling. Returns the miss flag.
- `FileView`: wraps the body in the fragment root (a block `div`, `h-full`
  for a workspace PDF; `contents` and no jump in embed mode), calls the hook
  with `source = data.body ?? data.content`, and shows "Couldn't find that
  section in this card." in the body-notice slot beside `FileStaleNotice`.
  Every renderer that renders the body through `Markdown` is covered with no
  per-view code: `MarkdownCardView`/`CardBody`, `PersonView`, publication,
  Webpage, Commentary, PDF text, Browser task, `.md` files.
- Search: `components/search/target.ts` — `sectionDestination(hit)`
  (null for card hits and for `kind === "gdoc"`) and `searchResultTarget(hit)`.
  `renderers/search.tsx` and `QuickSearchOverlay.tsx` call it;
  `SearchResults.tsx` labels gdoc section hits "Synced document text".

### Track D — markdown links carry a decoded `#fragment`

- `resolveContentTarget` uses `parseRef`, resolves `ref.path`, parses
  `ref.query`, and sets `fragment` from `ref.fragment`, percent-decoded
  (`#notes%2D1` → `notes-1`; malformed escapes kept raw). `#` wins over a
  `?fragment=` in the same href. Before: `Other.doc.card#h` resolved to path
  `…/Other.doc.card#h` (probe), and `?view=source#h` to viewer `source#h`.

## Could this be simpler?

**Locator: stored heading id vs render-time section path (chosen).**

| | Index stores heading id | View resolves section path by `data-line` |
|---|---|---|
| Repeated headings | Correct | Correct |
| Markup in heading | Correct | Correct |
| Title heading blanked by `CardBody` | Wrong: index `weekly-plan` / `weekly-plan-1`; page has only `weekly-plan` (the repeat) — the title result jumps to the repeat | Correct (probe and test) |
| Fenced `#` line | Opens at top | Lands on the containing section |
| Card edited after indexing | Shifted suffixes can name a different heading silently | Re-split; renamed → miss note |
| Index change | Schema bump, rebuild, re-embedding on every box | None |

**Consumer: per-view hooks + `sections` flag (draft 2) vs one `FileView`
consumer (chosen).** Per-view hooks needed edits in each body view and a
registration flag to explain the views that lacked one, and still missed
Webpage. The `FileView` consumer is one place; the cost is a bounded wait
(MutationObserver + 2 s) for lazy renderers.

**Repeat-jump trigger: `SidecarTab.openedAt` (draft 2) vs fragment change
(chosen).** `openedAt` was a second tab timestamp beside `lastActiveAt`; the
repeat case it served is accepted as a limitation (Track B).

**Not built:** highlight, smooth scroll, fuzzy title-to-id match, TOC,
scroll restoration on Back, `scroll-margin-top` (not needed; see *Rollout
shape*).

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Section renamed or deleted after indexing | `useFragmentJump.test.ts` (miss) | Note + `console.warn` | Clear (browser: screenshot 0005) |
| Link id names no element | Resolver returns `pending`; deadline → miss | Note after 2 s | Clear |
| View splitter and indexer disagree | `markdown-sections.test.ts` compares with `extractCardDocs` | One shared module | n/a |
| A literal `## Notes~2` collides with an automatic `~2` | `markdown-sections.test.ts` (paths, lines, unique ids) | `uniqueSectionPaths` | n/a |
| A body opening with a blank line then `## Status` | `useFragmentJump.test.ts` | Exact `data-line` match before `top` | n/a |
| Miss notice stays after an edit adds the section | `useFragmentJump.test.ts` | Re-resolve on source change, no scroll | n/a |
| `CardBody` blanks the title heading | `useFragmentJump.test.ts` through `MarkdownCardView` | `top` rule + line match | n/a |
| Fenced `#` line | `useFragmentJump.test.ts` | Nearest heading above | Clear |
| Embedded card's headings | `useFragmentJump.test.ts` (nested root) | Ownership by nearest root | n/a |
| A renderer that does not render the body with headings (question, place, todo view, Source view, gdoc metadata) | No | Deadline → miss note | Clear |
| gdoc section result | `target.test.ts` | No fragment; label "Synced document text" | Clear (no promise) |
| `params.fragment` set in code with the slot | No | Both keys serialized; slot wins on parse | Accepted (no code does this) |
| Encoded fragment in a link | `view-url.fragment.test.ts` | Decoded once; raw on failure | n/a |
| Live edit re-scrolls the reader | `useFragmentJump.test.ts` | One attempt per fragment | n/a |
| Re-pick of the same section on an open tab | No | None | Accepted limitation (Track B) |
| Heading under a sticky header | Browser walk | Not needed (heading lands flush at the pane top) | n/a |

## Agent-flow / user-flow edge cases

- **Wrong field.** ADDRESSED: one slot; forms told apart by the leading `/`;
  `searchResultTarget` is the only search path into it.
- **Stale ref.** ADDRESSED: re-split at view time; miss note. `bbx mv` keeps
  fragments.
- **Two agents touching the same card.** ADDRESSED: edits do not re-jump.
- **Hand-edit drift.** An agent writes `Card.card#Where things stand`.
  ADDRESSED visibly: exact match only; the miss note shows. Copying
  `bbx search` output (`path#/A/B`) into a link now works.
- **Fabricated value / validation UX.** Not applicable.
- **Transition state.** ADDRESSED: no data change; stored tabs without a
  fragment parse as before.

## NOT in scope

- **gdoc section destinations.** The text lives in the attachment; the hit
  does not carry its ref. Search stops promising a section.
- **Section destinations outside the workspace pane** (Browse detail, todo
  preview, chat embeds, figure embeds): those `FileView`s get no fragment.
- **Cmd-click hrefs for files with `#` or `?` in their names**:
  `link.tsx:37` does not encode the path; broken before, unchanged.
- **Bare `#heading` links within the same card**: still a native anchor
  (`classifyMarkdownHref`).
- **The splitter's code-fence and raw-markup behavior** in search labels.
- **A lint that checks link fragments**; highlight; TOC.

## Open design questions

None.

## Knowledge audits

Skip: no new agent-facing concept. The `#` ref suffix already parses in the
box ref algebra, and `bbx search` already prints `path#<section path>`.

## What will hold this after it ships

New node/tap `.test.ts` files (no new doctests):

- `test/shared/markdown-sections.test.ts` — the view's section paths equal
  `extractCardDocs`'s for a body with repeats, a fenced `#` line, and markup;
  `~N` counts emitted sections only; `sectionLines` gives 0-based lines.
- `src/frontend/test/lib/view-url.fragment.test.ts` — round trip of both
  forms; unchanged serialization without a fragment; reserved key and empty
  value; `#` in a file name through `parseViewUrl` and a `card=` value;
  `resolveContentTarget` with `#h`, `?view=source#h`, absolute path, empty
  `#`, `?fragment=a#b`, `%2D`, `%20`, malformed `%`, escaping path; a link
  href through `new URL` and `workspaceRouteTarget`.
- `src/frontend/test/hooks/useFragmentJump.test.ts` — happy-dom, the real
  `MarkdownCardView` → `CardBody` under a router and query client: repeated
  title heading, title section → root, second `Notes` by line, markup
  heading, fenced pseudo-section, element id, miss flag, no re-jump on a
  body edit, re-jump after clear; nested-root ownership.
- `src/frontend/test/components/search/target.test.ts` — section,
  card, and gdoc hits.
- `src/frontend/test/components/chat/workspace/state-reducer.fragment.test.ts` —
  an open tab takes a fragment and keeps its view; a plain open clears it.

## Implementation order

1. Track A. 2. Tracks B + D. 3. Track C. 4. Browser walk. All done in the
worktree; the plan ships in one piece when the boxholder says so.

## Rollout shape

**Checks run (2026-10-18):**
- New tests: 5 files, 49 assertions, all pass. `test/core/search/extract/core.doctest.md`
  passes with its import path changed.
- `pnpm --dir beebox typecheck`: clean. `pnpm lint:changed`: clean.
- `pnpm test:changed`: 289 files, 3588 assertions, all pass.

**Browser walk** (`bin/browse`, `http://localhost:3210/journey-courseware/test1/`,
read-only on box content; the test box has no long doc card, so the long
card is a Webpage card, `inbox/pages-saved/Steerling-8B_….webpage.card`):

1. Cmd-K, "discovered concept space", result `Section: /What this unlocks`:
   the pane scrolled to its maximum and the heading is in view
   (`.claude/screenshots/0002-quick-search-what-this-unlocks.png`). The URL's
   `card=` value carries `fragment=%2FWhat%20this%20unlocks`.
2. Search card, result `Section: /Steerling-8B in Action/Overview` (the
   second "Overview" in the card, an `h3` at `data-line` 47), on the
   already-open tab: the heading sits flush at the pane top, not under a
   header (`0003-search-card-repeated-overview.png`). No `scroll-margin-top`
   added.
3. `/views/<card>?fragment=performance` (the id form a `Card.card#performance`
   link serializes to): opens with `#performance` at the pane top
   (`0004-id-fragment-performance.png`). A rendered markdown `#heading` link
   was not clicked in the browser: no test-box card has one and box content
   was not edited. The href path is covered by the unit test.
4. `?fragment=/No such section`: the note "Couldn't find that section in this
   card." shows above the body (`0005-missing-section-note.png`).
5. A doc card (`theme-tour/long-form.doc.card`, `CardBody`), section path
   `/A code sample`: heading at the pane top (`0006-doc-card-section-path.png`).
6. Phone width 375×800, the repeated Overview: heading at the pane top
   (`0007-mobile-repeated-overview.png`).

No data migration and no index rebuild. No knowledge audit lands.
