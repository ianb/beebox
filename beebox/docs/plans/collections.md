---
title: "Collections — queries over cards, with todos as the worked example"
status: draft
workstream: collection-views
issues:
  - ../../../issues/features/2026-08-19-collection-views-are-badly-defined.md
---
# Collections — queries over cards, with todos as the worked example

**These are design notes from a discussion in progress. This is not yet a
plan.** No implementation is authorized. Items marked **OPEN** wait for the
boxholder. Items marked **DECIDED** record a boxholder statement and its date.

Background is in the issue: the code survey (2026-09-19), the parked
[query-cards plan](../unimplemented-plans/query-cards.md), the
[TiddlyWiki review](../../../research/tiddlywiki/README.md), and the
[use-case survey](../../../research/collection-use-cases-2026-09-19.md).

## What this is for

The boxholder's statements, 2026-09-19 and 2026-09-20:

- The usual reason to look at a set is **"what is going on here?"**. What is
  shown is specific to that question. **The search defines the display more
  often than the card type does.**
- Stable searches are valuable. The monorepo issue queue is the example: a few
  named searches over a small closed set of fields.
- Tasks are a likely search, scoped in different ways.
- The size of things is useful: how many books, to know where things stand.
- A group needs a meaning. A directory has a meaning, and it is not the only
  lens.
- This covers cases that boxes cover poorly today.
- A todo system is essential to most work and is tied to the specific work in
  the box. Building it with these techniques is a valid test of them.

The survey agrees on one point. The worklist is the collection that people
build most and keep longest. Progress and counts appear as attachments to other
views and not as views of their own.

## Model

A collection is a pipeline of five stages. The stage boundaries are the design.

1. **Scope** — a glob plus card types, relative to a *here*. Declarative, so
   that an index can answer it later.
2. **Extract** — `(card) → Item[]`. Optional. Pure. It reads one card and
   nothing else: no clock, no other cards. This makes it cacheable by content
   hash.
3. **Derive** — `(item, {now, here, since}) → item`. All dependence on time,
   place, and the last run goes here, so that it never invalidates stage 2.
4. **Filter and group** — typed parameters; groups with a key, a label, an
   order, and a rule.
5. **Consume** — a renderer. React on the client. Text, JSON, or a job brief on
   the server.

Stages 1 to 4 run on the server and return data. The client receives data only.

```ts
type Row<Item> = { card: CardSummary; items: Item[] };
type Result<Item> = { rows: Row<Item>[]; issues: Issue[] };
```

- **DECIDED (2026-09-20): the row is the card.** The result is
  `[{card, items}]`, not `[{item, card}]`. Extracted items hang off their card.
  The list renders the card as a header with the standard card summary, and the
  items under it.
- Item types are plain TypeScript types that the extractor declares. They do
  not need a card schema.
- Grouping applies to items. Rows are formed again inside each group, so one
  card can appear in two groups with different items.
- `issues` is a second channel. A card that matched and could not contribute is
  reported, never dropped. The todo collector already does this.
- **DECIDED (2026-09-20): a reduction is general.** A count is one reduction.
  The input and output shapes of a reduction are ad hoc, so reductions are
  code.

### Three levels of effort

1. **Standard render.** A scope, with each card shown through a standard
   per-type summary. No code. This makes simple queries very cheap
   (boxholder, 2026-09-20).
2. **Typed code.** The collection declares the card types it accepts and
   handles them in typed TypeScript. Cards outside that set still appear,
   through the standard summary. Every card has the standard properties
   (`title`, `contains`, `symbol`, `prominence`).
3. No middle level of stored query configuration is proposed. That level is the
   design parked on 2026-07-03. **OPEN:** confirm it stays out.

**A standard summary per type** is a prerequisite: one method on the schema
that gives a text form and a React form, with `title` plus `contains` as the
default. Three hand-written partial versions exist today: `foldFields`
(`src/core/search/extract.ts:219`), `buildBrowseCard`
(`src/webapp/trpc/routers/status.ts:130`), and the landmark link tile.

**An agent-side preview** supports level 2: given a scope, report the matching
types with counts, field coverage per type, sample paths, and load failures.
The agent writes the typed code against that report. This is agent tooling. It
is not a user surface.

## Worked example: todos

The shipped todo system is this pipeline written by hand, with one code path
per consumer (`src/core/todo/`).

| Stage | Todos |
|---|---|
| Scope | any card type; a glob, default the subtree of *here* |
| Extract | `{% todo %}` body tags and frontmatter `todos:`, each with a locator |
| Derive | `plateState` from `status`, `start`, `due`, and `now` |
| Filter | `status`, `assigned`, on-plate |
| Group | plate states, in a fixed order with fixed labels |

Consumers, in the order the boxholder ranked them:

- **The list.** Todos under their cards, cards as headers. Today's list has
  plate-state groups and no card headers. **OPEN:** whether the card is the
  right header, and which groups are wanted, wait for the boxholder's review of
  todos in a working box.
