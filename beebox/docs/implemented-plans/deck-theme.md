---
title: Deck system and card theme
status: implemented
workstream: theme-polish
issues: []
---
# Deck system and card theme

Promote the approved rounded charcoal and turquoise studio study into an optional
system and card theme. Preserve aqua messages, offset teal shadows and large
printed background panels.

**Issues addressed:** None. Searched the theme issue cluster; box-authored themes,
fixture infrastructure and strikethrough readability are separate scopes.

## Design

### Situations

- When opening everyday notes, I want the selected material to carry through
  navigation, chat and cards, so the box feels like my place.
- When reading long replies at night, I want clear light text on quiet dark
  surfaces, so the decoration does not obscure content.
- When keeping a card on pale paper, I want its explicit choice to stay intact.

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| Choose Deck | Show | Existing system/card pickers | Waits to be found |
| Read and chat | Show | Toolbar, workspace, cards, composer | Background |
| Keep another theme | Quiet | Existing saved choices | No change |

### Spirit

Serves “It should feel like a place” and “It should be playful, even about mundane
things.” Risks obscuring the gears through low contrast: preserve readable text,
focus, status colors and existing controls.

### Trust

Explicit setting selection only. No automatic selection or new agent behavior.

### When it goes wrong or does nothing

Existing validation exposes invalid choices. Use default or another theme reverses
selection. Existing settings remain until the person chooses Deck.

### Walkthrough

Choose Deck in Settings. Existing presentation mutation validates the catalog and
saves box chrome. The provider applies chrome attributes; unthemed cards resolve
to Deck. Reload preserves selection. Explicit Paper cards remain Paper. Card
Properties can independently choose Deck on a different system theme.

## Smallest fix and budget

One catalog entry, one scoped stylesheet and original SVG, one app import,
focused resolver/router test updates, one existing-pattern tour and documentation.
Estimate 350–500 source/test changed lines plus 20–30 documentation lines. No new
rendering engine, schema or migration. Studio follow-up is a separate checkpoint.

## Stated preferences this plan trades against

Human: “I like A3, go with that.” A3 is Deck desktop in the three-study exhibit.
Preserve that look; translate its sample controls onto actual controls. The theme
must be flat, textured and expressive. No named artist recreation.

## What already exists

Paths below are relative to beebox.

- `src/shared/card-theme/catalog.ts:1`: `export const THEME_CATALOG = [`;
  reuse picker and validation source, with one new entry.
- `src/shared/card-theme/core.ts:17`: `export function validateSystemThemeChoice`;
  reuse system validation, no new persistence path.
- `src/frontend/src/pages/dev/ThemeStudioPage.tsx:3`:
  `import "./theme-studio-studies.css";`; approved study is isolated here.
- `src/frontend/src/themes/bloom.css:21`: the existing one-layer artwork
  pattern uses `.bbx-box-presentation[data-chrome-theme="bloom"]:not(.bbx-system-theme-preview)`.
  Reuse the single layer structure so nested desks reveal it; preserve the study’s cover sizing and phone-specific size/position.
- `src/frontend/src/themes/materials.css:5`: `.bbx-card-theme {`;
  override full dark material including sheet, quote layer and code tokens.
- `test/tours/ribbon-theme.tour.ts:6`: the `ribbon-theme` tour selects, reloads,
  checks inherited/explicit cards and restores the previous choice. Adapt it.

## Prior art (external)

No external dependency or premise. Original geometric SVG and approved study;
no external source is adopted.

## Ontology

Existing theme choice gains name `deck`, stock `panels`. Chrome and card material
share that name. Paired card themes: deck, paper, post-it, defaulting to deck.
No new persisted fields or nouns.

## Tracks / scope

1. Register Deck and import production CSS/SVG; supply full card, chat, nav,
   composer, tab, swatch and print treatments. Keep dark surfaces opaque. Preserve
   danger/recording/disabled states; no behavioral changes. Rename the studio-only
   Deck draft to `deck-study` first, preserving the original comparison independently from production Deck.
Define paper, ink, ink-soft, pen, edge, underlay, sheet, tint, code-paper,
   code-ink, quote papers and all selection pairs. Set dark color-scheme on Deck
   card and composer surfaces only, leaving unrelated light cards/menus alone.
2. Update resolver/catalog expectations, theme reference, and focused real-app
   tour. Assert explicit Paper heading computed color as well as its theme attribute.
   Use existing synthetic fixtures; no real model calls or personal content.

## Could this be simpler?

Shipping just the background would not deliver the approved aqua messages and
rounded dark cards. Existing material tokens and scoped rules deliver those
without changing shared components or inventing a theme engine.

## Subplans

None; one built-in theme uses the established contract.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Backend rejects new chrome | Extend resolver/router doctests | Shared catalog | Visible error |
| Dark prose or controls unreadable | Browser and contrast checks | Full material tokens and scoped prose | Silent without visual check |
| Artwork paints on nested desks | Browser check | Single root layer | Visual |
| Explicit card gets dark styles | Resolver assertion and real tour | Card attribute scoping | Visual |
| Phone crops all decoration | Phone capture | Dedicated background sizing | Visual |
| Recording/disabled colors overwritten | Inspect enabled/idle selectors | Scope overrides to idle/enabled | Visual |

## Agent-flow / user-flow edge cases

ADDRESSED: existing validator handles wrong theme/stock; no new field ambiguity.
ADDRESSED: explicit cards and landmark precedence remain in existing resolver.
ADDRESSED: concurrent writes, stale refs and malformed hand edits use unchanged
presentation APIs and card handling. No migration or new asynchronous write.
ADDRESSED: the test backend accepted Deck after its worktree generation restarted;
the tour verified selection and inheritance after reload.

## NOT in scope

- Promoting Undertow or Patina; they remain optional studies.
- Global dark mode or restyling independently themed cards and portaled dialogs.
- Theme extension APIs, migration, new settings controls, merge or deployment.

## Open design questions

None. One stock, approved Deck proportions and color family.

## Knowledge audits

No new agent concept; one additional value in the existing theme contract.

## What will hold this after it ships

Resolver and presentation router doctests cover availability and inheritance.
Real-app tour checks selection persistence, explicit card isolation and menus.
Browser captures cover synthetic conversation, card back and phone controls.
Inspect key text/background contrast independently of axe.

## Implementation order

Completed the cross-model plan review, registration and styling, focused tests and
real browser inspection, cross-model diff review, and adjudication. The human's
finish request authorized the landing checks.

## Rollout shape

Deck survives reload, inherited cards use it, explicit Paper remains Paper, and
desktop/phone chat is readable. The focused doctests, selected test set, typecheck,
lint, smoke, and real-app tour passed at landing. No migration was needed.

## Plan review

Claude fable reviewed the plan. Accepted preserving cover/phone artwork sizing,
checking computed explicit-card ink, defining all dark material tokens and
renaming the studio draft before promotion. Dark color-scheme is restricted to
Deck card/composer surfaces to avoid changing independent light controls.

## Later boxholder direction

Theme previews and feedback iterations use visual checks; automated verification
runs at landing. This workflow is recorded in the bbx-theme skill and the theme
authoring guide. Deck is an optional built-in theme with independent card choices.
