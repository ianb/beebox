---
title: "Card fronts show the content; Properties shows the card"
status: draft
workstream: card-reading-properties
issues:
  - ../../../issues/bugs/2026-09-21-document-metadata-displaces-the-reading-view.md
  - ../../../issues/features/2026-09-27-card-properties-design-session.md
---
# Card fronts show the content; Properties shows the card

When I open a card to read it, I want the first screen to be what the card
says, so I can read my friends page, my course, or my errands without
scrolling past labels written for the machine. When I turn a card over to
Properties, I want to learn about the card as a thing in the box: where it
is filed, how it is found, what it carries, what changed, what points at it.

**Issues addressed:** the two listed in the frontmatter. Related and left
open: [course study home](../../../issues/features/2026-09-21-course-study-home-last-next-uncertain.md)
(a learner-facing view for the course family; this plan does not build it).
Searched the queue for "frontmatter", "properties", "backlink", "attach
scope", "repeated title", "H1": no other item covers this surface.

## Smallest fix and budget

Smallest fix: extend `INTERNAL_READING_FIELDS` in
`beebox/src/frontend/src/components/MarkdownCardView/view.tsx:80` with
`prominence` and `symbol`, and drop the H1 from the doc template. That
removes the fields journeys C and F saw. It leaves the course, memo, and
person fronts as they are, and leaves Properties as it is.

Chosen design, five tracks in one subproject (`beebox/`):

| Track | Source + test lines (adds plus deletes) |
|---|---|
| A. Front/back split by field kind | ~320 |
| B. Person front | ~110 |
| C. No repeated title | ~90 |
| D. Properties: attachments and last change | ~150 |
| E. Properties: order, appearance row, view chooser | ~80 |
| Docs (card-themes.md, cards/schemas.md, skill) | ~40, reported separately |

About 750 changed lines. Not a BIG CHANGE. The fuller design buys one rule
every card type follows (principle 8) instead of a growing deny-list, and a
Properties panel that answers the questions the boxholder brings to it
(design session issue).

## Stated preferences this plan trades against

- **Principle 8, one way to do each thing.** The deny-list in
  `view.tsx:80` and the Properties-side allow-list in
  `CardProperties.tsx:22-28` are two hand-synced copies of one decision. The
  plan replaces both with one pure function.
- **Principle 4, never silent.** A card whose schema is unknown or whose
  validation failed has no field classification. The plan shows its fields on
  the front rather than hiding them (Track A direction).
- **Minimize invented concepts (boxholder, memory).** The boxholder chose the
  rule "common fields each handled on purpose; type fields in Properties" over
  a per-field schema classification. No new schema option, no new vocabulary.
- **Scope anchored to the incident (boxholder, memory).** Landmark's front and
  the course family's reader view are out of scope; they are named below.
- **Bias toward strict.** The repeated-H1 rule is enforced three ways:
  template, lint warning, and renderer suppression for existing cards.

## What already exists

- `readingFrontmatter()` at `view.tsx:80-85`: *"const INTERNAL_READING_FIELDS
  = new Set(["contains", "contains-evidence"])"*. Replaced by Track A.
- `cardSummaryRows()` at `CardProperties.tsx:22-28` and `CardFacts` at
  `:12-20` (Filed at, Card type, Contains, Prominence). Reused and extended.
- `FrontmatterFields` (`MarkdownCardView/FrontmatterFields.tsx`): the
  key/value table, with `todos` rendered as todo items at `:136-145`. Reused
  on both faces.
- `FrontmatterCardResponse` at
  `beebox/src/webapp/trpc/routers/card.ts:23-37`; `loadFrontmatterCard`
  already knows `parsed.schema.bodyFieldName` (`:48-55`). Extended with one
  field (Track A).
- `CardSchema.bodyFieldName: string | null` at
  `beebox/src/cards/schema.ts:356`.
- `CardThemeSurface` (`ThemedFileCard/CardThemeSurface.tsx:60-110`) renders
  the header `<h2>{title}</h2>` and the back `section`. Extended with a
  symbol mark.
- `CardMark` (`components/ui/CardMark.tsx`): *"The one component that draws a
  card's symbol."* Reused in the header.
