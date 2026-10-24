---
title: "Theme studio: show what the app shows, at screen scale"
status: implemented
workstream: theme-audit
issues:
  - ../../../issues/closed/features/2026-10-21-theme-studio-lacks-app-nav-specimen.md
  - ../../../issues/closed/code-quality/2026-10-21-theme-check-captures-paint-backdrops-at-capture-height.md
  - ../../../issues/closed/code-quality/2026-10-21-chat-material-themed-by-utility-class-overrides.md
  - ../../../issues/closed/code-quality/2026-10-21-base-warm-text-scale-contrast.md
---
# Theme studio: show what the app shows, at screen scale

The theme studio is where themes are drawn and where `bin/theme-check`
measures them. Today it lays out its samples in one tall page, shows less
than the themes style, and is driven by free-text fields. This plan makes it
paint at screen scale like the app, cover every part a theme styles, and be
quick to drive. It also moves chat text to material tokens and secondary text
to `warm-700`, which the studio then measures.

**Issues addressed:** the four in the frontmatter. Searched `issues/` for
"studio", "theme-check", "warm-500", "material": the related open items are
`2026-09-23-test1-lacks-theme-tour-fixtures.md` (left for the boxholder's
"discuss"; not touched) and the box-authored-theme items
(`2026-09-08-box-authored-themes.md`, `2026-09-11-theme-is-a-closed-builtin…`),
which this plan does not change.

## Design

