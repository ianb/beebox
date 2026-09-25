---
title: "Search cards and quick search"
status: draft
workstream: search-card
issues:
  - ../../../issues/features/2026-08-08-no-visible-search-or-home.md
---
# Search cards and quick search

When a boxholder returns to a box, they need an obvious way to find a card
without relying on an old chat link. A canonical Search card provides that
surface. Copied Search cards provide durable, scoped search instruments for
landmarks and projects. Cmd-K provides a transient global quick-search and
go-to command without opening a card.

**Issues addressed:** `2026-08-08-no-visible-search-or-home.md`, search half
only. The issue explicitly says that the home-surface decision remains open
(`issues/features/2026-08-08-no-visible-search-or-home.md:53-60`).

## Smallest fix and budget

The smallest useful fix is a canonical Search schema, card installation, one
tRPC read procedure, and a Search renderer that calls the existing
`searchBox()` engine. That would make search reachable, but would not support
landmark-specific Search cards or Cmd-K.

This plan chooses five dependent tracks:

1. Extend the engine from one path prefix to bounded default prefix filters and
   extract the shared request/result contract.
2. Add the Search card schema, canonical path, separate migration cohort, and
   distinct authored/canonical templates.
3. Add the authenticated browser read path through tRPC.
4. Build the Search card renderer and shared result-list/navigation components.
5. Build the transient Cmd-K overlay on the application shell.

Estimated implementation size is 550–750 changed source and test lines, plus
roughly 120–180 lines of authored schema guidance and doctest documentation.
This is not a BIG CHANGE. The fuller design buys reusable scoped Search cards
and a quick command surface without creating a second search engine or a
second card type.

## Stated preferences this plan trades against

The plan keeps canonical identity separate from live state. Browse's schema
has only `body`, and says that “Live UI state is not card content”
(`beebox/src/schemas/browse.ts:5-20`). Search follows that rule while adding
durable configuration for copied cards.

The plan preserves singleton identity for the seeded canonical card by path.
The `search` type itself remains copyable, like `todo-view`; only the
canonical path is restore-only. The issue says
that Search joins the canonical interface cards at
`_config/interface/search.card` and that Browse is the model
(`issues/features/2026-08-08-no-visible-search-or-home.md:28-45`). Existing
system-card validation must therefore distinguish canonical seeded paths from
singleton-only types before copied `search.card` files can validate.

The plan reuses the existing search engine and workspace navigation. It does
not add a `/search` route, because the issue explicitly prohibits one
(`issues/features/2026-08-08-no-visible-search-or-home.md:47-51`).

## What already exists

- `beebox/src/core/search/query.ts:22-44` fixes the searchable fields and the
  calibrated `contains`/`title` boost. Reuse these product defaults; do not
  expose Orama's low-level BM25, threshold, similarity, or hybrid-weight
  parameters in card frontmatter.
- `beebox/src/core/search/query.ts:58-115` already defines the structured hit
  and result envelope, plus `kinds`, one `pathPrefix`, `limit`, and automatic
  text/hybrid ranking. Extend this contract rather than creating frontend
  result types by hand.
- `beebox/src/core/search/query.ts:118-221` validates kinds before refreshing,
  opens the lazy index, applies Orama kind filtering, applies the current path
  filter, and returns warnings/staleness. Preserve these ordering and
  fail-visible properties.
- `beebox/src/core/search/refresh.ts:1-13` documents that query-time refresh
  is correct for uncommitted filesystem changes and that the index is a cache.
  The tRPC procedure may use this existing refresh behavior; it must not write
  card content.
- `beebox/src/shared/system-card-paths.ts:4-23` owns canonical paths and
  migration cohorts. Add `search` there, but split the protected
  singleton-only type set from the canonical path/cohort set so copies remain
  valid.
- `beebox/src/schemas/system-card-templates.ts:5-27` currently registers
  canonical templates from the cohort and says additional instances are
  invalid. Search needs a separate canonical seed template and an ordinary
  authored Search template.
