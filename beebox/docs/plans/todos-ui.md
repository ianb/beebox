---
title: "Todos in the UI — one experience of what is open here and what to do about it"
status: partial
workstream: todos-ui
issues:
  - ../../../issues/bugs/2026-09-21-todo-copy-promises-unavailable-tick-controls.md
  - ../../../issues/features/2026-09-21-hide-completed-agent-todos-from-boxholder-cards.md
  - ../../../issues/bugs/2026-08-25-plate-badge-is-a-bare-number.md
---
# Todos in the UI — one experience of what is open here and what to do about it

When I read a card, I want to see its open todos where they are written, tick
one off, or drop it into chat with a note. When I open a project directory, I
want one line that says how many things are open there. When I open the
plate, I want the same list at box scope, with a headline that agrees with the
nav badge. When the agent owns a todo, I want it out of my way.

Today these are four features that grew separately: the `{% todo %}` tag, the
todo collection and its list, the plate, and the badge. This plan makes them
one experience. It also fixes two platform gaps that the walkthrough found:
box views cannot use the built-in Markdown renderer, and the todo-review
sweep does not run on most boxes.

**Issues addressed:**

- Closes [tick controls promised but absent](../../../issues/bugs/2026-09-21-todo-copy-promises-unavailable-tick-controls.md)
  (Track 3 makes the controls real).
- Closes [hide completed agent todos](../../../issues/features/2026-09-21-hide-completed-agent-todos-from-boxholder-cards.md)
  (Track 2).
