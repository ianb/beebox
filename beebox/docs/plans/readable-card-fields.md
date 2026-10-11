---
title: "Readable card fields"
status: draft
workstream: place-shows-cards
issues: []
---
# Readable card fields

A card's type fields render through a generic renderer that shows raw data:
"location: text: With Idris". This plan makes that renderer readable wherever
it draws fields, and exports its row and value pieces so custom views can use
them. The verbatim data stays one click away in the card's Source view.

**Issues addressed:** none filed. The problem was seen in the
[place-shows-cards](../implemented-plans/place-shows-cards.md) exhibit, after
that plan moved an empty-body card's fields onto its front. Queue searches
run (`bin/issues search`): "field labels raw", "frontmatter fields readable",
"nested object fields card", "card front fields". No match.

## Decisions from the boxholder (2026-10-11)

- *"I think the generic renderer should be readable, yes. We can still make
  custom views, but we can make the generic one better along the way, and
  maybe make components to support those generic renderers too."*
- Readable everywhere the generic renderer runs, with Source as the raw view:
  the planner's revised lean after plan review (finding 1, below). Not yet
  confirmed.

## Design

### Situations

- When Priya opens the odds-and-ends tray item, I want to read "Location
  Workroom shelf" and "Quantity 3", so I can find it without decoding field
  names.
- When a record names a person, I want the person's name as a link, with
  their role beside it, so I can open their card.
- When the agent or the person checks exactly what a card stores, they want
  the keys and shapes as written. The Source view keeps them. (The quiet
  case.)

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Priya, tray item | Show | Card front: readable fields | Waits to be found |
| Linked person | Show | Card front: name as link, role in parentheses | Waits to be found |
| Checking the data | Quiet | Source view: the file text, unchanged | Waits to be found |

### Spirit

- **Serves:** "It should feel like a place": a card reads as a thing, not a
  file.