- `beebox/src/core/system-cards.ts:10-132` validates, repairs, and seeds
  cohort cards. It must validate the canonical Search path while ignoring
  noncanonical `search.card` copies, and must route Search through a new
  migration cohort for already-enrolled boxes.
- `beebox/src/core/card-lint.ts:126-128` also applies canonical system-card
  location checks during card validation. The Search/type split must cover this
  path as well as staged validation and pre-commit checks.
- `beebox/src/webapp/trpc/router.ts:1-77` is the central tRPC registration
  point. `beebox/docs/adding-api-endpoints.md` specifies tRPC for normal read
  endpoints and `useQuery()` on the frontend.
- `beebox/src/frontend/src/renderers/browse.tsx:36-127` is the renderer model:
  it reads live state, calls tRPC, opens targets through the workspace, and
  updates state with push/replace semantics.
- `beebox/src/frontend/src/components/chat/workspace/WorkspaceProvider.tsx:171-189`
  owns `workspace.open()` and `updateTarget()`. Search results should use
  these callbacks instead of inventing navigation.
- `beebox/src/frontend/src/hooks/useRecentFiles.ts:103-145` provides a
  chat-entry-derived recent-file list, but it is not available at the global
  shell boundary. Cmd-K should not depend on chat transcript context in v1.
- `beebox/src/frontend/src/file-type-registry.ts:38-58` passes `params`,
  `viewState`, `onNavigate`, and `onViewStateChange` to renderers. The Search
  card can use the same interface as Browse.
- `beebox/src/schemas/todo-view.ts:2-13,20-27,30-68` is the closest authored
  precedent: frontmatter is a live query configuration, copied instances are
  valid, and the renderer supplies card-path context separately.
- `beebox/src/frontend/src/components/system-cards/SystemCardBoundary.tsx:10-18`
  checks canonical identity. Search must wrap only the canonical instance;
  copied Search cards must render normally.
- `beebox/src/frontend/src/lib/view-url.ts:43-84` currently parses a path and
  query but does not preserve a `#fragment` in `ViewTarget`. Search results
  carry section fragments in `SearchHit`; v1 will display the section locator
  and open at card granularity rather than adding half of a fragment-scroll
  system.

## Prior art (external)

No external prior art is required for the product decisions. The installed
Orama typings are the authoritative dependency surface for this plan. They
expose `limit`, `offset`, `exact`, `tolerance`, `threshold`, `sortBy`,
`facets`, `distinctOn`, `groupBy`, `where`, and `hybridWeights`, but the
current wrapper deliberately fixes the ranking fields and hybrid calibration
(`beebox/src/core/search/query.ts:22-44`). The plan uses only the stable
product-level subset: type filtering, bounded default path filters, and limit.

## Tracks / scope

### Track 1 — Shared search configuration and default filters

**What.** Define a shared search request/result contract used by the Search
card and Cmd-K. Extend `SearchBoxOptions` from `pathPrefix?: string` to a
bounded list of default `pathPrefixes?: string[]`, while retaining a
CLI-compatible single-prefix adapter.

**Why this needs to change.** Copied Search cards need durable default filters
  for one or more landmark or project paths. Orama's `where` supports equality
  and enum membership, but a string path prefix is not a native filter. The
  current implementation fetches up to `PATH_FILTER_FETCH` and filters one
  prefix after search (`beebox/src/core/search/query.ts:39-41,164-193`). A
  bounded prefix matcher is needed to represent the card's defaults without
  silently dropping all but the first configured path.

**Direction.** Add a pure normalizer that accepts optional default prefixes and
an optional request prefix, rejects unsafe/out-of-box values through the shared
ref/path helpers, and removes duplicates. Request filters may replace or narrow
the card's defaults; they are not a security boundary. Apply all resulting
prefixes to ranked hits before slicing, and return an explicit truncation
warning when the bounded fetch cannot prove the requested page complete.

