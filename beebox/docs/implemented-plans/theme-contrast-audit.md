---
title: "Theme contrast audit in the theme loop"
status: implemented
workstream: theme-audit
issues:
  - ../../../issues/code-quality/2026-05-28-color-contrast-wcag-aa-audit.md
---
# Theme contrast audit in the theme loop

Theme authors find contrast defects late, one at a time, and fix each with a
selector patch. This plan adds a contrast audit that measures what a reader
sees, puts it in the theme author's screenshot step, runs it on every tour
checkpoint and at landing, and fixes the defects it finds that keep a theme's
look. Changes that shift a theme's identity go to the boxholder as decisions.

**Landed beyond this plan:** a backdrop audit (`bin/theme-check` and tour checkpoints) that flags artwork that repeats, leaves a bare strip, or is stretched; artwork is cropped, not stretched. The audit and its decisions are in the code under `beebox/test/tours/`.

**Issues addressed:** `issues/code-quality/2026-05-28-color-contrast-wcag-aa-audit.md`
(re-measures and supersedes its axe-only inventory). Related, not closed here:
`issues/docs-and-chores/2026-09-23-test1-lacks-theme-tour-fixtures.md` (has a
pending "discuss" from the boxholder; installed on this worktree's test1
clone only, for the audit). Recently closed bugs of the same class,
each fixed with a theme-specific selector: `closed/bugs/2026-10-19-open-todo-text-unreadable-on-dark-deck-theme.md`,
`closed/bugs/2026-10-19-revealed-redacted-text-fixed-purple-on-dark-themes.md`,
`closed/bugs/2026-09-27-strikethrough-text-hard-to-read.md`.

## Design

No design section: this is developer tooling plus fixes that restore readable
text. The two catalog-wide visual changes it finds (the resting "Properties"
fold label and the base warm text scale) are reserved for the boxholder and
presented as decisions, not designed here.

## Smallest fix and budget

Smallest fix for the reported symptom: re-enable axe `color-contrast` in tours.
It does not work for themes. A May-style run in the studio (axe 4.11, every
catalog theme, 1280 and 375 wide) found 0 violations for 13 of 20 system
themes while marking 27–36 text nodes per theme "incomplete" (`bgImage`,
`bgGradient`, `pseudoContent`): axe declines to measure text over an image,
gradient, or texture, which is where these themes put their text. The Deck
Settings picker labels (light ink on a white panel, 1.16:1) and the Deck
Properties label (1.84:1) were not reported by axe at all.

Chosen design, estimated changed lines (additions plus deletions):

| Track | Source | Tests |
|---|---|---|
| A. Pixel + token audit library (`tour-lib/contrast*.ts`) | 300 | 120 |
| B. `bin/theme-check` + studio coverage | 200 | 40 |
| C. Tour checkpoint integration + landing gate | 60 | 30 |
| D. Fixes that keep the look | 80–150 | — |

About 850 lines plus docs (theme-authoring.md, bbx-theme skill, tours doc:
about 60 lines, with the skill shrinking). Not a BIG CHANGE.

## Stated preferences this plan trades against

- **bbx-theme skill**: *"do not run tests when showing a theme; wait for
  landing."* The audit is not a test in the author loop. `bin/theme-check`
  is the screenshot command: it produces the same desktop and phone captures
  the skill already asks for, with misses outlined. It never blocks; it prints
  and exits. The blocking form (`--all`) runs at landing, which the skill
  already reserves for checks.
- **Engineering principle 11, "Enforcement beats convention"**: the audit runs
  at three points (author screenshot, every tour checkpoint, landing) so it
  does not depend on someone remembering.
- **Memory "minimize invented concepts"**: no exemption attribute, no tier.
  Text that is exempt under WCAG is identified by platform state: `:disabled`,
  `aria-disabled="true"`, `inert`. Visually hidden text is identified by its
  1px box.
- **Repo rule: no weakening checks.** axe `color-contrast` stays disabled in
  `SUPPRESS_RULES` (`beebox/test/tours/tour-lib/axe.ts:29-33`), and the pixel
  audit replaces it at every checkpoint. The comment there will say so.
  Replacing a check that skips themed text with one that measures it makes
  tours stricter.

## What already exists

- Theme studio: `beebox/src/frontend/src/pages/dev/components/ThemeStudioHarness.tsx`
  renders real `CardThemeSurface`, `Markdown`, `CalloutStack`, composer and
  nav specimens under `system=`/`card=` URL params. Reused as the audit's
  stage; this plan adds specimens to it.