No design section: tracks 1–3 are dev tooling. Tracks 4–5 keep each theme's
look (track 4) or apply a decision the boxholder made on 2026-10-21 (track 5,
recorded in `issues/code-quality/2026-10-21-base-warm-text-scale-contrast.md`,
"Decision" section: *"move secondary text to warm-700 and keep 400–600 for
borders and fills"*).

## Smallest fix and budget

Smallest fix per issue: render a copied nav bar in the studio; scroll the
capture; recolor the chat overrides; replace the two class names in 91 files.

Chosen tracks and estimates (source and tests, additions plus deletions):

| Track | Estimate |
|---|---|
| 1 Studio frame and controls | 350 |
| 2 Studio coverage and the coverage check | 450 |
| 3 theme-check per screen | 150 |
| 4 Chat material tokens | 300 |
| 5 Secondary text to warm-700 | 500 (mostly one-token edits) |

About 1,750 lines; docs about 80 more. Not a BIG CHANGE. The fuller design
buys a studio whose coverage is checked: a theme hook the studio does not
render is reported, so the next copied specimen cannot drift unseen. The
2026-10-21 work found two such drifts (13 rules keyed on a class the
component stopped using, and a nav specimen that missed the real pills).

## Stated preferences this plan trades against

- Boxholder, this workstream: *"I don't want ad hoc solutions, but a proper
  color and style auditing solution will naturally find these errors."* The
  coverage check (track 2) is the audit for the studio itself.
- Boxholder, this request: *"Try to make the theme studio a good studio, fix
  any annoyances or caveats you find."*
- Memory rule, minimize invented concepts: track 4 reuses the card material
  tokens (`--bbx-ink`, `--bbx-ink-soft`, `--bbx-pen`) instead of a second
  chat token set.
- `.claude/skills/bbx-theme/SKILL.md`: the theme loop stays fast and
  untested until landing; nothing here adds a gate to it.

## What already exists

- Studio harness: `src/frontend/src/pages/dev/components/ThemeStudioHarness.tsx`
  (206 lines). Its nav is a copy: `NavigationSample` says *"Match AppNav/nav.tsx"*
  and renders three `Button`s. `UserMessageSample` copies classes: *"Base row
  and bubble classes from chat/user-message/view.tsx"*. Rebuild both on real
  components.
- Search schema: `src/frontend/src/lib/theme-studio-search.ts` (four strings).
  Extend.
- The app's presentation is screen height: `BoxPresentationProvider.tsx:50`
  `className="bbx-box-presentation h-full"`. The studio's is `min-h-screen`
  (`ThemeStudioHarness.tsx`, the `bbx-box-presentation min-h-screen` div).
- theme-check: `test/tours/theme-check.ts` captures at 1280×2400 and 375×4400
  (`VIEWPORTS`) and fits the studio to the screen only for the backdrop pass
  (`FIT_STUDIO_SCRIPT`). `tour-lib/contrast.ts:209` `auditContrast(page,
  { outline })` measures one viewport and counts runs outside it as
  `offscreen`. Reuse per screen.
- Real nav faces: `VoiceChipFace` (`components/chat/VoiceChip/view.tsx:57`)
  is presentational. `AttentionBadges` (`components/AppNav/app-nav-badges.tsx:59`)
  takes counts as props. `PlacePill` (`PlacePill.tsx:81`) and `SessionChip`
  (`SessionChip.tsx:243`) query tRPC; their faces are inline in a
  `Dropdown` trigger. Extract the two faces.
- Real chat pieces with props: `UserMessage` (`user-message/view.tsx:111`,
  takes `entries`), `SidecarTabStrip` (`workspace/SidecarTabStrip/view.tsx:126`,
  takes `tabs`, `identities`).
- Material context: `components/ui/material.ts` (`MaterialContext`,
  `useMaterial`); `Hint.tsx:15` picks `text-card-soft` in a material and
  `text-warm-500` outside one. Tailwind's `card` color family reads the
  tokens: `tailwind.config.js:113` *"card: { … soft: `var(--bbx-ink-soft, ${palette.warm[700]})`"*.
- Per-theme chat overrides: one rule per dark theme of the form
  `:is(.bbx-chat-reply-material, .bbx-chat-pending-material, .bbx-chat-meta-material) :is(.text-warm-500, .text-warm-600, .text-warm-700, .text-warm-800, .text-primary)`
  (`gilt-chrome.css:45`, `deck.css:166` and `:327`, `night-atlas.css:168`
  and `:292`, `doodlebit-chrome.css:45`, `goldfish-chrome.css:45`,
  `tempest-chrome.css:45`, `veil-chrome.css:45`, `textile-chrome.css:61`,
  `ribbon.css:174`), plus `.bg-warm-50` light-plate exceptions
  (`gilt-chrome.css:62`).
- Secondary text: `grep -rE "text-warm-(500|600)"` over
  `src/frontend/src` finds 235 uses in 91 files (151 `text-warm-500`,
  80 `text-warm-600`, 3 `hover:text-warm-600`).

## Prior art (external)

No decision depends on an external premise. One platform fact: CSS media
queries follow the viewport, not a container, so a phone-sized preview inside
a desktop window needs an `<iframe>`; a sized `<div>` would keep the desktop
layout. Evaluated only.

## Ontology

- **Studio case**: the four search values `system`, `systemStock`, `card`,
  `cardStock` (existing, `theme-studio-search.ts`).
- **Screen**: a named width×height the studio is viewed or checked at
  (existing `SCREENS` in `theme-check.ts`; moves to a shared module so the
  studio's size picker and theme-check use one list).
- **Theme hook**: a `bbx-` class that theme CSS styles (existing term in
  `docs/theme-authoring.md`, "chrome hooks").
- **Specimen**: a real component rendered in the studio with fixed fictional
  props (existing usage: "composer specimen", `ComposerSpecimen`).
- **Material**: the ink and paper tokens a surface declares (existing,
  `material.ts`). Chat material elements become materials too. The Tailwind
  family keeps its name `card-*`; its config comment says it reads the
  nearest material, card or chat.
- **Unmatched rule**: a theme CSS rule, scoped to the theme under test, that
  matches no element in the studio at any screen size checked.

No new nouns beyond the screen list's move and the unmatched rule.

## Tracks / scope

### Track 1 — Studio frame and controls

**What.** The presentation fills the window and scrolls inside, like the
app. The controls become a small floating panel. Fields become pickers.

**Why.** At `min-h-screen` the presentation grows to its content, so
artwork sized to the presentation paints at a scale no screen shows. The
controls take a quarter of a phone screen. A theme change keeps the old
stock (`deck` with `leaf` renders base styles without a word), and a system
theme change leaves the card theme behind.

**Direction.**
- Presentation: `h-dvh` with one inner scroller (`overflow-auto`) holding the
  samples, so the artwork stays put while samples scroll, as in the app.
- Controls: a `position: fixed` panel at the top right, collapsed to one
  "Studio" button; open state is per-viewer `localStorage` (wrapped in
  try/catch). Search param `controls=0` omits it; theme-check and the size
  frame use that.
- Pickers: theme `<select>` lists catalog themes, the studies and `draft`,
  plus "Other…", which shows a text field; a name only in the URL selects
  "Other…" with that name. Stock `<select>` lists the theme's catalog stocks
  plus "Other…" with a text field, so a draft or study can try any stock. Changing a theme sets its stock to
  `defaultStock`. A "Card follows system" checkbox, on when the card is the
  system theme's pairing (the rule in `catalogCases()`: itself, or
  `cardThemes[0]` for a system-only theme), moves the card with the system.
- Notice: when a theme lacks the stock in the URL, the panel says so.
- Screen picker: Fill, or one of the shared screens. A screen renders an
  `<iframe>` of the same URL with `controls=0` and without `screen` (so it
  cannot embed itself) at that size, scaled down to fit the window. Search
  param `screen`.

**Vocabulary lock-ins.** Search params `controls`, `screen`. Module
`src/shared/theme-screens.ts` exporting `SCREENS`.

**First chunk.** Inner scroller and `h-dvh`; `controls=0`; floating panel;
pickers with stock reset. No open questions.

### Track 2 — Studio coverage and the coverage check

**What.** The studio renders every theme hook, with real components; and
theme-check reports any hook it does not.

**Why.** Of the hooks named in `themes/*.css`, the studio rendered none of
these on 2026-10-21 (measured by listing classes in the studio DOM):
`bbx-place-pill`, `bbx-interface-tabstrip`, `bbx-interface-tab*`,
`bbx-companion-desk`, `bbx-conversation-desk`, `bbx-interface-card-desk`,
`bbx-chat-meta-material`, `bbx-chat-user-attachment*`,
`bbx-chat-user-status`, `bbx-chat-user-token`, `bbx-chat-user-unsure`,
`bbx-card-fields`, `bbx-card-field-label`, `bbx-card-contents*`,
`bbx-card-chat-path`, `bbx-card-problem`, `bbx-quote-inline`,
`bbx-quote-speakers`, `bbx-quote-mark`, `bbx-theme-swatch*`,
`bbx-card-overlay*`, `bbx-card-print-*`, and others. Every one is a place a
theme can fail with no capture showing it.

**Direction.**
- Nav: render the real `<nav className="bbx-app-nav">` row with
  `PlacePillFace`, `SessionChipFace`, `VoiceChipFace`, `AttentionBadges` and
  an `Avatar`, with fixed props. Extract `PlacePillFace` and
  `SessionChipFace` from the `Dropdown` triggers in `PlacePill.tsx` and
  `SessionChip.tsx`; the live components render the same faces.
- Desks: the conversation column sits in `.bbx-conversation-desk`; the card
  column in `.bbx-companion-desk` with a real `SidecarTabStrip` (fixed tabs)
  over `.bbx-interface-card-desk`.
- Chat: replace `UserMessageSample` with `UserMessage` on fixed entries that
  include an attachment, a status and an unsure token; add meta lines (sender,
  "Request interrupted", load-older button).
- Cards: a field card (fields, contents, chat path), a card with a problem,
  inline and speaker quotes in the sample Markdown, the card theme swatches.
- Tab specimens carry the selected card theme (`data-card-theme`), so a
  theme's tab rules apply to them (codex: without presentation data
  `SidecarTabStrip` resolves tabs to `plain`, `SidecarTabStrip/view.tsx:22`).
