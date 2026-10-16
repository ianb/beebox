---
title: Theme authoring studio
status: implemented
workstream: theme-polish
issues:
  - ../../../issues/code-quality/2026-10-15-themed-file-card-unit-layout.md
---
# Theme authoring studio

Provide a repeatable development page for styling themes against fixed content.
A developer edits CSS, opens a URL, and captures the same surfaces at two widths.

**Issues addressed:** None. Searched the public queue for theme harness, preview,
rig, and authoring. The related `2026-09-23-test1-lacks-theme-tour-fixtures` issue
concerns real-box fixtures; the studio has its own fixed content and does not
resolve that issue.

## Design

No design section: this is developer tooling, with no changed boxholder flow.

## Smallest fix and budget

Add a DEV-only studio using existing card and composer components, a small
isolated draft CSS file, and a short guide. Estimate 300–450 source lines changed,
20–40 test lines, and 45–65 guide lines. No new screenshot engine or skill.

## Stated preferences this plan trades against

The human asked for an easy rig with sample content where a theme can be written
and checked in a screenshot. Reuse keeps the samples close to shipping rendering;
a new mock shell would drift. The existing live tours remain necessary for actual
navigation and workspace behavior.

## What already exists

- `beebox/src/frontend/src/lib/box-route-layout.ts:1`: `export const DEV_HARNESS_PATHS = {`.
  Reuse this registry to bypass product layout for the studio.
- `beebox/src/frontend/src/main/router.tsx:275`: `const devComposerStatesRoute = createRoute({`.
  Reuse its lazy, DEV-gated route pattern.
- `beebox/src/frontend/src/components/themes/ThemedFileCard/CardThemeSurface.tsx:43`:
  `export function CardThemeSurface({ theme, title, detail, symbol, boxSlug, mode, children, properties, actions, problem }: CardThemeSurfaceProps) {`.
  Render this real surface with fixed front/back content.
- `beebox/src/frontend/src/pages/dev/components/ComposerStatesHarness.tsx:132`:
  `function StateBlock({ spec, includeControlIds }: { spec: Spec; includeControlIds: boolean }) {`.
  Export/rename this existing specimen with optional header suppression for reuse.
- `beebox/src/frontend/src/themes/materials.css:5`: `.bbx-card-theme {`.
  Its material tokens reset on each card; author draft overrides using those selectors.
- `beebox/src/frontend/src/themes/chrome.css:53`: `.bbx-box-presentation {`.
  Set this wrapper's theme attributes directly for the studio.

## Prior art (external)

No design decision depends on an external premise. Existing harnesses and the
repository's browser wrapper provide the relevant APIs.

## Ontology

No new product vocabulary. A studio is a development harness. A draft theme is
CSS loaded by this harness only; it is not a registered product system theme.

## Tracks / scope

1. Add `/dev/theme-studio` with URL search fields for system theme/stock and card
   theme/stock. Defaults are plain/neutral. Allow draft names directly so authors
   need not register a product theme before exploring it. Use the router's search
   state, and show the selected values explicitly. Unknown names intentionally
   preview the base material until matching CSS is authored.
2. Render one specimen at a time: real CardThemeSurface, Markdown prose, quote,
   checklist, code, table, real controls, and the existing composer specimen.
   Include a clearly labeled navigation styling sample using shipping classes;
   it does not impersonate a working AppNav. Use fixed fictional data only.
3. Import an isolated draft stylesheet from the lazy studio. Supply a minimal
   `draft` example illustrating card material and chrome selectors. It must not
   be imported by production app entry points. The guide points authors to this
   file, the catalog, existing theme CSS, and the three real integration tours.
4. Add a theme-studio tour for desktop/mobile capture using the existing runner.
   Document bin/tour and bin/browse for iterative checks. No new CLI,
   arbitrary CSS upload, image service, theme persistence, or app setting writes.

## Could this be simpler?

Instructions to edit global CSS and open arbitrary box cards are smaller, but
content and selection vary with box state, which repeats the setup friction the
human asked to remove. The studio adds only fixed content and selection. Existing
browser capture and tour commands already satisfy the screenshot requirement.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Studio gets product chrome or appears as a production route | Extend inventory-card-state.interface-card-state.doctest.md route coverage | Same lazy DEV registration as sibling harness | Verify source gate and browser layout |
| URL selections disappear on refresh | Browser check across reload | Router search parameters | Selected names are visible |
| Duplicate composer IDs | Browser count check | Render one composer; original gallery keeps includeControlIds behavior | Inspect DOM |
| Draft CSS leaks onto product pages | Browser check studio then product | Every selector scoped to studio and draft attributes; CSS lives under pages/dev, outside globally imported themes | Verify unchanged plain product attributes |
| Real component prop changes | Typecheck | Reuse component props | Compile failure |

## Agent-flow / user-flow edge cases

- ADDRESSED: system and card fields have distinct labels and query names.
- ADDRESSED: candidate CSS can use a name absent from the product catalog;
  the guide explicitly describes the resulting base-style fallback.
- ADDRESSED: no box cards or configuration are written, so stale refs,
  concurrent agents editing cards, and partial migration do not apply.
- ADDRESSED: malformed search types are rejected by the route's schema.
- ADDRESSED: screenshot output uses bin/browse's existing file and URL sidecars.

## NOT in scope

- Implementing or registering the three proposed product themes: their visual
  studies are still under discussion.
- Rebuilding AppNav or faking its behavioral coverage: use the live tours.
- Installing missing theme-tour fixtures: the separate installer already exists.
- A new skill or screenshot wrapper: the guide and existing commands suffice.

## Open design questions

None for the rig. Specific theme design decisions remain in the visual studies.

## Knowledge audits

No agent instruction/skill changes. This adds developer reference documentation
and a pointer in frontend.md, so no context or skill audit is needed.

## What will hold this after it ships

Typecheck verifies the real surface/composer contracts. Browser checks cover
selection reload, card flip, and desktop/mobile layout. Selected tests cover
route layout and search parsing. The three existing theme tours cover final product
integration after a candidate becomes a product theme.

## Implementation order

Review plan, add route and specimen, add isolated draft CSS and guide, run
selected checks and browser captures, review diff, commit the verified tooling.

## Rollout shape

One development-only change. Done when a draft CSS edit is visible through a
stable studio URL and captures at 1280×800 and 375×800, the real card flips,
selected names survive reload, and source checks preserve the DEV route gate.
No data migration or deployment action.

## Plan review

Claude fable reviewed the plan. Accepted a tour for repeatable captures, and
explicit studio/draft selector scoping because lazy CSS persists after navigation.
The tour runner uses the dev router. Its axe runner currently suppresses color
contrast; the guide must not claim contrast validation. Corrected source line
references and made the route classification test explicit.

## Verification and review

Frontend typecheck and changed-file lint pass. The two selected doctest files
pass (28 assertions). Browser checks confirmed selection after reload, a working
card flip, one main landmark, no duplicate IDs, and no draft nodes on leaving
for a product page. The desktop/mobile tour passes with no axe findings (contrast
is not checked). Claude claude-opus-5-5 identified missing composer/nav wrappers
and message/callout base-style drift; these were corrected and checked in the
browser. Paper blue navigation now renders its actual dark bar.

At finish, the human approved a mechanical move of the ThemedFileCard entry and
its helpers into the required `view/` unit, plus the corresponding import and
doctest-name updates. This clears the pre-existing layout-check finding without
changing card behavior. The issue remains open only for the finish close-out.