- `ThemeSwatchPicker` (`ThemedFileCard/ThemeSwatchPicker.tsx:17-18`): the
  swatch grid under an "Appearance" h3. Wrapped, not rewritten.
- `ViewChooser` at `ThemedFileCard/view.tsx:56-83`. Moved, not rewritten.
- `CardMentions` at `CardProperties.tsx:31-70`: mounted only while open,
  refetches on `file-change`. The pattern Track D copies for attachments and
  last change.
- `trpc.status.browse` (`routers/status.ts:239`) lists a directory;
  `useDirectoryListing` (`frontend/src/directory-listing.tsx:30`) wraps it.
  Reused for the attach scope.
- `trpc.history.list` (`routers/history.ts:89`) with `filter.path`, backed by
  `getLogPaginated` (`lib/git/core/log.ts:158`), which follows renames
  (`:49-50`) and sorts by `date`. Reused with `count: 1`.
- Recipe renderer registration (`renderers/recipe.tsx:11-14`): the precedent
  for a type renderer at priority 100. Copied for person.
- `lintOne` in `core/card-lint/core/lint-cards.ts:189-196` collects body
  warnings. The H1 warning joins it.
- `createDocTemplate` (`schemas/doc.tsx:86-95`) and the doc instructions'
  example (`:49-57`) which shows `# Trip Report` under `title: Trip Report`.
- Doctest precedents: `frontend/test/components/MarkdownCardView.markdown-card-view.doctest.md`
  (renderToStaticMarkup of `FrontmatterFields`) and
  `.../ThemedFileCard/CardProperties.contains-fields.doctest.md`.

## Prior art (external)

No decision depends on an external premise. The mechanisms are React
rendering, a tRPC field, and a lint rule, all in-repo patterns.

## Ontology

- **Card front** (exists: `bbx-card-front`, `CardThemeSurface.tsx:101`): the
  reading face. Shows title, todos, body, and, for a bodiless type, the fields.
- **Properties** (exists: `bbx-card-back`, `:104`): the card as an object.
  Shows filed-at, type, found-by, type fields, attachments, last change,
  mentions, appearance, views, actions.
- **Common field** (exists: `GLOBAL_CARD_FIELDS`, `cards/schema.ts:102-110`):
  one of `title`, `contains`, `contains-evidence`, `todos`, `symbol`,
  `prominence`, `theme`. Each has one named place.
- **Type field**: any frontmatter key that is not a common field. Shown in
  Properties, or on the front when the type has no body field.
- **Bodiless type**: a schema with `bodyFieldName === null`
  (`cards/schema.ts:356`). 25 built-in schemas, e.g. landmark, question,
  todo-view, gdoc. Many have their own renderer already. Lesson-plan and
  progress are NOT bodiless (`schemas/lesson-plan.ts:42`,
  `schemas/progress.ts:47`): their segments and entries move to Properties
  and their fronts show the body.
- **Attach scope** (exists, `docs/cards/format.md`): `<basename>.attach/`.
- **Last change**: the newest commit touching the card's path, following
  renames (`log.ts:49-50`).
- **Mentions** (exists: `CardMentions`): cards whose refs point at this one.

No new nouns.

## Tracks / scope

### Track A. Front/back split by field kind

**What.** One pure function decides which frontmatter keys render on the
front and which in Properties. The generic card front shows title, todos,
and body. Properties shows the common fields in named rows and the type
fields in the shared table.

**Why.** `view.tsx:80-85` hides two keys; everything else (`prominence`,
`symbol`, memo `status`/`created`, course `audience`/`goals`, person `name`)
renders first. Journeys C, D, F read these as bookkeeping. Properties
duplicates two of them by a second list (`CardProperties.tsx:22-28`).

**Direction.**

- `card.get` returns `schema: { hasBodyField: boolean; defaultProminence:
  EffectiveLevel } | null` on `FrontmatterCardResponse` (`card.ts:23`), from
  `parsed.schema.bodyFieldName` and `parsed.schema.defaultProminence`; `null`
  when the card did not parse against a schema (the `validationError`
  branch). `FileData` (`file-type-registry.ts:24-39`) carries it. One carrier
  for both facts the faces need; `effectiveLevel` (`shared/prominence.ts:40`)
  needs the type default.
