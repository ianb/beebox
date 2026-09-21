---
title: "Todo collection — todos as a staged query, with summaries that belong to the card type"
status: active
workstream: collection-views
issues: []
---
# Todo collection — todos as a staged query, with summaries that belong to the card type

When I open a project directory, or the plate, I want to see what is going on
there: the open todos under the cards and sections they were written in, the
few that have real dates, and the todos elsewhere that point at this place.
When the agent asks the same question, it gets the same answer as text. This
plan rebuilds the todo system as the first *collection*: a staged query over
cards whose result several consumers render. It builds the general shape and
commits to one instance.

Background, decisions, and what a working box showed are in the
[design notes](collections-design-notes.md). This plan does not repeat them.

**Issues addressed:** none closed. This plan advances
[collection views](../../../issues/features/2026-08-19-collection-views-are-badly-defined.md)
(the todo instance only, so the issue stays open) and the list half of
[todos as inline things to think about](../../../issues/features/2026-08-30-todos-inline-things-to-think-about.md)
(its card-edge summary and companion panel are not here). It changes the
rendering that
[verify todo annotation rendering](../../../issues/features/2026-07-29-verify-todo-annotation-rendering.md)
gates; that issue's manual-testing text must be rewritten when this ships.
Related and untouched:
[near-duplicate todos](../../../issues/features/2026-09-20-near-duplicate-todos-accumulate-across-cards.md),
[directories as viewable things](../../../issues/features/2026-07-28-directories-as-viewable-things.md).
Searched the queue for "todo", "plate", "summary loader", "file summary": no
other open item covers this work.

## Smallest fix and budget

**Smallest fix.** Add `sectionPath` and `parent` to `CollectedTodo`, and group
`TodoViewCard` by card, section, and parent.
About 250 source lines and 150 test lines. It fixes the list for a box whose
todos are undated. It leaves the agent command todo-specific, leaves the clock
inside extraction, gives no reference scope, and leaves box-local card types
with a filename for a header.

**Chosen design.** Five tracks.

| Track | Source | Test |
|---|---|---|
| 1. `summarize` on the card type | 300 | 250 |
| 2. Pure extract with position and references | 400 | 350 |
| 3. Collection pipeline and the todo definition | 450 | 400 |
| 4. Consumers: list, `bbx query`, sweep, ambient line | 900 | 650 |
| 5. Agent guide, schema instructions, audits | 100 | — |

About 4,000 changed source and test lines, counting deletions
(`loader-registrations.ts`, most of `cli/commands/todos.ts`, most of
`TodoViewCard.tsx`, their doctests). Authored docs add about 250 lines. The
first estimate was 3,150; cross-model review judged it low against the number
of surfaces that name `bbx todos` and the four doctest suites that move, and
the table was raised.

> **BIG CHANGE.** The size comes from four consumers moving to one result
> shape, and from their doctests moving with them. The boxholder asked
> (2026-09-20) for the todo scope to keep the general shape: polymorphic
> rendering with fallbacks, explicit rendering, and a powerful query type.
> **Approved by the boxholder, 2026-09-20 ("go ahead"), at about 4,000 lines.**
> Boxholder decisions the same day: "the size is okay"; "I want each
> component to live alongside the rest of the schema. If that requires
> changing the depth that is okay"; "leave bbx todos but plan to delete it
> later".

What the fuller design buys over the smallest fix: one query that the web list,
the agent, and the scheduled sweep all read; extraction that a cache can sit
behind later; a scope that follows references; and summaries that a box-local
type can define.

## Stated preferences this plan trades against

- **Boxholder decisions, 2026-09-19 and 2026-09-20** (recorded in the design
  notes): the row is the card, `[{card, items}]`; a reduction is general and a
  count is one case; the search defines the display more often than the type;
  a group needs a meaning; a summary belongs to the type, "as something a type
  can extend/override"; no attribute for kinds of todo; the nav badge,
  `![]()` embedding, and indexing are later, and "the shape of the queries and
  server/client separation should allow that later optimization".
- **The parked query-cards verdict** —
  `docs/unimplemented-plans/query-cards.md:9-13`: *"too complex, too
  contextless"* … *"a standalone query card is a selection with no *here*"*.
  This plan adds no stored query vocabulary. Every query has a `here`.
- **`beebox/CLAUDE.md`**: *"`bbx` is the box agent's surface, not yours"* and
  *"End users get neither; they live in the web UI and chat."* The list is the
  user surface. `bbx query` is agent plumbing.
- **`beebox/code-style.md`**: no `as`; exhaustive dispatch with `assertNever`;
  *"Never resilient to the impossible"*; files max 300 lines; no barrels; max
  two positional parameters.
- **Minimize invented concepts** (boxholder standing preference). The card
  header reuses `FileSummary` and `FileEntry`. The `todo-view` card gains no
  fields.
- **Shipped precedent:** the todo-annotation plan
  (`docs/implemented-plans/todo-annotation.md`), goals 2 to 4: a trusted
  open-loop system, one collector that everything consumes, and visible-invalid
  results. This plan keeps all three.