- Tour runner: `beebox/test/tours/tour-lib/checkpoint.ts:28` `captureCheckpoint`
  takes the screenshot, AX tree and axe report per checkpoint. Reused; the
  audit is one more artifact there.
- `BrowseSession` (`tour-lib/browse.ts:36`) wraps `bin/browse` with `eval`,
  `screenshot`, `setViewport`. Reused by `bin/theme-check`.
- Material tokens: `beebox/src/frontend/src/themes/materials.css:5-48` define
  `--bbx-paper`, `--bbx-ink`, `--bbx-ink-soft`, `--bbx-sheet`, `--bbx-tint`,
  `--bbx-quote-paper`, `--bbx-quote-layer-paper`, `--bbx-blockquote-paper`,
  `--bbx-code-paper`/`--bbx-code-ink`. The token-pair check reads these.
- `Card` has a `material` prop (`components/ui/Card.tsx:24`) that takes the
  enclosing card's material. Settings panels do not use it; that is the
  Deck picker-label defect.
- `sharp` is already a beebox dependency (`beebox/package.json:186`); used to
  decode the capture.
- Searched for an existing pixel or token contrast checker in `beebox/`,
  `browse/`, `bin/`: none.

## Prior art (external)

- axe-core reports text over background images as `incomplete` with
  `messageKey: bgImage`, not as pass or fail (observed above; axe docs
  "color-contrast" rule). Evaluated-only: this is why the audit measures pixels.
- WCAG 2.2 SC 1.4.3 thresholds: 4.5:1, 3:1 for large text (24px, or 18.66px
  bold); inactive components and pure decoration are exempt. Adopted as the
  thresholds.
- Hiding glyphs and sampling the background under each text box is the
  approach of several visual contrast tools (e.g. Polypane, the Chrome
  DevTools contrast picker's "background from image" estimation). Evaluated
  only; no code taken.

## Ontology

- **Text run**: the visible text of one element in the viewport: its text
  nodes' line boxes, its computed color with ancestor opacity folded into
  alpha, and whether it is large text. Inputs contribute their value or
  placeholder over their content box. New, in `contrast-page.ts`.
- **Background capture**: a viewport screenshot with every glyph transparent
  (color, `-webkit-text-fill-color`, decoration). Text shadows stay, because a
  halo is part of what the text is read against.
- **Surface break**: text inside a card, outside any control, whose median
  background matches none of the material's declared surfaces and sits on
  the other side of light/dark from the paper by at least 3:1. Catches an app
  panel that ignores the material (the Deck Settings picker) without an
  exemption list. Controls draw their own surfaces by design and are skipped.
- **Run score**: the contrast between the run's color (composited over each
  sample) and the background sample at the 10th percentile of the run's
  samples. Not the minimum (one texture speck would fail a line), not the
  median (would pass text unreadable over a fifth of its width).
- **Token pair**: a foreground and background material token that a theme
  promises to keep readable together, such as ink on sheet. Measured from
  computed values on each `.bbx-card-theme` element, independent of what the
  specimen happens to render.
- **Miss**: a run or pair below its threshold. Exists already as tour
  `Finding` (`tour-lib/types.ts:24`); a miss in a tour is a `fail` finding.
- **Studio case**: one (system, systemStock, card, cardStock) studio URL.
  `catalogCases()` enumerates every catalog theme and stock.

## Tracks / scope

### A. Audit library

- What: `tour-lib/contrast-page.ts` (page functions sent with
  `fn.toString()`), `tour-lib/contrast.ts` (`auditContrast(page, {outline})`,
  pure `scoreRuns(image, runs)`, `contrastRatio`), and token pairs.
- Why: axe skips the themed cases (see budget section).
- Direction: `auditContrast` collects runs and hides glyphs in one eval,
  screenshots, decodes with sharp, restores text and draws outlines in one
  eval (each browse call costs about a second). Token pairs: for each
  `.bbx-card-theme` in the viewport, resolve each token through a probe
  element's computed `color` and check these pairs at 4.5:1: ink/paper,
  ink-soft/paper, ink/sheet, ink/tint, ink/quote-paper,
  ink/quote-layer-paper, ink/blockquote-paper (each composited over paper when
  translucent), code-ink/code-paper, pen/paper. A pair with a transparent
  background is skipped (the pixel check covers it).
- Vocabulary lock-ins: `ContrastFailure { kind: "text" | "token", ... }`.
- First chunk: the library as prototyped, plus `contrast.test.ts` for
  `scoreRuns` (solid, texture speck, translucent fg, large text) and
  `contrastRatio`.

### B. `bin/theme-check` and studio coverage

