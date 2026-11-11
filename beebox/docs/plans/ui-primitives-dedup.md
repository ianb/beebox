---
title: "UI primitives: remove duplicates and guard against new ones"
status: active
workstream: web-guidance-scan
issues:
  - ../../../issues/code-quality/2026-10-13-component-reuse-review.md
  - ../../../issues/exploration/2026-10-08-motion-in-the-app.md
  - ../../../issues/decisions/2026-08-26-axe-region-rule-on-floating-menus.md
  - ../../../issues/code-quality/2026-10-23-frontend-smaller-near-duplicates.md
  - ../../../issues/bugs/2026-10-24-status-and-error-text-ignore-card-material.md
  - ../../../issues/code-quality/2026-10-31-modules-at-line-cap-block-small-changes.md
  - ../../../issues/exploration/2026-11-10-adopt-modern-web-guidance-skill.md
---
# UI primitives: remove duplicates and guard against new ones

The beebox frontend has several hand-made copies of the same UI shapes:
popovers, menus, spinners, status dots, skeletons, lists, tables, form
controls and time formats. This plan moves each copy onto one primitive in
`components/ui/`, gives each concept one name, and adds lint and check guards
so that the next copy fails a check. Each guard lands in the same commit as
the removal of the copies it would flag.

Paths without a package prefix are relative to `beebox/src/frontend/src/`.

**Issues addressed:**

- Resolves `issues/code-quality/2026-10-13-component-reuse-review.md`: its
  remaining steps are "input/select primitives, the two remaining overlays and
  the reporting check" (re-review note, 2026-10-30). Tracks 5, 7, 8 and the
  guards do all three.
- Touches, does not resolve:
  - `issues/exploration/2026-10-08-motion-in-the-app.md`: Track 3 adds the
    "one rule for the rest" for reduced motion. The question of which moments
    get motion stays open.
  - `issues/decisions/2026-08-26-axe-region-rule-on-floating-menus.md`: the new
    `Popover` portals to `<body>` like the menu, so it meets the same axe
    `region` finding. The decision stays with that issue.
  - `issues/code-quality/2026-10-23-frontend-smaller-near-duplicates.md`: Track 9
    removes the duplicates the new class-string check finds. The five groups
    that issue lists (upload XHR, media-query hooks, tab intervals, retry
    backoff, external links) are not class duplicates and stay open.
  - `issues/bugs/2026-10-24-status-and-error-text-ignore-card-material.md`:
    Track 4 adds a `StatusMessage` variant. It does not change its ink.
  - `issues/code-quality/2026-10-31-modules-at-line-cap-block-small-changes.md`:
    `ui/Dropdown.tsx` (410 lines) and `ui/fields/field.tsx` (335 lines) are near
    the 300-code-line cap; Tracks 5 and 7 split them before they grow.
  - `issues/exploration/2026-11-10-adopt-modern-web-guidance-skill.md`: this is
    the second pass of that adoption.
- Searched with `bin/issues search --all` for: duplication, duplicate
  component, overlay, popover, spinner, naming, lint rule, dropdown, modal,
  reduced motion, skeleton, table component, raw input, primitive, ellipsis,
  focus ring outline. No other open issue covers this work. No issue was ever
  filed for the ack-badge, audio-badge or filter-bar popovers.

## Design

No design section: the plan normalizes existing looks onto one look per
primitive and adds no new surface, behavior or record. Where copies differ
today, Direction picks one look (the boxholder: "you shouldn't assume there's
a good reason for differences"). The visible changes are shown before and
after in one exhibit at the end (Implementation order, step 12).

## Smallest fix and budget

The smallest fix for the problem the boxholder named ("overlays and stuff
happened multiple times") is Track 7 alone: one `Popover`, the five popovers
moved onto it, and the anchored-panel lint entry. It leaves spinners, dots,
lists, tables, fields, dates and names duplicated, and leaves the cause (no
guard on `components/`) in place for every other shape. The boxholder
approved the wider list (renames, A1–A4, B2, B3, B9, reduced motion, the
field, list and table primitives, the date helpers), so the smallest version
that meets the request is every approved duplicate family migrated in full,
plus only the guards whose behavior and exceptions this plan demonstrates.
That is the design below. After the cross-model review (Review section) it
no longer has the ellipsis rule or the name-to-render inference, and it now
specifies the Popover, `Menu at`, table and class-matching contracts that
were missing.

By track. Lines are additions plus deletions.

| Track | Source | Tests | Docs |
|---|---|---|---|
| 1 Vocabulary renames | 240 | 25 | 15 |
| 2 UI doc coverage check and overlay docs | 90 | 60 | 70 |
| 3 Reduced motion, `Spinner`, class matcher, `restricted-classes` rule | 330 | 310 | 50 |
| 4 `LiveDot`, `Skeleton`, inline `StatusMessage` | 160 | 65 | 30 |
| 5 Field gaps, `require-ui-primitive` rule | 415 | 210 | 50 |
| 6 `List` and `Table`, content-renderer contract | 320 | 135 | 20 |
| 7 Anchored layer, `Menu at`, `MenuItem` link and action, `Popover`, toast hold, name rule | 740 | 440 | 60 |
| 8 Full-screen `ModalDialog`, `ControlRing`, viewport-layer and dialog entries | 215 | 85 | 12 |
| 9 Repeated class-string check, its fixtures, and the duplicates it finds | 330 | 140 | 15 |
| 10 Time formatting | 90 | 50 | 8 |
| 11 Focus-outline entry, other packages' rules, workstreams-app overlays | 95 | 40 | 15 |
| **Total** | **about 3,035** | **about 1,560** | **about 345** |

**BIG CHANGE.** About 4,600 changed source and test lines and about 345 lines
of authored docs. The boxholder approved this work at about 2,000–2,500
lines. This estimate is above that, and above the 3,000-line flag. What drives
the size:

- Three new lint rules, one shared class matcher and one whole-tree check,
  each with the RuleTester, fixture or unit suite that
  `personal-vibe-check/AGENTS.md` requires ("Shipping a rule without tests is
  not acceptable"). The guards are about 1,300 of the 4,600 lines.
- The interaction contracts the review asked for (Popover focus and dismiss,
  `Menu at`, `MenuItem` router links and sibling actions, the toast hold,
  the table name and scroll owner). They add about 650 lines over the first
  estimate; the two cut guards removed about 250.
- About 150 call sites, most of them one to five lines each.
- Two splits of files at the line cap (`Dropdown.tsx`, `fields/field.tsx`).
  A split counts its moved lines twice.

The first pass ran 1.7 times its estimate (`modern-web-guidance-adoption.md`,
"Implementation status", "**Size.**"). This estimate counts tests at the rate
that pass measured. A cut line, if the boxholder wants one: Tracks 1–8 are
about 3,750 source and test lines; Tracks 9–11 (about 850) can be a follow-up
plan. Track 9 is the only guard against copies of shapes this plan does not
name, so the follow-up should not be dropped.

## Stated preferences this plan trades against

- **Boxholder, this plan:** "I strongly want to remove duplication, which
  might mean generalizing existing components slightly, but often just means
  normalizing things." "Anyplace we are guarding against future duplicates,
  we should eliminate current duplicates." Every guard below lands with zero
  findings; there is no baseline file of known duplicates.
- **Boxholder, this plan:** "if two things make the same component ideally
  they'd hit the same name, then see the duplication!" Track 1 renames, and
  the `component-name-suffix` rule bans the suffixes that hid the copies.
- **`beebox/docs/engineering-principles.md` §8, "One way to do each thing":**
  "caller churn, import churn, and differing defaults are migration work, not
  reasons to keep the duplication." No alias is kept for a renamed export.
- **§11, "Enforcement beats convention":** "Suppression is sometimes right,
  but it's infrequent, signaled, **line-level only** (never file- or
  rule-level) … when a legitimate exception *recurs*, encode it into the rule
  itself rather than accumulating disables." Each exception is encoded in
  the rule as a per-entry `allowIn` list of the files that own the shape, with
  the reason in a config comment. No guard exempts a whole directory (the
  existing `ignores: ["**/components/**"]` at
  `beebox/src/frontend/eslint.config.ts:213` is the pattern this plan does not
  repeat). No line-level disable is added; the three `prefer-native-dialog`
  disables today are removed.
- **Root `AGENTS.md`:** "Do not disable or weaken lint rules … The existing
  exception is one `eslint-disable-next-line <rule> -- <concrete
  justification>` for a true, narrow false positive." No rule is weakened.
  Three existing `prefer-native-dialog` disables are removed (Track 7, 8).
- **Memory, "Minimize invented concepts; prefer primitives":** `Popover`
  is the platform's own `<dialog popover>`; `List` replaces `Stack as="ul"` so there is one
  list concept, not two; the guards reuse ESLint and the existing
  `no-restricted-imports` patterns before adding rules.
- **`beebox/frontend.md:249-255`, "Adding a new UI primitive":** "Is the
  pattern used 3+ times with uniform look? If so, extract a primitive." Every
  new primitive below has three or more callers except `AnchoredLayer` (Menu,
  Popover, one selection button) and `ModalDialog layout="fullscreen"` (two).
- **Shipped precedent:** `beebox/docs/implemented-plans/frontend-visual-near-duplicates.md`
  (2026-10-23). It added `Notice` and `ModalCard`, converted all callers per
  track in one commit, and used DOM tests from `test/helpers/dom-harness.ts`.
  This plan follows that shape. That plan added no guard, and the audio-badge
  copy that followed is why guards are a track here.

## What already exists

- **Modal primitive.** `components/ui/ModalCard.tsx:44` (`export function
  ModalCard`) with `useModalDialog` (`hooks/useModalDialog.ts`). Reuse;
  rename to `ModalDialog` (Track 1). Five callers already use it.
- **Menu primitive.** `components/ui/Dropdown.tsx:198` already portals,
  positions and dismisses: `:244` "it's positioned `fixed` from the trigger's
  viewport rect", `:315` `useDismiss({ root: rootRef, portal: menuRef, open,
  onDismiss: closeMenu });`, `:106` `kind?: "menu" | "navigation";`. Reuse;
  rename to `Menu`, and extract its positioning into an `AnchoredLayer` that
  `Popover` shares (Track 7).
- **Dismiss hook.** `hooks/useDismiss.ts:12`. Reuse inside `ui/` only.
- **Lists.** `components/ui/Stack.tsx:88-89` already renders `<ul role="list">`
  and `<ol role="list">`; 4 callers use it. Rebuild as `List`, because
  `Row` has no list form and the 11 marked lists (`list-disc`,
  `list-decimal`) have no primitive. One list primitive replaces two
  partial ones.
- **Tables.** None in `ui/`. Seven raw `<table>` sites.
- **Spinner.** A private `function Spinner()` at `components/ui/Button.tsx:138`.
  Reuse its SVG; export it as `ui/Spinner`.
- **Loading text.** `components/ui/StatusMessage.tsx:4` `export type
  StatusMessageVariant = "pane" | "menu";`. Extend with `inline`.
- **Fields.** `components/ui/fields/field.tsx`: `CheckboxField` (`:224`),
  `SelectField` (`:296`). Extend: bare `Checkbox`, `SelectField tone`. The dark
  tone already exists on the modal: `ModalCard.tsx:33` `dark: "border
  border-gray-700 bg-gray-900 text-white",`.
- **Ring.** `components/ui/ControlRing.tsx:47` draws an accent ring around an
  element on a timer. Generalize (Track 8).
- **Reduced motion.** `lib/reduced-motion.ts:5-6` "Declarative motion uses
  Tailwind's `motion-safe:` prefix instead (see `components/ui/Dropdown.tsx`)".
  `index.css` has no global `prefers-reduced-motion` rule (grep, 2026-11-11).
  Keep the helper for scripted motion; replace per-site `motion-safe:`.
- **Time.** `beebox/src/shared/relative-time.ts:44` `export function
  formatDuration(ms: number): string`; `components/ui/FriendlyDate.tsx:47`
  `export function friendlyDate(value: string | number, mode?: "datetime" |
  "date"): string`. Extend both.
- **Lint plugin.** Six custom rules in `personal-vibe-check/rules/`. The
  closest model for the new class rule is `restrict-component-classes.ts`,
  whose class-string reader (string literals, template quasis, conditional
  branches) the new rule shares. `no-px-font-size-class` is the model for an
  opt-in Tailwind rule set in the project config
  (`beebox/src/frontend/eslint.config.ts:223-227`).
- **Restricted imports.** `beebox/src/frontend/eslint.config.ts:147-156` sets
  `@typescript-eslint/no-restricted-imports` with `patterns`. Reuse: add one
  pattern for the overlay hooks.
- **Doc reads code.** `beebox/src/dev/doc-check/check.ts:275-279`
  `agentChangesDocProblems` fails when a doc and the code's list of handles
  disagree. The new UI doc coverage check follows that shape.
- **Whole-tree check wiring.** `.husky/pre-commit:146-149` runs `pnpm
  layout-check` on staged code; `bin/lint-changed.ts:185` adds it to
  `lint:changed`. The new `ui-check` is wired the same way.

## Prior art (external)

- **Global reduced-motion rule** (adapted). Andy Bell, "A (more) Modern CSS
  Reset": `@media (prefers-reduced-motion: reduce)` sets animation and
  transition durations to near zero on `*`.
  https://piccalil.li/blog/a-more-modern-css-reset/ . Adapted with a spinner
  exemption. ACKNOWLEDGEMENTS.md entry lands in Track 3.
- **WCAG 2.3.3, Animation from Interactions** (evaluated): motion that is
  essential to the function is exempt.
  https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html .
  A spinner shows that work continues, so it slows and does not stop.
- **Non-modal `<dialog>` with `show()`** (evaluated, rejected for `Popover`).
  Available at the floor, but `show()` runs the dialog focusing steps on open
  and does not use the top layer.
  https://html.spec.whatwg.org/multipage/interactive-elements.html#dom-dialog-show .
  See Track 7's comparison.