- Closes [the plate badge is a bare number](../../../issues/bugs/2026-08-25-plate-badge-is-a-bare-number.md)
  (Track 1: the plate headline states the badge's number and its scope).
- Advances, does not close,
  [todos as inline things to think about](../../../issues/features/2026-08-30-todos-inline-things-to-think-about.md):
  ask 1 (the "N open things here" summary) is built in Track 4; ask 2 (the
  card companion panel) is not.
- Changes the rendering that
  [verify todo annotation rendering](../../../issues/features/2026-07-29-verify-todo-annotation-rendering.md)
  gates. Its `## Manual testing` text is rewritten when this ships. Its
  manual-testing gate stays with the boxholder.
- Related, not addressed:
  [completion requires an answer](../../../issues/exploration/2026-09-24-todo-completion-requires-an-answer.md)
  (queued by the boxholder on 2026-09-24),
  [near-duplicate todos](../../../issues/features/2026-09-20-near-duplicate-todos-accumulate-across-cards.md),
  [remove `bbx todos`](../../../issues/docs-and-chores/2026-09-20-remove-bbx-todos-verb.md).

Searched the queue for "todo", "plate", "view-widgets", "box view markdown",
"todo-review", "selection chat": no other open item covers this work.

## Smallest fix and budget

**Smallest fix.** Change the authored "Tick them off" copy, add
`assigned: "!agent"`-style filtering to the stock plate, and label the
toggle. About 60 lines. It leaves todos read-only, leaves them invisible in
box-view cards and as raw YAML in frontmatter, leaves no per-place summary,
and leaves agent todos with nobody to do them.

**Chosen design.** Seven tracks. An eighth, a scheduled procedure in which
the agent works its own todos, was split out after cross-model review
(see NOT in scope).

| Track | Source | Test |
|---|---|---|
| 1. Scope prefilter, plate headline, agent scope | 200 | 200 |
| 2. One rendering of a todo (body, frontmatter, list) | 300 | 200 |
| 3. Tick and "+ to chat" (write-back) | 400 | 350 |
| 4. Per-place summary (card, directory) | 200 | 150 |
| 5. List links open in the opposite pane | 60 | 40 |
| 6. `Markdown` for box views, hand-rolled Markdown is an error | 350 | 250 |
| 7. todo-review: own schedule, `recheck`, health check | 450 | 350 |

About 3,550 changed source and test lines (Track 7 grew by about 450 after
the boxholder's recheck decision, 2026-09-24). Authored docs (agent guide, view
guide, `docs/todos`-area reference, this plan) add about 300.

> **BIG CHANGE.** The size comes from two platform pieces that the
> walkthrough showed the todo experience depends on: a write path for one
> todo (Track 3) and a `Markdown` export for box views with its enforcement
> (Track 6). Each can ship alone. Tracks 1, 2, 4, 5 are the UI
> unification proper, about 1,350 lines. **Approved by the boxholder,
> 2026-09-24 ("Yes, okay this is a big change").**

What the fuller design buys over the smallest fix: todos that can be acted on
where they are read; todos that appear in every card type; a summary at every
place; agent todos out of the boxholder's way.

## Stated preferences this plan trades against

- **Boxholder decisions, 2026-09-24** (this workstream's conversation):
  todos are tickable, and also "+"-able into chat as a selection with notes;
  finished todos are hidden by default with a count at the bottom; finished
  agent todos are hidden; the badge is fine; the pill-versus-margin-mark look
  does not matter; links from the list open in the opposite pane; "I really
  don't want anyone to use a markdown renderer that isn't our built-in
  enhanced one"; hand-rolled Markdown in a box view is an error, and views
  that need more ask for options; box views get explicit named exports, not
  open imports; `**` scanning stays (indexing is a separate, box-wide
  design), but the todo query should have "something better than `**`";
  review todo-review's scheduling and everything about it; "we have to be
  super careful about out-of-control agent activity on agent-assigned
  tasks. Super careful."
- **Boxholder decisions, 2026-07-28**
  (`docs/implemented-plans/todo-annotation.md`, Open design questions):
  click-to-done was deferred as "a fast-follow candidate once the read path
  has earned trust". This plan is that fast-follow.
- **The collection design** is a draft owned by the `collection-views`
  workstream (`docs/plans/collections-design-notes.md:1-12`, *"This is not
  yet a plan"*). This plan consumes what landed and records its needs in
  *Open design questions*. It does not edit that draft.
- **`beebox/CLAUDE.md`**: `bbx` is the agent's surface; end users live in the
  web UI and chat. Every user-facing piece here is web UI.
- **`beebox/code-style.md`**: no `as`; `assertNever` for status dispatch;
  files under 300 lines; cross-process locks through `src/lib/file-lock.ts`.
- **Minimize invented concepts** (boxholder standing preference). No new tag
  attribute, no new card type. Track 1 uses an existing `CollectionDef` field,
  `mayHaveItem`, in one more place.

## What already exists

- **`{% todo %}` tag.** `src/shared/markdoc-config.ts:348-379`; transform:
  *`return new Tag(node.inline ? "TodoInline" : "TodoBlock", attributes, children);`*.
  Rendered by `makeTodoComponents()` (`src/frontend/src/components/Todo.tsx:78-108`),
  wired at `Markdown.tsx:170`, *`const { TodoInline, TodoBlock } = makeTodoComponents();`*,
  with no card path or locator (`Todo.tsx:66-72`, props are
  `status/assigned/due/start/children`). **Reuse and extend.** The sibling
  factories already receive the card path: `makeSeeAlsoComponent({ ..., basePath: linkCtx.basePath })`
  (`Markdown.tsx:171`).
- **Locators.** `src/core/todo/collect-types.ts:20-30`:
  *`{ kind: "body"; line: number; nth?: number } | { kind: "frontmatter"; index: number }`*.
  Body `line` is a 1-based file line (`extract.ts:107` adds
  `lineOffset`). Not stable across edits (`extract-body.ts:230-234`).
  **Reuse** as the address for a write, with a text check (Track 3).
- **Collection runner.** `src/core/collection/run.ts:81-91` reads and parses
  every card in scope; `mayHaveItem` (`src/core/collection/types.ts:69-70`,
  *"Cheap proof a card's text cannot hold an item"*) is applied only in the
  reference pass (`run.ts:192`). **Reuse** in the scope pass (Track 1).
- **Collection reduction is complete regardless of the status filter.**
  `types.ts:83`, *"Always over ALL in-scope items"*; `reduceTodos`
  (`src/core/todo/collection.ts:119-141`). The list's hidden-count line uses
  it (`TodoViewCard.tsx:128`, *`const finished = result.reduction.done + result.reduction.dropped;`*).
- **"Show finished" refetches.** `TodoViewCard.tsx:189`,
  *`status: statusFilterWithFinished(resolveTodoViewStatusFilter(fm), options.showFinished)`*
  — a new server query, which is the full scan, about 2 s on a 1,014-card box
  (measured 2026-09-24 with `bbx query todos`, CLI start-up subtracted).
- **Badge count.** `src/core/todo/count.ts:97`,
  *`isBoxholderTodo(t) && (t.plateState === "escalated" || t.plateState === "on-plate")`*,
  with the text prefilter (`count.ts:90`). The plate's stock card sets no
  `assigned` filter (`src/core/box/defaults.ts:263`, *`{ glob: "**", title: "The Plate" }`*),
  although `TodoViewSchema` has one (`src/schemas/todo-view.ts:26`).
- **Frontmatter rendering.** `src/frontend/src/components/FrontmatterFields.tsx:91-106`
  renders every key generically; the one name-based special case is
  *`name === "ref" && typeof value === "string" ? <RefLink .../>`* (line 100).
  **Reuse the precedent** for `todos`.
- **Write precedent.** `card.setTheme` (`src/webapp/trpc/routers/card.ts:216-259`):
  `ownerProcedure`, `withCardLock(fullPath, ...)` (line 238), format-preserving
  YAML via `parseDocument` (lines 243-249), `writeFileAtomic`,
  `stageAndCommitPaths` with trailers `{ "Source": "webapp", "Endpoint": "card.setTheme" }`
  (lines 252-256), then `emitTransient("file-change", ...)` (lines 261-265).
  **Reuse the shape.** Text-surgical attribute edits in a body:
  `src/core/rewrite-card-refs.ts:220` (regex over `ref=` in the tag's
  source). **Reuse the approach.**
- **Refresh after a write.** `TodoViewCard.tsx:193-203` invalidates
  `collections.query` on any `.card` `file-change`; `file-view-data.ts:115-147`
  invalidates `card.get`. Nothing new needed.
- **Selection into chat.** `useChatSelections().addSelection(selection, { anchor: null, spokenWords: null })`
  (`src/frontend/src/components/chat/InteractiveChat-selections.ts:32-46`)
  adds a `SelectionItem` (`{ ref, text, position }`,
  `src/frontend/src/lib/selection/serialize.ts:29-51`) and focuses the
  composer (`alwaysFocus: true`, line 45). No DOM selection needed.
  **Reuse.** `FileView` already carries `onAddSelection`
  (`FileView.tsx:174`).
- **Panes.** `useWorkspace().open(target, { destinationPane })`
  (`src/frontend/src/components/chat/workspace/WorkspaceProvider.tsx:62,169-176`);
  `oppositePane` (`workspace-state-model.ts:32-34`); an explicit
  `destinationPane` wins (`workspace-state-model.ts:193`). Precedent:
  `renderers/browse.tsx:82,94`. **Reuse.**
- **Box view imports.** Browser shim `src/webapp/views/compiler.ts:112-126`
  exports only `CardLink`, `CardRef`; node entry
  `view-widgets/node-entry.tsx:26`; types in `src/exports/view-widgets.d.ts`
  and `src/types/view-widgets.d.ts` (kept in sync by their headers); no
  import allowlist (`compiler.ts:198-215`).
- **Box view checks.** `lintViewFile` (`compiler.ts:325-332`) and
  `lintViewRefs` (`src/core/views/refs.ts:62-83`, regex over source) run from
  `validate-hook.ts:156-162` and `sdk-hooks.ts:57-63`. **Precedent** for a
  static source check.
- **The view guide teaches raw body text.** `src/core/views/doc.ts:146`,
  *"its prose from `body`"*, and `doc-examples.ts:24`, *`<p>{card.body}</p>`*.
- **Built-in Markdown.** `Markdown.tsx:261-275` props `children`,
  `onNavigate` (required), `basePath`; it calls `useParams` from
  `@tanstack/react-router` (line 286), so it cannot run outside the app
  router as-is.
- **todo-review.** Runs inside `bbx wakeup` housekeeping
  (`src/cli/commands/wakeup-housekeeping.ts:55-68`). `bbx wakeup` runs
  automatically only from the three connector schedules, all seeded
  `enabled: false` (`src/core/box/defaults.ts:294,305,316`). On a box with no
  connectors it runs only on `bbx force-wakeup`. The reactor that runs its
  job is also a wakeup step (`wakeup.ts:79-80`).
- **Scheduled agent runs.** `process-retrospective`
  (`defaults.ts:348-366`) runs `bbx procedure run process-retrospective`
  weekly, seeded enabled because its precheck exits `CHECK_SKIP` when there
  is nothing to do. Procedures carry `max-turns` (default 20,
  `docs/procedure-implementation.md:110`), prechecks, and validate phases.
  **Precedent** for Track 7.

## Prior art (external)

No design decision here depends on an external premise. The external review
behind todos (org-mode, Obsidian Tasks, Logseq) is in the todo-annotation
plan and does not change.

## Ontology

Existing nouns, unchanged: **todo** (a `{% todo %}` tag or a frontmatter
`todos:` entry; `collect-types.ts`), **locator** (`TodoLocator`), **status**
(`open | done | dropped | parked`, `todo-model.ts`), **plate state**,
**collection**, **reduction** (`TodoReduction`), **here**, **todo-view
card**, **plate** (the stock box-wide todo-view card), **badge** (the nav
count, `count.ts`), **selection** (`SelectionItem`), **procedure**,
**scheduled script**.

New or sharpened:

- **Boxholder scope** — the todos that are not `assigned="agent"`. Already a
  predicate, `isBoxholderTodo` (`todo-model.ts:40-42`). This plan makes it the
  default for every boxholder surface. It is not a new filter value.
- **Agent follow-up** — an open todo with `assigned="agent"`. Not a new
  status or type; a name for the set the plate headline counts separately.
- **Place summary** — the one-line reduction for a card or a directory
  ("3 open · 1 overdue"). It is the existing `TodoReduction`, rendered. Not a
  new query result.
- **Todo write** — setting one todo's status, addressed by path + locator +
  the text and status the client saw. Not a general card-edit API.
- **Recheck** — a todo attribute: the date the review may next list the
  todo, or `never`. Written by the review agent or the verify step. Not a
  plate-state input, not a reminder to the boxholder.
- **Todo actions** — a React context that gives a rendered todo its two
  actions (set status, add to chat). Provided by the surfaces that can
  perform them; absent elsewhere, and then the controls do not render.

## Tracks / scope

### Track 1 — Scope prefilter, plate headline, agent scope

**Status (2026-09-25): implemented**, commit `52b609299`. Tracks 2 and 3
and Track 4's card line are implemented; the rest is not started.

**What.** Make the todo query skip cards that cannot hold a todo, default
boxholder surfaces to boxholder scope, and give the plate a headline that
agrees with the badge.

**Why.** The scope pass parses every card (`run.ts:81-91`), about 2 s per
query on a 1,014-card box, and every "Show finished" click pays it again.
The plate shows agent follow-ups that the badge excludes; the badge's number
appears nowhere on the plate (issue: plate badge).

**Direction.**

- `runCollection`'s scope pass applies `def.mayHaveItem(content)` after a
  successful read and before `scan`. A card that fails the check contributes
  no items and no issues. A card that cannot be read is still an issue
  (`run.ts:121-132` runs first). This is the "something better than `**`": the todo
  collection's scope is "cards whose text can hold a todo", declared by the
  collection (`mayHaveTodo`, `extract.ts:45-47`), not by a query syntax. Reads
  use `mapInBatches` as `count.ts` does.
- The visible-invalid guarantee (`extract.ts:58-76`) narrows: an unreadable
  card is still reported, but a card whose text cannot hold a todo is no
  longer schema-loaded, so its unknown type or bad frontmatter is not
  reported here. That is not a todo problem; `bbx validate` reports it.
  Boxholder, 2026-09-24: accepted ("seems super obscure").
- The stock plate and every todo-view card with no `assigned` field show
  boxholder scope. `TodoViewSchema.assigned` keeps its exact-match meaning
  when set. `TodoParamsSchema` gains `scope: "boxholder" | "all"` (default
  `"boxholder"`), since "every assignment except agent" is not an exact
  match. `bbx query todos` passes `"all"` by default, so the agent's view does
  not change.
- `scope` must apply **before** reductions, or agent todos would vanish from
  rows but still count in headers: reductions run over all in-scope items
  (`src/core/collection/types.ts:83-84`, `run.ts:107-112`, `rows.ts:99-103`),
  and params reach only `matches` (`rows.ts:40-43`). `CollectionDef` gains
  an optional `inScope(item, params): boolean`, applied in `runCollection`
  right after derive and before any reduction or grouping. The todo
  collection implements it from `scope`. This is a change to the landed
  runner; it is recorded as a need for `collection-views` below.
- `count.ts` reads `reduction.onPlate` from the same boxholder-scope
  predicate. One predicate, `isBoxholderTodo`, is used by the reduction, the
  badge, and the list. `count.ts` keeps its fast path.
- The plate headline: "**15 on your plate** · 4 later · 3 for the agent",
  from the reduction. The first number is the badge's number, by
  construction. "For the agent" links to the list with `scope: "all"`,
  `assigned: "agent"`.
- The badge gains a dot when `reduction.escalated > 0`. The number and its
  meaning stay (boxholder: "Badge is fine").
- "Show finished" stays a server filter, now fast. The switch moves to the
  bottom as a text button, "4 done", that reveals them.

**Vocabulary lock-ins.** Param `scope`, values `boxholder | all`.

**First implementation chunk.** The `mayHaveItem` check in the scope pass,
batched reads, and a doctest: a box with 200 cards, 3 with todos, one
unparseable card without "todo", one unparseable card with "todo"; the
result has the 3 cards' items and exactly one issue.

### Track 2 — One rendering of a todo

**Status (2026-09-25): implemented** (Track 3 made the checkbox live).
One correction to the direction below: `Markdoc.transform` resolves the tree
first, and `resolve` clones every node, so a `Map<Node, TodoLocator>` passed
in the config cannot be looked up from the transform. `Markdown.tsx` instead
stamps each todo node with its locator under a module-private symbol
(`stampLocators`, `shared/todo-locators.ts`), which the clone carries; the
`todo` transform reads it with `stampedLocator`.

**What.** A todo looks and behaves the same in a card body, in frontmatter,
and in the list.

**Why.** Walkthrough figures A1, A4, A5: body todos get a pill; frontmatter
todos render as `text:`/`due:`/`status:` rows (`FrontmatterFields.tsx:80-83`);
the list uses a third rendering (`todo-view/ItemTree.tsx`). Overdue looks
like future. Finished agent bookkeeping sits in the reading flow (issue:
hide completed agent todos).

**Direction.**

- One component, `TodoItem`, in `src/frontend/src/components/todo/`, used by
  `TodoInline`, `TodoBlock`, the frontmatter renderer, and `ItemTree`.
  Leading control: a checkbox (Track 3 makes it live), replacing the `todo`
  pill. Dates: "due Sep 15" chips; an escalated todo's due chip uses the
  warning treatment and reads "overdue · Sep 15". Plate state comes from the
  server, because it depends on the box timezone
  (`todo-annotation.md`, "Plate-state time semantics") and the frontend has
  only the browser's (`FriendlyDate.tsx:2`). A card's body todos read it from
  the Track 4 per-card query, matched by locator; until that query returns,
  dates render without the overdue treatment.
- `FrontmatterFields.tsx` gains a second name case beside `ref`: a `todos`
  array renders as a list of `TodoItem`, with frontmatter locators
  `{ kind: "frontmatter", index }`.
- `makeTodoComponents({ cardPath })` receives the card path, as
  `makeSeeAlsoComponent` does.
- A rendered todo knows its locator from the collector's own algorithm, not
  a second one. `assignLocators` (`src/core/todo/extract-body.ts:289-299`)
  moves to `src/shared/todo-locators.ts`, unchanged; the collector imports it
  from there. `Markdown.tsx` runs it on the parsed AST before `transform` and
  passes the resulting `Map<Node, TodoLocator>` in the transform config. The
  `todo` schema's own `transform` (`src/shared/markdoc-config.ts:374-378`)
  looks its node up in that map and adds `locator` to the `Tag` it builds.
  Markdoc filters only declared attributes that come from source
  (`transformer.ts`), and a transform-built `Tag` is not filtered, so the
  locator is not a declared attribute and an author cannot write one by
  hand. One function numbers todos for both the write and the render, so
  they cannot disagree. It needs the card's frontmatter line offset. `card.get` returns only the split body today
  (`card.ts:196`, *`body: split.hasFrontmatter ? split.body : raw`*), so it
  gains `bodyLineOffset` from the same `splitCardContent` call.
- In a card's reading view, a todo with `assigned="agent"` and status `done`
  or `dropped` does not render. An open agent todo renders in the quiet
  (parked) text treatment with an "agent" chip.

**Vocabulary lock-ins.** Component `TodoItem`; module
`src/shared/todo-locators.ts`; the transform-only `locator` prop on
`TodoInline`/`TodoBlock`.

**First implementation chunk.** `TodoItem` with status, dates, and overdue,
used by `ItemTree` and `TodoInline`/`TodoBlock`, with a component doctest
over the four statuses and an escalated item.

### Track 3 — Tick and "+ to chat"

**Status (2026-09-25): implemented.** `todos.setStatus`
(`webapp/trpc/routers/todos.ts`), `TodoActionsContext` and its rules
(`components/todo/todo-actions.ts`), the provider
(`components/todo/TodoActionsProvider.tsx`), and the live checkbox and "+"
in `TodoItem`. Corrections and choices where the direction was silent:

- **The client's `text` comes from the collector's own flattening.** A body
  todo renders from React children, which carry no plain text to send.
  `flattenNodes` moved from `core/todo/extract-text.ts` to
  `shared/todo-text.ts` (with `TodoSeeAlso`), and the `todo` transform adds
  `text` beside `locator`, so the text a tick sends and the text the server
  checks come from one function, as the locators do.
- **One provider, in `FileView`, serves the list too.** Every action is
  addressed by card path, so the provider `FileView` renders around a card
  (beside `CardTodos`) also serves a todo-view card's lines; `TodoViewCard`
  needs none of its own. An embedded figure inherits its host's.
- **"+" needs a composer, ticking does not.** Where `FileView` has no
  `onAddSelection`, the provider gives `addToChat: null`: the checkbox is live
  and "+" is absent. No provider at all (Markdown outside a card view) means
  read-only and no "+".
- **"+" on parked and dropped todos**, whose checkbox stays disabled, and on
  agent todos, which are tickable (the plan did not restrict either).
- **Not gated on ownership in the UI.** A non-owner's tick is refused by
  `ownerProcedure` (`FORBIDDEN`) and reverts with that message inline.
- **Touch.** "+" is hidden until hover or focus-within only under
  `@media (hover: hover)`; without hover it is always shown. No precedent
  existed in `components/`.
- **A conflict also invalidates `card.get` and `collections.query`**, so
  "it has been reloaded" holds even when no `file-change` arrives. A commit
  warning is a toast.
- `position` for "+" is "todo at line N", "todo at line N (#2 on that
  line)", or "todo in frontmatter".

**What.** A checkbox that sets a todo `done` or back to `open`, and a "+"
that puts the todo into chat as a selection.

**Why.** Issue: tick controls. Copy promises ticking; nothing can.

**Direction.**

- Mutation `todos.setStatus` in a new `src/webapp/trpc/routers/todos.ts`,
  mounted as `todos` in `appRouter` (`src/webapp/trpc/router.ts:42-82`),
  `ownerProcedure`. Input:
  `{ path, locator: TodoLocator, text: string, expectedStatus: "open" | "done", status: "open" | "done" }`.
  Under `withCardLock`: read the card, extract its todos
  (`extractCardTodos`), find the todo at `locator`, and require its `text` to
  equal `text` and its current status to equal `expectedStatus`. A current
  status of `parked` or `dropped` always rejects. On mismatch, reject with
  `CONFLICT`, "This card
  changed since it was shown — it has been reloaded", and write nothing. The
  `file-change` subscription has already refreshed, or will.
- The edit itself is a pure function in `src/core/todo/set-status.ts`:
  `setTodoStatus(content, locator, status): string`. Body: a text-surgical
  edit of the opening tag on the locator's line (the `rewrite-card-refs.ts:220`
  approach): set `status="done"`, or remove the `status` attribute for
  `open` (absence means open). Frontmatter: `parseDocument`, set or delete
  `todos[index].status`, as `setTheme` does. Everything else in the file is
  unchanged byte for byte.
- Write with `writeFileAtomic`, commit with
  `stageAndCommitPaths(..., trailers: { "Source": "webapp", "Endpoint": "todos.setStatus" })`,
  message "Mark todo done: <text, truncated>". Commit failure returns
  `commitWarning` as `setTheme` does.
- Only `open ↔ done` from the checkbox. `parked` and `dropped` stay chat or
  hand edits. A parked or dropped todo's checkbox is shown disabled, with the
  status as its label.
- The checkbox is optimistic: it shows the new state at once and reverts on
  error with the error message inline.
- Both controls reach their actions through a `TodoActions` context, not
  props threaded through `Markdown`. `FileView` provides it from its
  existing `onAddSelection` (`FileView.tsx:174`) and the mutation;
  `TodoViewCard` provides it for the list. Where no provider exists (a
  surface with no chat composer, a published page), the "+" does not render
  and the checkbox is read-only.
- The "+" button sits beside each todo (visible on hover and focus, always
  visible on touch). It calls
  `addSelection({ ref: "/" + path, text, position: "todo at line N" }, { anchor: null, spokenWords: null })`.
  In the list, the same button uses the item's card path and locator.
- The authored "Tick them off" copy becomes true and stays.

**Vocabulary lock-ins.** Procedure `todos.setStatus`; function
`setTodoStatus`; commit trailer `Endpoint: todos.setStatus`.

**First implementation chunk.** `setTodoStatus` with doctests: inline tag,
block tag, two todos on one line (`nth`), a tag with other attributes kept in
order, frontmatter entry, and an untick that removes `status`.

### Track 4 — Per-place summary

**Status (2026-09-25): card line implemented** (`components/todo/CardTodos.tsx`);
the directory line is not started. In a box view "N open" is plain text for
now rather than a link to the card's list. The query uses `here` = the card
path (its default glob is that path, now glob-escaped in
`core/collection/here.ts`) rather than an explicit `glob`.

**What.** A one-line summary where todos live: at the top of a card, and on
a directory's browse page.

**Why.** Issue: todos as inline things, ask 1, "3 open things here".
Walkthrough A1 and A6.

**Direction.**

- **Card.** `FileView` renders, above any renderer (core or box view), the
  line "3 open · 1 overdue · 2 done" when the card has boxholder todos. Data:
  `collections.query` with `glob` = the card's own path and
  `includeReferring: false`, so the server reads one file. Clicking "3 open"
  scrolls to the first open todo in a core-rendered body; in a box view it
  opens the card's list (the todo-view of its directory, or `?view` — see
  open questions) in the opposite pane.