- New `src/frontend/src/lib/card-field-faces.ts`:

  ```ts
  export const COMMON_FIELDS = ["title", "contains", "contains-evidence", "todos", "symbol", "prominence", "theme"] as const;
  export function splitCardFields(
    frontmatter: Record<string, unknown>,
    opts: { hasBodyField: boolean | null; mode: RendererProps["mode"] },
  ): { front: Record<string, unknown>; properties: Record<string, unknown> }
  ```

  Rules, in order: `title` goes to neither (header), except in embed mode as
  today (`view.tsx:83`). `todos` goes to front. `theme` goes to neither
  (Appearance row). `contains`, `contains-evidence`, `symbol`, `prominence`
  go to Properties named rows. Every other key goes to Properties when
  `hasBodyField === true`, otherwise to front. In embed mode every other key
  goes to front: an embedded card has no Properties face (`FileView/view.tsx:268`
  returns the renderer without `ThemedFileCard`), and hiding the fields there
  would lose them. Person `name` stays a type field like any other; Track B
  owns the person front, so the duplicate title is not seen.
- `MarkdownCardView` renders `front` through `FrontmatterFields` where it
  renders `readingFrontmatter` today (`view.tsx:98`). `readingFrontmatter`
  is deleted.
- `CardFacts` renders Filed at, Card type, then Found by: `contains`,
  `prominence` (the declared level, or "<level>, the type's default" via
  `effectiveLevel`), `symbol` (a `CardMark` plus its source),
  `contains-evidence` collapsed under a disclosure, then `properties` through
  `FrontmatterFields`. `FrontmatterFields` requires `onNavigate` and
  `basePath` (`FrontmatterFields.tsx:163`); `CardFacts` gains both props,
  threaded from `ThemedFileCard`, which already has `onNavigate`
  (`view.tsx:29`). `cardSummaryRows` is deleted.
- `CardThemeSurface` takes `symbol?: CardSymbolData` and draws a `CardMark`
  before the h2.

**Vocabulary lock-ins.** `schema` on the card response. `COMMON_FIELDS`
mirrors `GLOBAL_CARD_FIELDS` keys; a doctest asserts the two sets are equal
so a new global field fails a test until it is placed.

**First implementation chunk.** `schema` in `card.ts` and `FileData`;
`card-field-faces.ts` with its doctest; `MarkdownCardView` and `CardFacts`
switched to it; the two old lists deleted; the existing
`CardProperties.contains-fields` doctest rewritten against the new function.

### Track B. Person front

**What.** A `PersonView` renderer (priority 100, `selector: { type:
"person" }`) showing role, then contact rows (email, phone, address as
`mailto:`/`tel:`/text), aliases, an "archived" note when set, then the body.

**Why.** Track A moves `role`, `email`, `phone`, `address` to Properties. For
a person those are the content (person schema `schemas/person.tsx:19-29`).
The boxholder agreed person gets its own front.

**Direction.** `components/PersonView/view.tsx` plus
`renderers/person.tsx` after `recipe.tsx:11-14`. The body renders through the
same `Markdown` component as `MarkdownCardView` (`view.tsx:103-111`). No
frontmatter table on the front; Properties still lists the fields through
Track A. `boxholder: true` renders as a "Boxholder" badge next to the role.

**Vocabulary lock-ins.** None; renderer name "Person".

**First implementation chunk.** The whole track: component, registration,
and a doctest rendering a person with and without contacts.

### Track C. No repeated title

**What.** Doc cards stop carrying `# <title>` as their first body line.

**Why.** The doc instructions' example (`schemas/doc.tsx:49-57`) shows the H1
under `title:`; agents copy it, and every journey saw the title twice.

**Direction.**

- Instructions: replace the example body with prose and add one sentence:
  the title is shown from `title:`; do not repeat it as a heading.
  `createDocTemplate` already writes no H1 (`:86-95`); unchanged.
- Lint: in `lintOne` (`lint-cards.ts:189-196`), when the body's first
  non-blank line is an ATX H1 whose text equals `title` after trimming and
  case-folding, push a `warning` with type `"body"`: *"body repeats the title
  as a heading; the title is shown from `title:`"*. Applies to every schema
  with a body field, not only doc.