- **Popover API** (adopted for `Popover`, as `<dialog popover="manual">`).
  The guide data lists "Safari iOS 18.3"
  (`research/modern-web-guidance/audit/ui-components.md:13`). WebKit's 18.3
  notes describe the change as outside-tap light dismiss on iOS
  (https://webkit.org/blog/16439/webkit-features-in-safari-18-3/), which a
  `popover="manual"` element with our own dismiss does not rely on. So the
  reason the three existing disables give (`components/chat/ack-badge.tsx:75`
  "popover deferred (full support at iOS 18.3, above the iOS 18.0 floor)")
  does not apply to `manual`. A top-layer element is rendered above the page
  but stays where it is in the DOM
  (https://drafts.csswg.org/css-position-4/#top-layer), so a popover inside a
  modal dialog stays the dialog's descendant and is not made inert
  (https://html.spec.whatwg.org/multipage/interaction.html#modal-dialogs-and-inert-subtrees).
  `prefer-native-dialog`'s own message already points non-modal overlays at a
  popover (`personal-vibe-check/rules/prefer-native-dialog.ts:59`). Unverified
  here: that WebKit at iOS 18.0 displays a `<dialog popover>` opened with
  `showPopover()` and exposes its dialog role; Track 7 checks it in the
  simulator before any site moves.
- **ESLint flat config** (evaluated). Options of one rule do not merge across
  config objects; the last match wins.
  https://eslint.org/docs/latest/use/configure/configuration-files#cascading-configuration-objects .
  `beebox/eslint.config.ts:19-20` records the consequence for
  `no-restricted-syntax`: "a second `no-restricted-syntax` entry REPLACES the
  preset's". So the new bans are custom rules with their own options, not
  `no-restricted-syntax` selectors.
- **Cross-file duplicate class strings** (evaluated, unverified). Code-clone
  tools such as jscpd (https://github.com/kucherenko/jscpd) compare token
  runs of code, not Tailwind class sets. I know of no Tailwind lint rule that
  compares class strings across files; check the eslint-plugin-tailwindcss
  rule list before writing Track 9's script. If one exists, use it.
- **Safari drops list semantics under `list-style: none`** (already adopted in
  the first pass): https://www.scottohara.me/blog/2019/01/12/lists-and-safari.html .
- **axe `scrollable-region-focusable`** (evaluated): a scrolling table wrapper
  must be keyboard-reachable.
  https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable .
  `Table` owns the focusable wrapper.

## Ontology

Existing names are marked (exists). New names are marked (new).

- **`ModalDialog`** (rename of `ModalCard`, exists at
  `components/ui/ModalCard.tsx:44`): a native `<dialog>` opened with
  `showModal()`. Props add `layout: "card" | "fullscreen"` and `label` as an
  alternative to `labelledBy`. Not a popover; not a toast. Callers are named
  `<Thing>Dialog`.
- **`Popover`** (new): a small panel anchored to a trigger, non-modal, light
  dismiss (outside press, Escape), with the focus contract in Track 7.
  Renders a `<dialog popover="manual">` in the tree directly after its
  trigger, shown with `showPopover()` and positioned by `AnchoredLayer`. Not a
  command menu (that is `Menu`). Callers are named `<Thing>Popover`.
- **`Menu`** (rename of `Dropdown`, exists): a command menu (`kind="menu"`,
  default) or a navigation disclosure (`kind="navigation"`). Anchored to a
  trigger, or (new) to a point `at={{ x, y }}` with `openedBy` and
  `returnFocus`. Callers are named `<Thing>Menu`.
- **`MenuItem`, `MenuDivider`** (exist, in `ui/dropdown-menu-item.tsx`, renamed
  file `ui/menu-item.tsx`). `MenuItem` gains TanStack link props (`params`,
  `search`, `hash`, `state`) and `action` (a sibling menu item beside the
  row, never inside it).
- **Menu page** (rename of Dropdown "panel"): one screen of a multi-screen
  menu. `panelIndex` becomes `pageIndex`. "Panel" is reserved for the
  companion side pane (`OpenInPanelButton`).
- **Menu body** (exists as a name: `ContextMenuBody`, `SwitchMenuBody`): a
  component that renders the rows of one menu page. The six `*Panel` menu
  bodies become `*MenuBody`.
- **`AnchoredLayer`** (new, `ui/`): positioning for a layer anchored to an
  element or a point, clamped to the visual viewport, and the dismiss
  listeners. It does not choose where the layer mounts: `Menu` portals into
  `trigger.closest("dialog") ?? document.body` (its current mechanism),
  `Popover` stays in the tree as a top-layer popover. Used by `Menu`,
  `Popover` and the selection "+" button. Carries no ARIA role.
- **`List`** (new): a `<ul>` or `<ol>` with `marker: "none" | "disc" |
  "decimal"`, `gap`, `direction: "column" | "row" | "wrap"`, `divided`.
  `marker="none"` sets `role="list"`. Replaces `Stack as="ul" | "ol"`.
  Children are raw `<li>`.
- **`Table`, `Th`, `Td`** (new): `Table` owns the one scroll container and
  the name (`caption: string` or `labelledBy`, one required), `variant: "data"
  | "grid"`, `scroll: "x" | "both"`. `Th` requires `scope`. `Th`/`Td` forward
  cell attributes. `thead`, `tbody`, `tr` stay raw.
- **Rendered document content** (term): structure that comes from a document
  (Markdoc output, Docling tables, spreadsheet grids), as opposed to
  application-authored structure. JSX content renderers use `Table
  variant="grid"`; Markdoc output is outside the JSX rules.
- **`Spinner`** (new export of the private one): an indeterminate progress
  glyph. `size`, `tone: "current" | "onDark"`. CSS hook class `bbx-spinner`.
- **`LiveDot`** (new): a small round dot that pulses to mean "ongoing".
  `tone`, `size`. Not a badge, not a spinner.
- **`Skeleton`** (new): one placeholder bar shaped by `className` sizing. A
  page's own arrangement of bars is a `<Thing>Skeleton` component.
- **`StatusMessage` `variant="inline"`** (new value): small muted status text
  inside a section.
- **`Checkbox`** (new): a bare checkbox with no label wrapper, for a row whose
  text labels it or a display-only marker. `CheckboxField` (exists) stays the
  labelled form.
- **`SelectField` `tone`** (new prop): `"light" | "dark"`, matching
  `ModalDialog` tones.
- **`useFilePicker`** (new hook in `ui/fields/`): returns `{ open, input }`,
  where `input` is the hidden file input to render.
- **`ControlRing`** (exists): gains a `rect` target, `tone`, and an optional
  `durationMs`; with no duration it stays until unmounted.
- **`CaptureScreen`** (rename of `CaptureOverlay`): the full-screen capture
  surface. Not a dialog.
- **`SourceInspector`** (rename of `SourceViewOverlay`): the developer source
  inspector.
- **Class matcher** (new, `personal-vibe-check/rules/` lib): reads class
  strings from `className`, `cn`/`clsx`/`twMerge` arguments, templates and
  branches into possible class sets, with variant-aware patterns.
- **`allowIn`** (new option shape, shared by the three rules): the files that
  own a shape and may use it. Not a directory exemption.
- **`restricted-classes`** (new lint rule): bans configured class patterns or
  combinations, and optionally inline `position: "fixed"`, with a message and
  `allowIn` per entry.
- **`require-ui-primitive`** (new lint rule): bans configured intrinsic
  elements, ARIA roles and attributes, with a message and `allowIn` per entry.
- **`component-name-suffix`** (new lint rule): bans configured component-name
  suffixes.
- **`acquireHold`** (new, `toast-store`): a counted toast hold that only
  `ModalDialog` takes.
- **`ui-check`** (new dev script): whole-tree UI checks that ESLint cannot do
  one file at a time: doc coverage of `ui/` and repeated class strings.
- **`formatClock`** (new, `shared/relative-time.ts`): milliseconds to `M:SS`.
- **`friendlyDate` mode `"time"`** (new value).
- **`Badge`** in workstreams-app (rename of `Pill`,
  `workstreams-app/src/frontend/components/ui.tsx:7`).

## Tracks / scope

### Track 1 — Vocabulary renames

- **What.** Rename components so one concept has one name, before new code
  is written against the old names.
- **Why this needs to change.** The census found the same modal called
  Dialog, Popup and Overlay, and menus called Dropdown, Menu and Panel. A
  search for one name misses the others, which is how the second and third
  copies were written without anyone seeing the first.
- **Direction.** Renames, with no alias kept:
  - `ui/ModalCard.tsx` → `ui/ModalDialog.tsx` (`ModalCardTone` →
    `ModalDialogTone`, `ModalCardProps` → `ModalDialogProps`); test file
    `test/components/ui/ModalCard.test.ts` → `ModalDialog.test.ts`.
  - `ui/Dropdown.tsx` → `ui/Menu.tsx`; `ui/dropdown-menu-item.tsx` →
    `ui/menu-item.tsx`; `DropdownContext` → `MenuContext`, `useDropdownClose`
    → `useMenuClose`, `DropdownAlign`/`DropdownVertical`/`DropdownProps`/
    `DropdownTriggerProps` → `Menu…`; `PortaledMenuScope` keeps its name;
    `panelIndex` → `pageIndex` (3 callers outside `ui/`); Tailwind keyframes
    `dropdown-panel-in-*` → `menu-page-in-*` (`tailwind.config.js`).
  - `ScreenshotConsentPopup` → `ScreenshotConsentDialog`;
    `QuickSearchOverlay` → `QuickSearchDialog`.
  - `capture/CaptureOverlay/` → `capture/CaptureScreen/`, component
    `CaptureOverlay` → `CaptureScreen` (also the lazy const at
    `components/chat/everywhere/InteractiveChat/shell.tsx:156`).
  - `MicOverlay` → `MicStatus`.
  - `SourceViewOverlay` → `SourceInspector` (file
    `components/SourceInspector.tsx`).
  - Menu bodies: `LandmarkLinksPanel`, `RecentFilesPanel`,
    `SessionListPanel`, `ModelPanel`, `AdvancedPanel`, `VoicePanel` →
    `…MenuBody`, with their files.
  - workstreams-app `Pill` → `Badge` (13 files).
  - `beebox/src/dev/knowledge-audits.yaml:9440` "ui/Dropdown already positions
    in JS" → `ui/Menu`.
  Every `bbx-` control id stays as it is (`beebox/frontend.md:167`: "Never
  rename an existing id; iOS mirrors some of them").
- **Vocabulary lock-ins.** `ModalDialog`, `Menu`, `MenuContext`, `pageIndex`,
  `*MenuBody`, `CaptureScreen`, `MicStatus`, `SourceInspector`,
  workstreams-app `Badge`.
- **First implementation chunk.** The `ModalCard` → `ModalDialog` rename
  alone: 7 files and one test. `pnpm typecheck`, `pnpm lint:changed`,
  `pnpm layout-check`, `pnpm test:changed`.

### Track 2 — UI doc coverage check and the overlay docs

- **What.** A check that every exported component and hook in `ui/` is named
  in `beebox/frontend.md`, and that every `<Name>` in its primitives section
  exists. The docs it would fail on today are written in the same commit.
- **Why this needs to change.** An agent reading `frontend.md` today does not
  learn that a modal primitive exists. Exports absent from it (grep,
  2026-11-11): `BrokenLink`, `CardMark`, `ControlRing`, `MetaItem`,
  `ModalCard`, `Notice`, `ToastViewport`, `PortaledMenuScope`,
  `MaterialContext`, `DropdownContext`, `FieldShell`, `FieldMessage`,
  `RevealButton`. It also names a stale path, `beebox/frontend.md:181`
  "**Inputs** (all in `ui/fields.tsx`)", and lists `ImageLightbox` under the
  primitives (`:222`) though it lives at `components/ImageLightbox.tsx`. Its
  menu line is older than the menu roles: `:220` "menu with click-outside,
  escape-to-close".
- **Direction.**
  - New `beebox/src/dev/ui-check/` with a `check.ts` entry and a pure
    `docCoverageProblems({ exports, doc })` function. Exports are read with
    the TypeScript parser already used by `beebox/src/dev/layout/`.
    PascalCase function and const exports, and `use*` hooks, count.
    `ALL_CAPS` constants do not. An allow-list in the check holds ui-internal
    exports (`FieldShell`, `FieldMessage`, `RevealButton`, `MenuContext`),
    each with the ui file that imports it as its reason; an allow-listed name
    imported from outside `components/ui/` fails.
  - Reverse check: each `` `<Name>` `` in the "Frontend UI Primitives" section
    must be an export of `components/ui/**`.
  - Wiring: `"ui-check"` script in `beebox/package.json`; `.husky/pre-commit`
    runs it when staged paths match `beebox/src/frontend/src/` or
    `beebox/frontend.md`; `bin/lint-changed.ts` adds it beside layout-check.
  - Docs in `beebox/frontend.md`, in the same commit: A1 (ModalDialog,
    Notice, `toastError`, `ToastViewport`, the dialog rules: "a modal is
    `ModalDialog`, a non-modal anchored panel is `Popover`; never write
    `role="dialog"` on a `div`; never lock body overflow"; this holds with no
    exception, since both primitives render a native `<dialog>`), A2 (`Menu kind`,
    `TabBar mode`), A4 (raw controls are exempt from
    `control-has-associated-label`, per `personal-vibe-check/preset/react-rules.ts:24`
    `ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr",
    "video"]`), the missing exports, the stale path, and
    `ImageLightbox`'s real location.
- **Vocabulary lock-ins.** `pnpm ui-check`; the allow-list shape `{ name,
  reason }`.
- **First implementation chunk.** `docCoverageProblems` with its unit test
  (`test/dev/ui-check/` mirror of the source path), the frontend.md entries
  that make it pass, and the wiring.

### Track 3 — Reduced motion, `Spinner`, the class matcher, and `restricted-classes`

- **What.** One global reduced-motion rule; one `Spinner` that slows under it;
  a class matcher that understands variants and `cn()` calls; the generic
  class-ban rule, landing with its first entry (`animate-spin`).
- **Why this needs to change.** About 23 sites animate with no reduced-motion
  form (4 `animate-spin`, 18 `animate-pulse`, `Redacted`'s shimmer). The
  spinner is copied five times: `components/ui/Button.tsx:141` `className=
  "animate-spin w-4 h-4"`, `components/capture/CaptureControls.tsx:71` and
  `:169`, `components/capture/CaptureOverlay/CapturePhotoStrip.tsx:81`, and
  `components/chat/InteractiveChat-layout/view/ChatAttachments.tsx:78`. The
  ring string `w-5 h-5 border-2 border-white border-t-transparent rounded-full
  animate-spin` appears in two files verbatim.
- **Direction: CSS.**
  - `index.css`, outside any Tailwind `@layer`:
    ```css
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
      .bbx-spinner {
        animation-duration: 3s !important;
        animation-iteration-count: infinite !important;
      }
    }
    ```
    The class selector outranks `*` among `!important` declarations, so the
    spinner keeps turning at a third of its speed. Tailwind 3
    (`beebox/src/frontend/package.json:57` `"tailwindcss": "^3.4.0"`) emits no
    native cascade layers, so specificity decides.
  - Theme CSS keeps its own blocks (`themes/card-turn.css:61` and the chrome
    themes): they set `animation: none`, the right resting state for ambient
    drift. The card turn skips its animation in script when the preference is
    already on (`components/themes/ThemedFileCard/CardThemeSurface.tsx:71`
    `if (prefersReducedMotion()) setBack(!back);`), and shortens a turn that is
    already running (`themes/card-turn.css:67-68` "A preference change during a
    turn must still complete the state change." `.bbx-card-surface[data-card-turn]
    { animation-duration: 1ms; }`). The global rule must keep that working:
    verification case below.
  - Remove the now-redundant `motion-safe:` prefixes in `Menu.tsx:352,366-367`
    and `ControlRing.tsx:47`, and rewrite the `lib/reduced-motion.ts:5-6`
    comment to point at the global rule.
- **Direction: `Spinner`.** `ui/Spinner.tsx`: `<Spinner size="sm" | "md"
  tone="current" | "onDark" />`, the Button SVG, classes `bbx-spinner
  animate-spin`, `aria-hidden`. `Button` uses it; the four other sites use it.
- **Direction: the class matcher.** A new module in `personal-vibe-check/rules/`
  (a `lib/` file beside the rules), used by the new rules only.
  `restrict-component-classes` keeps its own reader; it is not changed. The
  existing reader cannot be reused unchanged: it skips calls
  (`restrict-component-classes.ts:142-145`, "call expressions … contribute
  nothing") and strips every variant (`:136` `stripPrefixes`), so
  `cn("fixed …")` is invisible and `hover:ring-2` looks like `ring-2`.
  - **Sources read:** a `className` attribute value; the arguments of
    configured class helpers (option `callees`, default `["cn", "clsx",
    "twMerge"]`), including nested arrays and the keys of object arguments
    (`{ "fixed": cond }`).
  - **Shapes read:** string literals; template literals, quasi by quasi, where
    a token that touches a `${}` boundary is partial and dropped; conditional
    and logical expressions.
  - **Resolution model: per operand, no cross product.** The matcher splits
    a class value into the *unconditional* tokens U and a list of
    *conditional operands* (each branch of `a ? x : y`, the right side of
    `a && x`, each object-key entry in `clsx({…})`). It checks the
    candidate sets U and U ∪ O for each operand O on its own. It never
    combines two operands. Before checking, each set is projected onto the
    tokens the entry's patterns can match and deduplicated, so unrelated
    optional classes add no work and there is no complexity budget.
  - **Correlated conditions.** Because operands are never combined, an
    impossible combination such as `clsx(a && "absolute top-full", !a &&
    "z-50")` is not reported. The cost, documented in `conventions.md`
    Limitations: a banned combination split across two independent operands
    (`a && "absolute"`, `b && "top-full z-50"`) is missed. A `none` pattern
    (a replacement) counts when it is in U or in the same operand as the
    match.
  - **Merging.** `cn` calls `twMerge`
    (`beebox/src/frontend/src/lib/cn.ts:15`), so a later class can remove an
    earlier one at runtime (`cn("fixed", "static")` renders `static`). The
    matcher collects tokens and does not simulate the merge, so it reports
    that case. That is the conservative direction; the fix is to not pass the
    banned token.
  - **Variant-aware tokens:** a token keeps its variant chain
    (`sm:focus-visible:ring-2` → variants `["sm", "focus-visible"]`, utility
    `ring-2`). A pattern is written as `[variants:]utility-glob`, for example
    `focus-visible:ring-*`. Responsive variants (`sm`, `md`, `lg`, `xl`,
    `2xl`) and `dark` are ignored when matching; every other variant must be
    listed in the pattern to match. So `hover:ring-2` does not match
    `focus-visible:ring-*`, and `md:focus:border-accent` matches
    `focus:border-*`. A pattern may list alternatives with `|`
    (`outline-none|focus:outline-none`), and a glob may be followed by an
    exclusion with `!` (`focus:outline-*!focus:outline-none`).
  - **Entry semantics:** `{ all: Pattern[], none?: Pattern[], allowIn?:
    string[], message }`. An entry fires on a candidate set that holds every
    `all` pattern and no `none` pattern. `allowIn` lists the files (globs
    relative to the config) that own the shape; there are no directory-wide
    exemptions.
  - **Fixtures** (RuleTester and matcher unit tests): `cn("fixed", x)`;
    `clsx({ fixed: open })`; a template split as `` `fix${a}ed` `` (no match)
    and `` `fixed ${a}` `` (match); `a ? "fixed" : "absolute"` with an `all:
    ["fixed", "z-*"]` entry and `z-10` unconditional (match on one branch
    only); `clsx(a && "absolute top-full", !a && "z-50")` (no match,
    correlated); `a && "absolute"`, `b && "top-full z-50"` (no match, the
    documented miss); six unrelated optional classes beside one banned shape
    (one finding, no blow-up); `cn("fixed", "static")` (reported);
    `outline-none hover:ring-2` (fires); `focus:outline-none` alone (fires);
    `focus:outline-none focus-visible:ring-2` (passes, the `CloseButton`
    form at `components/ui/CloseButton.tsx:62`); `outline-none
    md:focus-visible:ring-2` (passes); `outline-none focus:border-accent`
    (passes); `focus:outline-none focus:outline-none` (fires: removal does
    not count as its own replacement); a dynamic identifier (`className={x}`,
    skipped and tested as skipped).
- **Direction: the rule.** `restricted-classes` in `personal-vibe-check/rules/`,
  options `{ entries: Entry[], callees?: string[], stylePosition?: { values:
  string[], allowIn?: string[], message } }`. Registered in `plugin.ts`;
  documented in `conventions.md` with a Limitations section (an identifier or
  member expression is invisible; split operands are missed; merges are not
  simulated). The frontend config sets
  it for `src/**/*.tsx` with no `ignores`. First entry: `{ all:
  ["animate-spin"], allowIn: ["src/components/ui/Spinner.tsx"], message:
  "Use <Spinner> from components/ui/Spinner." }`. Zero findings after the five
  sites move.
- **Vocabulary lock-ins.** `bbx-spinner`; rule name, entry shape and pattern
  syntax; `Spinner` `size`/`tone` values.
- **First implementation chunk.** The matcher with its unit fixtures, then the
  rule with its RuleTester suite, unwired, in `personal-vibe-check`. The next
  commit adds `Spinner`, the five sites, the CSS and the config entry.

### Track 4 — `LiveDot`, `Skeleton`, inline `StatusMessage`

- **What.** Primitives for the three other loading shapes.
- **Why this needs to change.**
  - Pulsing dots, 9 sites, sizes 1.5/2/2.5 and five tones, for example
    `components/capture/CaptureOverlay/StatusBar.tsx:56` `"w-2.5 h-2.5
    bg-danger rounded-full animate-pulse"` and
    `components/chat/everywhere/InteractiveChat/BackgroundTasks.tsx:55`.
  - Skeleton bars, 5 sites: `pages/browse/components/BrowseLoading.tsx`,
    `pages/inventory/components/InventoryLoading.tsx:8-9`,
    `components/DoclingView/view.tsx:110-111`, `components/PdfCardView/view.tsx:207`,
    `components/themes/ThemedFileCard/view/ThemedFileCard.tsx:40`.
  - About 40 loading strings bypass `StatusMessage` through `Hint`, `Text`
    or raw `<p className="… animate-pulse">`
    (`components/dashboard/ScheduleOverview/view.tsx:224`,
    `components/dashboard/ScheduleOverview/RunHistory.tsx:97`).
- **Direction.**
  - `ui/LiveDot.tsx`: `tone` (`danger`, `warning`, `info`, `accent`,
    `current`), `size` (`sm` = 1.5, `md` = 2). The 2.5 dot in the capture
    status bar becomes `md`. Under reduced motion it pulses once and rests
    solid.
  - `ui/Skeleton.tsx`: one bar, `bg-warm-100 rounded animate-pulse`, sized by
    `className`. `BrowseLoading` → `BrowseSkeleton`, `InventoryLoading` →
    `InventorySkeleton`. The container that shows a skeleton carries
    `aria-busy` (`beebox/frontend.md:147-148`).
  - `StatusMessage variant="inline"`: `text-sm text-warm-700`, no padding.
    The ~40 sites move onto it with `busy`. Each moved string is written with
    "…"; the three-dot spellings (about 34 lines in `.tsx`) mostly go with
    these moves. The rest stay; no rule (Review, finding 1).
  - No `animate-pulse` entry in `restricted-classes`: two icons pulse
    (`components/chat/SpeechMenu.tsx:40`,
    `components/chat/InteractiveChat-composer/InteractiveChat-voice-button.tsx:68`)
    and no primitive fits a pulsing icon. See NOT in scope.
- **Vocabulary lock-ins.** `LiveDot`, `Skeleton`, `<Thing>Skeleton`,
  `StatusMessage` `inline`.
- **First implementation chunk.** `LiveDot` with a DOM test and its 9 sites.

### Track 5 — Field gaps and the `require-ui-primitive` rule

- **What.** Fill the three field gaps, move every raw control onto `ui/fields`,
  and ban raw `<input>`, `<textarea>`, `<select>` everywhere except the files
  that own them.
- **Why this needs to change.** There are 22 raw controls outside
  `ui/fields/` (15 in app code, 7 in dev harnesses). Nothing flags them: the
  name rule skips `input` and `textarea` (react-rules.ts:24, quoted in
  Track 2). The boxholder: "seems like maybe we shouldn't allow raw input
  fields?"
- **Direction.**
  - `ui/fields/field.tsx` is at 335 lines; move `CheckboxField` into
    `ui/fields/checkbox.tsx` and add `Checkbox` there (`checked`,
    `onChange`, `disabled`, `aria-label` or `aria-labelledby` required by
    type). `field.tsx` re-exports both.
  - `SelectField tone="dark"`: the classes of `ModalDialog`'s dark tone.
  - `ui/fields/file-picker.tsx`: `useFilePicker({ accept, multiple, onFiles })
    => { open: () => void; input: ReactNode }`.
  - Site moves:
    - `components/capture/CaptureOverlay/view.tsx:177-178` and
      `components/chat/InteractiveChat-layout/view/ChatComposerSection.tsx:163`
      → `useFilePicker`.
    - `components/capture/CaptureOverlay/DeviceSettings.tsx:25,39` →
      `SelectField tone="dark"`.
    - `components/todo/TodoItem.tsx:97`, `components/Markdown/body.tsx:265`
      → `Checkbox`.
    - `components/admin/CloudflarePublishConnectionsSection/view.tsx:267`,
      `components/history/HistoryFilterBar.tsx:220` → `CheckboxField`.
    - `components/admin/ClaudeCodeSection.tsx:67` → `TextField identifier
      hideLabel`; `components/DebugLog.tsx:230` → `TextField type="search"`.
    - `components/chat/conversation/use-bound-emission/PendingSendStorageRecovery.tsx:17`
      → `TextareaField readOnly hideLabel`.
    - The two composer textareas are the same control twice:
      `components/chat/InteractiveChat-composer/view.tsx:106` and
      `components/chat/InteractiveChat-mobile-row.tsx:42` share
      `value`, `onChange`, `onPaste`, `onDrop`, `readOnly`, `aria-label` and
      `composerTextareaClasses`. Merge into one `ComposerTextarea` in
      `chat/InteractiveChat-composer/` with `mobile` and `id` props. It owns
      the one raw `<textarea>` outside `ui/fields/`: autosize, caret tracking
      and IME handling that `TextareaField` does not have.
    - `components/browser-task/SubmissionForm.tsx:134` keeps its visible
      file input: its header (`:5`) says "a real `<input type="file"
      multiple>`, because a browser-automation tool" sets files on it.
    - Seven dev-harness controls (`pages/dev/components/ThemeStudioHarness/`,
      `CaptureModeHarness.tsx:271,278`) move to fields primitives. Dev pages
      are not exempt.
  - Rule `require-ui-primitive` in `personal-vibe-check/rules/`. Options:
    `{ elements?: Record<tag, { message, allowIn?: string[] }>, roles?: …,
    attributes?: … }`, the same per-entry `allowIn` shape as
    `restricted-classes`. The frontend config sets it for `src/**/*.tsx` with
    no `ignores`. This track sets `input`, `textarea` and `select`, each with
    its own `allowIn` list of the files that own that tag, with a config
    comment per file. No directory glob:
    - `input`: `ui/fields/field.tsx` (`TextField`, `NumberField`; today
      `:67`, `:188`), `ui/fields/checkbox.tsx` (`CheckboxField` moved from
      `field.tsx:247`, and `Checkbox`), `ui/fields/radio.tsx` (`:101`, `:141`),
      `ui/fields/file-picker.tsx` (the hidden file input),
      `components/browser-task/SubmissionForm.tsx` (the visible file input).
    - `textarea`: `ui/fields/field.tsx` (`TextareaField`, today `:137`), the
      `ComposerTextarea` file.
    - `select`: `ui/fields/field.tsx` (`SelectField`, today `:317`).
    A new file in `ui/fields/` that renders one of these tags fails until it
    is added to that tag's list. There are no `eslint-disable` comments for
    this rule.
- **Vocabulary lock-ins.** `Checkbox`, `SelectField tone`, `useFilePicker`,
  `ComposerTextarea`; rule name and option shape.
- **First implementation chunk.** `Checkbox` and the `field.tsx` split, with
  a DOM test for `Checkbox`'s name.

### Track 6 — `List`, `Table`, and the content-renderer contract

- **What.** One list primitive and one table primitive that encode the
  semantics rules; the contract for tables that render document content; the
  ban on raw `<ul>`, `<ol>`, `<table>`, `<th>`, `<td>` in JSX.
- **Why this needs to change.** The boxholder (A3): "maybe in the form of a
  component that encodes these rules, and that agents should use." Today:
  - 30 raw `<ul>`/`<ol>` outside `ui/`. Bullet lists use five spellings, for
    example `components/MarkdownCardView/FrontmatterFields.tsx:99` `"min-w-0
    list-disc list-outside ml-5 space-y-0.5 marker:text-warm-400"` and
    `components/admin/SecretsSection/uses.tsx:38` `"list-disc pl-4
    space-y-0.5"`.
  - 7 tables with three header styles. Since 11b505061 three of them have no
    name: the commit removed captions that "repeated a visible heading or
    column header". `components/browser-task/RunsTable.tsx:45` shows the
    heading `<Heading level={2}>Runs</Heading>` that names it visually.
- **Two kinds of structure.**
  - *Application-authored:* lists and tables whose rows the app defines
    (settings guidance, run tables, schedules, inventory, frontmatter lists).
    These use `List` and `Table` with the `data` variant.
  - *Rendered document content:* structure that comes from a document.
    Markdown bodies are rendered by Markdoc from a tag config
    (`components/Markdown/body.tsx:216` `buildRenderConfig`;
    `beebox/src/shared/markdoc-config/tags/html-schema.ts:42`), not from JSX
    elements, so the JSX rule does not see them and this plan does not change
    them. Two content renderers are JSX: `components/DoclingView/DoclingPageSection.tsx`
    (tables extracted from PDFs) and `components/SheetTable.tsx` (a
    spreadsheet grid). They use `Table variant="grid"` under the contract
    below, so they need no exception.
- **Direction: `List`.** `ui/List.tsx`: `<List marker="none" | "disc" |
  "decimal" gap="none" | "xs" | "sm" | "md" direction="column" | "row" |
  "wrap" divided>`. `marker="none"` sets `role="list"`. Marked lists use one
  indent (`pl-5`, `list-outside`) and `marker:text-warm-400`. `List` forwards
  `id`, `aria-label`, `aria-labelledby` and `data-*`. `Stack` drops `ul` and
  `ol` from `StackAs` (`components/ui/Stack.tsx:5`); its 4 callers move to
  `List`.
- **Direction: `Table`.**
  - **Name, required and non-empty.** Props `{ caption: string; captionHidden?:
    boolean } | { labelledBy: string }`. `caption` is `string`, not
    `ReactNode`, so `null` does not typecheck, and an empty string fails a
    runtime `invariant` (`beebox/src/shared/invariant.ts`). Docling's
    `caption: string | null` (`DoclingPageSection.tsx:39`) has an explicit
    fallback at the call site: `caption ?? \`Table on page ${page}\`` with
    `captionHidden` when the fallback is used.
  - **One scroll owner.** `scroll: "x" | "both"` (default `"x"`). The wrapper
    `div` is the only scroll container: `overflow-x-auto` or `overflow-auto`,
    `tabIndex={0}`, named by the same caption or heading. Callers do not wrap
    a `Table` in another scrolling element. `SheetTable` today has its own
    wrapper, `<div className="overflow-auto border border-warm-300 rounded">`
    (`SheetTable.tsx:46`), with no height cap. It is replaced by `Table
    scroll="both"`, also with no height cap, so its behavior stays: the
    wrapper scrolls horizontally, the row-number column sticks to it, and the
    sticky header row has no vertical scroller to stick in (as today). Adding a
    height cap is not part of this plan.
  - **Attribute forwarding.** `Th` and `Td` forward native cell attributes
    (`colSpan`, `rowSpan`, `headers`, `id`, `className` for callers inside
    `components/`, `data-*`). `Th` requires `scope: "col" | "row"`. `numeric`
    aligns right with `tabular-nums`. `thead`, `tbody`, `tr` stay raw.
  - **Variants.** `data`: header `text-left font-medium text-warm-700 pb-2
    pr-3`, body rows `divide-y divide-warm-200`. `grid`: bordered cells
    (`border border-warm-300 px-2 py-1`).
- **Direction: the guard.** `require-ui-primitive` gains `ul`, `ol` → `List`
  (`allowIn: src/components/ui/List.tsx`); `table`, `th`, `td` →
  `Table`/`Th`/`Td` (`allowIn: src/components/ui/Table.tsx`).
- **Vocabulary lock-ins.** `List`, `marker`, `divided`; `Table`, `Th`, `Td`,
  `variant: "data" | "grid"`, `scroll`.
- **First implementation chunk.** `List` with a DOM test of each marker's role
  and the 4 `Stack as="ul"` callers.

### Track 7 — Anchored layer, `Menu` anchors, `Popover`, toast hold, names

- **What.** The overlay cluster: one positioning layer, a point anchor for
  `Menu`, router links and a sibling action for `MenuItem`, a new `Popover`
  with a written interaction contract, a modal-only toast hold, and three
  guards.
- **Why this needs to change.** Five popovers have no primitive:
  - `components/chat/ack-badge.tsx:79` and
    `components/chat/user-message/audio-overlay-badge.tsx:168`, both
    `"absolute left-0 top-full mt-1 z-50 bg-white text-warm-800 rounded-lg
    shadow-lg border border-warm-200 px-3 py-2 w-64 text-xs normal-case
    tracking-normal"`, each with a `prefer-native-dialog` disable.
  - `components/history/HistoryFilterBar.tsx:204` (`w-60`, listbox).
  - `components/chat/InteractiveChat-layout/view/ChatSelections.tsx:61` (`w-72`,
    no dismiss and no ARIA).
  - `components/dashboard/HeaderStrip.tsx:25` `"fixed left-[10vw] top-24
    w-[80vw] bg-white border rounded-lg shadow-lg z-10 p-3 text-xs"`, no
    dismiss.
  A menu at a point is hand-made:
  `pages/browse/components/BrowseContextMenu.tsx:17` `"fixed z-50 min-w-40
  rounded-lg border border-warm-200 bg-white py-1 shadow-lg"`, with no
  Escape, no outside dismiss and no `role="menu"`. Five menu rows write
  `role="menuitem"` by hand: `components/chat/SpeechMenu.tsx:93`,
  `components/chat/everywhere/InteractiveChat/session-search.tsx:144`,
  `SessionListPanel.tsx:225,291`, `SessionChip-model-panel.tsx:123`.
  The cause: the class rule skips `components/`
  (`beebox/src/frontend/eslint.config.ts:210` "Files inside components/ are
  exempt — that is where appearance lives."), and even where it applies it
  allows position classes (`personal-vibe-check/rules/restrict-component-classes.ts:84-86`
  `"^(static|fixed|absolute|relative|sticky)$"`, `"^-?z-.+$"`).
- **Direction: `AnchoredLayer`.** `ui/AnchoredLayer.tsx` takes the positioning
  effect out of `Menu.tsx` (`:244-313`). For trigger anchors the move has no
  behavior change except one bug fix: the vertical clamp. Today the far edge
  is bounded but the near edge is not (`Menu.tsx:266-271`: `next.maxHeight =
  viewportTop + vh - (rect.bottom + gap) - margin;`), so a trigger near the
  bottom gives a negative `maxHeight`. New rule for both anchor kinds: place
  on the preferred side (`vertical`); if the space there is less than
  `min(content height, 12rem)`, use the side with more space. `maxHeight` is
  the space on the chosen side; 8rem is a preference, not a floor. Containment
  wins: the layer never extends outside the visual viewport, which shrinks
  when the iOS keyboard opens (`Menu.tsx:259`). If neither side has 8rem, the
  layer is placed at the top of the visual viewport with `maxHeight` equal to
  the viewport height minus the margins, and it scrolls. `maxHeight` is never
  negative. The clamp is a pure function with a unit test, including a
  viewport shorter than 8rem.
- **Direction: `Menu at` (point anchor).** A discriminated union beside the
  `trigger` form: `{ at: { x: number; y: number }; open: boolean; onClose:
  () => void; openedBy: "pointer" | "keyboard"; returnFocus: HTMLElement |
  null }`.
  - *Containment:* there is no trigger root. `useDismiss` returns early when
    `root.current` is null (`hooks/useDismiss.ts:22` `if (root.current ===
    null || !(target instanceof Node)) return;`), so `useDismiss` gets a
    `boundary` option and the point menu passes the menu panel as its only
    inside region. A press anywhere outside the panel closes it, including a
    press on the row that opened it.
  - *Placement:* the clamp above, with the point as a zero-size rect, so a
    bottom-right point opens up and left.
  - *Focus:* `openedBy="keyboard"` (ContextMenu key or Shift+F10) focuses the
    first item; `pointer` focuses the panel itself (`tabIndex={-1}`), with no
    visible ring. Close returns focus to `returnFocus` when focus was inside
    the menu at close, or when the close was Escape.
  - *Arrow keys from the panel:* `moveMenuFocus` handles a key only when its
    target is a menu item (`Menu.tsx:24` `if (!(target instanceof
    HTMLElement) || !target.matches(ITEM_SELECTOR)) return false;`), so a
    focused panel ignores arrows today. The handler changes: when the target
    is the menu panel itself, ArrowDown and Home focus the first item, ArrowUp
    and End the last. This also fixes the trigger form when focus is on the
    panel. DOM tests: pointer open then ArrowDown reaches the first item;
    pointer open then ArrowUp reaches the last.
  - *Scroll and resize:* a point does not move with content, so any scroll
    outside the panel, or a resize, closes the menu. Scroll inside the panel
    does not.
- **Direction: `MenuItem` links and actions.**
  - Router links: the link form widens from `{ to: string }`
    (`ui/dropdown-menu-item.tsx:30-34`) to the TanStack Link props the menus
    use: `to`, `params`, `search`, `hash`, `state`. `MenuItem` also forwards
    `title` and `data-*` (for `bbxSource`, as at `SessionListPanel.tsx:289-294`
    `search={toSearch({ session: s.sessionId })}` and
    `{...bbxSource("session", s.sessionId)}`), and `session-search.tsx:142`'s
    message anchor.
  - Sibling action: `action?: { label: string; icon: ReactNode; onSelect: ()
    => void; keepOpen?: boolean }`. It renders a second `role="menuitem"`
    button *beside* the row, inside a `role="none"` wrapper, never inside the
    row's button or link. Arrow keys reach it as the next item
    (`moveMenuFocus` walks menu items in DOM order). This is the model pin
    today: a sibling button (`SessionChip-model-panel.tsx:120-130`) whose
    `onClick` calls `props.onPinModel(model)` and does not select the model or
    close the menu; it becomes `action={{ …, keepOpen: true }}`.
  - Non-interactive row text at the end (the "default" label at `:116`)
    stays in the row's children; there is no `trailing` slot.
- **Direction: `Popover` interaction contract.** Written first; the element
  is chosen after it.
  1. *Open.* A press on the trigger toggles. Enter or Space on the trigger
     opens. The trigger carries `aria-expanded` and `aria-controls`.
  2. *Initial focus.* Keyboard open: focus moves to the first focusable
     element in the panel, or to the panel (`tabIndex={-1}`) if it has none.
     Pointer open: focus stays on the trigger. This is the menu's rule today
     (`Menu.tsx:210-212`: "whether the open was via keyboard (focus the first
     item) or mouse (leave focus alone, no visible focus ring)").
  3. *Tab.* Focus is not trapped, and the panel follows its trigger in DOM
     order (rule 6), so Tab works as in the page:
     - Pointer open, focus on the trigger: Tab enters the panel at its first
       focusable control. Shift+Tab from the trigger leaves to the element
       before it and closes the popover.
     - Inside the panel: Tab and Shift+Tab move among its controls.
       Shift+Tab from the first control returns to the trigger and the
       popover stays open. Tab past the last control moves to the element
       after the panel in the page and closes the popover.
     - Text-only panel (no focusable control): a keyboard open focuses the
       panel (`tabIndex={-1}`); Tab moves to the element after the panel and
       closes the popover; Shift+Tab returns to the trigger. After a pointer
       open, Tab from the trigger skips the panel (nothing to focus) and
       closes it.
     The close on leaving is a `focusout` whose `relatedTarget` is outside
     both the trigger and the panel.
  4. *Escape.* Closes and returns focus to the trigger.
  5. *Outside press.* Closes. Focus returns to the trigger only if focus was
     inside the panel at that moment; otherwise it stays where the press put
     it.
  6. *Placement in the DOM.* The panel renders in the tree directly after
     its trigger, not in a portal. A popover opened inside a `ModalDialog` is
     therefore the modal's descendant and stays interactive; the top layer
     draws it above the modal without reparenting it.
  7. *Name.* `label` is required and names the panel.
- **Element choice, compared against the contract.** (Corrected in review
  round 2: an earlier version said a top-layer popover leaves the modal's
  subtree. It does not; the top layer changes rendering, not DOM position.)
  - *Non-modal `<dialog>` with `show()`.* Available at the floor, but `show()`
    runs the dialog focusing steps and moves focus into the panel on every
    open, which breaks rule 2 for pointer opens. It is not in the top layer,
    so it needs `z-index` and can be clipped by an `overflow` ancestor.
    Rejected.
  - *`<dialog popover="manual">` in the tree, shown with `showPopover()`.*
    Top layer: no `z-index`, never clipped by an ancestor's `overflow`.
    Stays in DOM order after the trigger, which gives rule 3's Tab order and
    rule 6's modal nesting with no extra code. On a `<dialog>`,
    `showPopover()` runs the dialog focusing steps (HTML Standard, popover
    focusing), so focus moves into the panel. Rule 2 therefore needs explicit
    code: on a pointer open, `Popover` calls `trigger.focus({ preventScroll:
    true })` right after `showPopover()`; on a keyboard open it lets the
    focusing steps run, then moves focus to the first focusable element (or
    the panel). Tests: pointer open leaves `document.activeElement` on the
    trigger; keyboard open puts it in the panel; the iOS 18.0 simulator and
    desktop check repeat both. If restoring focus causes a visible flicker
    or a screen reader announces the panel on pointer open, fall back to
    the portaled `div` below. `manual` has no light dismiss
    of its own, so the 18.3 outside-tap fix does not matter; dismiss comes
    from `AnchoredLayer`. It is a native `<dialog>`, so it carries the dialog
    role with no `prefer-native-dialog` disable. `popover="auto"` is not used:
    its light dismiss is the behavior WebKit fixed in 18.3, and it would
    duplicate our dismiss. **Chosen.**
  - *A portaled `div` with `role="dialog"` (the menu's mechanism).* Proven at
    the floor, but needs a disable, a Tab bridge from the trigger to the
    end of `<body>`, and a portal target inside an open modal. It is the
    fallback only if the simulator check below shows that WebKit at iOS 18.0
    does not display or announce a `<dialog popover>`. If the fallback is
    used, its single disable reads "a non-modal positioned panel; WebKit at
    iOS 18.0 fails <the observed behavior> for `<dialog popover>` (checked
    <date>)", and the `frontend.md` dialog line gains that one named
    exception in the same commit.
  - *Verification before the five sites move:* the contract is checked in the
    iOS simulator at iOS 18.0 (`ios-app/AGENTS.md` gives the simulator build)
    and in desktop Chrome, Safari and Firefox with the browse skill: each of
    rules 1–6, by pointer and by keyboard, plus VoiceOver announcing the
    panel's role and name, and a popover opened inside an open `ModalDialog`.
    DOM tests in the happy-dom harness (`test/helpers/dom-harness.ts`) cover
    rules 2–5 as logic, including every Tab case in rule 3; they do not
    replace the device check.
  - `Popover` props: `trigger` render prop like `Menu`, `label`, `align`,
    `vertical`, `width: "md" | "lg"` (16rem, 24rem; the four widths in use
    today collapse to these two). Look: the ack bubble's padding (`px-3 py-2
    text-sm`) with the menu's border and shadow.
- **Direction: toast hold.** `ToastViewport` holds toasts whenever any
  `dialog[open]` exists (`components/ui/ToastViewport.tsx:39`
  `holdToasts(document.querySelector("dialog[open]") !== null)`), but the store
  reserves the hold for "a modal dialog covers the toasts"
  (`components/ui/toast-store.ts:98`). The hold moves to a signal that
  `ModalDialog` owns: `toast-store` gets `acquireHold(): () => void`. Holds
  are counted; the store is held while the count is above zero, and the
  existing release behavior (every toast gets a full timer) runs when it
  reaches zero. Each returned release function works once; a second call does
  nothing, so the count never goes below zero. `useModalDialog` acquires in
  the same effect that calls `showModal()` and releases in that effect's
  cleanup (`hooks/useModalDialog.ts:21-24`, which already closes the dialog
  there), so a modal that unmounts while open also releases. The
  `MutationObserver` in `ToastViewport` is deleted. Before Track 8 the
  lightbox still calls `useModalDialog` directly and so takes the hold too.
  Tests: two overlapping holds (a lightbox opened from inside a dialog),
  releasing one keeps the hold; unmount without close releases; a double
  release does not go below zero. Integration test: with a toast showing, an
  open `Popover` leaves its timer running and it expires; an open
  `ModalDialog` holds it and it gets a full timer after close.
- **Direction: sites.** The five popovers move to `Popover` (the filter bar's
  options become `CheckboxField` rows; the git status popover anchors to its
  button); `BrowseContextMenu` to `Menu at`; the five menu rows to `MenuItem`
  with link props or `action`; the selection "+" button at
  `components/SelectionCapture.tsx:317` (`position: "fixed",`) to
  `AnchoredLayer at`, keeping its current clamp of both coordinates
  (`:318-319`) through the shared clamp.
- **Direction: guards**, all with zero findings after the moves:
  - `restricted-classes` entry `{ all: ["absolute", "*-full", "z-*"],
    allowIn: ["src/components/ui/AnchoredLayer.tsx"], message: "An anchored
    panel is <Popover> or <Menu>." }`. Today it matches the four absolute
    popovers and nothing else (grep of `absolute` with
    `top-full`/`bottom-full`, 2026-11-11). `MicStatus` has no `z-` class; the
    jump-to-latest button
    (`components/chat/everywhere/InteractiveChat/messages.tsx:110`) has no
    `*-full` token.
  - `require-ui-primitive`: roles `menu`, `menuitem`, `menuitemcheckbox`,
    `menuitemradio` → `Menu`/`MenuItem` (`allowIn` the two menu files);
    attribute `aria-haspopup` → "the trigger props of `Menu` or `Popover`"
    (`allowIn` the menu and popover files). All current users of these move
    in this track.
  - Restricted imports: add `{ group: ["**/hooks/useDismiss"], message }` to
    the patterns at `beebox/src/frontend/eslint.config.ts:153` and `:163`, and
    a block for only `ui/AnchoredLayer.tsx` that restates the patterns
    without it. All three `useDismiss` callers outside `ui/` move in this
    track.
  - Not in this track: the `dialog` element ban and the `useModalDialog`
    import restriction. `components/ImageLightbox.tsx:13` imports
    `useModalDialog` and renders its own `<dialog>` until Track 8, so those
    two guards land in the Track 8 commit that moves the lightbox.
  - Rule `component-name-suffix` in `personal-vibe-check/rules/`: banned
    suffixes only. Options: `{ banned: Record<suffix, message>, allowIn?:
    string[] }`. A PascalCase function or const component whose name ends in
    a banned suffix fails. Frontend config: `Popup`, `Overlay`, `Modal`,
    `Sheet`, `Tooltip`, each message naming the agreed word (`Dialog` with
    `ModalDialog`, `Popover`, `Menu`, `Screen`); `allowIn` is
    `src/components/ui/BboxOverlay.tsx` (a box drawn over an image, the one
    meaning "Overlay" keeps). Today, after Track 1, it finds nothing. The rule
    does not check what a component renders: the element, role, class and
    import guards carry reuse; this one makes names collide.
- **Vocabulary lock-ins.** `AnchoredLayer`, `Popover`, `Menu at` and its
  fields, `MenuItem action`, `acquireHold`, `Popover width` values.
- **First implementation chunk.** Extract `AnchoredLayer` from `Menu.tsx` with
  the clamp fix and its unit test; `Dropdown.menu-keys.test.ts` (renamed in
  Track 1) and the control-id tests pass unchanged.

### Track 8 — Full-screen `ModalDialog`, `ControlRing`, viewport layers

- **What.** The remaining viewport-fixed layers move into `ui/`, and the
  `fixed` class and inline `position: fixed` are banned outside the files that
  own them.
- **Why this needs to change.** Two surfaces build full-screen dialogs by
  hand:
  - `components/ImageLightbox.tsx:131-134` renders its own `<dialog>` with
    `useModalDialog`.
  - `components/AppNav/PlacePill-landmarks.tsx:245` builds `role="dialog"
    aria-modal` on a `<section>` with a hand-written Tab trap and an `inert`
    loop (`:153-176`). Its reason (`:167-169`): "It is not a <dialog>
    because it sizes itself to the visual viewport for the iOS keyboard."
    A `<dialog>` can take the same inline size.
  Two surfaces draw a highlight rectangle by hand:
  `components/SelectionCapture.tsx:302` `"pointer-events-none fixed z-40
  rounded-sm border-2 border-accent bg-accent/10"` beside `ControlRing`.
- **Direction.**
  - `ModalDialog layout="fullscreen"`: no card padding, full-viewport
    `<dialog>`, `style` for a visual-viewport rect, `tone` adds `"clear"`
    (transparent, for the lightbox). `ImageLightbox` renders through it.
    `PlacePill-landmarks` renders through it with the rect from its existing
    `useSearchViewport`; the Tab trap and `inert` loop are deleted, and so is
    its `prefer-native-dialog` disable (`:244`).
  - `ControlRing`: `target: HTMLElement | DOMRect`, `tone: "accent" |
    "subtle"`, `durationMs?: number` (the timer only when given).
    `SelectionCapture`'s outline uses it.
  - `restricted-classes` entries: `{ all: ["fixed"], allowIn, message: "A
    viewport layer is a ui/ primitive: ModalDialog, Popover, Menu,
    AnchoredLayer, ControlRing, ToastViewport." }` and `stylePosition: {
    values: ["fixed"], allowIn }`. `allowIn` names each owner and nothing
    wider:
    - `ui/AnchoredLayer.tsx`, `ui/ModalDialog.tsx`, `ui/ControlRing.tsx`,
      `ui/ToastViewport.tsx` (the primitives).
    - `components/capture/CaptureScreen/view.tsx` (was
      `CaptureOverlay/view.tsx:94` `<div className="fixed inset-0 z-50">`):
      the full-screen camera surface, not a layer over the app. A modal
      `<dialog>` would hold every toast for the whole capture.
    - `components/DebugLog.tsx` (a dock at the bottom of the screen) and
      `components/SourceInspector.tsx` (draws over the whole app by design).
    - `pages/dev/components/ThemeStudioHarness/controls.tsx` (`:42,46`, the
      studio's floating controls).
    These files are exempt from the `fixed` entry only. The spinner, anchored
    panel, element and role guards still apply in them, so a dev page that
    needs a spinner or a popover uses `Spinner` or `Popover`.
  - Guards moved here from Track 7, landing in the commit that moves the
    lightbox (the last raw `<dialog>` and the last `useModalDialog` caller
    outside `ui/`):
    - `require-ui-primitive` element `dialog` → `ModalDialog` or `Popover`,
      `allowIn` `ui/ModalDialog.tsx` and `ui/Popover.tsx`.
    - Restricted imports: `**/hooks/useModalDialog` joins the pattern, with
      `ui/ModalDialog.tsx` as its only owning file.
    The landmarks-search move (the last `role="dialog"` section) lands in the
    same track; `prefer-native-dialog` already covers it.
- **Vocabulary lock-ins.** `ModalDialog layout`, tone `"clear"`;
  `ControlRing` `target`/`tone`/`durationMs`.
- **First implementation chunk.** `ModalDialog layout="fullscreen"` and the
  lightbox move, with a DOM test; the lightbox swipe and arrow keys are
  checked in the browser.

### Track 9 — Repeated class-string check and the duplicates it finds

- **What.** The second half of `ui-check`: a class string of six or more
  tokens that appears in two files fails. The groups it finds today are
  merged in the same commit. It blocks commits only after its fixtures pass.
- **Why this needs to change.** A lint rule sees one file. The audio badge
  copied the ack badge's 18-token string verbatim on 2026-08-15, and no
  check could see it. A scratch scan (2026-11-11) found 11 groups. Tracks 3
  and 7 remove two (the spinner ring and the ack bubble). The rest:
  - `bbx-chat-user-attachment block rounded-lg bg-black/15 px-3 py-2
    hover:bg-black/25` in `components/chat/CaptureChip.tsx`,
    `components/chat/user-message/UploadChip.tsx`,
    `components/chat/user-message/QuestionHandoffChip.tsx`.
  - The composer strip and its count tag in `ChatAttachments.tsx` and
    `ChatSelections.tsx`.
  - The coral icon button in `InteractiveChat-composer/view.tsx` and
    `InteractiveChat-mobile-row.tsx`.
  - The round voice button frame in `InteractiveChat-voice-button.tsx` and
    `InteractiveChat-composer/view.tsx`.
  - The task pill in `BackgroundTasks.tsx` and
    `ScreenshotIndicatorStrip.tsx`.
  - A raw button styled as a secondary button in
    `components/chat-husk/ChatHuskView.tsx` and
    `components/landmarks/LandmarkSessions.tsx` → `Button`.
  - A landmark row button in `LandmarkSection.tsx` and `LandmarkSessions.tsx`.
  - The icon-link base in `ui/ExternalIconLink.tsx` and
    `ui/OpenInPanelButton.tsx`.
- **Direction: the executable definition.** `repeatedClassProblems(files)` in
  `beebox/src/dev/ui-check/`, pure.
  - *Candidate strings:* string literals and template quasis in `.ts` and
    `.tsx` files under `beebox/src/frontend/src/`, read with the TypeScript
    parser (not a regex), `ui/` included.
  - *Class-shaped:* every whitespace-separated token matches
    `^(?:[a-z0-9-]+:)*!?-?[a-z][a-z0-9-]*(?:-\[[^\]\s]+\]|\/[0-9.]+|-[a-z0-9./]+)*$`
    or is a `bbx-` hook class. A string with any other token (a word with a
    capital letter, punctuation, `…`) is prose and is skipped.
  - *Appearance token:* at least one token, after its variant chain, starts
    with `bg-`, `border`, `rounded`, `shadow`, `ring-`, or is `text-` followed
    by a palette role (`primary`, `accent`, `info`, `danger`, `success`,
    `warning`, `coral`, `warm`, `card`, `white`, `black`, `gray`). Layout-only
    strings are skipped.
  - *Same string:* the sorted set of tokens, variants kept, at least 6 tokens.
  - *Finding:* a set that occurs in two or more files. Output is one line per
    group, sorted by the set, with its files sorted, so the report is stable.
  - *Fixtures,* written before the check is wired: prose that looks like
    classes ("Pick up where you left off"); a layout-only string; the same
    set in a different order (one group); variants differing only in
    `hover:` (two sets); a template literal split by `${}` (only whole quasis
    count); a `bbx-` hook string; a five-token string (below threshold).
  - Wired into `pnpm ui-check` and the pre-commit hook in the same commit
    that clears the groups above, after the fixtures pass.
- **Direction: merges.** Shared local components or one exported class
  constant in the owning directory (for example an `AttachmentChipFrame`
  beside the three chips). This is not the `Chip` primitive (see NOT in
  scope). Census duplicates in the same area that the check does not see
  (five tokens or fewer), merged here because the boxholder asked for
  removal: the danger box ×2 (`components/FileView/AgentViewRenderer.tsx:344`,
  `components/ViewErrorBoundary.tsx:55`) → `Notice tone="error"`; seven raw
  link-style buttons → `InlineAction`; four hand-made copy-feedback flashes
  → `Button flash` / `InlineAction flash`; three raw `×` buttons →
  `CloseButton`.
- **Vocabulary lock-ins.** The threshold (6 tokens), the class-shape pattern
  and the appearance-token list.
- **First implementation chunk.** `repeatedClassProblems` with its fixtures,
  unwired; then the attachment-chip merge.

### Track 10 — Time formatting

- **What.** One function per time format.
- **Why this needs to change.** Two functions named `formatDuration` produce
  different output: `beebox/src/shared/relative-time.ts:44` ("3m 20s") and
  `components/history/HistoryViewCard/CommitTimeline.tsx:69` (`MM:SS`).
  `components/capture/CaptureOverlay/view.tsx:40` `function formatTime(seconds:
  number): string` writes `M:SS` again. `components/chat/InteractiveChat-helpers.ts:120`
  `formatTimePassed` writes "2d3h" beside `formatDuration`'s "2d 3h". Five
  sites call `toLocaleTimeString` directly (for example
  `components/dashboard/ScheduleTicks.tsx:54`).
- **Direction.**
  - `formatClock(ms: number): string` in `shared/relative-time.ts` (`M:SS`,
    `H:MM:SS` past an hour). Capture and `CommitTimeline` use it;
    `CommitTimeline` keeps its "skip over an hour" check at the call site.
  - `formatTimePassed(ms)` returns `null` under six hours, else
    `formatDuration(ms)`. The agent-facing `time_passed` value changes from
    "2d3h" to "2d 3h" and from "7h" to "7h 30m". Tests that pin it are updated.
  - `friendlyDate(value, "time")` and `<FriendlyDate mode="time">`: an
    instant shows its time only; a date-only value shows the date.
    `components/settings/CompanionPairingSection.tsx:64` `formatDate` and the
    four React `toLocaleTimeString` sites use it.
  - Guard: `no-restricted-properties` for `toLocaleTimeString` and
    `toLocaleDateString` in the frontend config, ignoring
    `src/components/ui/FriendlyDate.tsx` and `src/deploy-page/**`. The deploy
    page is a separate script with no React and no Temporal polyfill
    (`deploy-page/poll.ts:40`), so it keeps its call. The preset does not set
    `no-restricted-properties` (grep, 2026-11-11), so nothing is replaced.
- **First implementation chunk.** `formatClock` with its unit test and the two
  callers.

### Track 11 — Focus outline, other packages, workstreams-app overlays

- **What.** B3, B9 and the workstreams-app copies.
- **Why this needs to change.** `outline-none` without a replacement focus
  style removes the keyboard focus ring; 0 of 35 uses do it today, so this
  holds the line. workstreams-app has two hand-made `showModal()` calls
  (`workstreams-app/src/frontend/components/QuickOpen.tsx:50`,
  `workstreams-app/src/frontend/exhibits/boot/DefaultExhibit.tsx:24`), a
  `<details>` popover with a backdrop button
  (`workstreams-app/src/frontend/components/QuotaPanel.tsx:54`) beside the
  native `popover="auto"` it already uses
  (`workstreams-app/src/frontend/components/IssuesPane/panel.tsx:87` "A
  `popover="auto"` element gets click-outside and Escape dismissal"), and an
  `ago()` (`workstreams-app/src/frontend/pages/RecentPage.tsx:17`) beside
  `relativeTime` in its own `lib/format.ts`. These are duplicates, so they are
  in scope; other workstreams-app and clerk changes are not.
- **Direction.**
  - `restricted-classes` entry, using Track 3's variant-aware patterns:
    `{ all: ["outline-none|focus:outline-none|focus-visible:outline-none"],
    none: ["focus:ring-*|focus-visible:ring-*|focus-within:ring-*",
    "focus:border-*|focus-visible:border-*", "focus:shadow-*|focus-visible:shadow-*",
    "focus:outline-*!focus:outline-none|focus-visible:outline-*!focus-visible:outline-none"],
    message }`. The removal matches all three spellings; 35 `.tsx` lines use
    the `focus:`/`focus-visible:` form today (grep, 2026-11-11), for example
    `components/ui/CloseButton.tsx:62` `focus:outline-none
    focus-visible:ring-2 focus-visible:ring-danger`. A replacement is a ring,
    border, shadow or outline under `focus:`, `focus-visible:` or
    `focus-within:`, and an `outline-none` never counts as its own
    replacement. A `hover:` or bare `ring-*` token does not count. Set in all
    three packages' configs.
  - B9: `no-px-font-size-class` in `workstreams-app/eslint.frontend.config.ts`;
    `no-viewport-height-class` and `no-px-font-size-class` in
    `beebox-clerk/eslint.config.ts` (0 violations in both, per the research
    grep).
  - workstreams-app: one `useModalDialog` hook in its
    `src/frontend/components/` for both dialogs; `QuotaPanel` to
    `popover="auto"`; `RecentPage` uses `relativeTime`. workstreams-app runs
    in Chrome only (`beebox/frontend.md:13-14`), so native popover needs no
    fallback there.
- **First implementation chunk.** The B9 config lines (no code changes).

## Could this be simpler?

- **Simplest version:** Track 7 only, plus a `frontend.md` paragraph telling
  agents to use `Popover`. It fails on the next spinner, list, table or form
  control, which are written the same way the popovers were. Per §12
  ("anything enforced only by memory of past conversations will eventually be
  violated") a paragraph does not hold, and the boxholder asked for the
  process to make duplicates "hard to implement inline due to lint rules".
- **Cut after review:** the `no-ascii-ellipsis` rule (not requested; the
  moved loading strings normalize anyway) and the name rule's "renders the
  matching primitive" inference (it checked spelling, not reuse). See Review.
- **Kept after review:** the doc coverage check (B2, approved) and Track 10
  (date helpers are duplicates the boxholder asked to remove).
- **Smaller guard set:** extend `restrict-component-classes` to `components/`
  and stop there. Measured 2026-11-11: run over `src/components` with the ui
  imports as targets, it reports 97 findings in 39 files, all appearance
  classes passed into primitives (`Text` ×29, `Row` ×13, `InlineAction` ×11).
  None is an overlay: it allows `fixed`, `absolute` and `z-*` by design. It
  answers a different question, so it is not a substitute (see NOT in scope).
- **One generic rule instead of three:** `restricted-classes`,
  `require-ui-primitive` and `component-name-suffix` read different AST nodes
  (class strings, element and attribute names, component declarations).
  Three small rules are cheaper to test than one rule with three modes. They
  share one option shape for exceptions (`allowIn` per entry).
- **`no-restricted-syntax` selectors instead of `require-ui-primitive`:** a
  second `no-restricted-syntax` entry replaces the preset's own selectors
  (`beebox/eslint.config.ts:19-20`, quoted in Prior art), so every frontend
  block would restate the preset list, and it has no per-entry file
  exceptions. A custom rule costs about 90 lines.
- **Keep `Stack as="ul"` and add `List` for marked lists only:** two list
  concepts. The memory rule "two tiers of anything is a smell" applies; one
  `List` costs 4 extra call-site edits.
- **Spinner that stops under reduced motion:** simpler CSS (no exemption),
  but a stopped spinner reads as "stuck"; `beebox/frontend.md:62-69` makes the
  same argument for the title glyph ("a frozen spinner would read as 'stuck'
  at the moment the honest answer is 'still going'").
- **Over-builds avoided:** no `ui/Slot` for the two content portals
  (`ComposeEditor.tsx:51`, `ChatBarChrome.tsx:160`), because `createPortal`
  is not banned; no `FileField` for one visible file input; no `Pulse`
  wrapper for two pulsing icons; no `Chip` before a survey; no `trailing`
  slot that could put a control inside a row's button.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| The `.bbx-spinner` override loses to the `*` rule, so spinners stop under reduced motion | Add: browse check with reduced motion emulated, `getComputedStyle(spinner).animationDuration === "3s"` (Track 3) | Class specificity; rule outside any `@layer` | Silent; the browse check makes it clear |
| A `0.01ms` single-iteration animation fires `animationend` where an infinite one never did, and a handler acts on it | Existing handlers read: `CardThemeSurface.tsx:88` (skipped under reduced motion at `:71`), `hooks/useCompanionMaterial.ts:80` (re-measures only) | Yes for both | Clear |
| Reduced motion turned on during a card turn strands the card half-turned | Add: browse check — start a turn, switch emulated reduced motion mid-turn, the card ends on the other side and `data-card-turn` clears | `card-turn.css:67-68` shortens a running turn to 1ms; the global rule also shortens it | Clear (visible) |
| An open `Popover` holds toast timers | Add: integration test (Track 7) | Hold moves to `ModalDialog`'s `acquireHold` | Was silent; the test makes it clear |
| A popover opened by pointer steals focus, or one opened by keyboard leaves it on the trigger | Add: DOM tests for contract rules 2–5; iOS 18.0 simulator and desktop browse checks | Contract in Track 7 | Clear in the checks |
| A popover inside a `ModalDialog` is inert | Add: DOM test that the panel is a descendant of the open `<dialog>`; simulator check | Panel renders in the tree after its trigger | Clear |
| WebKit at iOS 18.0 does not display or announce a `<dialog popover="manual">` | Simulator check with VoiceOver before any site moves | Fallback element and its named exception (Track 7) | Clear (checked first) |
| Tab after a pointer open skips the panel, or Tab out leaves the popover open | Add: DOM tests for each Tab case in contract rule 3, including a text-only panel | DOM order plus `focusout` close | Clear |
| Arrow keys do nothing after a pointer-opened menu focuses its panel | Add: DOM tests, pointer open then ArrowDown / ArrowUp | `moveMenuFocus` handles the panel as target | Clear |
| Two modals overlap and the first close releases the toast hold | Add: `acquireHold` unit tests (overlap, unmount, double release) | Counted holds; one-shot release | Clear |
| A menu on a very short visual viewport (iOS keyboard open) extends off screen | Add: clamp unit test with a viewport under 8rem | Containment wins over the 8rem preference | Clear |
| A point menu at the bottom-right corner gets a negative or tiny `maxHeight` | Add: clamp unit test; `Menu at` DOM test at the corner | Shared clamp (flip, 8rem preferred; containment wins) | Clear |
| An outside press does not close a point menu | Add: `Menu at` DOM test | `useDismiss` `boundary` option | Clear |
| A session row link loses its `search` or `bbxSource` attributes after moving to `MenuItem` | Add: DOM test of the rendered `href` and `data-cb-source` | Link props forwarded | Clear |
| Pinning a model also selects it or closes the menu | Add: DOM test — action fires `onPinModel`, not the row's `onClick`; menu stays open | `action.keepOpen` | Clear |
| `AnchoredLayer` extraction changes menu placement at the viewport edge | Existing: `Dropdown.menu-keys.test.ts` (renamed); add: clamp unit test | Same code moved, plus the clamp fix | Clear at phone width in browse |
| Docling table with no caption has no name | Add: DOM test with `caption: null` | Call-site fallback `Table on page N`; `caption: string` type; empty-string invariant | Clear |
| A spanning Docling cell loses `colSpan`/`rowSpan` | Add: DOM test | `Td`/`Th` forward cell attributes | Clear |
| SheetTable's sticky header stops sticking after the wrapper changes | Add: DOM test of one scroll container with sticky cells inside; browse check scrolling both axes | `Table scroll="both"` is the only scroller | Clear (visible) |
| Landmarks search as a full-screen `<dialog>` is hidden behind the iOS keyboard | No automated test; iOS simulator check (`ios-app/AGENTS.md`) | Inline rect from `useSearchViewport`, as today | Clear (visible) |
| A class string built from an identifier hides `fixed` or a popover combination | Matcher fixture for the skip | `cn`/`clsx` args and branches are read; `ui-check` sees literals anywhere | Silent (accepted, see edge cases) |
| A banned combination split across two independent conditional operands is missed | Matcher fixture (documented miss) | Per-operand checking; `ui-check` sees copied literals | Silent (accepted, documented in Limitations) |
| `cn("fixed", "static")` is reported though `twMerge` renders `static` | Matcher fixture | Conservative; remove the banned token | Clear |
| `ui-check` flags prose or a layout-only string | Fixtures (Track 9) | Class-shape and appearance tests | Clear |
| A rename breaks a tour or test that names a file path | `pnpm test:changed`; tours select by `bbx-` id | Ids unchanged | Clear |
| `formatTimePassed` change alters the agent's `time_passed` text | Update the chat-assemble tests that pin it | Value stays a short duration | Clear |
| `friendlyDate(…, "time")` on a date-only value shows midnight | Add: unit test | Date-only stays a `PlainDate` (`FriendlyDate.tsx:47-51`) | Clear |
| `ui-check` not run because a commit touches only `frontend.md` | Hook test of path match | Hook matches both paths | Clear |

No critical gap: the silent rows have a named check or an accepted reason.

## Agent-flow / user-flow edge cases

Walked against the code. "Agent" means a coding agent changing the frontend.

- **Scenario 1: an agent adds an anchored popover after this lands.** It
  writes, in `components/chat/foo-badge.tsx`, `<div role="dialog"
  className={cn("absolute left-0 top-full mt-1 z-50 bg-white rounded-lg
  shadow-lg …", wide && "w-96")}>` and imports `useDismiss`.
  1. The editor or `pnpm lint:changed` runs the frontend config
     (`beebox/package.json:205-207` runs the same config in lint-staged at
     commit).
  2. `prefer-native-dialog` (existing, `react-rules.ts`) reports
     `role="dialog"` on a `div`.
  3. `restricted-classes` reads the `cn(...)` argument (Track 3 matcher) and
     reports the `absolute` + `top-full` + `z-50` combination: "An anchored
     panel is <Popover> or <Menu>." The file is not in that entry's `allowIn`.
  4. The restricted import pattern reports `../../hooks/useDismiss`.
  5. If it names the component `FooPopup`, `component-name-suffix` reports
     the suffix and names `Popover`.
  6. If it uses `fixed` and inline coordinates instead, Track 8's `fixed`
     entry or `stylePosition` reports it. If it copies the menu's class string
     into a const, `ui-check` reports the repeated string at commit.
  7. If it writes `aria-haspopup` on its trigger, `require-ui-primitive`
     reports it.
  8. `frontend.md` names `Popover` and its contract (Track 2's check keeps it
     named).
  Left behind: nothing, because the commit fails. Residual gap: a novel
  popover whose classes come from an identifier, with no `*-full` token, no
  copied string, no `aria-haspopup` and no `useDismiss`, passes. ADDRESSED for
  the literal, helper-call and copied cases; the identifier case is accepted.
- **Scenario 2: an agent adds a settings form with a raw `<input>`.** It
  writes `<label><input type="checkbox" checked={x} onChange={…} /> Sync
  daily</label>` in `components/settings/SyncSection.tsx`.
  1. Today nothing reports it: `control-has-associated-label` ignores
     `input` (`react-rules.ts:24`).
  2. After Track 5, `require-ui-primitive` reports: "<input>: use TextField,
     TextareaField, NumberField, CheckboxField, Checkbox, SelectField or
     useFilePicker (components/ui/fields)." The file is not in `allowIn`.
  3. The agent writes `<CheckboxField label="Sync daily" …>`. If the row's
     own text labels the box, `Checkbox` with `aria-labelledby`.
  4. A `<select>` on the dark capture screen is `SelectField tone="dark"`.
  ADDRESSED. Gap: an agent can add `eslint-disable-next-line
  personal-vibe-check/require-ui-primitive` with no reason; no rule requires a
  description. GAP, filed as a follow-up (NOT in scope). Adding a file to
  `allowIn` is a visible config change with a required comment.
- **Scenario 3: a reduced-motion user sees a loading Button and a capture
  spinner.** iOS Settings → Accessibility → Motion → Reduce Motion sets
  `prefers-reduced-motion: reduce` in the WKWebView.
  1. The person taps Save; `Button` (`components/ui/Button.tsx`) has `loading`
     on, renders `<Spinner size="sm">` (class `bbx-spinner animate-spin`) and
     its `loadingLabel` text.
  2. The global block sets `animation-duration: 0.01ms` on `*`; the
     `.bbx-spinner` rule in the same block sets `3s` and `infinite`. The
     arc turns once every three seconds. The label stays.
  3. In capture, an upload in progress renders `<Spinner tone="onDark">` in
     `CaptureControls` (was `:71`, `:169`) and on each photo thumbnail in
     `CapturePhotoStrip` (was `:81`): same slow turn.
  4. The capture status bar's `LiveDot`s (was `StatusBar.tsx:56,63,79,94`)
     pulse once and rest at full opacity: a solid dot.
  5. A menu opens with no slide (`transition-duration: 0.01ms`). A card turn
     is skipped in script when the setting was already on; if the person turns
     the setting on during a turn, `card-turn.css:67-68` and the global rule
     both shorten it, and the card lands on its new side (verified in
     Track 3).
  6. Box views get the same rule: a view renders inside the app document
     (`components/FileView/AgentViewRenderer.tsx:374` `<div
     className="bbx-card-view" …>`), so a view's `@keyframes` drift stops
     with no work by the view's author.
  ADDRESSED.
- **Wrong primitive, two similar things.** An agent uses `Menu` for an info
  panel, or `Popover` for commands. `frontend.md` (Track 2) states the line:
  commands are `Menu`; anything else anchored is `Popover`. The `menuitem`
  role ban stops hand-made rows inside a `Popover`. ADDRESSED.
- **A second implementation inside `ui/`.** `ui/` is not exempt from the
  rules; each entry's `allowIn` names the one owning file. A new ui file that
  renders `<dialog>` or `fixed` fails unless the config is edited. What does
  not catch it: a new ui primitive that duplicates another with different
  classes and its own new `allowIn` line. The guard there is review of the
  config diff, the doc coverage check (the new primitive must be named in
  `frontend.md` beside the old one), and `ui-check` only when a class string
  repeats exactly. DEFERRED to review; stated, not solved.
- **Stale reference.** `frontend.md` names a primitive that was renamed or
  removed. Track 2's reverse check fails. ADDRESSED.
- **Two agents at once.** Another worktree adds a hand-made overlay on
  `main` before this merges. The merged tree is linted by finish
  (`.claude/agents/finish.md`, `bin/finish-verify`), and the rule fails
  there. ADDRESSED.
- **Hand-edit drift.** An agent adds an `allowIn` path or a `ui-check`
  allow-list entry with no reason. `allowIn` entries carry a config comment by
  convention (reviewed); the `ui-check` allow-list shape requires a typed
  `reason`. Disables are the GAP above.
- **Fabricated free-form value.** Not applicable: no agent writes card data
  here. The nearest case is a rule message that names a primitive; messages
  are fixed strings in config.
- **Validation error UX.** Each rule message names the primitive and its
  file, so the fix is in the message. ADDRESSED.
- **Partial migration.** Each track moves all its callers in the commit that
  enables its guard. Between Track 1 and Track 7 the code uses `Menu` with no
  `Dropdown` alias; no state has both. ADDRESSED.

## NOT in scope

- **Box views.** No `view-widgets` exports of the new components (boxholder:
  "Box views do NOT get the new components yet"). Box views do get the global
  reduced-motion rule, because they render in the app document.
- **Temporal migration.** A separate plan. Track 10 only merges format
  helpers.
- **Markdown-rendered lists and tables.** Markdoc renders them from its tag
  config, not JSX; this plan changes no Markdoc output.
- **`restrict-component-classes` over `components/`.** 97 findings in 39
  files (measured above). It guards against restyling primitives, not
  re-implementing them. Lean: a separate plan; file an issue at Track 1.
- **A `no-ascii-ellipsis` rule.** Not requested; cut after review.
- **A `Chip` primitive.** About 13 chip and pill components differ in look and
  behavior (`FileChip`, `CitationChip`, `TaskPill`, `SelectionPill`, …). The
  census says they "need their own small survey" and a visual choice, as the
  2026-10-23 plan did for its groups on an exhibit. Track 9 merges only the
  three byte-identical attachment chips.
- **Empty-state text.** 52 "No …" strings; a content survey, not a shape
  duplicate.
- **A guard on loading text.** "Loading" appears on 152 lines outside
  `StatusMessage` (identifiers included); no rule tells text from names
  cheaply. Track 4 moves the ~40 real sites; `frontend.md` holds the rule.
- **An `animate-pulse` ban.** Two pulsing icons have no primitive shape;
  the dots and skeletons move to primitives without a ban.
- **A `createPortal` ban.** Two portals are content slots
  (`components/MarkdownCardView/compose/ComposeEditor.tsx:51`,
  `components/chat/everywhere/InteractiveChat/ChatBarChrome.tsx:160`), not
  overlays. The class and style guards catch the overlay part.
- **`eslint-comments/require-description`.** Would close the bare-disable gap
  in all packages. Not in the preset today (grep); a preset-wide change with
  its own count. File an issue.
- **The `SourceInspector` palette** (`violet-*` classes, against
  `beebox/frontend.md:100`). A palette fix, not a duplicate; developer tool
  only.
- **The `PlacePill-landmarks` breakpoint hook** and the other groups in the
  smaller-near-duplicates issue.
- **`<Thing>Panel` names that are not menu bodies** (`AttachmentPanel`,
  `SelectionPanel`, `GuidePanel`, `DebugLogPanel`). No second implementation
  shares their shape; renaming them is churn without a collision to expose.
- **axe `region` on portaled layers.** Stays with its decision issue.
- **New rules in workstreams-app beyond Track 11.** It has no field
  primitives; banning raw controls there needs them first.

## Open design questions

- **Size.** About 4,600 source and test lines against the 2,000–2,500
  approved. Lean: proceed with all tracks in this worktree, in order, and
  report at the Track 8 checkpoint with actual counts; split Tracks 9–11 into
  a follow-up only if the boxholder prefers the smaller landing.
- **`restrict-component-classes` over `components/`** (NOT in scope above).
  Lean: separate plan.
- **Popover element.** Settled as `<dialog popover="manual">` in the tree
  unless the iOS 18.0 check fails; then the portaled `div` fallback with its
  named exception, recorded in the plan before the five sites move. Not a
  question for the boxholder unless both fail.

## Knowledge audits

New agent-facing concepts for dev agents: `Popover`, the field primitives,
`ModalDialog`. Add three dev entries to `beebox/src/dev/knowledge-audits.yaml`
beside `dev-browser-floor`:

- `dev-anchored-popover`: "I want a small info bubble that opens from a badge
  in the chat. How do I build it?" Expects `ui/Popover`; FAILS if it proposes
  an absolute-positioned `div` or `useDismiss` in the component.
- `dev-settings-checkbox`: "Add a checkbox to a settings section." Expects
  `CheckboxField` (or `Checkbox` with a row label); FAILS on raw `<input>`.
- `dev-confirm-dialog`: "Add a confirm dialog before deleting." Expects
  `ModalDialog`; FAILS on `role="dialog"` or a `fixed inset-0` overlay.

Each lands run: `pnpm knowledge-audit run --dev --filter <id>`, with the
status comment recorded, in Track 2 (dialog) and Tracks 5 and 7.
`dev-browser-floor`'s text changes in Track 1 and is re-run then.

## What will hold this after it ships

- **The guards** are the regression anchor for duplication: three rules, one
  restricted-import pattern, `no-restricted-properties`, and `ui-check`, run
  at commit, in `lint:changed`, and by finish.
- **Matcher fixtures and RuleTester suites** in `personal-vibe-check/rules/test/`:
  every option alone, every error path, `cn`/`clsx` arguments, split
  templates, exclusive branches, variant matching (hover versus focus), the
  set cap, `allowIn`, and identifiers skipped (`personal-vibe-check/AGENTS.md`,
  "Test-writing checklist").
- **DOM tests** (`test/helpers/dom-harness.ts`) for `Spinner`, `LiveDot`,
  `Skeleton`, `StatusMessage inline`, `Checkbox`, `SelectField tone`,
  `useFilePicker`, `List` roles, `Table` names, scopes, spans and scroll
  owner, the unnamed Docling table, `Popover` contract rules 2–6, `Menu at`
  (corner, outside press, focus return), `MenuItem` link destinations and
  `action`, `ModalDialog layout="fullscreen"`, `ControlRing` without a
  duration. Whole-markup `t.check` assertions that pin classes (for example
  `test/components/PdfCardView.pdf-card.test.ts`) are updated where a site
  moves.
- **Integration test** for the toast hold: `Popover` leaves timers running,
  `ModalDialog` holds them.
- **Unit tests** for `docCoverageProblems`, `repeatedClassProblems` and its
  fixtures, `formatClock`, `friendlyDate` time mode, `formatTimePassed`, and
  the `AnchoredLayer` clamp.
- **Device and browser checks** (not regression anchors): the Popover
  contract in the iOS 18.0 simulator and desktop browsers; the mid-turn
  reduced-motion case; SheetTable sticky scroll.
- **Tours** (`bin/tour`) re-run once after Tracks 7 and 8 for axe and focus.
  They inform; they are not the anchor (`beebox/docs/testing/tours.md`).
- No new test tier. No mocks of browser layout.

## Implementation order

Each step is one commit or a few. The plan ships in one piece, only when the
boxholder says so.

1. Track 1 renames: ModalDialog; Menu and menu bodies; dialogs and screen;
   SourceInspector; workstreams-app `Badge`.
2. Track 2: `ui-check` with doc coverage, `frontend.md` A1/A2/A4 and the
   missing exports, `dev-confirm-dialog` audit.
3. Track 3: class matcher and fixtures, then `restricted-classes` rule
   (personal-vibe-check commits); then global CSS + `Spinner` + `animate-spin`
   entry, with the mid-turn browse check. ACKNOWLEDGEMENTS.md entry for the
   reset snippet in this commit.
4. Track 4: `LiveDot`; `Skeleton`; `StatusMessage inline`.
5. Track 5: `field.tsx` split and `Checkbox`; `SelectField tone`;
   `useFilePicker`; `ComposerTextarea`; `require-ui-primitive` rule then the
   control moves and its entries; `dev-settings-checkbox` audit.
6. Track 6: `List`; `Table` with the content-renderer contract; their entries.
7. Track 7: `AnchoredLayer` extraction and clamp fix; `moveMenuFocus` panel
   fix; `Menu at`; `MenuItem` link props and `action`; toast `acquireHold`
   with its tests; `Popover` with its DOM tests, then the iOS 18.0 and
   desktop contract check, then the five popovers; the anchored-panel entry,
   role and attribute entries, and the `useDismiss` pattern;
   `component-name-suffix`; `dev-anchored-popover` audit.
8. Track 8: full-screen `ModalDialog` and the lightbox, with the `dialog`
   element ban and the `useModalDialog` pattern in that commit; landmarks
   search (after the iOS simulator check); `ControlRing`; the `fixed`
   entries.
9. Checkpoint: report actual line counts to the boxholder (Open design
   questions, Size).
10. Track 9: `repeatedClassProblems` with fixtures, unwired; then wiring with
    its merges; the census extras.
11. Tracks 10 and 11.
12. Browse screenshots at desktop and 375 px width for each visible change
    (popovers, lists, tables, dots, skeletons, spinner, git status), in one
    exhibit (`bin/exhibits add`); cross-model review of the branch.

## Rollout shape

- **Tests first.** For each primitive, the DOM test is written with its
  shape; for each rule, the fixtures and RuleTester suite are written with the
  rule; for `ui-check`, the fixtures come before the wiring.
- **Done when**, per track: its tests pass; `pnpm typecheck`, `pnpm
  lint:changed`, `pnpm layout-check` and `pnpm test:changed` pass from
  `beebox/`; `pnpm test`, `pnpm lint` and `pnpm typecheck` pass in
  `personal-vibe-check/` for rule commits; `pnpm ui-check` reports nothing;
  each new guard reports zero findings over the whole frontend
  (`pnpm lint` in `beebox/src/frontend/`, not only changed files, since a
  guard commit must prove the tree is clean).
- **Browser checks** with the browse skill: Tracks 3 (reduced motion
  emulated, including mid-turn), 4, 6 (SheetTable both axes), 7 (Popover
  contract by pointer and keyboard; `Menu at` at the corners), 8, at desktop
  and phone width, with the client debug log clean.
- **iOS 18.0 simulator:** the Popover contract before the five popovers move;
  the landmarks search sheet and the capture screen before Track 8's
  landmarks commit.
- **Knowledge audits:** the three above, run and recorded.
- **No data or storage change; no migration.**

## Review

Cross-model review, 2026-11-11, codex gpt-6-astra (log:
`scratch/cross-model/ui-dedup-plan.run.log`). Each finding was checked
against the source; the coordinator's adjudication is applied.

1. **Scope larger than needed** — partly accepted. Verified that the suffix
   rule accepted a component when anything in its file rendered the
   primitive. Changes: `component-name-suffix` now bans suffixes only;
   `no-ascii-ellipsis` is cut. Overturned: the doc coverage check stays (the
   boxholder approved B2), and Track 10 stays (the boxholder asked to remove
   duplicate date helpers). Cross-package work stays only where it removes a
   duplicate (workstreams-app overlays and `ago()`) or was approved (B9).
2. **`dialog.show()` chosen before the Popover contract** — accepted. Verified
   that the menu distinguishes keyboard from pointer opens
   (`Dropdown.tsx:210-212`). Track 7 now writes the contract (open, initial
   focus, Tab, Escape, outside press, conditional focus return, nesting in a
   modal, name), compares `show()`, `popover="manual"` (WebKit's 18.3 fix is
   the outside-tap dismissal) and the menu's portaled `div`, and chooses the
   `div`. It requires the iOS 18.0 simulator and desktop browse checks.
3. **Popovers would hold toasts** — accepted. Verified at
   `ToastViewport.tsx:39` (`dialog[open]`) against `toast-store.ts:98` ("a
   modal dialog covers the toasts"). The hold moves to a `ModalDialog`-owned
   `acquireHold`, with an integration test. This applies even though the
   chosen Popover is not a `<dialog>`, because the selector also matched the
   lightbox's and any future non-modal dialog.
4. **Table and list contracts** — accepted. Verified `caption: string | null`
   (`DoclingPageSection.tsx:39`), SheetTable's own scroll wrapper
   (`SheetTable.tsx:46`), and Markdoc rendering (`body.tsx:216`). Track 6 now
   separates application-authored structure from rendered content, makes the
   name a required non-empty string with Docling's explicit fallback, forwards
   cell attributes, and gives `Table` the only scroll container. Content
   renderers use `variant="grid"`; no exception is needed. Tests added.
5. **Class reader cannot implement the checks** — accepted. Verified the
   reader skips calls (`restrict-component-classes.ts:142-145`) and strips
   variants (`:136`). Track 3 now defines a separate matcher: `cn`/`clsx`/
   `twMerge` arguments, template quasis with boundary tokens dropped,
   branches as alternative sets with a reported cap, and variant-aware
   patterns. The outline entry (Track 11) uses `focus:`/`focus-visible:`
   patterns; `hover:` does not count. Fixtures listed.
6. **`MenuItem trailing` does not cover the rows** — accepted. Verified
   `MenuItem` takes only `to: string` (`dropdown-menu-item.tsx:30-34`), the
   session rows pass `search` and `bbxSource`, and the pin is a sibling button.
   `trailing` is replaced by router link props and a sibling `action` with
   `keepOpen`; tests on destinations and pin-without-select.
7. **`Menu at` cannot inherit the trigger implementation** — accepted.
   Verified `useDismiss` returns early with no root (`useDismiss.ts:22`) and
   the unclamped near edge (`Dropdown.tsx:266-271`). Track 7 defines the
   dismiss boundary, the flip-and-clamp rule (fixing trigger menus too),
   initial focus and return target, and close-on-scroll; corner and
   outside-press tests.
8. **Directory exemptions** — accepted. All `ignores` of whole directories are
   gone. Each rule entry has an `allowIn` list of owning files; dev pages and
   dev tools keep only their `fixed` panels. `ui/` is covered too, by owner.
   The remaining limit inside `ui/` is stated under edge cases.

Also added: the mid-turn reduced-motion verification (the reviewer found the
event audit sound and `card-turn.css:67-68` already shortens a running turn),
and Track 9's executable definition of class-shaped strings and appearance
tokens, with stable output and fixtures before it blocks commits.

Size after review: about 3,000 source, 1,480 test and 345 doc lines (was
2,900, 1,150 and 350). The contracts added more than the cuts removed.

### Round 2

Cross-model review, 2026-11-11, codex (log:
`scratch/cross-model/ui-dedup-plan-r2.run.log`). Round-1 findings 1–7 were
judged resolved. Each new finding was checked against the source.

- **Round-1 #8, directory exemption left in Track 5** — accepted. The
  `ui/fields/**` glob is gone; each of `input`, `textarea` and `select` has
  its own list of owning files, including the new `checkbox.tsx` and
  `file-picker.tsx` (Track 5).
- **R2-1, false containment premise for the native popover** — accepted.
  The top layer changes rendering, not DOM position, so a popover inside a
  modal stays its descendant. Re-decided on the corrected facts: `Popover` is
  a `<dialog popover="manual">` in the tree after its trigger. It needs no
  disable, gets Tab order and modal nesting from DOM order, and avoids the
  18.3 light-dismiss fix by using `manual`. The `frontend.md` dialog line
  holds with no exception. The portaled `div` is the fallback only if the
  iOS 18.0 check fails, with an accurate disable text and a named exception
  in the same commit (Track 7, Prior art, Track 2).
- **R2-2, Tab after a pointer open** — accepted. Contract rule 3 now defines
  Tab and Shift+Tab from the trigger, inside the panel, at both ends, and for
  a text-only panel, with DOM tests for each.
- **R2-3, branch cross product** — accepted. Verified the repeated-condition
  style (`SessionListPanel.tsx:300`) and that `cn` calls `twMerge`
  (`lib/cn.ts:15`). The matcher now checks the unconditional tokens with each
  conditional operand on its own, projected onto the entry's tokens and
  deduplicated; there is no cross product and no complexity budget. The miss
  (a combination split across two operands) and the merge behavior are
  documented, with fixtures (Track 3).
- **R2-4, outline rule misses `focus:outline-none`** — accepted. Verified
  `CloseButton.tsx:62`. The removal pattern covers all three spellings, and
  `outline-none` cannot count as its own replacement (Track 11, Track 3
  fixtures).
- **R2-5, arrow keys and the clamp** — accepted. Verified `Menu.tsx:24`
  rejects a non-item target. `moveMenuFocus` now treats the panel as a start
  point (ArrowDown/Home first, ArrowUp/End last), with tests. The clamp lets
  containment win over the 8rem preference (Track 7).
- **R2-6, guards ahead of their migration** — accepted. Verified
  `ImageLightbox.tsx:13`. The `dialog` element ban and the `useModalDialog`
  import restriction move to the Track 8 lightbox commit; Track 7 keeps only
  guards whose callers all move in Track 7.
- **Also:** `acquireHold` covers overlapping holds, unmount cleanup through
  the existing `useModalDialog` effect, and a one-shot release. The
  SheetTable claim is corrected: it has no `max-h` today, and the plan does
  not add one.

Size after round 2: about 3,035 source, 1,560 test and 345 doc lines.

### Round 3

Verification only (codex gpt-6-astra). All round-2 fixes hold. One blocker:
`showPopover()` on a `<dialog>` does run the dialog focusing steps, contrary
to Track 7's earlier text. Track 7 now returns focus to the trigger
explicitly on a pointer open, with tests, and falls back to the portaled
`div` if that misbehaves on device. The failure-mode table's "8rem floor"
wording now matches the contract (containment wins).

## Implementation status

- 2026-11-11, Track 1 (vocabulary renames): one commit. Renames applied with `git mv` and no alias: `ModalDialog`, `Menu` (`MenuContext`, `useMenuClose`, `pageIndex`, `menu-page-in-*` keyframes), `ScreenshotConsentDialog`, `QuickSearchDialog`, `CaptureScreen`, `MicStatus`, `SourceInspector`, the `*MenuBody` files and components, workstreams-app `Badge` (12 files, not 13). Size: about 600 changed lines of source, 38 of tests, 46 of docs (`git diff --shortstat`: 89 files, +359/-325; most lines are one-token renames). Deviations: (1) `VoicePanel` became `VoiceMenuBody`, but `components/chat/VoiceChip/panels.tsx` keeps its name because it mostly holds capability helpers, not menu bodies; (2) also renamed `DocumentLifecyclePills` to `DocumentLifecycleBadges` and `KindPill` to `KindBadge` in workstreams-app, and `RecentFilesPanelFileHandler` to `RecentFilesMenuBodyFileHandler`; (3) `shell.tsx` carried an existing `max-lines-per-function` error (151 lines, from the main merge) that blocked linting the renamed file; the two `useFirstLoadMark` calls moved into a `useConversationLoadMarks` helper, no rule changed; (4) historical docs (implemented plans, user-story reports, research, closed issues) and other open plans keep the old names as records of what they saw. Filed `issues/code-quality/2026-11-11-restrict-component-classes-skips-components.md` for the separate `restrict-component-classes` plan.

- 2026-11-11, Track 2 (UI doc coverage check): see the commit for sizes. `pnpm ui-check` (`beebox/src/dev/ui-check/`: `check.ts`, `doc-coverage.ts`, `exports.ts`), wired into `beebox/package.json`, `.husky/pre-commit` and `bin/lint-changed.ts` (`withUiCheck`). Allow-list `UI_INTERNALS` holds `FieldShell`, `FieldMessage`, `RevealButton`, `useFieldInk` (all imported by `ui/fields/field.tsx`) and `MenuContext` (`ui/menu-item.tsx`); `useFieldInk` was not in the plan's list but is a `use*` export used only by `ui/fields/`. Deviations: (1) `<CancelButton>` and `<HighlightedCode>` were named in the primitives section but exist nowhere in the source tree; the reverse check found them and the entries are removed. (2) `<Link>` is TanStack Router's, so `EXTERNAL_PRIMITIVES` exempts it from the reverse check. (3) `Popover` does not exist until Track 7; the dialog rules in `frontend.md` name it with a note that Track 7 adds it, and Track 7 removes the note. (4) `DropdownContext` in the plan's list is `MenuContext` since Track 1. (5) `toastError` is camelCase and not required by the check; it is documented anyway as the plan asks.

- 2026-11-11, Track 3 (reduced motion, `Spinner`, class matcher, `restricted-classes`): two commits, the rule and matcher in `personal-vibe-check`, then `Spinner`, the four other sites, the global CSS and the `animate-spin` entry. Size: about 710 changed lines of source (matcher and rule 556; frontend 150), 535 of tests, 64 of docs; the matcher and rule ran about twice the estimate, mostly RuleTester and matcher fixtures plus the `stylePosition` option. `restricted-classes` reports zero findings over the whole frontend (`pnpm lint` in `beebox/src/frontend/`). Browser checks (`bin/browse set media light reduced-motion`): a `bbx-spinner` element computes `3s` / `infinite` while `animate-pulse` computes `1e-05s` / `1`; on the theme-tour card a turn paused 58 ms into `out`, with reduced motion switched on mid-turn, finishes on the back with `data-card-turn` cleared; with the preference already on, the turn swaps sides with no animation. Deviations: (1) `allowIn` globs are relative to ESLint's working directory, since a rule cannot see its config's directory; from another directory they match nothing, so the rule fails closed. (2) The rule is enabled in the frontend config, not through a `vibeCheck()` option, like the other Tailwind rules. (3) `Spinner` takes an outer-layout `className` like every primitive, and adds `shrink-0`. (4) The two capture "ring" spinners (border circles) and the chat attachment's simplified SVG now render the Button SVG; the capture and pasted-image spinners were not seen in a browser, only in DOM tests of the primitive. (5) `index.css` comment explains why the rule shortens durations instead of setting `animation: none`.

- 2026-11-11, Track 4 (`LiveDot`, `Skeleton`, `StatusMessage inline`): one commit. Size: about 260 changed lines of source, 64 of tests, 6 of docs (`git diff --shortstat`: 61 files, +252/-80). Deviations: (1) `StatusMessage` call sites also moved for "Checking…" and "Searching…" lines of the same shape (8 more), so about 48 sites in all; "Loading..." spellings at moved sites are now "Loading X…". (2) Nine dots: four capture status-bar dots, `BackgroundTasks`, `pending-hq-message`, `VoiceChip`, `ScheduleOverview`, and the working phase of `capture-bubble` (its settled phases stay static spans). The three `bg-warning-light` upload dots now use tone `warning`. (3) The ThemedFileCard and Browse skeletons did not pulse before and now do; the ThemedFileCard second bar was `bg-warm-50` and is now `bg-warm-100`; the Inventory first bar was `bg-warm-200`. (4) The login "Loading sign-in options…" line lost its centering (`text-center` is not a layout class for `restrict-component-classes`). (5) `FileView` pending label and `AgentViewRenderer` "Loading view…" now render `StatusMessage`. (6) No lint entry, as the plan says. Browser: computed styles of LiveDot/Skeleton class sets in the dev app under reduced motion (8px and 6px dots, pulse once); no loading state was captured live.

- 2026-11-11, review fixes for Tracks 1–4 (cross-model review, four findings, each reproduced by a failing test first): (1) `ui-check` reads `export { X as Y }`, `export { X } from`, and `const X = ...; export default X`, and throws `AnonymousDefaultExportError` for an anonymous default export; (2) `restricted-classes` skips a helper call only when the enclosing `className` or helper read reaches it, so `cn("animate-spin").trim()` and `pick(cn(...))` are checked; (3) template interpolations touching quasi text are joined from their static spellings (`hover:${a ? "x" : "y"}` reads `hover:x`, `hover:y`) and dropped as partial otherwise; (4) `ui-check` reads `import * as ns` with `ns.Name`, `ns["Name"]`, and treats other uses of `ns` as importing every allow-listed name.