Trade made against "scope anchored to the incident": the observed problem is a
flat list that is useless when nothing is dated. The plan goes past that on the
boxholder's explicit request, and says so in the budget above.

## What already exists

- **The collector** — `src/core/todo/collect.ts:121` `collectTodos`, `:204`
  `collectCardTodos`, `:74` `listTodoCardPaths` (glob at `:77`, narrowed at
  `:92`: *"globbed.filter((absPath) => absPath.endsWith(".card"))"*), and the
  containment re-check at `:97`. **Reused** for stage 1. `issues` with five
  kinds (`collect-types.ts:61`) is **reused** as the result's second channel.
- **The clock is inside extraction today.** `collect.ts:247` and
  `collect-body.ts:106`: *"plateState: deriveTodoPlateState(plateInputFor({
  status, start, due }), ctx)"*. **Rebuilt**: Track 2 moves this out, because a
  cache cannot sit behind a function that reads `now`.
- **The plate-state rule** — `src/shared/todo-model.ts:334`
  `deriveTodoPlateState`, already pure: `:13-15` *"`now`/`timeZone` are always
  passed in by the caller"*. **Reused** unchanged as the derive stage.
- **The body walk** — `collect-body.ts:68-71`, a flat `ast.walk()` with no
  parent, heading, or sibling context. **Rebuilt** in Track 2. Verified shape
  of the raw AST for `- {% todo %}A{% /todo %} — note [link](…)` with an
  indented `- {% todo %}B{% /todo %}` under it (probe run 2026-09-20):
  `item > inline > [tag:todo > text "A", text " — note ", link]`, and the
  nested `list` is a **sibling of that `inline` under the same `item`**, not a
  child of the todo tag. So the ordinary nested shape does not leak text into
  the parent (an earlier draft of this plan claimed it did). A block-form todo
  that wraps a list does contain its nested todos, and `walkChildren`
  (`:143-158`) would then merge their text. No doctest covers either nesting
  shape today.
- **Ref parsing** — `src/shared/ref-path.ts:100` `parseRef` and `:176`
  `resolveRefPath`. **Reused** for item references; per `beebox/CLAUDE.md`, no
  other ref parsing is written. `src/core/body-refs.ts:110` `extractBodyLinks`
  scans whole-body Markdown source and cannot be aimed at one todo, so Track 2
  reads `link` nodes from the AST it is already walking.
- **No reverse reference index.** Searched `beebox/src` for `findIncomingRefs`
  and `findOutgoingRefs`: nothing. The reference scope in Track 3 is a filter
  over extracted items, not a lookup.
- **Per-type summaries, in two halves.** Server: `FileSummary<T>`
  (`src/core/file-summary.ts:16`) built by `src/core/loader-registry.ts:101`
  `summarize`, with type loaders registered in a side file —
  `src/core/loader-registrations.ts:20-21`: *"registerTypeLoader("memo",
  memoLoader); registerTypeLoader("image", imageLoader);"* — and a fallback
  (`loader-registry.ts:67`). Loaders take untyped `fields`
  (`file-summary.ts:38-46`) and parse again by hand (`src/schemas/memo.ts:89`).
  `registerTypeLoader` is not in the public `beebox/cards` API, so a box-local
  type cannot have a summary. Client: `FileEntry`
  (`src/frontend/src/components/ui/FileEntry.tsx`) renders a summary through
  `listUI.ListComponent` with a fallback (`src/frontend/src/file-type-registry.ts`,
  `FileTypeUI`). **Reused** as the card header. Track 1 moves the server half
  onto the schema.
- **Two other partial summaries** — `foldFields`
  (`src/core/search/extract.ts:219`) and `buildBrowseCard`
  (`src/webapp/trpc/routers/status.ts:130`). **Left alone**; see NOT in scope.
- **Consumers to port** — `todos.list` (`src/webapp/trpc/routers/todos.ts:35`,
  filters at `:69-76`, scope default at `:88-94`); `TodoViewCard.tsx`
  (`GROUP_ORDER` at `:44-51`); `bbx todos` (`src/cli/commands/todos.ts`,
  classified `audience: "agent"` at `src/cli/surface-data.ts:63`);
  `runTodoReviewSweep` (`src/core/todo/review-sweep.ts:180`, sets at
  `:126-147`); `computeTodoAmbientLine` (`ambient-summary.ts:20`, called from
  `reactor/batch-jobs.ts:44`, `reactor/chat-jobs.ts:63`,
  `session-context.ts:273`).
- **The nav badge fast path** — `src/core/todo/count.ts:71`. **Kept.** It calls
  `collectCardTodos`; Track 2 changes it to call the new extract and the
  derive function, with the same result.

## Prior art (external)