Keep section-level results as the engine contract. Keep automatic semantic
ranking for the existing CLI. Interactive browser queries use `mode: "text"`
in v1 so typing never triggers a full pending-embedding pass or a paid query
embedding. Do not expose `exact`,
`tolerance`, `threshold`, `sortBy`, `hybridWeights`, or `similarity` as durable
card options.

**Vocabulary lock-ins.** `pathPrefixes`, `kinds`, `limit`, `query`, and `mode`
are the shared names. Card frontmatter uses `paths`, `types`, `query`, and
`limit`; the schema adapter maps them to the engine names.
`paths` means default prefixes, not exact paths or access control.

**First implementation chunk.** Add the pure default-filter normalizer, extend
the core query options with `lockRetries`/`lockRetryMs`, and add search
doctests for multiple prefixes, request override/narrowing, empty defaults,
bounded filtering, and duplicate paths. No UI or schema fields are needed in
this chunk.

### Track 2 — Search schema and installation

**What.** Add `SearchSchema`, canonical path registration, a separate Search
migration cohort, distinct canonical/authored templates, schema registry
registration, and schema doctests.

**Why this needs to change.** Existing boxes need the canonical card and fresh
boxes need it at init. The issue names both requirements
(`issues/features/2026-08-08-no-visible-search-or-home.md:39-45`).

**Direction.** The schema fields are optional defaults:

```yaml
paths: [_content/recipes]
types: [recipe]
query: chicken
limit: 20
```

`paths` is a list of box-relative default prefixes. `types` is validated
against the searchable type set when the query runs, so schemas do not need a
static copy of dynamically loaded box types. The user may change or clear
these defaults in the live Search view. `query` is an initial query, not a
restriction. `limit` is a bounded default. The card does not expose ranking
mode in v1; interactive browser search uses text ranking for responsiveness.

The schema sets `searchable: false`, like Browse, so Search cards do not appear
in their own index. The canonical seed contains only `title: Search`. The
ordinary authored Search
template can generate optional defaults. The canonical renderer uses
`SystemCardBoundary`; copied Search cards do not. Instructions must say that
the canonical path is seeded and restore-only, copied cards are allowed,
frontmatter is durable default configuration, and live query state is not card
content.

Because current system-card validation treats every type in
`SYSTEM_CARD_PATHS` as singleton-only, split the protected singleton type set
from the canonical seeded path set. `search` remains a canonical path/cohort
member and is validated at that exact path, but noncanonical `search.card`
copies are not rejected by `systemCardLocationError`, staged validation, or
pre-commit checks. Do not weaken singleton protection for dashboard, settings,
Browse, or the other existing system cards.

Use a new migration name, such as `search-interface-card`, for existing boxes.
Do not append Search to `remaining-interface-cards`: migrations are enrolled
and run by name, so already-enrolled boxes would otherwise report the new card
missing without a new migration execution. Fresh init must seed and assert the
new Search cohort in addition to the existing cohorts.

**Vocabulary lock-ins.** The card type is `search`; canonical path is
`_config/interface/search.card`; canonical migration is
`search-interface-card`. `paths` and `types` are defaults, not permission
ceilings. No `/search` compatibility route is added.

**First implementation chunk.** Add the schema, registry entry, separate
canonical path/cohort and migration entry, authored template, canonical seed
template, system-card validation split, fresh-init wiring, and doctests proving
canonical seeding plus a copied defaulted Search card validates. No renderer is
needed in this chunk.

### Track 3 — Browser search API

**What.** Add `search.query` as a tRPC query and register it in `appRouter`.

**Why this needs to change.** The issue says the engine is currently reached
through CLI and wakeup, not tRPC (`issues/features/2026-08-08-no-visible-search-or-home.md:14-26`).
The browser needs a server-side read path with box-root and credential access.

