---
title: Seven material-led theme collections
status: active
workstream: theme-polish
issues: []
---
# Seven material-led theme collections

Add seven matching system and card themes inspired by supplied artwork, with
texture and composition carried through controls and reading surfaces.

**Issues addressed:** None. Searched theme issues; box-authored themes and open
`theme` vocabulary remain separate decisions, not prerequisites for these built-ins.

## Design

### Situations

- When opening a personal workspace for an evening of writing, I want its
  materials to feel chosen, so that it feels like my place.
- When reading a long answer on a phone, I want the ornament to frame the
  words, so that I can read without competing patterns.
- When I need a quiet workspace, I want to retain my current theme rather
  than have new artwork applied automatically.

### Right place, right time

Choices wait in Settings and card Properties. Nothing interrupts or changes
an existing selection. Each collection has a matching system and card name.

### Spirit

Serves “It should feel like a place” and “It should be playful, even about
mundane things.” Risks the legibility of the gears: keep text on quiet,
contrast-checked materials and preserve controls and focus indicators.

### Trust

Shows only. A person's explicit picker action applies a choice; no automatic
pairing, configuration rewrite, or new agent action.

### When it goes wrong or does nothing

Existing validation and plain fallback remain. Independent card/system choices
can be mixed, and either can be changed through the existing picker.

### Walkthrough

Open Settings, choose Selvedge, and keep the current conversation. The toolbar,
composer, status, menus, and chat material use woven accents. Open a memo's
Properties and choose Selvedge there to give that card its own cloth surface.
Choosing Flat later changes the workspace while the memo retains its selection.

## Smallest fix and budget

Reuse the expressive composition system. Approximately 1,250 source lines,
80 test/fixture lines, and 150 documentation lines across seven CSS collections,
original SVG and WebP assets, catalog/imports, and existing verification fixtures.
No new theme engine or dependencies. Three abstract pigment textures are generated
from material and palette descriptions; reference artwork is not bundled.

## Stated preferences this plan trades against

The human approved all seven working themes, including fabric texture and the
period/style of Para Todos. Character extends beyond palette and wallpaper.
Reuse focused checks; no redundant broad test run after an unrelated merge.

## What already exists

- `src/shared/card-theme/catalog.ts:3`: `name: "plain"` starts the shared catalog;
  new descriptors use the existing `composition: "expressive"` capability.
- `src/frontend/src/themes/expressive.css:3`:
  `.bbx-box-presentation[data-theme-composition="expressive"]` consumes scene,
  chrome, reply, and status tokens. Reuse it.
- `src/frontend/src/themes/control-shapes.css:1`:
  “Shape only decorative layers: hit targets and focus outlines stay whole.”
  Reuse this boundary for varied controls.
- `test/tours/expressive-themes.tour.ts:1`: “Real authored card materials with
  temporary DOM-only system previews.” Extend its fixture coverage.

Paths in this plan are relative to `beebox/`, except ACKNOWLEDGEMENTS.md.

## Prior art (external)

Adopt the supplied artwork as visual inspiration only. All seven sources and
artists are credited in ACKNOWLEDGEMENTS.md; source images are not bundled.
The supplied images establish composition, shape, texture, and palette. The
Para Todos cover collection and Gorboot interview additionally establish the
period design and flat-color/ink approach. Other source pages were inaccessible
through the browsing tool; attribution for those follows the supplied credits.

## Ontology

No new runtime concepts. Existing theme descriptors add names/stocks:
Selvedge/wool, Footlights/marquee, Overpass/silhouette, Golden Hour/canopy,
Interlace/pigment, Blacklight/ink, and Far Horizon/gouache. Names are selectors,
not a new automatic pairing system.

## Tracks / scope

1. Author seven complete token sets and original material decorations. Each defines
   system chrome and card material, including input, selection, status, and menus.
2. Register choices in the shared catalog and CSS imports. Add matching authored
   fixtures and extend the real-message harness and existing tour.
3. Verify selectors/persistence validation with the focused shared-theme doctest;
   inspect desktop/phone scenes, controls, reading surfaces, and Properties.
   Present one labeled exhibit and obtain cross-model review before completion.

## Could this be simpler?

Seven palette substitutions would be smaller but would not deliver the requested
fabric, period ornament, brushwork, and distinct geometry. Existing tokens and
original SVG and compressed WebP assets provide those without new runtime machinery.

## Subplans

None; the collections share an established presentation contract.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Frontend choice rejected by backend catalog | Shared-theme doctest extended | Shared catalog reused | Visible error |
| Dense wool texture competes with text | Browser inspection | Quiet opaque reading cloth | Visually evident |
| Art shrinks to noisy tiles on phone | Desktop/phone tour | Responsive composition | Visually evident |
| Polygon clips label or focus | Focus/browser inspection | Decorative layers only | Visually evident |
| Status strip escapes composer corners | Existing harness hidden-sibling case | Shared status rules | Visually evident |

## Agent-flow / user-flow edge cases

Wrong or hand-edited names: ADDRESSED by existing theme validation and plain
fallback. Stale refs, concurrent card edits, and validation messages: unchanged
existing ownership. Partial rollout: shared backend/frontend catalog deployed
together; old local dev workers may need their normal worktree refresh. No
migration or new free-form agent value is introduced.

## NOT in scope

Box-authored themes, automatic matching, picker regrouping, new fonts downloaded
from third parties, motion effects, and changes to existing theme palettes.

## Open design questions

None blocks this implementation; the exhibit invites reactions to the seven
working interpretations.

## Knowledge audits

No new agent-facing procedure or data shape; skip new audits. Existing theme
choice and system/card distinction remain unchanged.

## What will hold this after it ships

The focused catalog doctest verifies both card and chrome resolution. The
existing expressive-theme tour retains desktop/phone visual checkpoints. Browser
inspection judges material quality; numerical checks alone cannot establish it.

## Implementation order

Author materials and assets, integrate catalog/fixtures/credits, inspect and
adjust browser results, run focused checks and review, then commit the batch.

## Rollout shape

Additive choices; no migration or automatic selection. Done when all seven
resolve as both card and system choices, screenshots show their full surfaces,
and focused checks and review are complete. Landing requires the human's ask.

## Verification checkpoint

All seven implemented and inspected at desktop and phone widths. Shared theme
resolution doctest passed (19 assertions). The expressive tour captured all ten
collections at both widths with zero axe violations. Four heading findings were
Footlights' intentional uppercase heading, attributed to the preceding checkpoint
by the runner; corrected the expected name and checked the saved AX trees.
Claude Opus 5.5 review found an API catalog expectation needing the new names
and a Selvedge control-texture specificity conflict; both corrected. No broad
suite rerun. The comparison exhibit is the visual review surface.

## Visual revision after feedback

Selvedge retains its cloth surface with a new warp-and-weft composition. Footlights
uses simple controls without notches. Interlace shifts to ultramarine, clay, and
lavender; Blacklight reduces lime and gives its textarea an 8px radius. Overpass,
Golden Hour, and Far Horizon replace scenic vector backgrounds with original
abstract ink and pigment textures. Far Horizon also uses deeper petrol chrome
and warm cream reading fields. Fourteen fresh desktop/phone captures document
this revision; prior catalog/API tests remain applicable.

## Third visual revision

Footlights gains outlined multicolor fans and varied control colors; its heading
rules stop before the square Properties fold. Overpass uses a wider sans serif.
Interlace replaces tiled geometry with translucent watercolor and softer shadows.
A smoother Far Horizon study lives only in the exhibit alongside the unchanged
current theme. Electric Playground profile-email text uses a readable muted ink.
