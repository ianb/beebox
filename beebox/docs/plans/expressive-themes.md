---
title: Expressive theme collections
status: active
workstream: theme-polish
issues: []
---
# Expressive theme collections

Three original visual treatments translate supplied art references into system and card themes, including composition, texture, and shape.

**Issues addressed:** None. Related searches found box-authored-themes and theme-is-a-closed-builtin; this work does not implement custom theme loading or close those issues.

## Design

### Situations

- When Mara opens her personal workspace to collect studio notes, she wants it to feel expressive and hers, so returning is enjoyable.
- When Rowan opens a long note inside a colorful workspace, he wants clear reading surfaces, so decoration does not compete with the content.
- When Mara wants a quiet workspace, she wants to retain Flat, so these choices never replace her current preference automatically.

### Right place, right time

The existing Settings picker offers system themes; card Properties offers matching card themes. They wait to be found. No prompts, notifications, or automatic pairing.

### Spirit

Serves “It should feel like a place” and “It should be playful, even about mundane things.” Risks “The best stuff comes from the people”: ornament must not obscure the person's words. Opaque reading surfaces, visible focus, and static decoration protect that.

### Trust

Presentation changes only after an explicit picker choice. Existing settings persistence and reset behavior remain in charge.

### When it goes wrong or does nothing

Existing selections remain unchanged. Existing picker mutation errors and resets remain visible. Theme decoration has no interactive layer and cannot intercept input.

### Walkthrough

Mara opens Settings, chooses Harlequin, and sees an angular pigment composition surrounding the workspace. She opens a note, chooses Harlequin in Properties, and sees a related solid reading sheet. Changing the system choice alone never rewrites that card choice. Reset returns to the existing inherited choice.

## Smallest fix and budget

Palette-only CSS is smallest, but misses the explicit request for composition, texture, and shape. Add shared CSS consumers and three theme definitions with original SVG ornaments. Estimate 750–1100 changed source/test lines plus 130 documentation lines; no generated output. No new persistence model.

## Stated preferences this plan trades against

The human says the references are “color inspiration, but also composition and texture and shape,” and authorizes extending the theme system. Matching names give discoverable pairings without prematurely building a collection-management UI. Existing themes retain their appearance.

## What already exists

- `beebox/src/shared/card-theme/catalog.ts:1`: `export const THEME_CATALOG = [` — reuse the common catalog and existing choice validation.
- `beebox/src/frontend/src/components/themes/BoxPresentationProvider.tsx:47`: `data-chrome-theme={chrome?.choice.name ?? "plain"}` — reuse the selected system scope.
- `beebox/src/frontend/src/themes/materials.css:36`: `color: var(--bbx-ink);` — reuse complete card material tokens.
- `beebox/src/frontend/src/components/ui/Dropdown.tsx:325`: `? createPortal(` — menu nodes need the selected presentation attached explicitly.

## Prior art (external)

Adopted aesthetic references supplied directly by the human: Stephen Westfall's The Tall Grass (2025), No7er's Fries 2000, and Saigetsu's pink cloud/star illustration. Original SVG/CSS compositions interpret their color relationships, shape families, and texture; no supplied image is redistributed. Credit in ACKNOWLEDGEMENTS.md. No external technical premise requires research.

## Ontology

Existing theme choice remains `{name, stock?}`. New catalog IDs: harlequin/pigment, electric-playground/prism, daydream/cloud. Each supports both system and card surfaces. A collection is an informal matching pair, not persisted state.

## Tracks / scope

1. Extend CSS theme parameters for scene background, toolbar/composer/menu shapes and material, reply surfaces, sheet decoration/shadow, and tab radius. The catalog composition capability opts themes into shared consumers; roots reset tokens so nested previews cannot leak styles. Existing themes keep their styling. Dropdowns read existing presentation context and carry selectors into their portal.
2. Create Harlequin (asymmetric painted wedges), Electric Playground (black stage, perspective lines, translucent prisms), and Daydream (flowing clouds, starbursts, speckles). Register/import them and credit inspirations.
3. Browser comparison on the same note and conversation/composer at desktop and phone widths, Properties, menus, Browse/Admin; inspect contrast and focus. Run targeted tests, tours, typecheck/lint, and Claude review. Commit and exhibit; no landing.

## Could this be simpler?

Three isolated stylesheet patches would repeat menu, composer, and sheet mechanics. Shared consumers buy actual extensibility for shape and composition, while avoiding a generic theme-builder or user-authored CSS schema.

## Subplans