**Direction.** The procedure accepts a bounded request containing `query`,
optional `kinds`, optional `pathPrefix`, optional `limit`, and optional `mode`.
It also accepts optional card defaults when the Search renderer calls it;
request values may override/narrow those defaults because they are view
configuration, not access control. Cmd-K sends no card defaults. Use
`publicProcedure` consistently with the existing read routers, preserve
structured warnings, and map invalid kinds/path configuration to a clear
`BAD_REQUEST`. Do not expose absolute paths, embedding credentials, raw Orama
documents, or vectors.

Expose `lockRetries` and `lockRetryMs` through the core query options so the
browser can use a short lock-retry policy rather than making a typing
interaction wait through the full refresh retry budget. The client debounces
and deduplicates in-flight queries. Browser callers pass `mode: "text"` in v1;
the CLI retains the existing automatic semantic ranking and embedding path.

**Vocabulary lock-ins.** The procedure is `search.query`. Its output is the
existing `SearchBoxResult` shape. Frontend types derive from `RouterOutput`.

**First implementation chunk.** Add the router and focused doctests for valid
queries, type rejection, default-filter override, stale/index warnings, short
lock contention, and credential-free text fallback. Verify browser text mode
cannot trigger the embedding pass. Register it without changing any page.

### Track 4 — Search card renderer and shared result UI

**What.** Build a Search renderer, a pure card-config adapter, and a shared
result list used by both the card and Cmd-K.

**Why this needs to change.** A tRPC endpoint alone does not create a surface.
Browse demonstrates that the renderer owns live view state and workspace
navigation (`beebox/src/frontend/src/renderers/browse.tsx:36-127`).

**Direction.** Resolve card frontmatter into `SearchConfig`, overlay
`viewState` query text and filter overrides, and call `search.query` with
`mode: "text"` and a debounce. Use replace-state for typing/query changes so the singleton card
does not create a browser-history entry per keystroke. Show empty, loading,
error, stale, warning, no-result, and truncated states visibly.

Results show title, kind, path, excerpt, and section locator. Clicking a result
opens the card/file at card granularity through `onNavigate`/`workspace.open`
with the existing target shape. The section locator remains visible text in
v1; do not add half of a fragment-scroll system when the frontend has no
heading-id/scroll consumer.

Use `SystemCardBoundary` only when `props.data.path` equals the canonical
Search path. A copied Search card is a regular searchable view and can be
placed in a landmark or linked like any other card.

**Vocabulary lock-ins.** Shared components are `SearchResultsList` and
`SearchConfig`; live query state uses `viewState.query`. The canonical card
label is `Search`; copied labels come from their card title.

**First implementation chunk.** Add the config adapter, renderer, result list,
navigation, and card doctest/browser harness coverage for canonical and copied
cards. Include a landmark-style card with default filters, user override of
those defaults, query persistence through replace-state, and a result that
opens the correct file while displaying its section locator.

### Track 5 — Cmd-K quick search/go-to overlay

**What.** Add a global, transient command overlay that consumes the shared
search query and result list but is not a card and does not add a route.

**Why this needs to change.** The Search card solves discoverable persistent
search, while the boxholder also wants a fast command-style entry point. Making
Cmd-K navigate to the Search card would conflate transient command state with
workspace state.

**Direction.** Mount the overlay in the application shell. On macOS register
Meta-K; on other platforms register Ctrl-K. Do not turn macOS Ctrl-K in an
active text editor/composer into a global shortcut because it is an editing
command there. On open, focus the input; Escape closes; arrows move the active
result; Enter opens it through `workspace.open`.

Debounce text-ranked indexed search. For empty input show the command hint and no full
index result list. For path-like input, use the existing bounded file-kind
lookup to offer an exact go-to when the path exists; otherwise use
`search.query` globally. Do not depend on chat transcript entries for a
shell-mounted overlay. The overlay has local transient state only and does
not modify card frontmatter, Search-card `viewState`, or the URL.

If launched from a scoped Search card, global Cmd-K remains box-wide in v1;
scope inheritance would require a visible mode indicator and is deferred.