- **Directory.** The browse page for a directory shows the same line for
  `glob: <dir>/**`, `includeReferring: false`. It links to the directory's
  todo-view card if one exists, else to the plate filtered by `here`.
- Referring items (todos elsewhere that link here) are not in the summary.
  The reference pass reads the whole box (`run.ts:182`); the summary must be
  cheap. The list still shows them.

**First implementation chunk.** The card summary line in `FileView` with a
component doctest over zero todos (no line), all done, and overdue.

### Track 5 — List links open in the opposite pane

**What.** From the todo list, a card title and a dated-strip card name open
the card in the other pane.

**Why.** Boxholder request, 2026-09-24. Today `DatedStrip.tsx:24` navigates
with a `/browse/` href and `FileEntry` titles only expand a preview
(`FileEntry.tsx:230-237`).

**Direction.** `CardRow` passes `onPanel` to `FileEntry`, and `DatedStrip`
uses a button: both call `workspace.open(target, { destinationPane: oppositePane(pane) })`.
The pane comes from the context `WorkspaceCanvas` already establishes per
pane (`WorkspaceCanvas.tsx:59`); outside the workspace (mobile, full page)
the existing href behaviour stays. Each todo line's text also opens its card,
scrolled to the todo where the renderer supports it.

**First implementation chunk.** `onPanel` wiring in `CardRow` with a
browse-level check in the doctest of `WorkspaceCanvas` pane routing.