- Renderer: `MarkdownCardView` drops that same leading H1 before rendering,
  using one shared predicate `leadingTitleHeading(body, title)` in
  `src/shared/` so lint and renderer agree. Existing cards read right without
  a migration.

**Vocabulary lock-ins.** A new `"body"` member in the `LintIssue.type`
union (`cards/lint-format.ts:21-29`); the existing members are parse,
validation, reference, id, schema, contains, canonical, absolute-path,
display-path, none of which names a body-content check.

**First implementation chunk.** The shared predicate with a doctest; lint
warning with a doctest; renderer suppression; instructions text.

### Track D. Properties: attachments and last change

**What.** Two new sections, mounted only while Properties is open, after the
`CardMentions` pattern.

**Why.** The design issue asks what Properties should show that it does not:
attachments and history. Today the attach scope is invisible from the card,
and history is a menu item.

**Direction.**

- `CardAttachments`: `useDirectoryListing(attachScopeOf(data.path))`. Lists
  entries as links through `onNavigate`, with a count in the h3. An absent
  directory shows "No attachments": `status.browse` returns an empty
  listing on ENOENT (`status.ts:283-288`), so empty `cards`, `files`, and
  `dirs` is that state. A query error shows the message and a Retry, as
  mentions do (`CardProperties.tsx:50-53`).
- `CardLastChange`: `trpc.history.list` with `{ filter: { path }, count: 1
  }`. Shows "Changed <relative date>: <subject>", linking to the History
  card the way `CardActions` does (`CardActions.tsx:95`). `GitLogEntryExtended`
  (`lib/git/core/log.ts:36-43`) carries `hash`, `date`, `subject`, no author;
  the line shows no author rather than extending the git format. No commits:
  "Not committed yet". Refetch on `file-change` as mentions do.

**Vocabulary lock-ins.** None.

**First implementation chunk.** Both components with doctests over their
pure parts (`attachScopeOf`, the last-change line formatter) and the
sections wired into `CardFacts` order.

### Track E. Properties: order, appearance row, view chooser

**What.** Properties reads, top to bottom: Filed at, Card type; Found by;
type fields; Attachments; Changed; Mentioned by; Appearance; View; actions.
Appearance is one row, "<Theme> <stock> · <chosen by>", with a Change
button that expands `ThemeSwatchPicker`. The three Theme/Stock/Chosen-by
rows at `ThemedFileCard/view.tsx:107-111` go. `ViewChooser` moves to the
bottom, above actions.

**Why.** The swatch wall (A6) pushes mentions, views, and actions below the
fold. The boxholder: the view chooser is rarely used and is not front and
forward; appearance collapse "okay, I'd want to see it".

**Direction.** A `disclosure` pattern already used for `contains-evidence`
in Track A; the expanded state is local component state, closed on each
open. `LandmarkSystemThemePicker` (`view.tsx:45-47`) sits inside the same
Appearance disclosure for landmarks.

**Vocabulary lock-ins.** None.

**First implementation chunk.** The whole track; a before/after exhibit
with ask `confirm` so the boxholder can veto the collapse.

## Could this be simpler?

Simplest: add `prominence` and `symbol` to the deny-list and drop the H1
from the doc instructions. Two lines. It fails on the memo (`status`,
`created` still first), the course (goals and five paths still first), and
the person (`name` twice), which journeys D and F reported, and it keeps two
lists that must agree (principle 8). Track A is the smallest change that
fixes those with one rule. Tracks B, D, E are the design-session issue's
asks; each is dropped independently if the boxholder prefers.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A new global field is added without a place in `splitCardFields` | planned doctest (set equality) | fails test | clear |
| A card fails schema validation; `schema` is null | planned doctest | fields shown on front | clear |
| A card is embedded in a body or chat message; no Properties face | planned doctest (embed mode) | fields shown on front | clear |
| A bodiless type with its own renderer never calls `splitCardFields` | n/a | renderer owns its front | clear |
| Attach scope missing | planned doctest for `attachScopeOf`; browser check | empty listing on ENOENT (`status.ts:283-288`) renders "No attachments" | clear |
| `status.browse` refuses a display-form path | existing guard `status.ts:241` | error shown with Retry | clear |
| Card not yet committed; `history.list` returns none | browser check | "Not committed yet" | clear |
| Card renamed; history without `--follow` misses older commits | existing: `log.ts:49-50` follows | n/a | clear |
| Body H1 equals title but has trailing punctuation or emphasis | planned doctest | predicate matches trimmed plain text only; otherwise shown | clear, visible |
| Embed mode: a card embedded in another shows its title twice | existing behaviour `view.tsx:83` kept | n/a | clear |
| Publication renderer passes `hideEmptyBody` and expects the old filter | planned doctest | uses the new function | clear |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: ADDRESSED. A key the schema does not declare is
  stripped at parse (`cards/schema.ts:557`) and lint warns
  (`lint-cards.ts:387`); the UI never saw it and still does not. A declared
  field with prose in it shows in Properties.