**Vocabulary lock-ins.** The UI name is `QuickSearchOverlay`. It is not a card,
route, schema type, or compatibility shim. It uses the same `SearchConfig`,
`SearchResultsList`, tRPC procedure, and result locator as the card.

**First implementation chunk.** Add the overlay, shortcut lifecycle, keyboard
navigation, close behavior, global search, exact path go-to, and browser
coverage. Verify that opening a result preserves the existing workspace
semantics and that the overlay unmounts without leaving URL state behind.

## Could this be simpler?

The simpler version would add only an unrestricted Search card and a tRPC
procedure, with card-level results opening at file granularity. It would solve
the filed field-test failure with fewer changes.

The fuller version earns its cost because the boxholder explicitly wants copied
Search cards with durable path/type defaults and a Cmd-K interface. Keeping a
shared contract prevents those two surfaces from drifting into separate search
semantics. Keeping transient Cmd-K state outside cards preserves the existing
stateful navigation model and avoids creating duplicate canonical surfaces.

## Subplans

None. Fragment display, default-filter semantics, and the migration split are
settled in the track directions; they do not need separate research phases.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A copied card's default filter is accidentally discarded or misapplied | New core/API doctest | Normalize defaults and request overrides in one adapter | Clear |
| Multiple path prefixes exceed the ranked fetch budget | New core doctest | Continue bounded fetches or return an explicit incomplete/truncated warning | Clear |
| A copied card names an unknown type | Existing `UnknownKindError` tests plus API test | Validate before refresh and return `BAD_REQUEST` | Clear |
| Index lock contention serves old results | Existing search-index tests | Preserve `stale` and display the warning | Clear |
| Embeddings are unavailable during browser search | Existing hybrid tests plus API test | Automatic text fallback with structured warning | Clear |
| Interactive browser query triggers a full pending-embedding pass | New API/frontend test | Browser mode is explicitly text-ranked; CLI keeps automatic semantic mode | Clear |
| Search result section locator is not supported by navigation | New renderer test | Display the locator and open at card granularity in v1 | Clear |
| A moved or deleted result is clicked | Existing moved-card recovery path plus browser test | Use normal navigation/recovery; show the existing missing state | Clear |
| Cmd-K shortcut remains installed after overlay unmount | New frontend harness test | Effect cleanup removes the listener | Clear |
| Cmd-K steals Ctrl-K from a macOS text editor/composer | New frontend keyboard test | Use Meta-K on macOS and ignore Ctrl-K while editing | Clear |
| Canonical Search card is copied and incorrectly rejected | Schema/validation test | Validate only the canonical path; keep search type copyable | Clear |
| Existing box is already enrolled in older interface cohorts | Migration doctest | Run a new Search-specific migration; do not mutate old cohort semantics | Clear |
| Search schema is categorized as background system machinery | Schema/landmark test | Set `searchable: false` and keep the copyable Search type authored-facing; canonical seeding is path-based | Clear |
| Browser search waits through a full index lock retry budget | API/frontend test | Use short browser retry settings and client debounce/deduplication | Clear |
| Empty Cmd-K input triggers a full-index query | Keyboard/browser test | Show hint only until text or an exact path is entered | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** The schema locks `paths` to
  default prefixes, `types` to searchable kinds, and keeps `query` distinct
  from defaults. Schema instructions include examples and reject unknown
  fields.
- **Stale ref — ADDRESSED.** Results navigate through the existing workspace
  target path and moved-card recovery; the section locator is display context
  in v1, with a dedicated card-granularity navigation test.
- **Two agents touching the same card — ADDRESSED.** Search is read-only; the
  index remains the disposable query-time cache described by
  `beebox/src/core/search/refresh.ts:1-17`.
- **Hand-edit drift — ADDRESSED.** Zod validates fields, path normalization
  fails closed, and malformed defaults produce visible card/API errors.
- **Fabricated free-form value — ADDRESSED.** Types are checked against the
  searchable registry; paths use shared path resolution rather than manual
  filesystem joins.
