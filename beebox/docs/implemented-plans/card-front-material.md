---
title: "Card fronts take the card's ink; the theme audit flags app ink in cards"
status: implemented
workstream: card-ink-dark-themes
issues:
  - ../../../issues/closed/bugs/2026-10-24-status-and-error-text-ignore-card-material.md
---
# Card fronts take the card's ink; the theme audit flags app ink in cards

On a dark card theme, a question beside the chat showed dark text on a muddy
patch, and loading, error and caption lines in card views kept app colours.
This plan makes text on a card's front follow the card's material, gives the
question patch a dark-paper colour, and extends `bin/theme-check` so the
studio catches app ink in a card on any theme, light or dark.

**Issues addressed:** `issues/bugs/2026-10-24-status-and-error-text-ignore-card-material.md`.
Searched the queue for "material", "card ink", "dark card", "caption": no
other open item covers this.

## Design

No design section: this restores the decided look (card text in the card's
ink) on themes where it broke. The patch's dark-paper colour is a theme
styling choice shown in the exhibit.

## Smallest fix and budget

Smallest fix for the report: wrap the question patch in `MaterialContext`
and key its colour on `color-scheme` (about 30 lines). That alone leaves the
same bug in every other card view that uses `Text`, `StatusMessage`,
`ErrorText` or a field on the card's front.

Chosen scope, about 450 changed source and test lines:
- Track A, question patch (~60 lines).
- Track B, card front provides the material; status, error, inline action
  and table caption follow it; app panels reset it (~120 lines).
- Track C, audit: studio specimens, app-ink check, shared-sheet rule
  coverage (~250 lines).

## Stated preferences this plan trades against

- Chat materials already provide `MaterialContext` at their roots
  (`docs/implemented-plans/theme-studio.md:266`: *"Chat materials provide
  `MaterialContext` true at their roots"*). Card fronts follow that precedent.
- Root `AGENTS.md`: no lint weakening or audit exemptions to pass. The
  shared-sheet coverage leaves nine existing sheets out by name
  (`SHARED_NOT_YET_COVERED`); this narrows a new check, not an old one, and
  the list is filed as an issue.

## What already exists

- `components/ui/material.ts`: `MaterialContext`, `useMaterial`. Reused.
- `CardThemeSurface.tsx`: the back already provides the material
  (*"The back of the card is its own paper: everything on it sits on the
  material."*). The front now does the same.
- `--bbx-danger` / `text-card-danger` (`themes/materials.css:55`): each theme
  sets a red at least 5:1 on its paper. `ErrorText` uses it on a material,
  which settles the issue's error-red tension without a new decision.
- `test/tours/tour-lib/contrast-page.ts`: text runs, materials, surface
  check. Extended with `appInk`.
- `test/tours/tour-lib/rules.ts`: rule coverage. Extended with `shared`.

## Prior art (external)

No decision depends on an external premise. `light-dark()` follows the used
`color-scheme`, supported by the browser floor (Chrome 123, Safari 17.5).

## Ontology

No new nouns. "App panel" names an existing thing: an element inside a card
that paints its own app-palette background (non-material `Card`, `Notice`,
`Popover`, a `bg-white` row); it keeps app ink.

## Tracks / scope

### Track A — question patch
- `QuestionPatch` (QuestionBeside/view.tsx) wraps both forms and provides
  `MaterialContext`; `AnsweredQuestion` is extracted from
  `QuestionCardView` so the studio renders it.
- `--bbx-question-patch` uses `light-dark()`: the tan mix on light paper; on
  a `color-scheme: dark` card, paper mixed 18% toward `--bbx-pen`.
- The stub rule outranks a theme's surface `background-image` (Deck's weave
  was sized to the stub's 1px edge layers).

### Track B — card front material
- `CardThemeSurface` front provides `MaterialContext`.
- `StatusMessage`, `ErrorText`, `InlineAction` default to the nearest
  material; `InlineAction` gains a material `danger`.
- `Table` caption and data column headers take `text-card-soft` on a material.
- App panels reset the context: `Notice`, `Popover`, `PdfFrame`,
  `TabArrangementView` rows, `CardRef`, `HistoryFilterBar`,
  `PdfStatusNotice` lines. `QuestionForm`'s sticky row paints card paper.
- `success-dark` darkens to 5:1 on `success-100` (the studio's badge failed).

### Track C — audit
- Studio: a question card (pending and answered), and on the reading card a
  loading line, an error with three inline actions, a captioned table.
- `appInk`: text in a themed card whose colour comes from an app palette
  utility and is not one of the card's inks, unless an app panel lies
  between. Reported as a miss on every theme.
- Rule coverage includes rules naming no theme in theme sheets, minus
  `SHARED_NOT_YET_COVERED`.

## Could this be simpler?

Track A alone fixes the report. B is needed because the same primitives on
any card front fail the same way (the studio's checkbox label already failed
on Gilt, Deck and Phosphor before this work). C is the boxholder's ask.

## Subplans

None.

## Failure modes

- A card renderer paints its own light panel without `Card` and is missed by
  the survey: its text turns to card ink, light on light under a dark theme.
  The survey (sonnet, 42 renderers) found the sites listed in Track B; the
  studio's audit cannot see renderers it does not render.
- `light-dark()` follows `color-scheme`. A dark stock that does not declare
  `color-scheme: dark` gets the tan patch; its text is card ink, so it stays
  readable, and the contrast audit measures it.

## Agent-flow / user-flow edge cases

- Question beside the chat on a phone: the notch points below; the studio
  shows it at phone width.
- A question card opened as a page (not beside): `QuestionForm`'s sticky row
  paints the card's paper.

## NOT in scope

- Chat materials (already done).
- Rule coverage for the nine sheets in `SHARED_NOT_YET_COVERED` (filed).
- Badge tones other than success that fail AA on their own fills (filed).
- A static (lint) check for app ink in card renderers.

## Open design questions

None open: the error red uses each theme's `--bbx-danger`.

## Knowledge audits

None: no agent guidance changes.

## What will hold this after it ships

`bin/theme-check --all`: specimens for the patch, status, error, inline
actions and captions; the app-ink check; shared-sheet coverage.
`test/tours/contrast.test.ts` and `test/tours/rules.test.ts` cover the scoring.

## Implementation order

1. Track A with its studio specimen (landable alone).
2. Track B.
3. Track C checks; `--all` clean.

## Rollout shape

Frontend only; ships with the next deploy. No migration.
