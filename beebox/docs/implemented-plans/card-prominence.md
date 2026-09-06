---
title: "Card prominence: visibility lives on the card, landmarks derive from it"
status: implemented
workstream: card-visibility
issues:
  - ../../../issues/closed/features/2026-06-12-card-level-prominence.md
  - ../../../issues/closed/features/2026-08-29-landmark-links-become-file-metadata.md
---
# Card prominence: visibility lives on the card, landmarks derive from it

Today the only editorial signal for "should the box surface this?" is a
landmark card's hand-curated `navigation.links` list. It lives far from the
cards it names and it drifts. This plan adds one frontmatter field to every
card, `prominence`, with three named levels, and makes a landmark's list
derive from the cards under it. The vocabulary is the deliverable as much as
the mechanism: what each level promises a reader, what it asks of an agent,
and how an agent decides on one card without flooding the box.

The jobs, in the boxholder's situations:

- When an agent has just produced the plan for a project, next to its notes,
  logs and drafts, I want that plan to be the thing Browse shows first for the
  directory, so the real artifact is not one row among twenty.
- When I open the Recipes spot, I want the recipes that matter listed without
  someone having re-typed their paths into the landmark, so the list is
  current after a move or a new card.
- When I look at the box from the top, I want a pruned tree of what matters,
  with entry points into each area, so I can survey the box without reading
  a flat directory dump.
- When a directory holds logs and state, I want it folded away everywhere
  except a raw listing, so housekeeping never competes with content.

