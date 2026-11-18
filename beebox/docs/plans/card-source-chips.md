---
title: "Sources line at the top of a card's front"
status: draft
workstream: card-source-chips
issues: []
---
# Sources line at the top of a card's front

A card's `sources:` list (what the card was made from: a scanned PDF, a
photo, a web page, another card) shows on the card's front only when the
card has no body. A record with a body hides its scanned document on the
Properties face. This plan adds a one-line Sources section at the top of the
card's front, with each source as a link, that expands to the full list with
notes.

**Issues addressed:** none. Searched `issues/` for "source file", "source
chip", and "sources:.*front". The only hit near this subject is the closed
`issues/closed/bugs/2026-10-22-source-chip-shows-chat-file-name-and-usage-keyword.md`,
which is about the in-body `{% source %}` citation chip, a different surface.

## Design

### Situations

- When Nadia opens the record card for her house's deed to check a lot
  number, I want the scanned deed in view at the top of the card, so she can
  open the scan without knowing it is listed under Properties.
- When Eli reads a doc card the box wrote from a voice memo and a web
  article, I want both sources named above the text, so he can check the
  original when the summary reads wrong.
- When a card has no `sources:`, nothing new appears.
- When Nadia only wants the text, the section is one line and does not push
  the body far down.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Card with sources, opened as a card | Show | Card header, under the title, one line | Waits to be found |
| Webpage or recipe card | Quiet (no new section) | Their views already draw their sources at the top | none |
| Card with no sources | Quiet | none | none |
| Card embedded in chat | Quiet (no new section) | The embed's field block lists `sources` as now | none |

The top is where a reader looks first for what a card is about and where it
came from; one line keeps the cost small.

### Spirit

- **Serves:** "see the gears": what the card was made from is visible on the
  card, not one face away.
- **Risks:** "feel like a place": chrome on every card front. Guard: it
  appears only when `sources:` has entries; it is one line; the chips use the
  card's own material colours (`Badge material`), so a themed card stays in
  its theme.

### Trust

Shows only, takes no action.

### When it goes wrong or does nothing

- A ref names a file or card that was moved or deleted: the chip still
  shows, and tapping it opens the file view's not-found state, the same as
  the existing `RefLink` on Properties and the in-body citation chip
  (`components/Markdown/Source.tsx`, "Stale-ref behaviour"). The validator
  already reports broken refs.
- A ref escapes the box (`refToViewTarget` returns null): the chip shows as
  plain text, not a link.
- A malformed `sources` value (not a list; an entry with no `ref`, `href`, or
  `label`): that entry makes no chip. A recipe-style entry with only a
  `label` shows as plain text.

### Collapsed and expanded

Collapsed (the default): the word "Sources", then one chip per entry, on one
line. Chips that do not fit wrap onto a clipped second line, so a chip shows
whole or not at all; a chip wider than the line truncates, with the full text
as its tooltip. The toggle names the total ("All 5") when there is more than
one entry, so a narrow card that fits only some chips still says how many
there are. With one entry, the toggle reads "Details" and appears only when
the entry has a `note` or `pos` or a name over 24 characters.

Expanded: one row per entry, in order: the chip, then its `pos` and `note`
in the card's soft ink. The toggle reads "Less".

A chip's text: the entry's `label`; else for a chat card "chat, Oct 22"
(`chatRefLabel`); else for another ref `refLabel` (the basename, for a card
without its type suffix); else for an `href` that parses as an http(s) URL its host name, else the
raw `href` as text with no link. Its
tooltip is the `note`, else the ref or URL. A marker before the text names
the kind, guessed from the path (a display convention, not a lookup): a
document icon for a file, "→" for a card, "↗" for a web page (the last two
as the in-body citation chip uses them). A file or card chip
opens in the app (`onNavigate`); a web chip opens a new tab.

### Walkthrough

1. Nadia opens `/_content/home-papers/Property_Deed.record.card`. Its
   `sources:` has five entries: the deed PDF (with a note), a photo of the
   back (with a label), a survey photo in the card's attach folder (with a
   `pos`), the water bill's record card, and the county recorder's web page.
   The card has a body.