- **Risks:** "You should be able to see the gears": readable labels hide the
  exact keys. Guard: the Source view (`renderers/builtins.tsx:46`, "Raw source
  view for frontmatter cards") shows the file verbatim on every frontmatter
  card.

### Trust

Shows only, takes no action.

### When it goes wrong or does nothing

- **A shape the rules do not know:** it shows as nested rows with readable
  labels. Nothing is dropped.
- **A label that reads badly when humanized** (an abbreviation): the person
  sees "Ssn" for `ssn`. A custom view or a better field name fixes it; this
  plan adds no label registry.
- **Dates:** shown as written. A date string is often evidence kept verbatim
  (`image/schema.tsx:67`, a document date "as printed"), so this pass does not
  reformat strings.

### Walkthrough

Tomas opens "Camp stove" from the Lending place on the desktop layout.

1. The card front shows the heading "Camp stove" and the summary line "With
   Idris · 1 stove".
2. Below it: "Location  With Idris" and "Quantity  1 stove". There is no
   "Name" row, because the heading shows the same value.
3. He opens the Source view. It shows the YAML with `name`, `location.text`,
   and `quantity.value`.

## Smallest fix and budget

**Smallest fix:** humanize labels in `FieldRow` (about 10 lines). It removes
"location:" but leaves the nested "text:" rows, the worst part.

**Chosen design:** the rules as pure functions in one module, the renderer's
row and value made readable and exported. About 120 source lines and 150 test
lines.

## Stated preferences this plan trades against

- **Minimize invented concepts; prefer primitives** (boxholder memory). The
  readable form comes from key names and value shapes. Schemas gain no label
  or format declarations.
- **Two tiers of anything is a smell** (same memory). One readable rendering
  serves the front and Properties; the raw view is the existing Source view,
  not a second field renderer.

## What already exists

- `MarkdownCardView/FrontmatterFields.tsx:56-90` `ValueView`: URL, scalar,
  list, ref, nested-record rendering. Keep its URL, list, and ref branches.
- `FrontmatterFields.tsx:133-149` `FieldRow`: `<dt>{name}:</dt>`, the raw label;
  the `todos` branch renders todos. Keep the todos branch.
- Callers: the front (`MarkdownCardView/view.tsx`, `PersonView/view.tsx:163`)
  and Properties (`CardProperties.tsx:72`). All three get the readable form.
- `themes/card-themes.css:435-440`: `.bbx-card-fields`, `.bbx-card-field-label`
  carry theme colors. Kept on the same elements.
- `ThemedFileCard/view.tsx:40` `cardTitle` (moved to `lib/card-title.ts` in
  implementation, to avoid an import cycle through `PropertiesFace`): the header's title (`title:`, a
  landmark's label, `name:`, or the filename). Reuse to decide which row
  repeats the header.
- Record entry shapes (`src/schemas/record.tsx:23-41`): `PersonEntry`
  `{ name, ref, role, notes, note }`, `LocationEntry` `{ text, ref }`,
  `MeasureEntry` `{ value, note }`.
- A shape where `ref` is evidence, not identity: a guide observation
  `{ text, ref? }` (`src/schemas/guide/schema.tsx:61`). The compact rule must
  not turn its text into a link.
- `PersonView/view.tsx:95-102` `ContactRow`: a flex-row label and value. Its
  layout differs from the grid rows; left as is.

## Prior art (external)

No design decision depends on an external premise.

## Ontology

- **Readable value**: how a field's value shows in the generic renderer,
  derived from its shape. Display only; nothing on disk.
- Module `lib/readable-fields.ts` (pure rules). Exported components from
  `FrontmatterFields.tsx`: `FieldsTable` (exists, now exported) and
  `FieldValue` (today's `ValueView`, readable, exported).

## Tracks / scope

### Track A — Readable rules (pure)

- **What.** `lib/readable-fields.ts`: `fieldLabel` and `compactValue`.
- **Why.** The decisions are the risky part; as pure functions doctests reach
  them directly.
- **Direction.**
  - `fieldLabel(key)`: split on `-` and `_`, sentence case. `back-by` → "Back
    by".
  - `compactValue(value: Record<string, unknown>)` returns
    `{ text: string; ref?: string; aside?: string } | null`:
    - an identity shape: string `name` (or `label`, or `title`), optional
      string `ref` (a link), optional `role`, `note`, `notes` (the aside, in
      that order). `{ name: "Idris", ref, role: "lender" }` → linked "Idris"
      with aside "lender".
    - a plain value shape: string `text` or `value`, optional `note`/`notes`,
      and no `ref`. `{ value: "1 stove", note: "missing lid" }` → "1 stove"
      with aside "missing lid"; `{ text: "With Idris" }` → "With Idris".
    - anything else returns `null` and shows as nested rows: a `ref` beside
      `text` (a guide observation, a located record) keeps its own row; an
      extra key (`{ value, unit }`) keeps its row.
- **Vocabulary lock-ins.** `fieldLabel`, `compactValue`.
- **First implementation chunk.** The module and its doctest, with the cases
  above plus `{ text, ref }` → `null`.

### Track B — Renderer

- **What.** `FrontmatterFields` renders readable labels and values, and drops
  the row that repeats the header.
- **Direction.**
  - `FieldRow`: label `fieldLabel(name)` with no colon, same classes.
  - `ValueView` → `FieldValue`: a compact object renders as its text (a
    `RefLink` when it has `ref`) with the aside in parentheses, muted; other
    branches unchanged except nested records use readable labels.
  - `FrontmatterFields` gains `headerTitle?: string`. A root row whose key is
    `name` and whose value equals `headerTitle` is skipped. The front callers
    pass `cardTitle(data)`; Properties passes it too. Only a value match drops
    the row, so a landmark headed by its label keeps a different `name` row.
  - `FieldsTable` and `FieldValue` are named components in the module, kept
    unexported until a custom view uses them: an unused export fails the knip
    sweep, and `FieldsTable` needs the navigation context `FrontmatterFields`
    provides, so the first custom view that needs it decides the export shape.
- **Vocabulary lock-ins.** `FieldValue`, prop `headerTitle`.
- **First implementation chunk.** The renderer change and doctests: a record
  front shows "Location", "With Idris", no "text" label, no "Name" row; a card
  whose `name` differs from its header keeps the row; a guide-style
  `{ text, ref }` shows two rows; todos render as before.

## Could this be simpler?

- **Labels only:** fixes "location:" but not the nested "text:" row the
  exhibit showed.
- **Raw in Properties, readable on the front:** a second rendering. Plan
  review showed it guards nothing for an empty-body card, whose fields go to
  the front and not to Properties (`card-field-faces.ts:95`,
  `CardProperties.tsx:38`). The Source view already shows the file as
  written.
- **Separate component set and a `PersonView` swap:** the boxholder said
  "maybe"; exporting the two pieces covers it until a custom view needs more.
  `ContactRow`'s flex layout would not survive a grid row.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `compactValue` hides a key (`{ value, unit }`) | Doctest: extra key → `null`, nested rows | Unknown keys fall back to rows | Clear |
| A `ref` that is evidence swallows its text | Doctest: `{ text, ref }` → `null` | Links only on identity shapes | Clear |
| The `name` row is dropped while the header shows something else | Doctest: `name` differs from header → row kept | Drop only on value equality | Clear |
| A theme relied on the trailing colon | Exhibit with two card themes | Classes unchanged | Clear on screen |

## Agent-flow / user-flow edge cases

- **Wrong field, fabricated value, validation UX, migration:** not
  applicable; display only.
- **Hand-edit drift.** `location: workroom` as a plain string. ADDRESSED: a
  scalar shows as itself.
- **Stale ref.** ADDRESSED: `RefLink` is unchanged.

## NOT in scope

- Friendly date formatting: date strings are often verbatim evidence; needs
  per-field meaning.
- Schema-declared labels or formats: a new concept.
- Custom views for record or loan, and a `PersonView` row swap.
- Field order: stays storage order.

## Open design questions

None open for implementation. The aside shows its value only ("1 stove
(missing lid)").

## Knowledge audits

None: no agent-facing concept changes.

## What will hold this after it ships

Doctests on `lib/readable-fields.ts` and on the rendered fields in the
existing `MarkdownCardView`, `CardProperties`, and `PersonView` doctests. No
new test tier.

## Implementation order

1. Track A: the module and its doctest.
2. Track B: renderer, `headerTitle`, exports, doctests; update doctests that
   asserted "name:" style labels.
3. Exhibit: before/after of the camp stove card.

## Rollout shape

Done when those doctests pass with the change-selected suite, typecheck,
lint, and layout check, and the exhibit shows the readable card. No
migration.

## Plan review

codex gpt-6-sol, 2026-10-11, round 1: six findings, all verified and taken.
(1) Properties does not hold an empty-body card's fields, so "raw Properties"
was no guard; the Source view is the raw view. (2) Components were scoped as
required; cut to two exports. (3) `ref` beside `text` can be evidence; links
only on identity shapes. (4) Date reformatting can alter verbatim evidence;
dropped. (5) `bodyHeadingField` can differ from the header; drop by value
match against `cardTitle`. (6) `ContactRow` layout differs; left alone.