- What: `bin/theme-check [--system X --system-stock S --card Y --card-stock T]`
  (default `draft`/`draft`) and `--all`. Writes outlined desktop and phone
  captures under `beebox/test/tours/.artifacts/theme-check/` and prints each
  miss with ratio, colors and selector. One theme exits 0 (a preview);
  `--all` exits 1 on any miss, and on text it could not measure (below the
  capture, or in a faded group over an image).
- Why: the author's existing screenshot step becomes the check, with no extra
  step.
- Direction: studio specimens gain the surfaces the boxholder's examples hit:
  a `{% quote treatment="layered" %}` with heading, list and bold; a nested
  Markdown blockquote with a list; an interface panel (real `Card`, `Heading`,
  `Hint`, and `SystemThemeSwatches`, exported from `SystemThemePicker.tsx`) as
  Settings renders it inside the card surface. Studio cases render at
  1280×2400 and 375×4400 so one capture holds the whole studio.
- First chunk: CLI as prototyped plus specimens.

### C. Tours and landing

- What: `captureCheckpoint` runs `auditContrast` after the axe run, writes
  `<checkpoint>.<viewport>.contrast.json`, and pushes one `fail` finding per
  miss. A new `theme-contrast` tour is not added: `bin/theme-check --all` is
  the catalog sweep, and the finish preflight names it when the diff touches
  `beebox/src/frontend/src/themes/`, `pages/dev/theme-studio*`,
  `components/themes/`, `src/shared/card-theme/catalog.ts`, or the checker
  itself (`test/tours/theme-check.ts`, `test/tours/tour-lib/contrast*.ts`).
  Tour findings are reports; tours do not gate.
- Why: the studio does not exercise live navigation, portaled menus, or chat
  state (`theme-authoring.md`); tours do.
- First chunk: checkpoint integration and the preflight rule with tests in
  `bin/test/` for the path rule.

### D. Fixes that keep the look

From the first `bin/theme-check --all` (131 misses over 26 cases × 2 widths):

- Callout context label "Ready to review" (`text-accent-dark` #c98a20 on
  gold-50, 2.7:1, every light theme): a darker gold for this label only.