### Track 6 — `Markdown` for box views; hand-rolled Markdown is an error

**What.** Box views import the built-in renderer from `beebox/view-widgets`,
and the view check rejects a view that renders Markdown any other way.

**Why.** A box-local `event` view on a field box strips `{% todo %}` with a
regex and renders its own paragraphs, so the todo is invisible. On
2026-09-24, 9 of 28 box view files on 3 of 6 field boxes matched a rough
hand-rolled-Markdown pattern (structural count). The view guide teaches
this (`doc-examples.ts:24`).

**Direction.**

- Export `Markdown` from `beebox/view-widgets`:
  `Markdown: ComponentType<{ children: string; card: { path: string; bodyLineOffset: number } }>`.
  `card.path` resolves relative refs and gives todos their card path.
  Navigation comes from the view host (`host.openCard`, as `CardLink` uses),
  not a prop. Files: `src/frontend/src/components/view-widgets/index.tsx`,
  the shim in `src/webapp/views/compiler.ts:119-124`,
  `src/frontend/src/components/view-widgets/node-entry.tsx`,
  `src/exports/view-widgets.d.ts`, `src/types/view-widgets.d.ts`.
- `Markdown.tsx` stops calling `useParams` directly: the box slug comes from
  a small context that the app router provides and `NodeViewHostProvider`
  also provides. Then the same component renders in `bbx view test`.