- Rule coverage check (`tour-lib/rules-page.ts` + `rules.ts`, the pattern of
  `backdrop-page.ts`): in the page, walk `document.styleSheets`. Keep each
  style rule whose selector names the case's theme
  (`[data-chrome-theme="x"]` or `[data-card-theme="x"]`, the forms theme CSS
  uses). Skip rules under `@media print`; for other `@media` rules, test only
  when `matchMedia` matches the current screen. Strip user-action
  pseudo-classes (`:hover`, `:focus`, `:focus-visible`, `:focus-within`,
  `:active`) and pseudo-elements, then `document.querySelector` the
  selector. The browser parses the selector, so `:not(…)` and comments need
  no parser of ours. A rule is covered when it matches at any screen size of
  the backdrop pass. Report each uncovered rule with its stylesheet and
  selector: *"rule matches nothing in the studio: <selector> (gilt-chrome.css)"*.
  Draft and study CSS is loaded in the studio, so a single-theme run checks
  drafts too.
- An uncovered rule is fixed by a specimen, or deleted when it is dead CSS.
  Exemptions are one list in theme-check of selector substrings, each with a
  reason (for example, the modal card overlay if it cannot render inline).
- The check is a miss under `--all` (exit 1), like the other checks.

**Vocabulary lock-ins.** `PlacePillFace`, `SessionChipFace` exports.