- **Validation error UX — ADDRESSED.** Card load errors use normal card
  validation; query errors use bounded tRPC messages without absolute paths.
- **Partial migration / transition state — ADDRESSED.** A new Search-specific
  migration is missing-only, so old boxes gain Search without overwriting an
  existing card; fresh init seeds the same canonical path directly.

## NOT in scope

- Home-surface selection or redesign. The issue leaves dashboard, inventory,
  landmarks, and Browse unresolved (`issues/features/2026-08-08-no-visible-search-or-home.md:53-60`).
- A `/search` route or legacy redirect. Search starts at its canonical card
  path; Cmd-K is an overlay.
- Search engine re-ranking research. Existing boost, similarity, and hybrid
  behavior remains the product default.
- Editing cards from search results, bulk actions, saved-result annotations,
  or mutations of the index source data.
- Cross-box search, Gmail search, external web search, or untracked content.
- A full command palette for settings/actions. Cmd-K v1 is quick search/go-to.
- Automatic inheritance of a scoped Search card's defaults into global Cmd-K.
- Native iOS Cmd-K support. The first surface is the existing web application.

## Open design questions

There are no open questions inside the first implementation chunks. The
following are settled directions rather than deferred choices:

- Search section locators are displayed but do not deep-scroll in v1.
- `paths` is a bounded list of prefixes rather than a glob language.
- Empty Cmd-K input shows a hint, not the entire index.
- Search-card defaults are user-facing filters, not access-control ceilings.

## Knowledge audits

This introduces agent-facing `search.card` configuration and the distinction
between canonical Search and copied scoped Search cards. Add `knows_directly`
audits to `beebox/src/dev/knowledge-audits.yaml` covering:

1. where the canonical Search card lives and why a copied Search card is valid;
2. how to create a scoped Search card using `paths` and `types`;
3. why `query` is a default and not a scope restriction;
4. why Cmd-K is a transient UI command and not a card reference.

Run the audits against the worktree test box with the knowledge-audit skill and
record their status before the plan completes.

## What will hold this after it ships

Use focused doctests for the pure default-filter helper, Search schema,
canonical migration/template behavior, and tRPC procedure. These tests are
cheap and reach the risky decisions without a browser.

Use a frontend harness/doctest for renderer state, warnings, keyboard behavior,
result selection, and canonical-versus-copied boundary behavior. Add one
browser smoke walkthrough for direct canonical Search entry, a copied scoped
Search card, and Cmd-K opening a result. The walkthrough is UI evidence, not a
replacement for reducer/API tests.

Run `pnpm test:changed`, the named search/schema/API/frontend doctests,
`pnpm typecheck`, and `pnpm lint:changed`. Run the knowledge audits separately.
Verify browser queries use text mode and do not claim interactive embedding
behavior or physical-device behavior from browser tests.

## Implementation order

1. Track 1: pure default-filter helpers and core query extension.
2. Track 2: schema, canonical path/cohort, templates, registry, and migration
   tests.
3. Track 3: `search.query` tRPC router and API tests.
4. Track 4: Search renderer, result list, locator navigation, and browser
   card coverage.
5. Track 5: Cmd-K overlay and keyboard/navigation coverage.
6. Knowledge audits, focused/full changed checks, and final browser evidence.

The plan ships only after every track and its verification are complete and the
boxholder asks to finish/land it.

## Rollout shape

The card schema and migration are additive. Existing boxes receive the missing
canonical Search card through the declared system-card cohort. Fresh boxes
receive it through the same template stock. No existing authored cards are
rewritten.

The implementation is done when the core default-filter doctests, schema and
migration doctests, tRPC tests, frontend harness tests, Cmd-K keyboard tests,
typecheck, changed lint, changed tests, knowledge audits, and the three browser
walkthrough cases pass. Browser evidence must separately show canonical Search,
one copied scoped Search card, and Cmd-K. Deployment, push, and physical-device
verification remain separate claims.