**Issues addressed:**
`issues/features/2026-06-12-card-level-prominence.md` (anchor; resolved) and
`issues/features/2026-08-29-landmark-links-become-file-metadata.md` (its
sibling; resolved: distributed metadata, an index, a pruned tree, the menu
shortcut kept). Related, designed with but NOT resolved here:
`issues/features/2026-08-06-landmark-list-sort-modes-used-name-tree.md`
(ordering of landmarks themselves; independent of the ordering of a
landmark's children, which this plan settles),
`issues/bugs/2026-08-24-map-children-git-vs-disk.md` (this plan's aggregator
reads disk only, so it does not inherit the git/disk split),
`issues/features/2026-08-30-todos-inline-things-to-think-about.md` (the
companion view; a card's prominence is a natural companion-panel fact, not
built here), `issues/features/2026-06-12-directory-head-cards.md` (the deep
version: a same-named sibling card heading a directory; this plan keeps the
landmark-inside-the-directory shape and does not preclude it),
`issues/features/2026-08-19-collection-views-are-badly-defined.md` (entry
points are often collection views; this plan uses the existing per-type view
binding and does not define collection views),
`issues/features/2026-07-28-directories-as-viewable-things.md` (a directory's
compact listing is a view of a directory in spirit, but this plan changes the
existing directory renderer rather than making directories view targets),
`issues/features/2026-08-08-no-visible-search-or-home.md` (the pruned
Landmarks tree is a better home surface; search discoverability is untouched).
Grep of the queue for `prominen`, `featured`, `entry point`, `landmark`,
`links:`, `browse` found no other open items.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` **#1 Types are structure**: the level is a
  closed literal union, not a boolean plus a flag.
- **#3 Validate at boundaries**: the field is validated by the card schema at
  parse time, like every global field.
- **#4 Resilient and never silent**: a landmark whose derived list cannot be
  computed says so; the Landmarks page already renders parse problems as a
  row (`docs/landmarks.md`: "Parse warnings — a row naming any
  `**/*.landmark.card` whose frontmatter failed to parse").
- **#7 Hierarchy is a discoverability contract**: the field's meaning is
  scoped to the directory the card sits in, so the tree stays the unit of
  meaning.
- **#8 One way to do each thing**: "surface this card here" is said on the
  card. The landmark's `links:` list narrows to what a card cannot say about
  itself (a target outside the directory, a contextual label, a fixed order).
- **#10 Testability is architectural**: the fold decision for Browse and the
  pruning walk for landmarks are pure functions over listings, reached by
  doctests, not tested through the page.
- **#11 Enforcement beats convention**: the budget that keeps an agent from
  marking everything is a lint, not a paragraph.
- **#12 The maintainer is usually an agent**: the level names and the agent
  guidance are written for an agent deciding on one card with no memory of
  this plan.
- `beebox/CLAUDE.md` migration rule and the `bbx-migration` boundary: a
  landmark's `links:` gains a derived counterpart on real boxes; the
  migration is additive and idempotent.
- Boxholder direction, this session: "We'll probably have more than one
  level, with kind of entry points (often a collection-style view that gives
  an overview of a whole area) and visible-but-not-entry-points. Phrasing
  these correctly and describing to the agent is super important."
- Precedents: the `symbol` global field and its `landmark-symbol` migration
  (`docs/implemented-plans/card-symbol.md`, `scripts/migrate/landmark-symbol.ts`)
  for adding a global field and moving landmark data onto it; the landmark
  `group:` expand for a collapsed-with-count disclosure
  (`src/schemas/landmark.ts:68-72`).

## What already exists

- **Global card fields.** `src/cards/schema.ts:92-98` `GLOBAL_CARD_FIELDS`
  holds `title`, `contains`, `contains-evidence`, `todos`, `symbol`; injected
  by `cardSchema()` at `:348-352` with schema-wins on a name clash. The
  docblock at `:89-90` names the two docs to update when a field is added:
  `.claude/skills/bbx-guide-schemas/SKILL.md` and `docs/adding-schemas.md`
  (`docs/adding-schemas.md:72`: "Every schema automatically gets five optional
  frontmatter fields"). **Reuse**: `prominence` becomes the sixth.
- **Landmark schema.** `src/schemas/landmark.ts:98-105` `LandmarkNavigation`
  (`label`, `symbol`, `links`, `expand`, `chat-app`); `:52-56` `LandmarkLink`
  `{ ref, label? }`; `:74-81` `LandmarkExpand` (glob `query`, `group`,
  `order`, templates). Its `instructions` (`:147-195`) are the agent-facing
  doc. **Reuse**: `links` and `expand` stay; the resolver gains a derived
  source.
- **The standalone landmark reader is NOT the card loader.**
  `src/schemas/landmark.ts:128-140` `LandmarkObject` parses a landmark file
  directly and strips every global field except `symbol`, which is admitted
  by hand: "`symbol` is the exception, admitted explicitly ... Stripping it is
  what would make a migrated landmark render as no symbol at all."
  `parseLandmarkFields` (`:207-219`) is what `landmarks.list`, `forDir`,
  triage, and `installRootLandmark` read. **Change**: `prominence` is
  admitted the same way, in the same chunk that adds the global field, or a
  `background` landmark is invisible to every landmark reader.
- **Landmark resolver.** `src/core/landmark/resolve.ts:87-110`
  `resolveLandmark` builds the flat list (hand-listed first, then unnamed
  expands, deduped by ref) and named groups; `:146-183` `resolveExpand` runs
  a glob relative to the landmark directory, filters to card files, sorts by
  `alphabetical | modified-desc | modified-asc` via `fs.stat`, and caps groups
  at `GROUP_CHILD_CAP = 50` (`:62`). **Reuse**: derived children are one more
  input to the same dedup and the same wire shape.
- **`landmarks.forDir` and its callers.** `src/webapp/trpc/routers/landmarks.ts:262-281`
  globs `<dir>/*.landmark.card` per call and fully resolves navigation
  (`links` refs and every `expand` glob, which for a `**/` query is already a
  recursive walk); called from `PlacePill.tsx:102`, `DocumentIcon.tsx:64`,
  `DocumentPlace.tsx:53`, `ChatBarChrome.tsx:93`, `LandmarkLinksPanel.tsx:44`,
  and `BrowsePage.tsx:186` on every directory navigation. `PlacePill.tsx:16-18`
  calls it "cheap and scoped to one directory". Most of those callers want
  only the landmark's identity (label, symbol) and never open the link list.
  This is the hot path the 08-29 issue names; Track B splits identity from
  resolution so derivation never runs on a page mount.
- **`landmarks.list`** (`landmarks.ts:194-253`) globs every landmark, resolves
  each, and computes `depth` by an ancestor lookup. **Change**: the same
  ancestor lookup decides whether a landmark is under a `background`
  ancestor, so the cascade holds on the Landmarks page and the switch menu,
  not only inside one directory's derivation.
- **`forDir` has no `problems` channel.** It returns `{ landmark: null }` for
  an unparseable landmark; `problems` rides `landmarks.list` and
  `chat.byLandmark` only (`docs/landmarks.md`, Parse warnings), and today a
  `LandmarkProblem` is only a landmark parse failure. **Change**:
  `LandmarkProblem` becomes a two-member union,
  `{ kind: "landmark-parse", path, message } | { kind: "derived-read",
  landmarkPath, path, message }`, rendered by the same row. A derived child
  that fails to read inside `forDir` is logged at warn and skipped; the same
  failure surfaces as a `derived-read` row on the Landmarks page.
- **Per-file parse cache.** `src/core/landmark/card-cache.ts:56-89`
  `readLandmarkCard` caches one file's parse keyed by `ino:mtimeNs:ctimeNs:size`
  and deliberately does not cache glob discovery (`:10-13`) so adds and
  deletes show on the next call. **Reuse as the pattern** for the prominence
  index: fresh discovery, cached parse, no invalidation protocol.
- **Frontmatter reads.** `src/core/frontmatter-field.ts:43-51`
  `loadCardFrontmatter(absPath)` (read + parse, null on failure) and `:18-27`
  `lookupField`. `bbx ls --format "{prominence} {title}"` already prints any
  frontmatter field (`src/core/commands/ls.ts:1-7`), so agents can inspect
  a directory's levels with no new command (it prints, it does not filter).
- **Browse listing.** `src/webapp/trpc/routers/status.ts` `browse`
  (`:161-290`) lists from disk, folds `<basename>.attach/` into its owning
  card, reads `status` and `title` per card (`:262-276`), sorts by natural
  name. No fold or "show all" exists (grep of `pages/browse/` for
  `collapse|show all|showAll` found nothing). `docs/landmarks.md`: "The
  Browse page shows everything with equal weight — a flat file tree, no
  editorial layer." **Change**: the listing carries `prominence` per entry
  and a per-directory summary; the page folds.
- **Landmarks page and menus.** `LandmarksList.tsx` renders links as tiles
  "capped at the first 6 with an inline 'Show all N' disclosure"
  (`docs/landmarks.md` Rendering); grouped expands render as collapsed
  count-chips. The place pill's here menu shows "its pinned links at root
  level". **Reuse unchanged**: derived children arrive inside the same
  `links` array.
- **Card-type to view binding.** `src/frontend/src/lib/view-bindings.ts:1-13`:
  a box view exporting `rendersCardTypes = ["<type>"]` becomes that type's
  default renderer; `useCardViewBinding` is used from `FileView.tsx:344-360`;
  `bbx view-lint` enforces one view per type. **Reuse unchanged**: an entry
  point opened from a listing renders through its bound view. Nothing in the
  06-12 issue's "card-type→view binding" question needs new machinery; the
  `.sandbox.card` it mentions does not exist (no schema under `src/schemas/`
  matches) and is not created here.
- **Attach scopes.** `src/shared/attach-path.ts` (`.attach` suffix, owner
  found by basename match; `webapp/routes/figure.ts:41-63` `hasOwningCard`).
  Browse folds an owned `<basename>.attach/` into its owner card
  (`status.ts:217-234`). A plain file has no frontmatter and no sidecar.
  **Reuse**: a non-card file stays ordinary; the owning card carries the
  level; derivation does not walk into an owned attach scope (Track B).
- **Lint modules.** `src/core/lint-symbol.ts` is "one self-contained rule
  over one field" split out because `card-lint.ts` is at its line budget.
  **Reuse as the pattern** for the prominence budget lint.
- **Migration registry and precedent.** `src/core/migrations.ts:158`
  `landmark-symbol` (`scripts/migrate/landmark-symbol.ts:1-26`): surgical text
  edit rather than YAML re-stringify, idempotent by content. **Reuse as the
  pattern.**
- **Agent guide.** `src/core/agent-guide/cards.ts:55-62` explains `contains:`
  to box agents; `src/core/agent-guide/landmarks.ts` explains landmarks;
  schema `instructions` flow into `box-docs/card-<type>.md`
  (`src/core/docs-gen/package-docs.ts:1-20`). **Reuse**: the level guidance
  goes beside `contains:` and into the landmark instructions.
- **Knowledge audits.** `src/dev/knowledge-audits.yaml`, entries shaped
  `{ id, prompt, expected_level, watch_for, correct_contains, tags }`;
  `landmark-ref-box-root` (`:494-508`) is the nearest existing audit.
- **Search ranking.** `src/core/search/query.ts` scores by BM25 and vectors;
  no rank, pin, or hide signal exists. Nothing to reuse; ranking by
  prominence is NOT in scope.
- **Trash.** `bbx rm` moves cards to `_bookkeeping/trash/`
  (`src/core/box/skills-content.ts:332`), outside `_content`, so the root
  landmark's walk (`src/core/landmark/root-dir.ts:21,30-32`: logical `""`
  maps to `_content`) never reaches trashed primary cards. No stock
  housekeeping marker is needed for trash.

## Prior art (external)

Static-site generators solved "per-page navigation metadata, aggregated
into a tree" and converged on the same three moves this plan makes.

- **Docusaurus** orders sidebars from a per-doc `sidebar_position` and hides
  a doc with a class or a dot-prefixed filename; a `ref` item links a doc
  without placing it (https://docusaurus.io/docs/sidebar,
  https://github.com/facebook/docusaurus/issues/5686). Lesson: a per-file
  ordering number is what people reach for, and it scatters
  (https://github.com/facebook/docusaurus/issues/10792). This plan has no
  per-card order number; order within a level is by name, and a fixed order
  is the landmark's `links:` job.
- **Hugo** uses `weight` per page and `_index.md` as a section's list page,
  the closest analog to "an entry point is often a collection view over an
  area"; headless bundles are content that renders but never lists. Same
  shape as `background`.
- **Just the Docs** `nav_exclude: true` and `nav_order`; **MkDocs**
  `not_in_nav` (https://www.mkdocs.org/user-guide/configuration/) and
  Material's front-matter `hide:`
  (https://github.com/squidfunk/mkdocs-material/discussions/5856). Lesson: an
  excluded page stays addressable; exclusion is about listings, never about
  reachability. `background` follows that.
- **Obsidian maps of content** (https://obsidian.rocks/maps-of-content-effortless-organization-for-notes/,
  https://github.com/seqis/ObsidianMOC): a hub note per area, a home MOC
  listing the hubs. That is the entry-point layer by hand; the plugin
  (https://github.com/Robin-Haupt-1/Obsidian-Map-of-Content) derives it from
  links. Lesson: a curated hub drifts; the derived map is what people build
  next.
- No prior art found for a three-level *editorial* scale on the page itself
  (entry point / primary / background) as opposed to order plus exclude.
  The closest is Hugo's `_index.md` (entry) plus `weight` (order) plus
  headless (exclude), three mechanisms for the one axis this plan names once.

## Tracks / scope

### Track A — The field and its vocabulary

**What.** A global card field `prominence` with three literal values and an
absent default, plus the agent-facing definition of each level.

**Why this needs to change.** Today a card cannot say anything about its own
standing. The only signal is a landmark's list, which the 08-29 issue
describes: "curated `links:` lists drift (a moved/renamed card falls out; a
new card never gets added), and the list lives far from the thing it
describes."

**Direction.** In `GLOBAL_CARD_FIELDS`:

```ts
export const Prominence = z.enum(["entry-point", "primary", "background"]);
export type ProminenceLevel = z.infer<typeof Prominence>;
// in GLOBAL_CARD_FIELDS:
prominence: Prominence.optional(),
```

Absent means the type's default, which is **ordinary** for every content
type (type defaults below). Code that dispatches on the level uses a
four-member union `ProminenceLevel | "ordinary"` with `assertNever` (principle
#2). A wrong value is a schema error at parse time, and the message lists the
three values (Zod enum errors do; the lint formatter already renders them).
This is deliberate: a card with `prominence: headlien` is a misunderstanding of
the field, the same reasoning `lint-symbol.ts` gives for its one error ("means
the author misunderstood the field, and letting it reach a commit spreads that
misunderstanding"). Unlike a bad `symbol`, this is a hard error because the
value is a closed enum on a global field, and every other enum field in the
tree behaves that way.

The levels, as written for the agent guide. The names were settled with the
boxholder on 2026-09-06 (`headline` was rejected as singular and
top-of-page; `visibility` was rejected because nothing is ever invisible or
private; `artifact` was rejected because it means both the deliverable and
the by-product). Each level is an absolute bar the card either meets or
does not, never a comparison with its neighbours:

> **`prominence`** — who a card is for, and whether the box should put it in
> front of a reader who is looking around rather than looking for it. Leave
> it absent for most cards; absent is a level, and it is the right one by
> default. This is not access: every card, at every level, is readable and
> addressable.
>
> - **`entry-point`** — *Where a reader starts.* A card whose main job is to
>   orient a reader to this directory or area and send them onward: an
>   index, an overview, a dashboard, a roster, a gallery, a collection view.
>   Do not use it for a card that is merely important or useful; a recipe is
>   never an entry point, the recipe index is. A landmark card is not one
>   either: it marks a place, and the place's entry point is a visitable
>   card inside it. Ask: *would a newcomer open this first to understand
>   what is here?* Usually one per directory; a second is exceptional.
> - **`primary`** — *The thing itself.* The card a reader came to this
>   directory for, as opposed to material toward it or about it: a project's
>   plan is primary, its research notes, quotes, drafts, and call logs are
>   not. Do not mark a card primary because it is good; mark it because it
>   is the thing. Ask: *is this the thing itself, or material toward it?* A
>   piece of work produces one primary card; if you are marking a second for
>   the same work, the first was not the thing. If everything here is the
>   thing (forty recipes), mark nothing and give the directory an entry
>   point instead.
> - *(absent)* — **ordinary.** For the reader, if they look. Listed in full
>   views, folded under "more" in compact ones. Most cards.
> - **`background`** — *For the agent, not the reader.* Material the agent
>   uses but does not write for the boxholder to look at: logs, state,
>   imports, scratch, generated intermediates, and anything already embedded
>   in another card (an image that appears inside a primary document is
>   background on its own; the document is where a reader sees it). Still
>   readable and addressable; folded last and shown dimmed. Cards the box
>   writes for itself (jobs, runs, chat threads) and landmark cards are
>   background by type; you never mark them. On a landmark card a written
>   `background` marks the whole place as background.
>
> `prominence` is not `status`. `status` is lifecycle (new, done, archived);
> `prominence` is who the card is for. A finished card is not automatically
> primary, and an archived primary card should usually go back to ordinary.
>
> **Who sets it.** You do, when you produce the thing a piece of work was
> for: mark that card, and only that one; mark what you wrote for yourself
> along the way background. Marking your own output primary is expected.
> Marking every output primary is the failure this field exists to avoid.
> To surface a card in a spot that is not its own directory, or to give it a
> contextual label or a fixed position, use the landmark's `links:`; the
> card cannot say that about itself.

How the local decision stays globally responsible: each test is answerable
from the one card the agent is holding ("is this the thing itself, or
material toward it?", "is this for the reader or for me?", "does this card
exist to send the reader elsewhere?"), so an agent never needs to know the
rest of the box, and never needs to compare siblings. The
budget lint (below) is the enforcement for the case where many local
decisions add up wrong.

**Type defaults.** Absent means the card type's default level, and for
every content type that default is ordinary. Two kinds of card are
background by type, because a reader never visits the file itself:

- **Cards the box writes for its own use**: every schema with
  `category: "system"` (`src/cards/schema.ts:171`; chat-job, chat-thread,
  contains-backfill-job, procedure-run, question-followup-job,
  todo-review-job). Nothing to declare per schema; the category is the
  declaration.
- **Landmark cards.** The boxholder, 2026-09-06: "landmarks are about
  locations and chats, but not particularly visitable files, so rather they
  are more like ordinary or background but serve their own alternate
  purposes." A landmark is a place marker: it gives a directory a label and
  a symbol, binds chats to it, and names it as a filing destination. It is
  not the directory's entry point; the entry point, if there is one, is a
  visitable card inside the directory (an index, a gallery, an overview).
  The `landmark` schema declares `prominence: "background"` as its type
  default, so the file folds in Browse and the directory's identity is
  drawn from it (Browse already heads a directory with its landmark's
  label, `BrowsePage.tsx:137-169`).

A schema declares a type default with a new `cardSchema` option,
`prominence?: ProminenceLevel` (default ordinary); `category: "system"`
implies `background` unless the schema says otherwise. `bbx ls --format
"{prominence}"` prints the declared field only; the effective level is what
the index and Browse compute.

**On a landmark card, `prominence` describes the place, not the file.** The
file is background by type. A written value means:

- `background`: a housekeeping place. Off the Landmarks page and the switch
  menu, folded in its parent's compact listing, and the level cascades:
  every card under it is treated as background for folding and derivation,
  whatever the card says. A card that says `primary` under a background
  landmark gets a lint warning.
- `entry-point` or `primary` on a landmark: a lint warning, "a landmark
  marks a place; the place's entry point is a visitable card inside it."
  The place is on the Landmarks page by being a landmark, as today; there
  is no promotion above that to write.

The Landmarks page therefore stays what it is, a list of places with their
chats, minus background places. The pruned tree of what matters is each
place's derived list (Track B), not a re-ranking of the places.

**Budget lint** (`src/core/lint-prominence.ts`, box-level, run by `bbx validate`):

- more than `MAX_ENTRY_POINTS_PER_DIR = 2` entry points in one directory
  warning, "N entry points in one directory; an entry
  point is where a newcomer starts, and a directory usually has one". The
  lint allows the exceptional second and warns at a third.
- more than `MAX_PRIMARY_PER_DIR = 7` primary cards in one directory: warning,
  "N primary cards in <dir>; primary is the thing itself, not everything
  good — if everything here is the thing, mark nothing and give the
  directory an entry point".
- `primary` or `entry-point` under a `background` landmark: warning naming
  both cards.
- `primary` or `entry-point` on a card inside an owned attach scope:
  warning, "prominence inside an attach scope has no effect; mark the owner
  card, or list it in the landmark's `links:`".
- A landmark `links:` entry whose target is inside the landmark's own pruned
  subtree, carries no `label`, and whose target already says `primary` or
  `entry-point`: info, "redundant with the target's prominence".

The thresholds are constants. They are warnings, not errors, because a
directory with eight primary cards is untidy, not broken (principle #6).

**Vocabulary lock-ins.** Field name `prominence`; values `entry-point`,
`primary`, `background`; the word **ordinary** for absent in every doc and
error message; "surface" as the verb in prose ("the box surfaces a primary
card"). Not used: `hidden` (279 hits in `src` for CSS and UI state),
`pinned` (136 hits, chat and session pins), `featured`, `visibility`
(collides with access and CSS, and nothing is ever invisible), `headline`
(singular, top-of-page), `artifact` (deliverable and by-product both),
`entry` alone (a journal entry).

**First implementation chunk** (after the vocabulary gate in Implementation
order). Add `Prominence` to `src/shared/` (the frontend reads it too), add it
to `GLOBAL_CARD_FIELDS` and `InferCardFields`, admit it in `LandmarkObject`
beside `symbol` (`landmark.ts:128-140`), update `docs/adding-schemas.md:72`
and the bbx-guide-schemas enumeration, extend `test/cards/` schema doctests
(accepts the three values, rejects a fourth with a message naming them,
absent parses as undefined) and `landmark-schema.doctest.md`
(`parseLandmarkFields` keeps `prominence`). No open questions inside this
chunk; the names are the approved ones.

### Track B — The prominence index and derived landmark children

**What.** A `core/landmark/prominence-index.ts` that answers "which cards
under this directory carry a level, and what is each subdirectory's summary"
fast, and a derived source in `resolveLandmark`.

**Why this needs to change.** Derivation must read the frontmatter of every
card in a subtree. `landmarks.forDir` runs on every directory navigation and
on every chat page (`PlacePill.tsx:102`); the 08-29 issue: "`landmarks.forDir`
is the hot path that must not get slower."

**Direction.**

*The honest cost.* A derived list for a directory costs one `readdir` per
directory in the pruned subtree plus one `stat` per card in it, on every
computation, and a parse for each card whose identity changed. Today's
`forDir` costs one single-directory glob plus, only when the landmark has an
`expand`, that expand's glob (a `**/` query is already a subtree walk;
`alphabetical` order does not stat, `resolve.ts:262-279`). So for a landmark
with no `expand`, derivation is a new subtree walk where there was one
`readdir`. The plan does not claim otherwise; it keeps that walk off the
mount path instead.

*Split identity from resolution.* `forDir` becomes two procedures:
`landmarks.identity({ dir })` returns label, symbol, path, and level (one
glob, one cached parse; what `PlacePill`, `DocumentIcon`, `DocumentPlace`,
`ChatBarChrome` need on mount), and `landmarks.forDir({ dir })` keeps its
name and its full payload (listed, derived, expand) for the callers that
render a link list: the here menu on open (the switch menu already fetches
lazily on first open, `PlacePill.tsx:16-29`), `LandmarkLinksPanel`, and
Browse. Done-when for this track includes the mount-path callers moved to
`identity`.

*Index.* Same pattern as `card-cache.ts`: discovery is fresh (a `readdir`
walk of the subtree), parses are cached per file keyed by
`ino:mtimeNs:ctimeNs:size`, and a file whose identity is unchanged is never
re-read. No file-watcher dependence: the index is correct for `bbx validate`
and for a `git pull` the watcher never saw. The index exposes a read counter
behind the existing test-stub flag pattern (principle #10) so a doctest can
assert a warm call parses nothing. The rollout step measures `forDir` on the
test1 root before and after; if a real box makes a warm derived call slower
than an `expand` over the same subtree, the fallback is a per-landmark memo
keyed on the subtree's directory identities, invalidated by the existing
file watcher (`core/box/file-watcher.ts`), which is a change inside this
module and not a design change.

*Pruned walk.* The unit of derivation is a landmark's **pruned subtree**: its
directory and every descendant directory, stopping at any directory that has
its own landmark card, and never entering an owned attach scope. A stopped
directory contributes exactly one entry, its landmark (label, symbol, path),
unless that landmark is `background`, in which case it contributes nothing.
A `background` landmark at the top of the walk yields an empty derived list.
An owned `<basename>.attach/` directory (its owner card is a sibling,
`attach-path.ts`) is not walked: Browse folds it into the owner
(`status.ts:217-234`), and derivation follows the same fold, so an attached
card never becomes a navigation entry on its own. The one exception is an
attach scope that holds its own landmark card, as in test1's
`courses/Acids_Bases.attach/Acids_Bases.landmark.card`: that is a nested
landmark like any other and contributes one entry. To surface a card inside
an attach scope, mark the owner, or list it in `links:`.

*Derived list order.* Within the flat list: hand-listed `links` (as today,
first and winning dedup), then derived `entry-point` cards, then derived
`primary` cards, then nested landmarks, then unnamed `expand` results; named
groups unchanged. Within each derived tier, by box path (`naturalCompare`,
the browse order). There is no per-card order number: a fixed order is
`links:`' job, and Docusaurus's `sidebar_position` scatter is the failure the
number invites.

*Wire shape.* The authored shape is unchanged: `navigation.links[]` stays
`{ ref, label? }` (`landmark.ts:52-56`), and a `source:` key written there is
an unknown key. The **resolved** shape (`ResolvedLink`, `resolve.ts:23-32`,
what `forDir` and `list` return) gains `source: "listed" | "derived" |
"expand"` and `prominence?: ProminenceLevel`, so the Landmarks page and the
here menu render derived entries with no change and a later UI can badge
them.

*Box-wide cascade.* `landmarks.list` and the switch menu's `chat.placeMenu`
drop a landmark whose written level is `background`, and any landmark with
a `background` ancestor landmark, using the ancestor lookup `list` already
performs for `depth` (`landmarks.ts:194-253`). The rule lives in one
function, `isListedLandmark(landmark, ancestors)`, used by both.

*Signature.*

```ts
export interface ProminenceEntry {
  boxPath: string;              // leading "/"
  level: ProminenceLevel;       // never "ordinary": ordinary is not indexed
  kind: "card" | "landmark";    // a landmark entry describes its directory
}
export interface DirectorySummary {
  hasEntryPoint: boolean;
  primaryCount: number;
  background: boolean;          // this dir's landmark says background, or an ancestor's does
}
export async function prunedSubtree(boxRoot: string, dir: string): Promise<{
  entries: ProminenceEntry[];
  nested: LandmarkSummary[];    // stopped directories' landmarks, background excluded
  summary: DirectorySummary;
}>;
```

**Vocabulary lock-ins.** "Pruned subtree", "derived" (vs "listed"), "nested
landmark", `source` on the resolved link, `landmarks.identity`.

**First implementation chunk.** `prominence-index.ts` with `prunedSubtree`
and the parse cache, and a doctest under `test/core/landmark/` that builds a
fixture tree (an entry point, two primary cards, an ordinary card, a nested
landmark with a primary inside it, a background landmark with a primary
inside it, an owned attach scope holding a primary card), asserts the
entries, the stop at the nested landmark, the exclusion under background,
the skipped attach scope, and zero parses on a warm second call. The
identity/resolution split and the resolver wiring are the second chunk.

### Track C — Compact Browse

**What.** Browse's directory listing leads with what matters and folds the
rest behind one disclosure. Raw mode shows everything, as today.

**Why this needs to change.** The 06-12 issue: "not a hard filter, but an
editorial default that flips browse from flat-everything to
here-are-the-real-things." The 08-29 issue: "a very compact browse: the
aggregated view reads like a pruned tree of what matters under the landmark,
not a flat dump."

**Direction.** `status.browse` already reads every card's frontmatter
(`status.ts:262`); it adds `prominence` per card and, per subdirectory, the
`DirectorySummary` from Track B (one extra walk per subdirectory, the same
walk that already counts `.card` files recursively at `status.ts:239-241`;
the two are merged into one). A pure `foldListing(listing) → { lead, more }`
in `src/shared/browse-fold.ts` decides:

- **lead**: entry-point cards; primary cards; subdirectories whose summary
  has an entry point or a primary (shown with their landmark identity when
  they have one); the directory's own landmark's hand-listed `links` are
  not repeated here (they are the here menu's job).
- **more** (one disclosure, "N more"): ordinary cards, plain files,
  subdirectories with nothing prominent, then background cards and
  background directories last and dimmed.
- A directory with nothing prominent anywhere renders exactly as today, with
  no disclosure. The compact mode is invisible until someone marks a card,
  so an unmarked box does not change.
- A `background` directory (own landmark or cascaded) folds everything into
  "more".

The page keeps a compact/raw toggle persisted per viewer in `localStorage`
(the same per-surface preference shape the 08-06 sort-modes issue proposes);
raw is today's listing. The cascade is computed server-side so the page never
walks ancestors.

**Vocabulary lock-ins.** "Compact" and "raw" as the two listing modes; "more"
as the disclosure label.

**First implementation chunk.** `browse-fold.ts` and its doctest (every
branch above, including "nothing prominent → no fold"), then the `browse`
procedure's added fields, then the page.

### Track D — Migration and stock

**What.** `landmark-links-prominence`: for every landmark, each `links:`
entry whose target is a card inside the landmark's pruned subtree gets
`prominence: primary` written on the target when the target has no
`prominence` yet. The link entry is kept. The script reports the entries that
are now redundant (no label, in-subtree) so a person or agent can trim them.

**Why this needs to change.** Existing boxes hold curated lists; without the
migration the compact Browse of those directories leads with nothing while
the landmark says otherwise.

**Direction.** Additive and idempotent: it writes only a missing field, never
removes a link, never re-stringifies YAML (the `landmark-symbol` precedent:
surgical text edit). A target that does not exist is reported and skipped
(`bbx validate` already flags it as a broken ref). A target outside the
subtree, or one that already carries a level, is left alone. `bbx create`
for landmarks (`createLandmarkTemplate`) is unchanged. Test1 has two landmark
cards, one with links (three entries, all in-subtree, all labelled), so the
migration marks three cards there and reports nothing redundant because every
entry carries a label.

**Vocabulary lock-ins.** Migration name `landmark-links-prominence`.

**First implementation chunk.** The script plus a doctest on a fixture box
(marks in-subtree targets, skips out-of-subtree, skips already-marked,
idempotent on rerun, reports missing targets).

### Track E — Agent guidance, docs, audits

**What.** The level definitions (Track A's block) into the agent guide beside
`contains:` (`agent-guide/cards.ts`), a shortened pointer in the landmark
schema `instructions` ("the derived list and when to still use `links:`"),
`docs/landmarks.md` rewritten where it says "Hand-curated and ordered. No
auto-discovery", and the knowledge audits below.

**Why this needs to change.** The boxholder's bar: "Phrasing these correctly
and describing to the agent is super important." A field the agent does not
understand is a field the agent either ignores or sprays.

**Direction.** One definition, one place: the agent guide holds the level
block; the landmark instructions and `docs/landmarks.md` link to it rather
than restate it. The guide block carries examples and non-examples drawn
from `docs/example-names.md` (a plan card marked primary beside unmarked
notes; a gallery view marked entry-point; a logs landmark marked background;
a well-written recipe among forty peers left ordinary, with the recipe index
as the entry point and the two the household cooks weekly as primary cards). `bbx ls --format "{prominence} {title}" <dir>`
is documented as the way to inspect a directory's levels.

**First implementation chunk.** The agent-guide section and the audit
entries, then run the audits and record status.

## Could this be simpler?

**Simplest version.** Tracks A and E alone: the field with its three
values, the agent-facing definitions with examples, the schema acceptance,
the docs, and the knowledge audits. No derivation, no index, no Browse fold,
no migration, no lint. Agents start marking cards; `bbx ls --format
"{prominence} {title}"` shows what they marked; nothing in the UI changes.
That version is where the risk is (the words) and none of the machinery, and
it is a coherent first landing if the boxholder wants the terms to survive
use before anything consumes them.

**What the fuller plan buys, and why:**

- **Compact Browse (Track C).** Without a consumer, the field is a promise
  the box never keeps; the 06-12 issue's motivating shape is "shown by
  default ... with attachments/logs/notes receding". Browse is the one
  surface where a marked card changes what a reader sees, and the fold is a
  pure function over a listing Browse already reads (principle #10).
- **Landmark derivation and the index (Track B).** Without derivation, a
  landmark's list and a card's level are two ways to say "surface this here"
  (principle #8) and the drift the 08-29 issue describes continues.
  Derivation reads subtrees, which is the only reason the index and the
  identity/resolution split exist (08-29 requirement 1).
- **The lint (Track A).** A paragraph asking agents to be sparing is a dead
  letter (principle #11); the budget is what makes a local decision globally
  responsible once many agents have made one.
- **The migration (Track D).** Without it, existing curated lists and the
  new marks disagree on real boxes.

A one-bit `prominent: true` was considered as the simplest version and
rejected: an entry point is what shows from *outside* its directory and a
primary what shows from *inside*, and with one bit either every marked card
climbs into the parent's tree or none does. The boxholder asked for the
levels; the pruned tree (08-29 requirement 2) needs them; `background` has
no boolean form.

## Subplans

none. The vocabulary decision is a short table (Open design questions), not a
research step; the index reuses an existing pattern rather than needing its
own design.

## Failure modes

> **Critical gap, accepted as documented risk:** a primary card moved by a
> shell `mv` into a directory that already has seven primary cards — nothing
> fails, the listing shows eight, and only `bbx validate` says so. Accepted:
> the outcome is untidy, not wrong, and the lint is the stated enforcement.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `prominence: headlien` (typo) | Track A doctest | Zod enum error naming the three values; card invalid until fixed | Clear |
| `prominent: true` (wrong key) | existing unknown-key lint | stripped in memory, lint warning (`schema.ts` "Lenient (not `.strict()`)") | Clear (warning) |
| 40 cards marked primary in one directory | Track A lint doctest | budget warning; Browse shows all 40 in lead | Clear (lint), silent (page) |
| primary card under a background landmark | Track A lint doctest | cascade folds it; lint warning | Clear |
| landmark says `background` on the box root | Track B doctest (prominence-index, root case) | ignored: the root landmark is the box's identity, not a place that can be housekeeping; nothing folds; `bbx validate` warns and says the value is ignored | Clear |
| index parse cache stale after an in-place edit that keeps mtime, size, and inode | Track B doctest (identity key) | same exposure as `card-cache.ts` today; ctimeNs changes on any metadata write, which covers `touch -r` but not a same-second overwrite | Silent, accepted (existing pattern) |
| `forDir` on a subtree of 5k cards | Track B doctest asserts warm parses = 0; no timing test | one stat per card; same order as an `expand` glob | Silent, measured in the rollout step |
| two landmarks in one directory | existing `forDir` takes the first match | unchanged; existing "one per directory" rule | Silent (existing) |
| derived entry's target is unreadable mid-walk (deleted between readdir and read) | no test (a race) | the index walk treats `ENOENT` after `readdir` as "not there" and skips the file; a read that fails after that point is a `derived-read` problem row on the Landmarks page and a warn log in `forDir` | Clear on the page, log-only in the menu (accepted) |
| a card inside an owned attach scope says `primary` | Track B doctest | not walked; lint warning "prominence inside an attach scope has no effect; mark the owner" | Clear |
| `prominence: background` on a landmark, engine reader not updated | Track A landmark-schema doctest | `LandmarkObject` admits the field in the same chunk | Clear (test) |
| migration target file has no frontmatter block | Track D doctest | reported and skipped, nothing written | Clear |
| migration on a box whose engine predates the field | n/a | the field is an unknown key there: stripped with a warning, `links:` still resolve | Clear (warning) |
| Browse compact mode hides a card the boxholder is looking for | manual (rollout) | the "N more" disclosure and the raw toggle | Clear |
| a landmark `links:` entry now duplicates a derived entry | Track B doctest | dedup by ref, listed wins with its label | Silent, intended |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — `prominence` vs `status`: ADDRESSED, the
  guide block states the distinction; `prominent:` vs `prominence:`:
  ADDRESSED by the unknown-key warning. `entry-point` chosen for a merely
  important document: ADDRESSED by the "would I send a newcomer here first?"
  test and the entry-point budget of two.
- **Stale ref** — a landmark `links:` target moved: unchanged from today
  (`bbx validate` broken-ref warning). A card's level travels with the card
  through `bbx mv`: ADDRESSED by construction, the field is on the card.
- **Two agents touching the same card** — no new codepath; a frontmatter
  edit like any other. The index tolerates a card changing between `stat`
  and read by re-keying on the next call.
- **Hand-edit drift** — `prominence: Headline` (case): GAP, Zod enum is
  case-sensitive and the error names the lowercase values; accepted, the
  message is the fix. `prominence: true`: same error path, ADDRESSED.
- **Fabricated free-form value** — the enum makes it impossible to invent a
  level: ADDRESSED. The honest default (absent) costs nothing: ADDRESSED by
  design.
- **Validation error UX** — the enum error reads "Invalid enum value.
  Expected 'entry-point' | 'primary' | 'background', received 'headlien'"
  through the existing lint formatter; the budget warnings are written above
  in the agent's terms: ADDRESSED.
- **Partial migration / transition state** — engine new, box unmigrated:
  `links:` resolve as today, derived list empty, Browse unchanged (nothing
  marked). Engine old, box migrated: field stripped with a warning. Both
  states are today's behavior plus a warning: ADDRESSED.
- **An agent marks its own output** — the guide asks for exactly one
  primary per piece of work: ADDRESSED in text; enforced only by the
  directory budget: DEFERRED to the audit results (Track E) for whether the
  text lands.

## NOT in scope

- **Search ranking by prominence.** Considered; not now because no ranking
  consumer exists (`search/query.ts`) and the field is in indexed frontmatter,
  so a later boost is a one-line weight.
- **A "Today" or home surface.** The pruned Landmarks tree is the nearest
  thing; a home page is `2026-08-08-no-visible-search-or-home`'s question.
- **Ordering of landmarks themselves** (used / name / tree): the 08-06
  issue, independent of this plan; the switch menu keeps its current order.
- **Sidecar metadata for plain files.** A plain file is ordinary; to surface
  one, wrap it in a card or list it in `links:`. A sidecar is a second
  metadata mechanism (principle #8) for a case the owning-card pattern
  already covers.
- **Per-card order numbers** (`weight`, `order`). `links:` is the fixed-order
  mechanism; see Prior art for why a number scatters.
- **Retiring or reshaping `expand`.** It stays as the collection-fan-out
  rule; a selector on the prominence field is not added because derivation
  is implicit and needs no query syntax.
- **Directory head cards** (`2026-06-12-directory-head-cards`) and
  directories as view targets (`2026-07-28`). The landmark stays inside its
  directory.
- **A `sandbox` card type** or any card-type→view binding change. The
  existing `rendersCardTypes` binding is the full picture the 06-12 issue
  asks for.
- **MAP.md leading with prominent cards.** `refresh-maps` is a live
  workstream with its own git-vs-disk bug (08-24); the brief can read
  `bbx ls --format "{prominence} {title}"` later without a plan change here.
- **Splitting the `destinations` role out of landmarks.** The 06-12 issue's
  caveat; a separate cleanup, untouched here.
- **The companion view** (08-30). A card's level is a fact it could show;
  the panel does not exist.

## Open design questions

These are the conversation with the boxholder. Questions 1 and 2 were
settled on 2026-09-06 and are kept for the record.

1. **The field name.** Settled: `prominence`. `visibility` was considered
   and rejected by the boxholder: "the bad part of visibility is that it's
   never invisible, it's not private or anything like that."
2. **The level names.** Settled: `entry-point` / `primary` / `background`.
   `headline` was rejected as reading singular and more important than an
   entry point; `foreground` as relational (only "more than ordinary") with
   no absolute bar; `artifact` as meaning both the deliverable and the
   by-product. `primary` names a category (the thing itself versus
   material toward it) that an agent can test on one card.
3. **Whether embedded-elsewhere should be derived rather than declared.**
   The boxholder's rule, "things that are embedded elsewhere probably are
   background items," is stated in the guide as something the agent
   declares. It is also computable: `core/find-inbound-card-refs.ts` can
   tell whether a card is embedded by another. Lean: declare now, derive
   later if agents keep forgetting; a derived signal is a second source of
   truth for the same field.
4. **What a landmark is on this scale.** Settled 2026-09-06: not the
   directory's entry point. A landmark marks a place (label, symbol, chats,
   filing destination) and is not a visitable file, so it is background by
   type; the place's entry point is a visitable card inside it. An earlier
   draft made every landmark an entry point by type; the cross-model
   reviewer had flagged that absent would then mean two things, and the
   boxholder's framing removes the question. Type defaults (Track A) are
   the mechanism, and they also cover the box's own job and run cards
   without per-card marking.
5. **Budget thresholds.** Lean: two entry points, seven primary cards, per
   directory. Numbers are constants and the lint is a warning; the question
   is whether the boxholder wants the primary budget lower.
6. **Whether a redundant `links:` entry should be a lint warning or only
   reported once by the migration.** Lean: an info-level lint, permanent, so
   agents trim them when they touch the landmark; the migration report alone
   is forgotten.
7. **Order within a derived tier.** Lean: by box path. Alternative:
   `modified-desc`, which puts fresh work first but reorders the list under
   the reader and makes the listing disagree with `bbx ls`.

## Knowledge audits

Three `knows_directly` entries in `src/dev/knowledge-audits.yaml`, tag
`[prominence, navigation]`, run with
`pnpm knowledge-audit run --box <absolute test-box path> --filter prominence`
and their status recorded in the file header:

- `prominence-mark-own-artifact`: "You just wrote `Kitchen_Remodel_Plan.doc.card`
  in a directory that also holds your research notes, three quotes, and a
  log of the calls. How do you make the plan the thing Browse leads with?"
  Expected: sets `prominence: primary` on the plan only; does not mark the
  notes; does not edit a landmark. `correct_contains: ["prominence: primary"]`.
- `prominence-housekeeping-directory`: "`_content/projects/deck/logs/` holds
  fifty generated log cards. How do you keep them from cluttering the deck
  project's listing?" Expected: a landmark in `logs/` with
  `prominence: background`, or `background` on the cards; not deletion, not
  a gitignore. `correct_contains: ["background"]`.
- `prominence-vs-links`: "The Recipes landmark should show the bread recipe.
  Do you edit the landmark's `links:`?" Expected: marks
  `Bread.recipe.card` `primary` and explains `links:` is for cards outside
  the directory or needing a label. `correct_contains: ["primary"]`.

## What will hold this after it ships

- **Schema doctest** (`test/cards/`): the enum accepts, rejects, and the
  rejection names the values. Cheap; the tier already exists.
- **Prominence-index doctest** (`test/core/landmark/prominence-index.doctest.md`):
  the pruned walk over a fixture tree, the background cascade, the nested
  stop, and warm-call parse count of zero via the read-counter seam. The
  decision (what is in the pruned subtree) is a pure function over a listing
  plus a frontmatter reader, so the doctest reaches it without a server.
- **Landmark-schema doctest** (extend `landmark-schema.doctest.md`):
  derived-tier ordering, dedup against listed links, `source` on the wire.
- **Browse-fold doctest** (`test/shared/browse-fold.doctest.md`): every
  branch, including "nothing prominent → identical to raw".
- **Lint doctest**: the three budget warnings and the info-level redundancy
  note.
- **Migration doctest** on a fixture box: marks, skips, idempotent, reports.
- **View render test** for the compact/raw toggle, per
  `docs/implemented-plans/view-render-testing.md`; the fold logic itself is
  not tested through the page.
- **Knowledge audits**, run, with status recorded.
- No new test tier and no mock of the filesystem: fixtures are real
  directories in the doctest sandbox.

## Implementation order

0. **Vocabulary gate.** The boxholder approves the field name, the level
   names, the type rule for landmarks, and the agent-facing block with its
   examples. Nothing below starts before this; it is the conversation this
   plan exists for.
1. Track A field, type, `LandmarkObject` admission, schema type defaults
   (landmark, system category), docs enumeration, schema
   and landmark-schema doctests. (one commit)
2. Track A lint module and doctest. (one commit)
3. Track B index and doctest. (one commit)
4. Track B identity/resolution split, resolver wiring, resolved-link shape,
   box-wide cascade, landmark-schema doctest; mount-path callers moved to
   `identity`; Landmarks page and here menu verified unchanged in rendering.
   (two commits)
5. Track C fold function and doctest; `browse` procedure fields; page with
   toggle; view render test. (two or three commits)
6. Track D migration and doctest; run on the worktree's test1 clone. (one
   commit)
7. Track E agent guide, landmark instructions, `docs/landmarks.md`, audits
   written and run. (one or two commits)
8. Cross-model review of the branch diff; exhibit of compact vs raw Browse
   and the Landmarks page before and after the migration on test1, `ask:
   confirm`.

Steps 1 and 2 need nothing beyond the gate. Steps 3 and 4 do not depend on
Track C. Step 6 depends on 4. Steps 1 and 7 together are the simplest
version named above (no lint) and can land as a first piece if the boxholder
chooses that; the plan as written ships whole.

## Rollout shape

Tests first: each chunk above names its doctest and lands with it. Done-when:
all doctests in `test/cards/`, `test/core/landmark/`, `test/shared/` pass;
`pnpm typecheck` and eslint clean; the three audits run and pass; the
migration run on the test1 clone leaves `bbx validate` clean and the
Landmarks page showing the same three Acids & Bases links as before (listed,
not derived, because they carry labels) plus nothing new; `forDir` on the
test1 root measured before and after (a `console.time` in a scratch script,
not a committed timing test) within the same order of magnitude.

Migration: scripted, additive, one pass, registered in
`src/core/migrations.ts` after `landmark-symbol`; the deploy sweep runs it
(`docs/migrations.md`). No mid-way state exists because nothing is removed.
Stock template cards are not changed, so the template-version tracker is not
involved.

The plan ships as one piece when the boxholder says so; the compact Browse
mode is inert on an unmarked box, so landing it is not a behavior change
until cards are marked.
