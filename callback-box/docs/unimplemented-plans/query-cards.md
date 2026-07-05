# Query cards — the "select and arrange cards" vocabulary

**Status: PARKED (2026-07-03), not planned for implementation.** After
design (including the display-param correction and the Obsidian Bases
comparison), the boxholder's verdict: *too complex, too contextless*. The
diagnosis worth keeping: every interface-as-cards success has been
anchored (the nav, a history filter on an existing surface, a session's
husk, a landmark's expand — "the recipes *here*"), while a standalone
query card is a selection with no *here*; the vocabulary's complexity is
a symptom of the missing anchor. Landmark `expand` may already be the
box's query-with-context surface. If a genuinely anchored need for saved
queries appears, restart from this plan. One piece survives
independently: the tile-renderer registry + question tile (chunk 1) —
planned in docs/landmarks.md long before this, useful for any list-shaped
surface, no query vocabulary required.

A saved query over the box's cards, expressed as a card: the `list` named
view, whose params say *which cards* (refs / include / exclude / type) and
*how arranged* (order, group-by, limit) — nothing presentational; each
match renders as its type's tile form (the landmarks contextual rule),
resolved server-side. This is the "query card"
species deferred from `docs/plans/interface-as-cards.md` — the piece that
turns saved searches into addressable, agent-editable cards and lets the
Questions surface become configuration instead of code.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md:100`: *"Read before writing. Don't guess file
  formats, XML structures, or API shapes."* — the vocabulary reuses shapes
  already shipped (landmark `expand`, view-card params) rather than
  inventing parallel ones.
- `callback-box/CLAUDE.md:103`: *"HTTP endpoints go in tRPC by default."*
  — resolution is a tRPC procedure.
- `callback-box/code-style.md` — strict types, no `any`, custom errors,
  max-2 positional params.
- `docs/plans/interface-as-cards.md` (Vocabulary section): *"the
  query/config vocabulary stays deliberately small; its smallness is the
  health metric"* and the layering rule: *"View cards do selection and
  arrangement; card renderers do interaction."* Every vocabulary addition
  below must justify itself against these two.
- Shipped precedents (denser than docs): landmark `expand`
  (`src/schemas/landmark.ts`, `src/core/landmark/resolve.ts`) for
  server-side query resolution; `view: history` params
  (`src/shared/named-views.ts`) for per-view param schemas, URL overrides,
  and provenance; `nav.card` for enumerated-error validation and
  can't-break fallbacks.

## What already exists

- **Server-side glob resolution with ordering and caps** —
  `src/core/landmark/resolve.ts:80` (`resolveLandmark`), glob execution at
  `resolve.ts:196` (`await glob(query, { cwd, nodir: true })`), order
  comparators at `resolve.ts:206-219` (alphabetical / mtime), group child
  cap (`GROUP_CHILD_CAP`, `resolve.ts:34-42`). **Reused**: the glob + order
  + cap mechanics extract into a shared core module; landmark expand keeps
  its template/dedup wrapper on top. Rebuilding this per-surface is how
  the codebase got four card-name regexes.
- **Order enum** — `src/schemas/landmark.ts:33`:
  `z.enum(["alphabetical", "modified-desc", "modified-asc"])`. **Reused**
  verbatim as the query `order` vocabulary.
- **Type-aware name grammar** — `src/shared/card-name.ts`
  (`parseCardFileName`, `cardTypeFromName`): nominal, positional, and job
  forms. **Reused**: the pattern matcher's type segment parses names with
  this grammar, so `*.recipe.card` matches a positional `recipe.card` too.
- **Per-view param schemas + URL overrides + provenance** —
  `src/shared/named-views.ts` (`NamedView.params`, `NamedView.query`,
  `resolveViewParams`); validate hook in `src/schemas/view.ts`
  (`validateViewParams`). **Reused**: the query card IS a named view
  (`list`) with a rich param schema — no new card type (see Direction).
- **The tile/full contextual rule** — docs/landmarks.md: *"There's no
  per-link display attribute. The rule is contextual: anything rendered
  inside a list-shaped surface uses the tile form… If a real case demands
  an override later, the attribute can be added."* **Reused as the
  rendering rule** — an earlier draft of this plan had a `display:
  tiles|full` param and was corrected against this precedent. The
  planned-but-never-built *"Tile-renderer registry (mirrors existing
  renderer registry)"* (docs/landmarks.md, implementation table) is built
  by this plan; landmark links currently hardcode a fallback tile
  (`LinkTile` in `components/landmarks/LandmarkSection.tsx`).
- **Question rendering** — `src/frontend/src/components/QuestionForm.tsx`,
  used by `components/questions/QuestionsList.tsx`. There is **no**
  registered `question` card renderer today (grep: no
  `registerCardRenderer("question"`) — the promotion is net-new and is
  what cashes the layering rule.
- **Honest empty/dropped-state conventions** — nav's enumerated validation
  errors (`src/schemas/nav.ts`), the design doc's "no silent caps" rule.

## Prior art (external)

- **Obsidian Dataview** — a full query language (plus JS API) over
  markdown files. The cautionary tale for this plan: powerful, but a real
  DSL with a documented learning curve (SQL-lookalike that behaves nothing
  like SQL), sluggish on large vaults, and it deliberately cannot search
  note *contents* to stay fast. Confirms the "small vocabulary, code
  escape hatch" split rather than growing a DSL in frontmatter.
  https://github.com/blacksmithgu/obsidian-dataview
- **Obsidian Bases (core) vs Dataview vs Datacore** — Obsidian's newer
  first-party answer is YAML-configured saved views over typed note
  properties, with plugins/code for anything richer — structurally the
  same two-tier split this plan makes (params vocabulary / named-view
  code). https://obsidian.rocks/dataview-vs-datacore-vs-obsidian-bases/
- **tsconfig `files`/`include`/`exclude` and gitignore anchoring** —
  already adopted in the design doc as the named-keys and per-pattern
  anchoring precedents (`docs/plans/interface-as-cards.md`, Vocabulary).
- No prior art search was needed for the glob engine itself — `glob` is
  already the project's matcher (landmark expand).

## Tracks / scope

Single-track plan (one vocabulary, one resolver, one view), with the
question-renderer promotion as an independent first chunk.

**What.** A `list` named view. A query card is an ordinary `view` card:

```yaml
---
title: Open questions
view: list
params:
  type: question            # string or list; comma also works inside patterns
  include:
    - "box/questions/**"    # patterns; relative = this card's directory,
  exclude:                  #   leading / = box root
    - "**/archive/**"
  refs:                     # explicit pins, ordered first, real refs
    - { ref: /store/notes/Read_Me_First.memo.card }
  order: modified-desc      # alphabetical | modified-desc | modified-asc
  group-by: status          # frontmatter field; groups sort by value
  limit: 100                # optional; capped output always says "+N more"
---
```

**Why this needs to change.** Saved searches don't exist; Questions and
Landmarks shipped as hardcoded named views with their query forms
explicitly deferred to this design
(`docs/plans/interface-as-cards.md`, surfaces table). Every "show me
these cards" surface currently costs a code change.

**Direction — the decisions:**

1. **No new card type.** The query card is the `list` named view with a
   rich param schema. Everything shipped for view cards applies unchanged:
   validation with enumerated errors (`validateViewParams`), the renderer
   registry, refs extraction (`extractRefs` walks `ref:` keys anywhere in
   frontmatter, so `refs:` pins are `cb validate`/`cb mv`-tracked), and —
   for free — **URL overrides with provenance**: `Open_Qs.view.card?type=memo`
   is a runtime re-scope of a saved search, with the override marker and
   reset. A dedicated `query` type would duplicate all of that plumbing
   for zero semantic gain (traces to: vocabulary smallness; reuse >
   rebuild).
2. **Selection params.** `refs` (explicit `{ref, label?}` pins, ordered
   first, deduped against matches — the landmark links/expand dedup rule),
   `include`/`exclude` (pattern lists), `type` (string or string list —
   sugar for a type-only query with no path opinion). At least one of
   `refs`/`include`/`type` required.
3. **Pattern grammar** (the lock-in): glob path segments as `cb ls`/
   landmark expand today; **relative patterns resolve from the card's
   directory, leading `/` anchors to box root** (gitignore precedent,
   already settled in the design doc); the **type segment is parsed, not
   string-matched** — `*.recipe.card` matches `Bread.recipe.card` AND
   positional `recipe.card`; **comma alternation in the type segment**
   (`*.memo,note.card`). Exclusions live in the `exclude:` key. A
   `!`-prefixed pattern inside `include` is accepted as gitignore-familiar
   sugar for the same thing — but note the YAML hazard: unquoted `!` is a
   YAML tag indicator, so the schema instructions must show exclusions
   quoted (`- "!drafts/**"`), and the primary spelling in all examples is
   `exclude:`.
4. **Arrangement params.** `order` (the landmark enum, reused), `group-by`
   (a frontmatter field name; buckets sort by value alphabetically; cards
   missing the field bucket last under `(none)`), `limit` (default 100,
   hard server cap 500; capped output always reports the total —
   "no silent caps").
5. **Rendering: the tile form, contextually — no `display` param.** An
   earlier draft had `display: tiles | full`; it contradicted the shipped
   landmarks rule ("no per-link display attribute — anything rendered
   inside a list-shaped surface uses the tile form") and is dropped. Every
   match renders its type's **tile form**: card renderers gain an optional
   `Tile` component in the registry (the tile-renderer registry the
   landmarks doc planned and never built); types without one fall back to
   the generic title+path link tile. A tile is *"a bounded form fitting in
   a list cell"* — nothing says static, so the pending question's tile IS
   its answer form: interactivity lives in the type's tile, which is the
   layering rule working rather than a presentation dial. A `view` card's
   tile is a link tile, so lists structurally never nest. Per the
   landmarks doc's own escape hatch, a display override can be added later
   *if a real case demands it* — none does yet.
6. **Self-exclusion default.** Matches of type `view` are excluded from
   results unless the query names `type: view` explicitly — a dashboard
   query card shouldn't list itself and its siblings by accident (the
   design doc's reflexivity note, resolved).
7. **Resolution is server-side** in a new tRPC procedure
   (`views.resolveList` or similar), mirroring "the expand evaluator runs
   server-side at fetch time" (docs/landmarks.md). Core logic in
   `src/core/query-list/` sharing extracted glob/order/cap helpers with
   landmark expand. The wire response is fully resolved rows (path, type,
   title, group key) + total counts; types with a registered `Tile` then
   fetch their card data per item (the FileView embed pattern,
   `src/frontend/src/components/FileView.tsx:333`), so a heavy tile costs
   only where a type opted in.
8. **Question tile promotion.** The `question` type registers a `Tile`
   wrapping `QuestionForm` (pending) / muted summary (answered). The
   `questions` named view then becomes replaceable by a query card
   (`view: list, params: {type: question, group-by: status}`); the named
   view stays registered as an alias during this plan (removal is NOT in
   scope).

**Vocabulary lock-ins.** Param keys `refs, include, exclude, type, order,
group-by, limit` — selection and arrangement only, nothing presentational;
order enum values reused from landmarks; pattern anchoring semantics;
comma-in-type alternation; quoted-`!` sugar. These names appear in schema
instructions, audits, and box cards — renaming later is a migration.

**First implementation chunk** (no open questions inside it): the tile
registry slot (optional `Tile` component per registered card renderer,
generic link-tile fallback) + the question tile
(`QuestionForm`-wrapping, pending/answered split), with `QuestionsList`
refactored to render through it; doctest for the split. Independent of
the vocabulary and immediately useful (questions render as themselves in
any list-shaped surface).

## Subplans

None. The vocabulary, resolver, and view are one coherent design; the
only candidate (freshness/`within:` filters) is deferred outright rather
than sub-planned.

## Failure modes

**Critical gap:** none unresolved — each row below has planned handling.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Pattern matches zero cards | planned (resolver doctest) | render "0 matches" with the resolved query echoed | clear (established empty-state rule) |
| Pattern is syntactically dud (e.g. empty alternation, bare `!`) | planned (schema doctest) | `validateViewParams` rejects with the pattern quoted | clear at `cb validate` time |
| Unquoted `!pattern` becomes a YAML tag | planned (schema doctest: tagged node → validation error, message names the quoting fix) | frontmatter YAML parse surfaces it; message must say *quote exclusions* | clear |
| `group-by` field absent on some/all matches | planned (resolver doctest) | `(none)` bucket, sorted last | clear |
| Match count exceeds `limit`/server cap | planned (resolver doctest) | rows + exact total; UI shows "+N more" | clear ("no silent caps") |
| Many heavy tiles (a type whose tile fetches its card, e.g. question) | planned (renderer note; limit doctest) | per-item fetch only for types with a registered Tile; `limit` bounds the list | clear |
| Query card matches itself / other view cards | planned (resolver doctest) | type `view` excluded by default | clear (documented in schema instructions) |
| Nested list-in-list recursion | structural (no test needed) | tiles never expand a view card's list — a view card's tile is a link tile | clear |
| A pinned `refs` target is missing | planned (resolver doctest) | row renders with `exists: false` (nav precedent); reported like nav problems | clear |
| Per-item card fetch fails mid-list (a Tile's data load) | existing FileView error handling per item | one broken tile doesn't blank the list | clear |

## Agent-flow / user-flow edge cases

- **Wrong key / wrong value** — ADDRESSED: strict per-view param schema;
  unknown keys and bad enum values fail `cb validate` with the valid set
  enumerated (shipped precedent: `view must be one of: …`,
  `params: Unrecognized key: …`).
- **Stale ref** — ADDRESSED: `refs` pins are real refs (`extractRefs`),
  rewritten by `cb mv`; dangling pins render marked-missing and surface as
  problems (nav precedent).
- **Two agents touching the same card** — ADDRESSED by shape: a query
  card is a single small YAML file; last-write-wins through git like any
  card. No new concurrent-write surface beyond what cards already have.
- **Hand-edit drift** — ADDRESSED for the known sharp edge (unquoted `!`
  → YAML tag; validation message names the fix; instructions lead with
  `exclude:`); other drift is ordinary schema validation.
- **Fabricated free-form value** — ADDRESSED by construction: every param
  is checkable against reality (patterns either match or don't; `group-by`
  either exists on cards or buckets to `(none)`); there is no prose field
  to fabricate.
- **Validation error UX** — ADDRESSED: all errors follow the
  enumerate-valid-values rule already used by nav/view schemas.
- **Partial migration / transition state** — ADDRESSED: nothing existing
  changes shape. The `questions` named view coexists with query cards;
  landmark `expand` is untouched (shares extracted helpers internally,
  same behavior). No box data migrates.

## NOT in scope

- **Freshness/time-window filters** (`within: 7d`) — deferred until a
  surface needs it in card form; the Chats picker keeps its custom view
  (its landmark-proximity grouping is beyond declarative anyway).
- **Retiring the `questions`/`landmarks` named views** — the aliases stay
  registered; removal is a follow-up once real boxes have converted.
  Removing them now would break existing `view:` cards silently.
- **Field-value predicates** (`where status = pending`) — the Dataview
  cliff. `group-by` + per-type renderers cover the shipped surfaces; a
  predicate language is exactly the DSL this design exists to avoid.
  Revisit only with a concrete surface that can't live without it.
- **Content/full-text queries** — that's `searchBox` (Orama) territory,
  a different subject (search results, not a card set); even Dataview
  refuses this for speed.
- **Landmark `expand` migration onto the new resolver's schema** — expand
  keeps its shape (`template-ref` etc.); only the internal glob/order/cap
  helpers are shared.
- **`group:` static labels (landmark-style) on query cards** — `group-by`
  covers the shipped need; two grouping spellings in one schema invites
  confusion.
- **A `display` override param** — an earlier draft had one; dropped
  against the landmarks precedent ("no per-link display attribute…
  if a real case demands an override later, the attribute can be
  added"). Rendering is contextual: tile forms in lists, full standalone.

## Open design questions

- **Procedure naming/placement** — `views.resolveList` on the existing
  views router vs a new `queryList` router. Lean: hang it on `views`
  (it serves the view renderer; no new router surface). Inside chunk 3,
  decided before that chunk starts.
- **Does `type:` accept the job convention names** (`intake-job`)?
  Lean: yes — `type` values validate against registered schema types at
  resolve time (warning, not error, since box-local schemas load
  per-box). Small enough to settle in chunk 2's doctests.

## Knowledge audits

Yes — this is new agent-facing vocabulary. Landing with the plan, in
`src/dev/knowledge-audits.yaml`:

- `knows_directly`: "How do you make a card that lists all pending
  question cards, grouped by status?" (expects `view: list` + `type:
  question` + `group-by: status`).
- `knows_directly`: "In a query card, how do you exclude a subtree, and
  what's the YAML gotcha with `!` patterns?" (expects `exclude:` primary,
  quoting for `!`).

Both run (`pnpm knowledge-audit run --box <absolute-path-to-test-box>
--filter <tag>`) with status recorded before the plan completes.

## Implementation order

1. **Tile registry slot + question tile** — optional `Tile` per
   registered card renderer with the generic link-tile fallback; the
   question tile wraps `QuestionForm`; `QuestionsList` renders through
   it; doctest. (Independent; commit 1.)
2. **Core resolver** — extract glob/order/cap helpers from landmark
   resolve into a shared module (landmark behavior unchanged, its
   doctests stay green); `src/core/query-list/resolve.ts` implementing
   selection (refs/include/exclude/type, anchoring, type-parsed matching,
   comma alternation, view-type self-exclusion), arrangement (order,
   group-by, limit+total), with doctests per failure-mode row. The
   pattern grammar lives beside `card-name.ts` in shared so validation
   (schema) and resolution (core) parse identically.
3. **tRPC procedure** — resolve a given view card's params (or inline
   params) to rows + totals; input validated with the same zod schema.
4. **`list` named view** — params schema + query codec registered in
   `named-views.ts` (URL overrides work day one); frontend `ListView`
   component: tiles + full modes, group sections, "+N more", empty state
   echoing the query; registered in `VIEW_COMPONENTS`.
5. **Schema instructions + docs** — view schema instructions gain the
   `list` documentation (exclusion quoting front and center);
   `docs/plans/interface-as-cards.md` surfaces-table updates.
6. **Knowledge audits** — written and run against the test box.
7. **Demo/verify** — an `Open_Questions.view.card` (interactive question
   tiles) and a saved-search card in the worktree box; live verification
   incl. a URL-override re-scope.

## Rollout shape

- **Test posture**: doctests named per chunk above — the resolver
  doctest is the design tool for chunk 2 (selection semantics, anchoring,
  caps, group-by buckets, self-exclusion each get an example);
  schema-validation doctests extend `test/schemas/view-card.doctest.md`;
  the question-renderer doctest covers pending/answered. Done-when: all
  new doctests green, landmark doctests untouched and green, full suite
  green.
- **Knowledge audits**: the two entries above land run, not just written.
- **Migration**: none — additive vocabulary on an existing card type; no
  box data changes shape. The plan ships as one unit; chunks are commit
  boundaries only.