- Stale ref: ADDRESSED. Attachments list links through `onNavigate`, which
  already handles a missing target; mentions unchanged.
- Two agents touching the same card: not affected; read-only surfaces.
- Hand-edit drift: ADDRESSED. A hand-written `# Title` that differs from
  `title:` is shown, and lint stays quiet; only an exact repeat is dropped.
- Fabricated free-form value: not affected.
- Validation error UX: ADDRESSED. The H1 warning names the field that shows
  the title.
- Partial migration / transition state: ADDRESSED. No data changes. An
  older client against a newer server ignores `schema`; a newer client
  against an older server reads `undefined` and treats it as `null` (fields
  on front).

## NOT in scope

- Landmark front: a bodiless type, so its fields stay on the front by the
  fallback rule. A purpose-built front was "not clear" to the boxholder.
- Course family reader views (course, lesson-plan, progress): the
  [study home issue](../../../issues/features/2026-09-21-course-study-home-last-next-uncertain.md).
  Under this plan their fronts show the body only (course prose, the
  progress summary, the lesson plan's body) and the tables sit in
  Properties, which is nearer to what journey D's learner asked for.
- Ref display with the target's title instead of its path: boxholder was
  unsure; left as is.
- A migration stripping existing `# Title` lines: the renderer and lint
  cover it; revisit if lint noise is high.
- Editing fields from Properties: not asked.
- Moving the view chooser into card chrome: rejected by the boxholder.
- Per-field schema classification (`filed:` list): replaced by the common
  versus type rule; revisit only if a type needs a front field without its
  own renderer.

## Open design questions

- The H1 lint warning fires on every existing doc that repeats its title.
  Measure the count on the test1 clone during Track C and report it; if it
  is in the hundreds, the boxholder chooses between keeping the warning, a
  one-shot migration stripping the H1, or restricting the warning to doc.
  Lean: keep the warning and offer the migration.

## Knowledge audits

One `knows_directly` entry: an agent asked to create a doc card writes
`title:` and does not open the body with the same heading. Run on the
isolated test1 clone before done; record the status comment.

## What will hold this after it ships

- Frontend doctests (renderToStaticMarkup tier, precedent above) for
  `splitCardFields`, `leadingTitleHeading`, `attachScopeOf`, the last-change
  line, `PersonView`, and the set-equality guard.
- Core doctest for the lint warning.
- Browser verification through `bin/browse` at 1280 and 390 widths for doc,
  memo, person, course, lesson-plan, landmark, image, recipe, each face; one
  exhibit.
- Re-walk of the affected journey actions (C actions 6, 19, 38; D
  screenshots 08-13, 22; F 09, 16) by opening the same cards in a prepared
  box, not a full journey.

## Implementation order

1. Track A (unblocks everything; Properties gains the type fields).
2. Track C (independent; small).
3. Track B (depends on A so Properties still lists person fields).
4. Track D, then Track E (both edit `ThemedFileCard/view.tsx`; serialized).
5. Docs: `docs/box/card-themes.md:12-13`, `docs/cards/schemas.md:79`, the
   bbx-guide-schemas skill line 23: state the common-field places and the
   type-field rule.

Each track is one or two commits in this worktree. Cross-model review of the
final diff before finish.

## Rollout shape

Done when: the doctests above pass; typecheck and eslint clean; the browser
exhibit shows each card front without type fields and Properties in the new
order; the appearance-collapse exhibit is confirmed; the knowledge audit is
run. No data migration.