- **The review sweep** (`review-sweep.ts`). A scheduled query with three named
  groups: escalated, stale, and stirring. Stirring is a delta group: items that
  crossed `start` since the last run. It needs a stored baseline for each
  consumer, which is the `since` input of stage 3. The sweep does nothing when
  every group is empty. Otherwise it renders a text brief into a job card. The
  general form is "run a collection on a schedule; when it is not empty, brief
  the agent". The question-aging sweep is a second hand-written instance.
  **OPEN:** what the sweep should raise, from the same review.
- **`bbx todos`.** Generalize it to a query command over any collection, with
  the collection's own typed parameters, a text form (card summary, then one
  line per item), and `--json` giving `Result`.
- **The ambient prompt line.** A reduction to one string.

### What a working box shows (2026-09-20)

Structural facts from one box with real work in it, after an agent review of
its todos. Counts and card types only.

- 2,556 cards. 234 body todos, in 18 cards. 15 more cards carry frontmatter
  todos.
- **Body todos concentrate in todo documents.** Ten `doc` cards hold 216 of the
  234. Most topic directories have one; one general document holds 57. Every
  body todo is a list item.
- **Headings inside those documents group the todos.** In eight of the ten
  documents, todos sit under headings (3 to 34 headings per document). The
  boxholder's groups exist already, as Markdown structure that the collector
  discards.
- **Frontmatter todos sit on entity cards**: 8 `probate-doc`, 4 `person`,
  2 `bill`, 1 `audio`. This is the "this thing needs something" capture.
- **Dates carry almost no signal.** 145 of about 152 open todos have neither
  `start` nor `due`. Under the shipped rule they are all "on the plate", so the
  plate-state grouping puts nearly everything in one group. `assigned` appears
  4 times.
- 82 todos have a status: 76 done, 5 dropped, 1 parked.

Consequences for the model:

- The card-as-header decision fits. The card is a curated list for one area of
  work, and its directory is the area.
- Extract must keep the item's **section path** (the headings above it). It is
  pure per-card data, so stage 2 allows it. It gives a second level of
  meaningful groups at no authoring cost.
- Plate state is the wrong default grouping for this box. Area (directory),
  then card, then section is the grouping that the content already has.
- The sweep's three sets depend on dates that are absent. **OPEN:** what the
  agent should raise when nothing is dated.

A reading of the todo text (kept out of this repository) adds these. The
boxholder's caution applies: most of this content came from one agent sweep, so
it shows how an agent arranges todos, not how they accumulate. One document is
different: a list that people wrote elsewhere and imported. It is an outline:
headings by asset or person, short noun phrases, nested items.

- **An item's context is its position.** Meaning comes from the heading path,
  from the parent list item (todos nest: a goal with steps), and from the text
  after the closing tag (a note, often with links to related cards). The
  collector keeps none of these. All are pure per-card data, so extract can
  carry them: `sectionPath`, `parent`, `annotation`, `refs`.
- **The result inside a card is a tree**: card, section, item, child item. The
  flat `items[]` stays, with `sectionPath` and `parent` on each item so that a
  renderer can build the tree again.
- **Attributes live in structure and prose, not in tag attributes.** A heading
  that is a person's name assigns its items. "Waiting on", "Decide", and open
  questions are kinds of item that only the wording marks. A filter on
  `assigned` finds almost none of this.
- **One todo has several kinds.** Actions, topics to think about, open
  questions (when done, the text holds the answer), waits with a check-back
  date, decisions, and documents to find. Dates appear only on waits and legal
  deadlines, where they are real.
- **A lens that is not a directory is wanted, and it is a join by reference.**
  One asset has todos in its own directory, in sections named for it in other
  documents, and in items whose notes link to its cards. "What is going on with
  this asset" needs all three. This changes the join question above: extract
  stays per-card and emits each item's `refs`; the **scope** stage may then
  include items that refer into *here*. A reference index can serve that later.
- **The same task appears in several documents**, because several areas care
  about it. A box-wide list shows it several times. Identity across cards is
  agent judgment, not something a query can derive.
- **Done items are a record.** They hold answers and dates. A reduction per
  card and per section (open, done, next date) is what the card header should
  show. A card where every item is done is finished, and the reduction can say
  so.

## Deferred, and kept in view

- **Embedding in Markdown.** The boxholder wants `![]()` to embed a collection
  in some form, with explanation and controls around the items. Not designed
  yet. The model must not block it: a card body that places a collection gives
  it an address, a *here*, and a label.
- **Indexing and speed.** Not designed yet. The stage rules above (declarative
  scope, pure per-card extract, time only in derive) are what keep it possible.
  The nav badge needs this work and is not a priority.
- **Write-back** (check a todo off in place). A neighbouring design. Items keep
  their locator so that it stays possible.
- **Joins.** Extract cannot read a second card. **OPEN:** whether a wanted
  query needs one.
- **Where collections appear without authoring.** A type histogram on the
  directory page, with each type linking to a standard-render list, was
  proposed and not discussed.
- **What a plugin contributes.** Under this model: collections (typed code),
  and standard summaries for its card types.