- Todos inside a box view's `Markdown` are tickable (Track 3) once they have
  a card path and the body's line offset. `ViewCard` carries neither offset
  today (`src/core/views/cards.ts:132-152` builds `path`, `type`,
  `frontmatter`, `body`), so it gains `bodyLineOffset`, in both the live
  path and `bbx view test`. `Markdown` takes the offset with the card:
  `card: { path: string; bodyLineOffset: number }`.
- New `src/core/views/markdown-check.ts` beside `refs.ts`, a TypeScript AST
  check (the compiler API, not regexes), reporting an **error** when a view:
  imports `marked`, `remark`, `markdown-it`, `showdown`, `micromark`, or
  `react-markdown`; contains the Markdoc delimiter `{%` in a string or regex
  literal; or reads a card's `body` anywhere except as the children of
  `<Markdown>` or a truthiness test. The last rule catches the guide's own
  `<p>{card.body}</p>` (`src/core/views/doc-examples.ts:24`) and the
  split-and-render pattern. A view that needs part of a body (for example,
  up to a heading) asks for a `Markdown` option. Wired in
  `src/cli/commands/validate-hook.ts:156-162` and `src/core/sdk-hooks.ts:57-63`
  next to `lintViewFile`. The
  message: "Render card text with `Markdown` from `beebox/view-widgets`. If
  it lacks something this view needs, say so in `_config/feedback/`."