- **Obsidian Tasks** groups a task query by heading, by file, and by folder
  ([Tasks grouping documentation](https://publish.obsidian.md/tasks/Queries/Grouping)).
  Position as the default meaning of a task is an established pattern. Not
  fetched again for this plan; the claim is from the use-case survey's sources.
- **Worklists survive; progress appears as an attachment to another view** —
  [use-case survey](../../../research/collection-use-cases-2026-09-19.md),
  sections B and C. This supports a reduction on each card header and no
  separate progress view.
- **"A collection is not an object"** —
  [TiddlyWiki review](../../../research/tiddlywiki/README.md), finding 1.
  Selection, iteration, and item rendering stay separate mechanisms here too.
- No external premise bears on the Markdoc walk. Markdoc's raw `Node` exposes
  `children`, `lines`, `type`, `tag`, and `attributes`
  (`collect-body.ts` uses all five); it has no parent pointer, so Track 2 walks
  with its own stack.

## Tracks / scope

### Track 1 — `summarize` belongs to the card type

**What.** `cardSchema()` takes an optional `summarize`. The loader registry's
type half is removed. A text form of a summary is added.

**Why this needs to change.** A todo list grouped by card shows a card header
for every card type in the box. Today only `memo` and `image` have a summary,
registration sits outside the type, the input is untyped, and a box-local type
cannot take part.

**Direction.**

```ts
// src/cards/schema.ts — CardSchemaConfig gains:
summarize?: (card: InferCardFields<CardSchema<TTag, TFields>>, base: CardSummaryBase) => CardSummaryParts;

interface CardSummaryBase { title: string; contains?: string; symbol?: CardSymbolData }
interface CardSummaryParts<TAttrs> extends CardSummaryBase { detail?: string; attrs?: TAttrs }
```

- `cardSchema` gains a third generic, `TAttrs`, inferred from `summarize`'s
  return type and carried on `CardSchema`. `SummaryAttrs<typeof XSchema>`
  extracts it. A list component declares `ListProps<SummaryAttrs<typeof
  ImageSchema>>` through a type-only import. This keeps the tie that
  `FileLoader<ImageAttrs>` gives today (`src/schemas/image.tsx:152`): a
  `summarize` that returns another shape is a compile error in the component.

- `base` is the standard summary: `title` from the `title` field or the
  filename, `contains`, `symbol`. A type extends it (`{ ...base, detail }`) or
  replaces it. A type without `summarize` gets `base`.
- `summarize` runs only on a card that passed schema validation. A card that
  failed gets `base` from the filename. This is the existing fallback rule.
- `FileSummary` gains `detail?: string`. `FileEntry`'s default middle slot
  shows it under the title.
- `summaryText(summary): string` in `src/core/file-summary.ts` returns
  `title`, then ` — detail` when present. It is the text form for Track 4.
- The hook type uses the exported `InferCardFields` (`src/cards/schema.ts:369`),
  not the private `InferFieldsRecord` (`:351`). `CardSchema` (`:285`) gains the
  field so that the hook survives `cardSchema()`.
- `src/core/loader-registry.ts` keeps path loaders for non-card files
  (`registerPathLoader`, `:53`) and resolves a card's summary from its schema.
  `summarize(input)` (`:101`) is schema-free today; it gains a `cardSchemas`
  argument. `files.summarize` has `boxRoot` and already builds a load context
  before it reads a card (`src/webapp/trpc/routers/files.ts:47`), so box-local
  schemas are reachable there. `files.summarize` is the registry's only caller
  outside tests.
- `memoLoader` and `imageLoader` become `summarize` on their schemas.
  `loader-registrations.ts` is deleted.
- **The React half is a separate registry, located beside the schema**
  (boxholder, 2026-09-20). Schemas load in the server and the CLI; a component
  on the schema object would pull frontend code into both. So the registry
  stays `registerFileType(... listUI ...)`.
  **Placement — built.** The component lives beside its schema:
  `src/schemas/<type>.list-entry.tsx` (boxholder, 2026-09-20: "I want each
  component to live alongside the rest of the schema"). It is frontend code in
  a backend tree, so the boundary is narrowed rather than opened, and the
  narrowing names one glob:
  - The backend tsconfig excludes `src/schemas/**/*.list-entry.tsx`; the
    frontend tsconfig includes it. `pnpm build` emits nothing for it.
  - `vite.config.ts` aliases `@schemas/<name>.list-entry` and nothing else
    under `@schemas`. The frontend lint rule that bans value imports through
    `@schemas` is now a regex with that one exception; `@core` and `@backend`
    are unchanged.
  - `eslint.config.ts` lints the glob with the React profile, allows it to
    reach the schemas, core and cards trees by type import only (values may
    come from `src/shared/` and `src/frontend/` alone), and bans every other
    module in `src/` from importing it.
  - It does not register itself: `src/frontend/src/file-types/builtins.tsx`
    imports it and registers it, so the file has an import edge and runs at
    startup (`main.tsx:17`). `knip.ts` reads the glob as frontend-workspace
    source so that edge is visible.
  `ImageCardListEntry.tsx` moved there first.

**Vocabulary lock-ins.** The config key `summarize`; the summary field
`detail`; `summaryText`. `summarize` becomes part of the public `beebox/cards`
surface that box-local schemas use.

**First implementation chunk.** Add `summarize` to `CardSchemaConfig` and
`CardSchema`, resolve it in `loader-registry.ts`, move the memo loader, and
extend `test/core/loader-registry` doctests (or create one if absent) to cover:
typed input, extend, replace, no `summarize`, invalid card.

### Track 2 — Extract is pure, and keeps position and references

**What.** One function turns one card into todo items. It reads no clock and no
other card. Each item keeps where it sits and what it points at.

**Why this needs to change.** In a working box, 145 of about 152 open todos
have no date, so plate state puts them in one group. Their meaning is in the
heading above them, the item they nest under, and the note after the closing
tag. The collector drops all three.

**Direction.**

```ts
// src/core/todo/extract.ts
export function extractCardTodos(input: { relPath: string; content: string; ctx: LoadCardContext }):
  { items: TodoItem[]; issues: TodoCollectionIssue[] };

interface TodoItem {
  path: string; locator: TodoLocator;
  id, text, status, assigned, by, created, due, start, seeAlso;   // as CollectedTodo today
  sectionPath: string[];      // heading texts above the item, outermost first; [] for frontmatter todos
  parent: TodoLocator | null; // the todo whose list item contains this one
  annotation: string;         // text after the closing tag, inside the same paragraph; "" when none
  refs: string[];             // box-relative paths, resolved and unchecked; from see-also refs and from links in text and annotation
}
```

- The walk is recursive over `children` with its own stack, because raw
  Markdoc nodes have no parent pointer. It replaces `ast.walk()` at
  `collect-body.ts:68`. The stack holds: the current headings by level
  (`heading` nodes carry `attributes.level`; their text is the flattened
  `inline` child), and the enclosing list `item` nodes.
- **`parent` comes from list-item ancestry.** A todo *owns* an `item` when it
  sits in one of the item's direct `inline` or `paragraph` children. When
  several do, the owner is the last one before the nested list. This covers
  the loose-list shape, where the item's first paragraph is plain text and the
  todo is in a later paragraph. A todo inside a nested list
  takes as `parent` the todo that owns the nearest enclosing `item`. An
  enclosing `item` with no todo is skipped. A block-form todo is the parent of
  the todos inside it.
- A todo's `text` stops at a nested todo tag, which matters only for the
  block form.
- `annotation` applies to an inline todo: the flattened text of the sibling
  nodes that follow the tag inside the same `inline` node, found by index in
  the parent's `children`. When one `inline` holds two todos, the annotation
  of the first stops at the second. A block todo has `annotation: ""`.
- `refs` come from `{% see-also ref %}`, and from `link` nodes in the AST:
  those inside the todo tag and those among the annotation's sibling nodes,
  read from `attributes.href`. They are collected during the walk, before text
  is flattened; flattening keeps only a link's label. `extractBodyLinks` is not
  used, because it scans Markdown source, not a node range. Each href goes
  through `parseRef` and `resolveRefPath` with `kind: "card"`. `resolveRefPath` resolves a string
  and does not prove that the target exists or is a card
  (`src/shared/ref-path.ts:176`), so `refs` are **box-relative paths**, files
  or directories, unchecked. External links and refs that escape the box are
  left out; link validation stays `bbx validate`'s job.
- `plateState` leaves the item. `deriveTodo(item, plateCtx): DerivedTodo` adds
  it, using `deriveTodoPlateState` unchanged.
- **Built:** `TodoItem` is the extracted shape and `CollectedTodo` keeps its
  name as the derived one (`TodoItem` plus `plateState`), because every
  consumer of the name is rewritten in Track 4 anyway — renaming it twice
  would be churn. `collectTodos` stays as extract plus derive over a glob, so
  callers outside Track 4 keep working through the transition. `count.ts`
  switches to the same two calls, and `mayHaveTodo` moves to `extract.ts`
  where both it and the runner can reach it.

**Vocabulary lock-ins.** `sectionPath`, `parent`, `annotation`, `refs` appear in
`bbx query todos --json` and in the review job brief.

**First implementation chunk.** `extract.ts` with the stack walk,
`sectionPath`, and `parent`; new cases in `test/core/todo-collect.doctest.md`:
heading path, two levels of list nesting, an enclosing item with no todo, a
block-form todo that wraps a nested todo (its text excludes the child's),
frontmatter todos with `sectionPath: []`.

### Track 3 — The collection pipeline and the todo definition

**What.** A small generic runner for the five stages, and the todo collection
defined on it.

**Why this needs to change.** Each consumer filters and groups by hand today
(`todos.ts:69-76`, `cli/commands/todos.ts:74-92`, `review-sweep.ts:126-147`,
`ambient-summary.ts:22-25`). A scope that follows references would have to be
written four times.

**Direction.**

```ts
// src/core/collection/types.ts
interface CollectionDef<Item, Derived, Params, Reduction> {
  name: string;
  params: z.ZodType<Params, unknown>;
  extract(input: ExtractInput): { items: Item[]; issues: CollectionIssue[] };   // pure, one card
  mayHaveItem(content: string): boolean;        // skip a parse in the reference pass
  derive(item: Item, ctx: DeriveContext): Derived;                              // ctx: now, timeZone, since
  matches(item: Derived, params: Params): boolean;
  refsOf(item: Derived): string[];
  keyOf(item: Derived): string;                 // identity within one card
  parentKeyOf(item: Derived): string | null;    // the ancestor chain the runner keeps for context
  compareItems(a: Derived, b: Derived): number; // canonical order within one card
  sectionOf(item: Derived): string[];           // what a row's `sections` group by
  reduce(items: Derived[]): Reduction;                                          // always over ALL items in scope
  groupings: Record<string, (item: Derived) => GroupKey>;                       // key, label, order
}

interface CollectionQuery<Params> {
  here: string;                 // box-relative directory or card path; "" is the box
  glob?: string;                // default: the subtree of here
  includeReferring?: boolean;   // default true unless here is the box
  group?: string;               // a key of groupings; default "place"
  params: Params;
}

interface CollectionResult<Derived, Reduction> {
  query: ResolvedQuery;         // the effective glob and here, echoed
  reduction: Reduction;
  groups: Array<{ key: string; label: string; reduction: Reduction; rows: Row<Derived, Reduction>[] }>;
  issues: CollectionIssue[];
}
interface Row<Derived, Reduction> {
  card: FileSummary;            // Track 1
  via: "scope" | "reference";
  reduction: Reduction;         // over every item of this card that is in scope
  sections: Array<{ path: string[]; reduction: Reduction }>;
  items: Array<Derived & { matching: boolean }>;   // matching items, plus non-matching ancestors for context
}
```

- **All items against matching items.** The runner keeps two sets per card:
  every derived item in scope, and the subset where `matches` is true.
  Reductions read the first set, so a hidden done item still counts. `items`
  carries the second set plus the ancestors that give it context, each marked.
  A card with no matching item has no row.
- **Built, beyond the shape above:** a `CollectionDef` may declare
  `crossCardIssues(items)`, run over every in-scope item once the scan is
  done. Todos use it for the duplicate-`id` check the old collector did
  box-wide; without it, retiring `collectTodos` would have retired that
  visible-invalid signal with it.
- **The runner holds no state.** `DeriveContext` is
  `{ now, timeZone, since: number | null }`. `since` is a box-local date epoch
  that the *caller* supplies. The review sweep keeps its own baseline file and
  its own rule for advancing it (`review-sweep.ts:216-232`); it passes
  `lastSweepEpoch` as `since`, and the todo `derive` sets
  `stirring: boolean` from it. Other callers pass `null`.
- **`count.ts` does not use the runner.** It stays a fast path over `extract`
  and `derive`.

- `runCollection(boxRoot, { def, query, deriveCtx })` in
  `src/core/collection/run.ts` does the stages in order (a named-params object,
  because the style rule caps positional parameters at two). Stage 1 reuses
  `listTodoCardPaths`, renamed `listScopedCardPaths` and moved to
  `src/core/collection/card-scope.ts` with its traversal guards, in Track 2.
  **Built, beyond the shape above:** identity (`keyOf`/`parentKeyOf`), order
  (`compareItems`), and sections (`sectionOf`) are `CollectionDef` members,
  because the runner cannot build ancestors, deterministic item order, or a
  row's `sections` without asking the collection what an item's identity and
  place are. Each reduction has a stated scope: the top-level one covers every
  in-scope item of every card scanned, a row's covers that card's in-scope
  items, and a group's covers the group's matching items.
- **`here`, exactly.** `here` is `""` (the box), a directory, or a card path.
  The scope glob defaults to `<dir>/**` for a directory and to the one card
  for a card path. A reference *matches* when the resolved ref equals `here`,
  or, for a directory, starts with `here + "/"`. A card path has no subtree:
  a ref to its sibling does not match. The `todo-view` card keeps its meaning
  by passing its own **directory** as `here` (as `todos.ts:88-94` computes
  today), not its own path.
- **Reference scope.** With `includeReferring`, a card inside the glob
  contributes all its items, `via: "scope"`, whether or not they also refer
  into `here`. A card outside the glob contributes only items with a matching
  ref, plus those items' ancestors, `via: "reference"`.
  A card outside the glob that fails to load or parse is skipped without an
  issue: an unparseable card cannot be shown to refer to anything, and a
  project-scoped view must not fill with the rest of the box's problems. The
  scope pass owns the issues channel.
- **Cost, stated plainly.** There is no index, so `includeReferring` reads
  every card in the box. For the box-wide plate this is today's cost. For a
  project-local `todo-view` it is a **regression**: today that query scans
  only its subtree (`todos.ts:65`, `:88`). Two things bound it until indexing
  exists: cards outside the glob are skipped without a parse unless their text
  can hold a todo (the `mayHaveTodo` test, `count.ts:52-54`, moved to a shared
  place), and `--no-referring` / `includeReferring: false` restores the
  subtree-only scan. The timing doctest records both numbers on the fixture
  box.
- **Row order.** Rows are ordered `via` first and path second — every card the
  scope holds, in path order, then every card that only refers into `here`, in
  path order — so a card from elsewhere in the box cannot sort above the
  place's own work, and so every consumer shows one order. The rule applies
  inside each group of any grouping.
- **Groupings for todos.** `place` (one group, key `"place"`; rows are cards in
  path order; the renderer nests sections and parents) and `plate` (the plate
  states in today's order with today's labels — a state with no items is
  absent, not an empty group). Rows form again inside each group.
- **Reduction for todos.**
  `{ open, done, dropped, parked, onPlate, escalated, next: string | null }`.
  `onPlate` counts open items whose plate state is `escalated` or `on-plate`;
  `escalated` counts the first of those. The ambient line needs exactly these
  two (`ambient-summary.ts:22-27`). `next` is the earliest `due` or resolved
  `start` among open items.
- **Todo params.** `{ status: TodoStatus[] (default open, parked), assigned?, onPlate? }`
  — the `todos.list` inputs, unchanged in meaning.
- The stage rules are enforced by the types: `extract` has no `ctx` with a
  clock; only `derive` receives `DeriveContext`.

**Vocabulary lock-ins.** `here`, `includeReferring`, `group`, `via`,
`reduction`; grouping names `place` and `plate`; the collection name `todos`.

**First implementation chunk.** `types.ts`, `run.ts` without the reference
scope, `src/core/todo/collection.ts`, and `test/core/collection-run.doctest.md`
covering scope default, filter, both groupings, reductions that count hidden
items, and the issues channel.

### Track 4 — Consumers

**What.** The web list, the agent command, the review sweep, and the ambient
line read `runCollection`.

**Direction.**

- **tRPC.** `collections.query({ collection: "todos", query })` in a new
  `src/webapp/trpc/routers/collections.ts`, with the `todos.ts` traversal
  guards moved over. `todos.list` is removed; its doctest moves.
- **The list** (`TodoViewCard.tsx`, rewritten, split to stay under 300 lines):
  - A **dated strip** first: open items with a `due` or `start`, in date order,
    each with its card title. It is empty in a box with no dates, and then it
    does not render.
  - Then one block per row: the card as a `FileEntry` header (polymorphic
    through the type's summary and list component, with the fallback), the
    card's reduction ("5 of 7", next date), then sections as subheads with
    their reductions, then items nested under their parents, each with its
    annotation. A row with `via: "reference"` says so.
  - Done and dropped items are hidden and counted, with a control to show them.
  - A control switches `group` between place and plate. It is view state, not a
    card field.
  - The `todo-view` schema does not change. An omitted `glob` still means the
    card's own subtree (`todo-view.ts:37-41`), and now also includes referring
    items. `glob: "**"` is the box; nothing refers into it from outside.
- **`bbx query <collection>`** is added. `bbx todos` stays for now (see Open
  design questions) and calls the same runner, flattening the rows back to the
  matching items so its flat listing and its `{todos, issues}` JSON are
  unchanged apart from the new item fields. Flags: `--here <path>`,
  `--glob`, `--group`, `--no-referring`, `--json`, plus the collection's params
  (`--status`, `--assigned`, `--on-plate`). Text output: per row,
  `summaryText(card)` and the path; under it, one line per item with its
  section path, locator, text, and dates; then the issues block as today
  (`cli/commands/todos.ts:121-127`). `--json` prints `CollectionResult`. `query` is added to `surface-data.ts` with `audience: "agent"`; the `todos`
  entry stays.
- **Review sweep.** `computeSets` reads derived items from `runCollection` with
  `here: ""`. The three sets and their rules do not change. Each job item gains
  `card` (the summary text) and `sectionPath`, so the brief reads in context.
  `TodoReviewItemSchema` (`src/schemas/todo-review-job.ts:22-27`) gains two
  optional fields; existing job cards stay valid. **Built:** the two are
  `card` (the summary text) and `section` (the heading path joined with
  " › "), and `stirring` is no longer the sweep's own arithmetic — it is the
  collection's, derived from the `since` baseline the sweep passes.
- **Ambient line.** `computeTodoAmbientLine` reads the box-wide reduction. The
  text changes only in its pointer: `` `bbx query todos` ``.

**Vocabulary lock-ins.** The verb `bbx query`; the router name `collections`.

**First implementation chunk.** The `collections.query` router and its doctest
(moved from `test/webapp/trpc-todos-list.doctest.md`).

### Track 5 — What the agent is told

`src/core/agent-guide/todos.ts` ("Querying", `:79`), the ambient-field text in
`src/core/chat/session/prompts.ts:120`, the `todo-view` and `todo-review-job`
schema instructions, `docs/cards-as-markdown.md:80-88`, and the two audits that
name `bbx todos`. The guide gains three sentences: headings and nesting group
todos, so write a todo under the heading it belongs to; a note after the
closing tag travels with the todo; a link in a todo makes it appear on the
linked card's place.

## Could this be simpler?

**The simplest version** is the smallest fix above: three new fields, the
nesting fix, and card grouping in one component. It would make the list usable
in a box with undated todos.

What the fuller plan buys, each against a named need:

- **Reference scope** — "what is going on with this asset" needs todos from
  three places; a directory scope finds one of them (design notes, "What a
  working box shows"). The simple version cannot do this without writing the
  filter into each consumer.
- **One result shape for four consumers** — the boxholder ranked the review
  sweep and a generalized agent command as the interesting consumers
  (2026-09-20). The simple version leaves the agent with a flat list and no
  card context.
- **Pure extract** — the boxholder required that the shape allow later
  indexing. The simple version keeps the clock inside extraction.
- **`summarize` on the type** — boxholder decision (2026-09-20). Without it a
  box-local type has a filename for a header.

**The generic runner has one caller.** That is the usual over-build. It is kept
because the boxholder asked for the general shape in this scope, and it is kept
small: types and one function, about 200 lines, with no registry, no plugin
loading, and no configuration format. If a second collection never arrives, the
cost is one level of indirection in `src/core/todo/`.

## Subplans

None. The one candidate, the reference scope, has no open decision.

## Failure modes

No critical gap: each row has planned handling and a test.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A type's `summarize` throws on a valid card | planned (loader-registry doctest) | catch, log with type and path, return `base` | clear (logged; header falls back) |
| `summarize` returns an empty `title` | planned | replace with `base.title` | clear |
| A list component's `attrs` type drifts from what `summarize` returns | structural | the component imports the type from the schema module (type-only), so drift is a compile error | clear |
| A heading contains inline markup or a tag | planned (todo-collect doctest) | flatten to text, as todo text is today | clear |
| A todo nested three levels deep | planned | `parent` chain; renderer indents; no depth cap | clear |
| A nested todo's parent is filtered out (parent done, child open) | planned (collection-run doctest) | keep the parent as a context-only ancestor, marked not matching | clear |
| Annotation text is very long | planned (frontend logic doctest) | list truncates with expand; JSON keeps all | clear |
| A link in a todo points at a card that moved | existing (`bbx validate` link warnings; `bbx mv` rewrites body links) | the ref resolves to the old path and matches by string, so the todo lists under the old place and not the new one | clear for the link through validate; the misplaced reference row is silent, accepted because validate reports the link |
| A link inside a todo is lost when text is flattened | planned (todo-collect doctest: a link in the text and a link in the annotation both reach `refs`) | refs are read from `link` nodes before flattening | clear |
| `here` is a card path, not a directory | planned (collection-run doctest) | scope is that one card; a reference matches only the card itself | clear |
| `--here` or `glob` contains `..` | existing (`trpc-todos-list`, `todo-collect` doctests), moved | reject, as `todos.ts:50-57` and `isUnsafeGlobPattern` do | clear |
| Box-wide extract with `includeReferring` is slow on a large box | planned (timing note in collection-run doctest on the fixture box) | same cost as today's unscoped `collectTodos`; no new handling | clear (slow, not wrong) |
| A card fails to load inside the scope | existing (`todo-collect` doctest) | `issues` channel, shown in the list and the CLI | clear |
| An old `todo-review-job` card lacks the new item fields | planned (schema doctest) | fields are optional | clear |
| Agent runs `bbx todos` from habit | existing (`test/cli/todos.doctest.md`) | the verb still works, on the runner | clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED. No new tag and no new card field.
  Tag attributes validate as before (`markdoc-config.ts:365-377`).
- **Stale ref** — ADDRESSED in Failure modes: an unresolvable link drops out of
  `refs`, and `bbx validate` reports the link.
- **Two agents touching the same card** — ADDRESSED by shape: this plan reads
  cards and writes none, except the sweep's job card, which keeps its lock
  (`review-sweep.ts:184-200`).
- **Hand-edit drift** — ADDRESSED. Position is read from ordinary Markdown.
  A boxholder who moves a todo under another heading changes its group, which
  is the intent.
- **Fabricated free-form value** — ADDRESSED. `annotation` and `sectionPath`
  are read from the card; the agent cannot set them apart from the text it
  writes.
- **Validation error UX** — ADDRESSED. `bbx query` validates params with the
  collection's zod schema and lists valid values, as `bbx todos --status` does.
- **Partial migration / transition state** — ADDRESSED. `collectTodos` keeps
  its signature until Track 4's last chunk, so each chunk leaves a working
  tree. No box data changes shape.
- ~~**The header's `FileEntry` peek opens a full card viewer inside the list**~~
  **DECIDED (2026-09-20), on screen: `FileEntry` stays, peek and all.** The
  alternative — a hand-built link — would have had to re-implement the mark,
  the type icon, and the type's list component to look the same, which is
  the polymorphism Track 1 exists to provide. Peek is opt-in; nothing expands
  unless the reader asks.

## NOT in scope

- **Non-todo collections** (questions, images, a type histogram on directory
  pages). The boxholder scoped this plan to todos.
- **Box-authored collections.** They need box code that runs on the server,
  which has no loader today. The runner is written so that one can be added.
- **A React list form from a box view** (a `ListEntry` export beside
  `rendersCardTypes`). Needs view-compiler work. Box-local types get data and
  text summaries now, and the fallback `FileEntry` rendering.
- **The agent-side scope preview** (types, counts, field coverage). It serves
  box-authored collections, which are out.
- **Caching, indexing, the nav badge path.** The stage rules keep them
  possible. `count.ts` keeps its fast path.
- **Write-back** (check a todo off in the list). Items keep their locator.
- **`![]()` embedding** of a collection in a card body.
- **Moving `foldFields` and `buildBrowseCard` onto `summarize`.** Filed as a
  follow-up when Track 1 lands.
- **Near-duplicate todos.** Separate issue. The reference scope will make
  copies more visible; that is accepted.
- **New sweep rules for undated boxes.** The sweep's three sets stay. What it
  should raise when nothing is dated is an open question in the design notes.
- **A `kind` attribute on todos.** Boxholder: it matters only if used in a
  structured way, and nothing does yet.
- **The card-edge "N open things here" summary and the companion panel** from
  the inline-todos issue. `here` accepting a card path is the hook for them.

## Open design questions

- ~~What happens to `bbx todos`~~ **DECIDED (2026-09-20): it stays, and is
  deleted later.** `bbx query todos` is added beside it. `bbx todos` keeps its
  flags and output and is re-based on the runner so that there is one code
  path. The guide, the ambient line, and the audits teach `bbx query todos`.
  No retired-verb mechanism is built now. A follow-up issue records the
  removal and the surfaces that name the verb.
- ~~Where a type's list component lives~~ **DECIDED (2026-09-20): alongside
  the schema**, as `src/schemas/<type>.list-entry.tsx`, with a narrow
  exception in the frontend's type-only `@schemas` boundary for that file
  pattern. Track 1 describes what was built.
- **Whether `place` order is path order or landmark order.** Lean: path order
  now; it is deterministic and needs nothing new.
- **Whether a referring item shows under its own card or under the card it
  refers to.** Lean: its own card, marked as a reference, because its section
  and parent context live there.

## Knowledge audits

New agent-facing behaviour, so audits land run, in
`src/dev/knowledge-audits.yaml`:

- Update `todo-annotation-bbx-todos` and `todo-application-query-plate` to
  expect `bbx query todos`.
- New `knows_directly`: "How do you see the open todos for one project
  directory, including todos elsewhere that link to it?" (expects
  `bbx query todos --here`).
- New `knows_directly`: "You are adding a todo to a long planning document.
  What decides which group it shows under in the todo list?" (expects: the
  heading it sits under, and nesting).

`summarize` is a schema-authoring concept; it goes in
`docs/adding-schemas.md`, the box's own schema-authoring guide
(`src/core/box/schemas-guide.ts` — the surface a box agent actually reads),
and the schema-guide skill, with one audit:
"How does a box-local card type control how it appears in lists?"

## What will hold this after it ships

- **Doctest tier, pure functions.** `extractCardTodos`, `deriveTodo`, the
  grouping and reduction functions, and `summaryText` are pure. The risky
  decisions (where a todo's text stops, what counts as annotation, which items
  a reference scope admits, what a reduction counts) are each a function with a
  doctest. No new tier.
- **Filesystem tier.** `runCollection` over a fixture box, in the existing
  style of `test/core/todo-collect.doctest.md`.
- **Route and CLI tiers.** The moved `trpc` doctest and a rewritten
  `test/cli/query.doctest.md`.
- **Frontend.** Tree building (sections, parents, the dated strip) lives in a
  logic module with a doctest, as `todo-view-card-logic.ts` does today. The
  component gets a browser check and one exhibit for the boxholder.
- The type rule "extract has no clock" is held by the compiler, not by a test.

## Implementation order

1. **Track 1, chunk 1** — `summarize` on the schema, memo moved.
2. Track 1 — image moved, `loader-registrations.ts` deleted, `detail` in
   `FileEntry`, `summaryText`, public API and `docs/adding-schemas.md`.
3. **Track 2, chunk 1** — `extract.ts`: stack walk, nesting fix, `sectionPath`,
   `parent`.
4. Track 2 — `annotation` and `refs`; derive split; `collectTodos` and
   `count.ts` on the new functions. All existing todo doctests green.
5. **Track 3, chunk 1** — types, runner without reference scope, todo
   definition.
6. Track 3 — reference scope with ancestors and `via`.
7. **Track 4** — `collections.query` router; then the list; then `bbx query`;
   then the sweep and the ambient line; then remove `todos.list` and
   `collectTodos`' old callers, and re-base `bbx todos` on the runner.
8. **Track 5** — guide, instructions, docs, audits run.
9. Browser check of the list on the worktree box, an exhibit, cross-model
   review of the branch.

Chunks are commit boundaries. The plan ships as one piece, when the boxholder
says so.

## Rollout shape

- **Tests first.** New or extended doctests, named by chunk: loader-registry
  (1, 2); `todo-collect` (3, 4); `collection-run` (5, 6);
  `trpc-collections-query`, `todo-view-card-logic`, `cli/query`,
  `todo-review-sweep`, `todo-ambient-summary` (7). Done when these pass, the
  untouched todo doctests pass (`todo-model`, `markdoc-todo`, `todos-field`,
  `todo-count`, `box-defaults-todo-view`, `schemas/todo-view`), and typecheck
  and lint are clean.
- **Knowledge audits** above land run, with status recorded.
- **Migration.** None. No card changes shape. The `todo-view` card and the
  `todo-review-job` card stay valid. No verb is removed.
- **Fixture content.** The worktree test box gets a planning document with
  headings, nested todos, annotations, and links into a second directory, on
  the clone's `keep` branch, so the list and the reference scope can be seen.
  It uses the fictional roster and no content from a real box.
