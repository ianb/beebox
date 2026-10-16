---
title: Bloom system and card theme
status: implemented
workstream: theme-polish
issues: []
---
# Bloom system and card theme

Make the approved pastel cutouts and striped toolbar available through the
existing system and card theme pickers. Keep the pink user-message slip and its
cream offset shadow.

**Issues addressed:** None. The related box-authored-theme exploration and
closed-built-in decision concern theme extension contracts, not this built-in.
The theme-tour fixture issue remains separate. Searched the theme issue cluster.

## Design

### Situations

- When opening everyday notes, I want the chosen pastel appearance to carry
  through the card, chat and toolbar, so the box feels like my place.
- When reading a long card, I want a quiet opaque reading surface so decoration
  does not compete with text.
- When I prefer the existing appearance, I want it to stay unchanged.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Choose Bloom | Show | Existing system/card appearance pickers | Waits to be found |
| Read or chat | Show | Shared desk, toolbar, card and composer | Background |
| Keep another theme | Quiet | Existing settings | No change |

### Spirit

- Serves “feel like a place” and “playful”: authored color and shape with calm text.
- Risks decoration obscuring content; keep reading surfaces opaque and focus,
  links, selected text and controls distinguishable.

### Trust

Selection is an explicit existing setting action. No automatic theme switch,
notification, or new agent action.

### When it goes wrong or does nothing

Existing validation and source labels describe theme choices. Existing defaults
remain. A user can choose another theme or Use default through the same picker.

### Walkthrough

The boxholder chooses Bloom in Settings → System theme. The existing presentation
mutation saves the catalog choice. BoxPresentationProvider supplies the choice to
chrome; unthemed cards resolve to Bloom through its cardThemes entry. An explicit
card theme keeps its choice. A landmark system override uses the existing resolver.

## Smallest fix and budget

One catalog entry, one production stylesheet, one SVG background asset, one app
import, current documentation and targeted fixtures/tour. Estimate 220–360 source
lines, 25–50 test/tour lines, and 15–30 documentation lines. No new theme engine.
The existing studio work is a separate already-verified checkpoint.

## Stated preferences this plan trades against

The human approved Cutouts/Striped and specifically liked the message shadow.
Preserve those choices and the latest cooler palette. Translate the mock into
actual component hooks rather than reproduce its fictional navigation layout.
Ribbon remains an exploratory study; Signal is set aside.

## What already exists

- `src/shared/card-theme/catalog.ts:1`: `export const THEME_CATALOG = [`;
  the catalog supplies picker options and system/card pairing.
- `src/shared/card-theme/core.ts:17`: `export function validateSystemThemeChoice`;
  existing validation checks catalog chrome support.
- `src/frontend/src/main/app.tsx:15`: `import "../themes/candy.css";`;
  production theme imports are explicit.
- `src/frontend/src/themes/materials.css:5`: `.bbx-card-theme {`;
  complete material defaults support nested cards and inherited embeds.
- `src/frontend/src/themes/candy.css:64`: user-message material is already a
  theme-scoped CSS hook; reuse `.bbx-chat-user-paper` and composer/nav hooks.
- `src/frontend/src/themes/system-theme-picker.css:19`:
  `.bbx-system-theme-preview {`; existing preview markup takes theme attributes.

## Prior art (external)

No external premise or library change. Use the approved original geometric study
and repository theme contracts; no artist or artwork recreation.

## Ontology

Existing system theme and card theme share the name `bloom`. One stock `cutouts`
represents the approved palette and composition. No new persisted field.

## Tracks / scope

1. Register Bloom with chrome support and a card material, stock `cutouts`, default
   pairing Bloom then Letter set and Sticky note. Implement the approved SVG
   cutouts as a decorative background, stable on desktop/mobile without stretching
   text or intercepting interaction. Add the pale blue striped toolbar, lilac
   controls, pink user slip with cream shadow, cool callouts and composer. Use one decorative layer on the Bloom presentation
   wrapper and transparent nested desks; do not route the composition through
   the repeatedly painted desk-pattern variable. Give the picker its own miniature.
   Use a light cream panel on the existing assistant reply material hook.
2. Implement cream card material, blue offset shadow, restrained pastel top rule,
   quote/blockquote inset washes, readable links/tables/code, selections and
   properties face, lilac inactive tabs and cream active tabs. Include picker swatches and focus-visible treatments.