- The view guide (`doc.ts`, `doc-examples.ts`) shows
  `{card.body ? <Markdown card={card}>{card.body}</Markdown> : null}`
  (`ViewCard.body` is optional, `src/core/views/types.ts:91-99`; `card`
  carries `path` and `bodyLineOffset`) and states the rule.

**Vocabulary lock-ins.** Export name `Markdown`; props `children`, `card`.

**First implementation chunk.** Remove `useParams` from `Markdown.tsx`
behind a box-slug context, with the existing Markdown doctests passing.

### Track 7 — todo-review runs on its own schedule

**What.** The review sweep becomes a stock scheduled procedure. This track
fixes when it runs. It does not decide what it should raise on undated
boxes (finding 3), which stays open.

**Why.** Review findings (2026-09-24):

1. It runs only inside `bbx wakeup` (`wakeup-housekeeping.ts:55-68`), and
   `bbx wakeup` runs automatically only from connector schedules seeded
   disabled (`defaults.ts:294,305,316`). On a box without connectors the
   sweep never runs. One field box with no connectors has never produced a
   todo-review job.
2. The reactor that runs the queued job is also a wakeup step
   (`wakeup.ts:79-80`), so on such a box a queued job would not run either.
3. Its three sets depend on dates. The design notes record 145 of about 152
   open todos with neither `start` nor `due` on a working box
   (`collections-design-notes.md`, "Dates carry almost no signal"). `stale`
   needs `created` (`review-sweep.ts:60`), which humans rarely write. On such
   a box the sweep finds almost nothing.
4. Agent follow-ups ride along as an exception in its brief
   (`todo-review-job.ts:83-91`). An undated agent todo waits 45 days.

**Direction.**

- A stock procedure `todo-review.procedure.card` and a stock scheduled
  script `todo-review`, daily at 06:30, seeded enabled (boxholder,
  2026-09-24: "Yes turn on todo-review"), like
  `process-retrospective`: its precheck computes the sets
  (`bbx engine todo-review check`, the existing `computeSets` logic) and
  exits `CHECK_SKIP` when all are empty, so no agent runs.
- The run step is an agent with `max-turns: 20` and the existing job
  instructions. The "Your own items" section stays until the agent-todos
  design (NOT in scope) replaces it; otherwise agent follow-ups would lose
  their only pickup.
- The wakeup housekeeping call is removed. The `.beebox/todo-review-sweep.json`
  baseline stays.
- `stale` without `created`: use the date of the commit that last changed the
  todo's line? **Not in this plan** (see NOT in scope). The sets stay as they
  are; the review of what to raise on undated boxes is still the design
  notes' open question.