- Flat user bubble (white on iris #7b6fb0, 4.43:1): darken the bubble one
  step.
- Quote attribution near-misses (Bloom 4.31, Night Atlas 4.00, Goldfish 4.03,
  Veil 4.08, Overprint 4.31): the attribution uses ink rather than a softened
  ink in those themes.
- Card detail line (`text-card-soft`) on Overprint (3.86) and Veil (3.19):
  darken those themes' `--bbx-ink-soft`.
- Overprint link (3.26): darken link ink.
- Settings/interface panels in dark card themes (Deck, Night Atlas, Gold
  Thread, Tempest, Gilt, Phosphor): panels take the material (`Card
  material`), so ink and panel come from one theme.
- Token-pair misses (Overprint pen and ink-soft on paper, Veil ink-soft on
  paper): darken that theme's token.
- The layered quote's shared sheet (`themes/quote-sheets.css:10-28`) paints a
  white highlight gradient and a white top edge that assume light paper; on
  Deck it greys the slip. Derive both from the material so dark papers get a
  dark highlight. This is the boxholder's grey-slab example; it passes the
  contrast measures, so it is fixed at the shared source rather than detected.

Reserved for the boxholder (exhibit with before/after, cost, lean):

- The resting "Properties" fold label at 28% opacity (1.1–1.8:1 in every
  theme).
- Posy's pink (bubble and nav button 3.8:1), Overprint's user bubble (2.8:1),
  Gilt's card heading over gold leaf (2.1–2.8:1) and gold nav buttons (3.8:1):
  signature colors or artwork.
- The base warm text scale (`text-warm-500/600` across about 240 call sites),
  which tours will now report in the plain app. Direction 1 versus 2 in the
  anchor issue.

## Plan review adjudication (codex gpt-6-sol, 2026-10-21)

Accepted and done in the prototype: group opacity is solved for the backdrop
when the faded group's background is a solid color, and reported as
unmeasured over an image (finding 5); boxes are clipped to clipping ancestors
and dropped when another element covers their centre (6); the capture's
aspect is checked against the viewport and the result is called an estimate
(7); every system stock is enumerated and text below the capture is counted
(8); single-theme mode never fails (1, see below); the grey-slab token
diagnosis was wrong and is now a shared-sheet fix (3); the surface-break rule
answers "contrast alone does not establish material use" (10).

Rejected or answered: (1) the boxholder asked for the environment to catch
contrast "naturally/automatically", which supersedes the skill's deferral for
this measure; the preview never blocks and adds no step. (4) Every pair in the
list is rendered together by a component: prose ink on paper and its soft
variant, links (pen), `Card material` panels (sheet, tint), the three quote
papers, code. (9) The preflight path list includes the studio harness and the
checker; tours report, they do not gate, and this plan says so. (2) The landing
gate stays strict: reserved decisions are resolved before landing, and a theme
the boxholder accepts below AA is changed or the check is revisited with them,
not quietly baselined.

## Could this be simpler?

Simplest: token pairs only, computed in CSS-variable space, no screenshots. It
fails on the boxholder's two examples' class: the Gilt heading over gold-leaf
artwork, the Overprint bubble, and any text whose background is an image or a
gradient are not token pairs, and the Settings picker failure is a component
that ignores the material, which no token reveals. Pixels-only fails on
material surfaces the specimen does not render (the layered sheet appears
only for one quote treatment). Each half catches cases the other cannot, so
both stay; each is under 150 lines.

A second simplification considered: a studio button that runs the audit live
in the page. Page script cannot capture pixels, so it would fall back to
token pairs and lose the image cases. Not done.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Animated background (Doodlebit walkers, Night Atlas motion) moves between capture and measurement | No (single capture: colors come from computed style, pixels from one shot) | Yes, by construction | n/a |
| Glyph-hiding style left on the page if the screenshot throws | `contrast.test.ts` (fake page throws) | `finally` restores | Clear |
| tsx `keepNames` injects `__name` into page functions | Prototype hit it | `call()` passes a no-op `__name` | Clear (eval error) |
| Text under an overlay (portaled menu) is measured against the overlay | No | Background capture is what the reader sees, so this is correct | n/a |
| `currentColor` borders/icons vanish in the capture and change the sampled background | No | Accepted: small area; percentile absorbs | Silent; documented |
| Router down at landing | No | `bin/theme-check` exits 2 with the browse error | Clear |
| False positive on a control border (prototype: composer input read its border) | `contrast.test.ts` input rect | Inputs measure their content box | Clear |

No critical gaps.

## Agent-flow / user-flow edge cases

- Wrong tool: an author runs `bin/browse screenshot` out of habit. ADDRESSED:
  the skill and theme-authoring doc name `bin/theme-check` as the screenshot
  step; tours and landing catch what it misses.
- A theme intentionally fades text (decorative): ADDRESSED by WCAG's own
  exemptions only (disabled, inert, visually hidden). A deliberate fade of
  readable text is a miss, reported as a boxholder decision.
- Hand-edit drift: a draft theme that defines only some tokens. ADDRESSED: the
  token pairs read computed values, so inherited defaults are measured as
  they render.
- Others (stale refs, concurrent agents, migrations): not applicable; no
  box data is written.

## NOT in scope

- Remapping the warm scale or sweeping `text-warm-500` (reserved decision).
- Replacing the per-theme `:is(.text-warm-500, …)` selector overrides in
  `themes/*-chrome.css` with material tokens. That refactor would remove the
  ad hoc class at its source; file as an issue with this audit as its guard.
- Driving real app pages under every system theme (would write the test
  box's `_config/box.json` per theme). The studio carries the components;
  tours check live pages under the box's own theme.
- The stale theme-tour fixtures on stock test1 (pending boxholder discuss).
- Non-text contrast (SC 1.4.11: borders, icons, focus rings).

## Open design questions

- Percentile (10th) and sample density are set from the prototype run; revisit
  if tours report texture noise. Lean: keep.

## Knowledge audits

The new agent-facing concept is "use `bin/theme-check` as the theme
screenshot". It lives in the bbx-theme skill; a dev knowledge audit entry is
added (`knowledge-audit --dev`) asking how to preview a theme.

## What will hold this after it ships

`contrast.test.ts` holds the scoring decisions (pure function over a raw
image). The finish preflight rule holds the landing gate, tested in
`bin/test/`. Tours report regressions weekly. The studio specimens are what
`--all` measures, so a new surface is covered when it is added to the studio.

## Implementation order

1. Library + unit tests (A).
2. `bin/theme-check`, studio specimens, docs and skill (B).
3. Tour checkpoint integration, preflight rule (C).
4. Fixes (D), one commit per theme family; re-run `--all`.
5. Exhibit: what the author sees on a miss; before/after for fixes; the
   reserved decisions with before/after captures.

## Rollout shape

Done when `contrast.test.ts` and the preflight test pass, `bin/theme-check
--all` reports only the reserved-decision misses, a tour run shows contrast
findings in its summary, and cross-model review of the diff is adjudicated.
No data migration.