3. Update current theme docs and add fixed synthetic tour content. Verify actual
   settings, chat, card and mobile surfaces as well as the theme studio.

## Could this be simpler?

A desk-only CSS change would omit the explicitly approved toolbar/message shadow
and leave no selectable theme. A catalog entry plus scoped stylesheet is the
smallest complete product change. No new settings or custom rendering mechanism.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Bloom rejected as a system theme | Extend card-theme doctest | Existing catalog validation | Visible error |
| Unthemed cards use plain instead of Bloom | Extend resolver doctest | Existing cardThemes resolver | Silent; assert resolved choice |
| Toolbar text inherits white on pale blue | Browser and screenshot tour | Theme-scoped text and focus rules | Visible in screenshot |
| Composer or portal differs from specimen | Real app browser checks | Use real hooks; keep unthemed portals readable | Visible |
| Decoration blocks input or obscures text | Desktop/mobile captures and interaction | Background-only SVG; opaque card text surfaces | Visible |
| Nested material inherits wrong colors | Existing material reset plus mixed-theme browser check | Per-card token contract | Visible |

## Agent-flow / user-flow edge cases

- ADDRESSED: system versus card choice keeps existing separate fields/pickers.
- ADDRESSED: malformed and unknown choices retain existing validation behavior.
- ADDRESSED: box and landmark precedence remains in the existing resolver.
- ADDRESSED: no data migration, file relocation, or asynchronous new writes.
- ADDRESSED: selecting another theme removes Bloom through attribute scoping.

## NOT in scope

- Shipping Ribbon or Signal. Ribbon needs another visual iteration; Signal was rejected.
- Additional Bloom stocks or saved background/toolbar combinations; one was chosen.
- Theme engine, schema redesign, new interactions or production deployment.
- Unrelated repository layout cleanup; its existing failure is already filed.

## Open design questions

None for Bloom. Ribbon's color flow remains a prototype discussion.

## Knowledge audits

No new agent concept: Bloom is one more value of the existing theme choice.
Current theme reference documentation lists the value; no new guidance workflow.

## What will hold this after it ships

Resolver doctests cover availability/default pairing. A focused tour checks real
Bloom surfaces at both widths; inspect screenshots, not just exit codes. Existing
card tours cover their card-specific surfaces, not Bloom chrome. Axe currently omits contrast, so
check key color pairs separately.

## Implementation order

Review plan, implement catalog/styles/assets, update docs/fixtures and targeted
tests, inspect studio then actual product at both widths, cross-model diff review,
adjudicate and commit if repository gates permit. Update Ribbon exhibit separately.

## Rollout shape

Done when Bloom can be selected, survives reload and styles actual chat/cards;
selected tests, typecheck and lint pass; screenshots show the approved composition
and readable states. Existing settings remain untouched except isolated test-box
verification. No merge or deploy until the human asks to finish.

## Plan review

Claude fable identified repeated background painting through the shared desk
pattern, missing explicit tab treatment, and insufficient existing chrome tour
coverage. Accepted all three: one composition layer, explicit tabs, and focused
Bloom selection/chat/reset coverage plus synthetic message browser evidence.
An SVG asset stays separate for readable original geometry; existing data URIs
are precedent, not a requirement.


## Implementation and verification

Bloom is registered as a system and card theme with the `cutouts` stock. The
approved original SVG paints once behind the workspace. Existing explicit card
choices remain intact. The theme studio remains available for future iterations.

The diff review found an opaque inline transcript background, pale toolbar marks,
and send/focus state conflicts. Removed the inline background in favor of the
existing conversation-desk class; themed the questions badge and transcription
dot; limited send styling to enabled desktop/mobile controls; scoped focus to
navigation; kept reply panels opaque and preserved print quote borders. The
stretching SVG matches the approved study, including its responsive behavior.

Resolver doctests pass (30 assertions), full typecheck and changed-file lint pass.
The real-app tour covers selection, reload, workspace, Add menu, explicit Paper
cards and reset at desktop/phone widths, with no behavioral findings. Its four
axe reports are two existing issues repeated at each width: unnamed Markdown
task checkboxes and the floating menu landmark decision. Both are recorded in
the issue queue. Additional real-chat screenshots verify synthetic user/reply
content, callouts, properties and mobile typing. Key text/background contrast
pairs range from 5.41:1 to 9.22:1.

The selected 578-file test run passed 7,397 checks and found one catalog-list
expectation missing Bloom. Updated that expectation and reran the presentation
router doctest separately.