**Every reviewed todo gets a next-check date.** Boxholder, 2026-09-24: "if
a todo is ignored I feel like it should require the agent to say when it
should check again, not just on the next tick of the review", and chose a
todo attribute over a state file ("seems heavy. But it's more-right"). Today
an escalated todo would be listed on every daily run, and a stale one on
every run after 45 days.

- New todo attribute `recheck`: an ISO date, or `never`. Tag
  (`markdoc-config.ts:349-361`) and frontmatter entry, validated in
  `todo-model.ts` like `due`. It is the review's bookkeeping, not the
  boxholder's plan: it never changes plate state, badge, or list order.
- The sweep skips any todo whose `recheck` is `never` or after today,
  whichever set it would otherwise be in.
- Each job item must end with one of: a status change (the agent's own
  todos only, as now); or a `recheck` date 1 to 90 days out, with a short
  reason written after the todo's closing tag or raised with the boxholder.
  The agent may write `recheck` on the boxholder's todos; it is the one
  attribute it may change there without asking.
- **Enforced.** A `validate` shell in the procedure, `bbx engine todo-review
  verify <job>`, lists job items that are still open with no future
  `recheck`. `severity: review` re-invokes the agent with that list
  (`docs/procedure-implementation.md`, severity table); if it still fails,
  the step fails and the run card says which items.
- **Ignored todos stop being reviewed, and that is a health issue.**
  Boxholder: "If a todo is really hanging out and not well tagged, it should
  eventually be ignored entirely. And that should be logged as a health
  issue." After the **third** `recheck` on a todo whose text, status,
  `start`, and `due` have not changed (counted by the verify step from the
  todo's recheck history in `.beebox/todo-review-sweep.json`, keyed by path
  and text — an edit resets the count, which is right: an edit means someone
  is tending it), the verify step sets `recheck="never"` instead. A new box
  health check, `todos-unreviewed` (severity `warning`, in
  `runHealthChecks`, `src/webapp/trpc/routers/health.ts:152`), reports "N
  open todos are no longer reviewed" with the oldest few named. Removing
  `recheck`, or any edit to the todo, puts it back in review.
- The list shows `recheck` as a quiet chip ("agent checks again Oct 15";
  "no longer reviewed"); the reading view does not show it.

**Vocabulary lock-ins.** Attribute `recheck` (date or `never`); health check
`todos-unreviewed`; engine subcommands `todo-review check`, `todo-review
verify`.

**First implementation chunk.** `bbx engine todo-review check` with a
doctest over an empty box (exit `CHECK_SKIP`), a box with one escalated
todo, and a todo with a future `recheck` (skipped).

## Could this be simpler?

- **Simplest version:** fix the copy, filter the plate, label the toggle
  (about 60 lines). It fails the boxholder's 2026-09-24 decision that todos
  are tickable, and leaves todos invisible in box-view cards (Track 6) — the
  problem the boxholder hit first.
- **Track 3 without the text check** (locator only) is smaller. It fails on
  the case where the agent inserts a line above the todo between render and
  click: the tick edits the wrong todo. Per strict-by-default, the check
  stays.
- **Track 4 client-side** (count the todos in the rendered body) is smaller
  for core cards but fails for frontmatter todos and box views. The server
  query on one file is cheap after Track 1.
- **Track 7 left in wakeup** is zero code. It fails on every box without a
  connector, which is the common case.
- **Track 6 as a warning** is smaller in effect but not in code. The
  boxholder chose an error.

## Subplans

None. The agent-todos procedure, split out, gets its own plan.

## Failure modes

> **Critical gap (accepted):** a todo write races an agent edit in another
> process. `withCardLock` is in-process only (`src/lib/card-lock.ts:1-14`).
> If the agent writes the card between our read and our write, the agent's
> edit is lost. Accepted because the window is one read-modify-write
> (milliseconds), and the agent's own edit tool refuses to write a file that
> changed since it read it, so the reverse race fails loudly on the agent's
> side. Documented in `set-status.ts`.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Line above a todo changed between render and tick | Track 3 doctest | text check → `CONFLICT` | Clear: inline message, list reloads |
| Same todo's status changed elsewhere, text unchanged | Track 3 doctest | `expectedStatus` check → `CONFLICT` | Clear |
| Renderer and collector number a line's todos differently | Track 2 doctest | one shared `assignLocators` | n/a by construction |
| No `TodoActions` provider (no composer) | Track 3 doctest | controls not rendered | Clear: no dead button |
| Two todos on one line, tick the second | Track 3 doctest | `nth` in locator | Clear |
| Tick on a card whose frontmatter no longer parses | Track 3 doctest | reject, write nothing | Clear |
| Commit fails after the write | Track 3 doctest | `commitWarning` | Clear: toast |
| Scope prefilter skips a card that has a todo | Track 1 doctest | `mayHaveTodo` is sound (`extract.ts:32-44`) | n/a |
| Box view uses `{%` in a string for another reason | Track 6 doctest | error message names the rule | Clear; the boxholder chose strict |
| `Markdown` in `bbx view test` with no router | Track 6 doctest | box-slug context | Clear |
| todo-review precheck errors | Track 7 doctest | procedure records a failed run | Clear on the run card |
| Review agent leaves an item with no `recheck` | Track 7 doctest | verify step re-invokes, then fails the step | Clear: run card names the items |
| Todo retired to `recheck="never"` and forgotten | Track 7 doctest | `todos-unreviewed` health warning | Clear: health list |
| Todo reworded between rechecks | Track 7 doctest | count resets (intended) | Clear |
| Card summary query on a card with a load error | Track 4 doctest | no line rendered, issue logged | Silent in the header; the card itself shows its error |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** ADDRESSED: the agent guide already teaches
  `assigned="agent"`; the plate headline now shows agent todos separately,
  so a misassigned todo is visible as "for the agent".