None; the artwork variations share one implementation contract.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Catalog choice rejected for system use | Existing shared theme doctest, extend concrete new choices | Catalog validation | Visible error |
| Portal menu loses selected theme | Browser menu check | Carry presentation selectors to portal | Visually silent without check |
| Busy background reduces text contrast | Computed contrast and visual checks | Opaque reading areas | Visual |
| Decoration blocks focus or clips content | Phone/desktop browser checks | Pointer-events none, no container clipping | Visual |
| Existing themes inherit new decoration | Browser Flat/Candy check | Consumers scoped to three IDs | Visual |

## Agent-flow / user-flow edge cases

Wrong field, stale ref, concurrent edits, hand-edit drift, and validation UX: ADDRESSED by unchanged choice schema and picker persistence. Fabricated free-form values: unchanged existing unknown-card-theme handling. Transition: additive builtins, no migration. Browser preferences: fixed authored palettes, tested under both OS color preferences; no app-wide automatic dark mode is introduced.

## NOT in scope

- Collection manager or automatic matching: independent choices are already useful.
- Landmark search dialog and task-specific overlay redesign: these keep their existing surfaces.
- General dark-mode infrastructure: artwork palettes remain authored choices.
- Box-authored executable styles: unrelated loading/security contract.
- Broad contrast cleanup or unrelated tour repair beyond paths used to verify this work.
- Deploying or merging: needs the human's finish request.

## Open design questions

Which directions the human ultimately keeps or adjusts remains a visual judgment after the exhibit. No unresolved question blocks implementing the three examples.

## Knowledge audits

The expressive-theme-choices developer audit passed with Claude Opus 5.5 on 2026-10-08. It read the guide and correctly explained independently choosing Electric Playground surroundings and a Daydream card.

## What will hold this after it ships

Existing shared catalog and presentation doctests validate selection and persistence. Browser tours and a new expressive-theme checkpoint walk cover actual renderings; these are visual evidence, not pixel regression tests. Typecheck and lint cover integration.

## Implementation order

Shared consumers and catalog, parallel artwork styles, browser iteration, review and verification, then one coherent worktree commit. Add acknowledgements with the styles.

## Rollout shape

Additive choices only. Done when targeted checks pass, desktop/phone evidence shows all three, review findings are adjudicated, and the comparison exhibit is ready. Existing settings require no migration and users must opt in.

## Review record

Claude Fable plan review found a repeated theme-ID allowlist, missing neutral resets, an unwanted OS-dark variation, and stale catalog guidance. The implementation now declares a catalog composition capability, resets new tokens at presentation/material roots, preserves fixed artwork palettes, and updates the guide. Portal menu coverage is explicit; task-specific dialogs remain outside scope.

Claude Opus 5.5 implementation review found inherited scene ink, unbacked chat metadata, an overbroad swatch-preview selector, disabled-menu styling, and focus contrast. These were corrected; verification confirmed all five plus card-owned tab radii. Its follow-up caught an unwanted metadata width override, which was removed. Explicit Properties labels use full ink opacity (the earlier Harlequin blend measured 4.33:1).

## Verification record

- Focused shared theme, presentation router, Properties, and card-title doctests pass: 50 assertions across four files. The router catalog expectation was updated for the three new entries and rerun (21/21).
- Backend/frontend typecheck and changed-file lint pass. The broad change selector selected 542 suites and reported memory pressure; that run was interrupted in favor of these focused checks.
- Final expressive-theme tour passed all six desktop/mobile checkpoints with zero findings and zero axe violations.
- Actual card fixtures cover all three choices and matching system CSS previews at 1280×800 and 375×800. Settings persistence and portal menu selection were separately exercised. OS color preference preserves the authored palettes.
- The test box has old chat cards without saved transcripts. A dedicated `/dev/chat-materials` harness now renders production message components with synthetic prose, tools, progress, compaction, interruption, self-note, pending voice, and failed capture states. It verifies component appearance, not live transcript delivery; no model calls were made.
- An unrelated existing SSR useLayoutEffect warning is recorded as issue 2026-10-08-landmark-menu-ssr-layout-effect-warning, with predecessor source evidence.

## Visual feedback follow-up

The human flagged Harlequin tiling and chat readability. Harlequin now paints one viewport-filling composition without repetition, including its decorative strips. Populated component checks exposed bare history/model labels and provisional voice/capture groups; those now have opaque material backing. Tool/progress and Markdown ink follow the reading material, and expanded compaction text keeps legible contrast. The comparison exhibit includes populated samples and the earlier tiled image for reference.

Claude Opus 5.5 follow-up review caught disabled-history styling, translucent queued user bubbles, and viewport-relative Harlequin picker cropping. Those were corrected and independently rechecked, along with the capture group and viewport-scrolling harness. Focused capture/layout doctests passed 36 assertions; changed-file lint passed.