2. Under the title, the card reads: "Sources [📄 property-deed-scan.pdf]
   [📄 Back of the deed (photo)] … All 5"; the chips that fit the width show.
3. She taps the PDF chip; the PDF opens in the app. Back returns to the card.
4. She taps "All 5"; five rows show, the first with "Scanned county copy of
   the deed".
5. Properties lists `sources` in its field table, as it does today for a
   card with a body.

## Smallest fix and budget

Smallest fix: one pure function and one component, rendered once in the
card header (`ThemedFileCard` → `CardThemeSurface`); `MarkdownCardView`
drops its own `sources` row outside embeds; `CardFacts` always lists
`sources`. Estimate: about 150 source lines, 120 test lines; 1
what's-new line; no generated output.

## Stated preferences this plan trades against

- The developer (handoff): "The source stays listed on the back too."
  Later in this session: the section is at the top, lists every source (not
  only files), and starts as a one-line summary that expands.
- plan:place-shows-cards Track B: a bodied type keeps its type fields on
  Properties; a bodiless type or empty body keeps them on the front
  (`card-field-faces.ts:5-12`). `splitCardFields` is not changed. Where it
  puts `sources` on the front, `MarkdownCardView` leaves that row out
  outside an embed (the header section shows it) and `CardFacts` adds it to
  Properties.
- Reuse a primitive: chips are `Badge` (`components/ui/Badge.tsx:34`) with
  `material`; labels and targets come from `lib/ref-label.ts`.

## What already exists

- `splitCardFields` (`lib/card-field-faces.ts:95`):
  `const typeFieldFace: Face = embed || hasBodyField !== true || bodyEmpty ? "front" : "properties";`.
  Callers: `MarkdownCardView/view.tsx:45`, `PersonView/view.tsx:154`,
  `CardProperties.tsx:45` (searched `splitCardFields(` in
  `src/frontend/src`). Person has no `sources` field
  (`schemas/person.tsx`, searched "sources": no hit).
- `CardFacts` (`CardProperties.tsx:44-50`) lists `split.properties`; it
  will also list `sources` when the split put it on the front.
- `ThemedFileCard` (`components/themes/ThemedFileCard/view/ThemedFileCard.tsx`)
  wraps every renderer's output for a non-embed card in `CardThemeSurface`,
  whose `<header className="bbx-card-heading">` draws the title and detail
  (`CardThemeSurface.tsx:113-119`). The section goes in that header, through
  a new `sources` prop. Embeds do not pass through `ThemedFileCard`
  (`mode: Exclude<FileViewMode, "embed">`).
- `MarkdownCardView` (`MarkdownCardView/view.tsx:53`) draws, outside an embed,
  the fields block then `CardBody`. Its fields block drops `sources`.
- `PdfCardView` (`components/PdfCardView/view.tsx:192`) draws
  `DocumentHeader` then the body; it does not render `splitCardFields`'
  front. The pdf schema has `sources` ("one `href` entry with `retrieved`",
  `schemas/pdf.ts:67-68`). Its Text and Original views both pass through
  `ThemedFileCard`, so the header covers both.
- `WebpageView` (`components/WebpageView.tsx:66`) draws the page URL and
  capture time from its one `sources` entry (`capturedPage`, line 86).
- `lib/ref-label.ts`: `refLabel`, `chatRefLabel`. Labels and the kind use
  `parseRef(ref).path` (`shared/ref-path/core.ts:100`).
- `resolveContentTarget` (`lib/view-url.ts:162`) turns the whole ref into a
  `ViewTarget`, keeping `?view=`, params, and `#fragment`; null when it
  escapes the root. Navigation uses it.
- `Badge` with `material` (`components/ui/Badge.tsx:28`):
  `"bg-card-tint text-card-soft"`.
- Recipe (`plugins/recipe/view.tsx:55`) already draws its own "Source:" line
  at the top. Not changed.

## Prior art (external)

No design decision depends on an external premise.

## Ontology

- **Source entry**: one item of `sources:` (`SourcesEntrySchema`,
  `src/cards/sources-entry.ts`). Existing.
- **Source chip**: the front's link for one source entry, of kind `file`,
  `card`, `web`, or `text` (label only, or an unresolvable ref). Kind
  `card` means the ref's path ends in `.card`; `file` is any other ref.