- **Stale ref.** ADDRESSED: a tick with a stale locator fails the text check
  (Track 3).
- **Two agents touching the same card.** Accepted gap above: a tick and an
  agent edit in another process. Same window.
- **Hand-edit drift.** ADDRESSED: `setTodoStatus` edits only the `status`
  attribute and leaves all other text as written.
- **Fabricated free-form value.** Not changed: agent follow-ups close with a
  `see-also` to evidence (existing rule). "Completion requires an answer" is
  the queued issue.
- **Validation error UX.** ADDRESSED: the Track 6 error names the export to
  use and where to ask for more.
- **Partial migration / transition state.** Existing box views that hand-roll
  Markdown keep running; the error fires when an agent next edits the view.
  Field boxes are not migrated by this plan (NOT in scope).

## NOT in scope

- **Agent follow-ups worked by a scheduled procedure.** Split out after
  cross-model review (2026-09-24): an autonomous daily agent run needs its
  own adversarially reviewed design, per the boxholder's "super careful".
  The review found two defects in the in-plan sketch: the guard and the
  attempt bookkeeping did not compose with procedure failure semantics (a
  failing shell short-circuits later steps,
  `src/core/procedure/engine-run-phase.ts:97-128`), and `budget: "1/1d"` is
  not a valid budget (`src/schemas/scheduled-script-duration.ts:64-73`, both
  sides are durations). Filed as
  [agent-assigned todos have no pickup](../../../issues/features/2026-09-24-agent-assigned-todos-have-no-pickup.md)
  with the sketch.
- **The card companion panel** (inline-todos issue, ask 2). Its design is
  shared with the chat-panel landmark-context issue; not decided here.
- **Indexing.** Boxholder, 2026-09-24: leave it; it is a box-wide design.
- **Referring todos in the per-place summary.** Needs the reverse index.
- **`parked` and `dropped` from the UI.** Chat and hand edits cover them;
  the checkbox is `open ↔ done` only.
- **Completion requires an answer.** Queued as its own issue.
- **Near-duplicate todos.** Separate issue, needs design.
- **What todo-review should raise on undated boxes.** Open in the
  collection design notes; Track 7 only fixes when it runs.
- **Migrating existing box views on field boxes.** Real-box work; the
  boxholder decides per box. Offered separately.
- **Published pages.** They use a separate zero-JavaScript renderer
  (`src/publish/render-docs.ts:1-26`); box views do not render there. The
  boxholder called this "a hard one"; not decided here.
- **Removing `bbx todos`.** Separate issue; waits on field boxes.
- **Line-anchored deep links** into core-rendered bodies beyond "scroll to
  the first open todo".

## Open design questions

- **Needs for the collection design** (for `collection-views`, recorded here,
  not decided): (1) a collection's scope pass may skip cards by the
  collection's `mayHaveItem` (Track 1 does this); (1b) an `inScope` hook
  that filters items before reductions, distinct from display filters
  (Track 1 adds it); (2) a boxholder-scope
  default that is not an exact-match filter; (3) a cheap per-card and
  per-directory reduction for summaries. Lean: these fit the five-stage
  model as they are.
- **Where "3 open" leads from a box-view card.** Lean: the directory's
  todo-view card if one exists, else the plate filtered to that card.
- **The three-recheck limit and the 90-day cap** (Track 7). Lean: keep
  them as constants; tune after a month on a field box.

## Knowledge audits

- `todo-recheck`: in a todo-review job, the agent ends every item with a
  status change or a `recheck` date, and may set `recheck` on the
  boxholder's todos but nothing else (`knows_directly`).
- `view-markdown-export`: a box agent writing a view that shows card text
  uses `Markdown` from `beebox/view-widgets` (`knows_directly`).
- Both land RUN against test1 with the status comment recorded.
- Track 3 adds no agent-facing concept. Track 7 moves the sweep; the
  existing todo audits are re-run.

## What will hold this after it ships

- `setTodoStatus`, `assignLocators`, the scope prefilter, and the markdown
  check are pure functions; doctests reach them directly.
- `todos.setStatus` gets a tRPC doctest in the style of the `card.setTheme`
  doctest.
- `TodoItem`, the summary line, and the headline get component doctests.
- The browser walkthrough (the exhibit for this workstream) is re-run at
  finish; it is evidence, not a regression anchor.

## Implementation order

1. Track 1 (prefilter, scope param, count on one predicate). Unblocks 4.
2. Track 3's `setTodoStatus` (pure).
3. Track 4's per-card query and summary line. Track 2 reads plate state
   from it.
4. Track 2 (`TodoItem`, frontmatter, locator attributes, `bodyLineOffset`).
5. Track 3's mutation, checkbox, and "+".
6. Track 1's headline and dot; Track 5; Track 4's directory line.
7. Track 6 (box-slug context, export, check, guide).
8. Track 7.
9. Rewrite the verify-rendering issue's `## Manual testing`; re-run the
    walkthrough; cross-model review of the branch.

Each step is one or more commits. The plan ships in one piece when the
boxholder says so.

## Rollout shape

- Done when: the doctests named in each track's first chunk and in the
  failure-mode table pass; typecheck and eslint are clean; the knowledge
  audit is run and recorded; the walkthrough shows ticking, "+", the
  summaries, the headline, and a box-view card with a visible todo.
- No data migration. Existing todo-view cards with no `assigned` field change
  meaning to boxholder scope; that is the intended change.
- New stock scheduled scripts reach existing boxes through the template
  tracker (`config/template-versions.json`); `todo-review`'s enabled default
  follows the boxholder's decision in Track 7.