**First chunk.** Extract the two faces with a render test each (the live
composition and the studio's render the same face); studio nav from real
faces; delete `NavigationSample`. No open questions.

### Track 3 — theme-check per screen

**What.** The contrast pass measures at real screen sizes, one screen of
scroll at a time.

**Why.** The issue: capture heights of 2400 and 4400 paint artwork at a
scale no screen shows, so contrast is measured over the wrong pixels.

**Direction.** Viewports become 1366×768 and 375×667 from `SCREENS`. Open
the studio with `controls=0`. For each scroll step of the inner scroller
(step = scroller height minus 80px overlap): `auditContrast`, screenshot to
`<case>.<screen>.<n>.png`, then scroll. Today `auditContrast` returns counts
for offscreen runs and assigns run ids per collection
(`contrast.ts:197`, `contrast-page.ts:193`), so the collector changes: it
stamps each text element with a stable `data-bbx-audit-run` id on first
sight (the DOM persists across scroll steps) and returns, per run, whether
it was wholly on screen. The merge keys failures by that id and counts a run
offscreen only when no step showed it whole. Delete `FIT_STUDIO_SCRIPT`; the
studio fits by itself.

**First chunk.** Collector ids and whole-visible flag, with a unit test of
the merge; then the stepping loop.

### Track 4 — Chat material tokens

**What.** Chat material elements declare material tokens; chat text reads
them; the per-theme utility-class overrides go.

**Why.** The issue: overrides keyed on utility class names stop applying
silently when a component changes a class (13 rules did on 2026-10-21).

**Direction.**
- Chat materials provide `MaterialContext` true at their roots
  (`bbx-chat-reply-material`, `-pending-`, `-meta-`), so `Hint`, `Text` and
  `Heading` pick material ink. Raw `text-warm-*` text inside chat material
  roots changes to `text-card-soft` / `text-card-ink`; `text-primary`
  links there to `text-card-pen`.
- Each dark theme sets `--bbx-ink`, `--bbx-ink-soft`, `--bbx-pen` on its chat
  material hooks to the colors its override rule used, and the override rule
  is deleted. Light plates inside replies (`.bg-warm-50`) get a hook and reset
  the tokens to the base material, replacing the `.bg-warm-50` exceptions.
- Prose variables (`--tw-prose-*`) stay as they are; they are already
  variables.

**First chunk.** Deck: tokens on its chat materials, chat text classes moved,
its override rules deleted, theme-check before/after identical in color.

### Track 5 — Secondary text to warm-700

**What.** The decided direction: text at `warm-500`/`warm-600` moves to
`warm-700`; borders and fills keep 400–600.

**Direction.** Primitives first: `Hint` non-material branch, `Text` muted
tone. Then each remaining call site: text → `text-warm-700`; an icon-only
element (SVG, no text) → `text-warm-600` (3.5:1 meets the 3:1 rule for
graphics); disabled controls keep their color (WCAG 1.4.3 exempts inactive
components). `placeholder:` and `hover:` variants follow the same rule.

**First chunk.** The two primitives.

## Could this be simpler?

The simplest version: copy the real nav markup into the studio, scroll the
captures, recolor overrides, `sed` the class names. It fails on drift: a
copied specimen stops matching the component and nothing says so, which is
how both the Paper nav pill miss and the 13 dead `.text-accent-dark` rules
happened (boxholder's rule: an auditing solution that finds these errors).
Real components plus the coverage check close that. The `sed` fails on
icons and disabled text, which have different rules.

Cut from the fuller idea: a live in-page contrast overlay in the studio
(needs pixels, which only a screenshot gives; see NOT in scope).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A face extraction changes the live nav's markup | New render test per face | Faces are the same JSX moved | Clear: tests fail |
| Rule check reports a rule only a state can reach (`:disabled`, `[data-active]`) | Exemption list | Render the state as a specimen, or exempt with a reason | Clear: the miss names the selector |
| Rule check passes a rule that matched a hidden element | None | Accepted: a rule matching a hidden specimen is rare; contrast and captures still show visible ones | Silent; documented risk |
| Scroll steps miss a run that straddles two steps | New unit test on merge | 80px overlap; offscreen counted when never whole | Clear: reported as offscreen |
| Iframe preview loads the studio without box auth | Manual | Same origin, same cookie | Clear: the frame shows the login |
| A theme's chat soft text changes color after track 4 | theme-check --all; before/after captures | Token values copied from the override rules | Clear in captures |
| warm-700 edit hits a border or fill class | Review of the diff | Edits only `text-` utilities | Clear in review |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong tag / field: an agent adds a theme rule and no specimen, or a
  component drops a class a rule keys on. ADDRESSED: the rule check reports
  the rule as matching nothing.
- Stale ref: a URL with a removed theme name. ADDRESSED: the picker shows it
  as "not in catalog".
- Two agents, hand-edit drift, fabricated values, migration: not applicable;
  no box data changes.
- Validation error UX: coverage misses name the hook and the fix ("render it
  in ThemeStudioHarness.tsx or exempt it with a reason").
- Partial migration: tracks 4 and 5 land in one branch; theme-check --all is
  green at each commit that lands.

## NOT in scope

- Live contrast overlay inside the studio: pixel contrast needs a
  screenshot, which a page cannot take of itself. File an issue.
- Print-media checks: print styles are exempt from coverage with a reason.
- Non-chat surfaces themed by utility-class overrides (if any remain): track
  4 covers chat, which the issue names.
- Remapping the warm scale in `tailwind.config.js`: the boxholder chose the
  call-site direction.
- The test1 theme-tour fixtures issue: left for the boxholder's discussion.

## Open design questions

None open. Settled above: reuse material tokens and the `card-*` utilities for
chat (minimize-concepts rule; codex review: a rename adds churn and fixes
nothing).

## Knowledge audits

Skip: no box-agent concept changes. The dev guidance change is the
coverage-check line in `docs/theme-authoring.md` and the skill.

## What will hold this after it ships

- Unit tests (`test/tours/*.test.ts`, the tier `backdrop.test.ts` uses): the
  rule-selector reduction (pseudo-class stripping, print skip), step merge.
- Render tests for `PlacePillFace` and `SessionChipFace`.
- `bin/theme-check --all` at landing (finish-preflight's "theme" kind) holds
  coverage, contrast per screen and backdrops.
- Existing component tests for `PlacePill`, `SessionChip`, `Hint`, `Text`.

## Implementation order

1. Track 1 (studio frame, controls, screen module).
2. Track 2 (faces, specimens, coverage check). Depends on 1 for the desks
   layout.
3. Track 3 (per-screen contrast). Depends on 1 (`controls=0`, inner scroller).
4. Track 4 (rename, then tokens and override deletion), verified by
   `bin/theme-check --all`.
5. Track 5 (primitives, then call sites by directory).
6. Docs: `docs/theme-authoring.md`, `bbx-theme` skill (remove more than
   added), `docs/testing/tours.md` if theme-check output changes.

## Rollout shape

Done when: the new unit tests pass; `bin/theme-check --all` reports no
contrast, material, backdrop or coverage miss; change-selected tests,
typecheck and lint pass; a cross-model diff review is adjudicated; an
exhibit shows the studio at Fill and Phone, and before/after for a chat
reply in two dark themes. No data migration.