- **Sources section**: the front's row of source chips, collapsed or
  expanded. `data-card-section="sources"`.

## Tracks / scope

One track.

- **What:** `sourceChips(sources: unknown, basePath: string)` in a new
  `lib/source-chips.ts` returns
  `Array<{ kind: "file" | "card" | "web" | "text"; text: string; title: string; target: ViewTarget | null; href: string | null; pos: string | null; note: string | null }>`.
  `cardShowsSourcesSection(type)` is false for `webpage` and `recipe`.
  `SourcesSection` (`components/themes/ThemedFileCard/view/SourcesSection.tsx`)
  renders it; `ThemedFileCard` passes it to `CardThemeSurface` as
  `sources`, drawn last in the header. `MarkdownCardView` drops `sources`
  from its front fields outside embeds; `CardFacts` adds it.
- **Why:** the main file behind a record is not visible on the face a person
  reads.
- **Direction:** as in Design. No deduplication: two entries for the same
  file at different `pos` are two chips.
- **Vocabulary lock-ins:** `data-card-section="sources"`.
- **Depends on:** the facts under What already exists, each read in this
  session.
- **First implementation chunk:** `sourceChips` and its tests. No open
  questions.

## Could this be simpler?

Simplest: render the existing `FrontmatterFields` with `{ sources }` at the
top. It shows every entry as a numbered list of label + note on every load,
several lines tall for three sources, with no one-line form. The developer
asked for a one-line summary that expands. The chosen version adds one
function and one component.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `sources` not a list; entry with nothing to show | new unit test | entry skipped | silent by design; validator reports schema errors |
| ref escapes the box root | new unit test | `text` chip | clear: text, no link |
| ref with `?query` or `#fragment` | new unit test | `parseRef` path part | n/a |
| ref names a missing file | none | file view not-found state | clear |
| `sources` shown twice on the front, or missing from Properties, for an empty-body card | view test | `MarkdownCardView` filter; `CardFacts` addition | n/a |
| malformed `href` (`not a url`) | new unit test | text chip, neighbours unaffected | clear |

## Agent-flow / user-flow edge cases

Scenario walk: the Design walkthrough. The way out: Back from the file
returns to the card; removing an entry from `sources:` removes its chip on
the next render.

- Wrong field: a file put under `persons:` or in body text makes no chip.
  ADDRESSED (developer scope: only `sources:`).
- Stale ref: ADDRESSED (Failure modes).
- Two agents on one card; validation UX; partial migration; stored state:
  render-only, nothing stored. ADDRESSED.
- Hand-edit drift: a ref without a leading `/` resolves relative to the
  card, as everywhere else. ADDRESSED.

## NOT in scope

- Recipe and webpage views: both already draw their sources at their top;
  the header section would repeat them. Recipe's line shows in-box refs as
  plain text; filed as an issue.
- Embed mode: the embed's field block already lists `sources`.
- A target-title lookup for card chips: one request per chip; `refLabel`
  is what the in-body citation chip uses.
- Refs in other fields (`persons`, `dates`): developer decision.

## Open design questions

none

## Knowledge audits

None: no agent-facing concept. Agents already write `sources:`.

## What will hold this after it ships

`test/lib/source-chips.test.ts` for `sourceChips` (kinds, labels, query and
fragment kept in the target, escape, malformed ref and href). `test/components/MarkdownCardView.markdown-card-view.test.ts`
for no `sources` row on an empty-body card's front outside embeds, and
the row inside an embed. A static render of `SourcesSection` for the
chip kinds and the toggle rule.
Browser check: click the PDF chip, a card-relative `attach/` ref chip, and
a card chip; confirm each opens; go Back; open Properties and confirm
`sources` is listed, on a bodied and an empty-body record; open the full list;
check a narrow pane.

## Implementation order

1. `sourceChips` + tests.
2. `SourcesSection`, the header slot, the `MarkdownCardView` filter, the
   `CardFacts` addition, + tests.
3. Browser check on the worktree test box; exhibit; what's-new line.

## Rollout shape

Done when the three test files pass and the browser check above passes. No
migration; no knowledge audits.
