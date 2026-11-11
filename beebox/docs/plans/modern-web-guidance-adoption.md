---
title: "Adopt modern-web-guidance: code sweep, lint rules, agent guidance"
status: draft
workstream: web-guidance-scan
issues:
  - ../../../issues/exploration/2026-11-10-adopt-modern-web-guidance-skill.md
---
# Adopt modern-web-guidance: code sweep, lint rules, agent guidance

This plan applies GoogleChrome/modern-web-guidance to the web code we have,
category by category, and decides how much of the guidance our dev and box
agents load. Each category below is a separate decision for the boxholder:
what the guides ask, what the scan found here, what our own guidance says, the
size of the change, whether lint can hold it, and a recommendation. Three
categories have a committed sample fix on this branch so the diff shape is
concrete.

**Issues addressed:** `issues/exploration/2026-11-10-adopt-modern-web-guidance-skill.md`.
Searched the queue for `modern-web`, `web-guidance`, `legacy-scan`,
`aria-describedby`, `isComposing`, `X-Frame-Options`, `frame-ancestors`,
`min-h-screen`, `overscroll`: no other open issue covers these. Related, not
resolved here: `issues/code-quality/2026-10-13-component-reuse-review.md`
(its dialog count is out of date; see Category C).

The evidence is in [`research/modern-web-guidance/`](../../../research/modern-web-guidance/README.md):
a per-guide triage table of all 209 published guides and eight audit reports.

## Design

No design section: this plan changes how existing controls are named,
announced, sized and protected, and how agents get guidance. It adds no
surface, card type, or behavior a person would decide on as product. Where a
category does touch product (a show-password button, which tabs exist), the
category marks it as a boxholder decision.

## Smallest fix and budget

**Smallest fix.** Merge the three samples on this branch (about 130 changed
source and test lines, plus 370 for the lint rule with its tests and docs) and
stop. That covers the
four real static-scanner findings, the field-description gap that touches every
form, and the modal scroll leak.

**Chosen scope**, if every "adopt" and "adopt with changes" recommendation
below is approved: about 1,100 changed source and test lines across about 60
files in `beebox/src/frontend`, `beebox/src/webapp`, `workstreams-app`,
`beebox-clerk`, and `personal-vibe-check`, plus about 150 lines of docs
(`frontend.md`, `box-docs/views.md`, `security-report.md`). Of the 1,100
lines, the samples account for about 500. Under 2,000: not a BIG CHANGE. The two
items that would push it over are listed as rejected or deferred: the
66-site `px`→`rem` conversion (D4) and a `popover` rewrite of `Dropdown` (B2).

What the fuller scope buys over the smallest fix: the clickjacking exposure
(F1), keyboard and screen-reader defects in shared primitives (B1–B3, B9–B11),
and lint rules that keep each fix from regressing (principle 11,
`docs/engineering-principles.md`: "A rule that matters gets a lint rule or a
type, not a paragraph").

## Stated preferences this plan trades against

- `beebox/frontend.md:5`: *"Bee Box is an internal app, not a public site
  chasing Lighthouse scores. Do not optimize before a measurement shows
  something is slow."* Most performance guides fail this test; Category E
  keeps only free attribute changes.
- Engineering principle 11: *"Enforcement beats convention, and the preset is
  ours."* Each adopted category names its lint rule or says why it has none.
- Engineering principle 8, *"One way to do each thing"*: a native element
  replaces a hand-rolled overlay only where our primitives (`ModalCard`,
  `useModalDialog`) are the native way already.
- `AGENTS.md`: *"Do not disable or weaken lint rules ... without explicit
  permission."* No existing rule is changed. New rules are additions; the one
  that turns on an existing plugin rule (`react/button-has-type`, B12) is
  marked as a boxholder decision.
- Memory/feedback: *"Minimize invented concepts; prefer primitives"* — the
  fixes go into primitives (`FieldShell`, `Dropdown`, `TabBar`) so one change
  covers every caller.
- Box isolation and egress: the upstream CLI sends telemetry by default
  (`src/cli/telemetry/clearcut-logger.ts`: *"return true; // Enabled by
  default!"*, opt-out `DISABLE_TELEMETRY=1`), and its events carry the search
  query (`src/cli/telemetry/types.ts`: `query?: string`). A box agent's query
  can contain box content, so Category H treats it as egress
  (`docs/security-report.md` §3).

## What already exists

- **Native dialogs.** `src/frontend/src/components/ui/ModalCard.tsx` and
  `hooks/useModalDialog.ts` open `<dialog>` with `showModal()`. Reuse: every
  dialog fix in Category C moves toward these.
- **IME helper.** `src/frontend/src/lib/ime.ts` already checks
  `event.isComposing || event.keyCode === 229`. Five handlers use it. Reuse
  (sample A1).
- **`field-sizing: content`** on the composer: adopted, with the Safari no-grow
  case recorded in `docs/implemented-plans/small-dependency-sweep.md:32`.
- **`:has()`, `overflow: clip`, `100dvh` app shell** (`src/frontend/src/index.css`:
  `.h-app { height: var(--app-height, 100dvh); }`), `color-scheme` on dark card
  themes, CSS Custom Highlight API, `mask-image` fades. Already the modern form;
  nothing to change.
- **jsx-a11y.** `personal-vibe-check/preset/react-rules.ts` runs the recommended
  set plus `control-has-associated-label`, `no-aria-hidden-on-focusable`, and
  `anchor-ambiguous-text`. It ignores `input` and `textarea` for labels
  (`ignoreElements: [... "input", "textarea", ...]`).
- **Accessible names rule.** `beebox/frontend.md`, "Frontend UI Primitives":
  every control has a name; per-row names say the object; toggles expose state.
  It goes further than the upstream accessibility guide.
- **axe in tours.** `beebox/test/tours/tour-lib/axe.ts` runs axe during tours.
  Reuse for target size (B4).
- **CSP.** `src/lib/csp.ts:44` has `["frame-ancestors", "'self'"]`, sent only as
  `Content-Security-Policy-Report-Only` (`src/webapp/server-root/root-routes.ts:120`).
  The companion headers were deferred on purpose:
  `docs/implemented-plans/app-wide-csp.md:322` *"Adopting `@fastify/helmet` for
  the broader header suite ... Deferred"*.
- **Weekly baselined lint.** `schedules/supplemental-lint/` reports only new
  oxlint and cycle findings. Reuse for a baselined `legacy-scan` (Category I).
- **View check.** `bbx view check` renders each box view with
  `renderToString` (`src/cli/commands/view/render-one.ts:163`). The rendered
  HTML is where DOM matchers could run (Category H).

## Prior art (external)

- **modern-web-guidance** (evaluated; one matcher adopted as a lint rule).
  209 use-case guides in 17 categories
  (`skills/modern-web-guidance/guides/<category>/`), a CLI with `search`,
  `retrieve` and `legacy-scan`, and plugin manifests. Apache-2.0. The adopted
  piece is credited in `ACKNOWLEDGEMENTS.md` in sample commit `9bb68f8a3`.
- **The scanner** (`modern-web-guidance-src/src/analyzing/`): 33 rules, all
  "qualified" (`rules/index.ts`: `QUALIFIED_RULES = RULE_MODULES.flat()`). The
  CLI says it covers *"~20% of the guidance corpus"* (`cli.ts`, the `note`
  field). It parses CSS only from `.css` files, so Tailwind classes are
  invisible to its CSS matchers. It needs no network and sends no telemetry
  (no `telemetry` import under `src/analyzing/` except `eval/`).
- **Evals.** The harness runs each task guided and unguided
  (`src/harness/run-suite.ts:22`: `const RUN_TYPES = ['guided', 'unguided']`)
  and flags tasks whose unguided pass rate is 80% or more
  (`.agents/skills/nightly-eval-investigation/SKILL.md`,
  `HIGH_UNGUIDED_PASS_RATE`: *"models already know the pattern without
  guidance"*). Its Claude Code agent runs through Vertex AI
  (`src/harness/config.ts`: *"Claude Code Configuration (through GCP Vertex
  AI)"*). Per-guide results live in the `guidance-evals` GCS bucket, which
  refused anonymous reads on 2026-11-11 (HTTP 401 on list, 403 on
  `suites.gen.json`). The public dashboard page loads them behind Google
  sign-in.
- **Distribution.** The skill tells agents to run
  `npx -y modern-web-guidance@latest search ...` (published `SKILL.md`), which
  executes whatever version is current on npm at each call. npm reports
  version 1.0.0, 16.5 MB unpacked.

## Ontology

The plan adds no product nouns. Working terms:

- **Guide** — one upstream Markdown file, id = its filename
  (`ime-safe-enter-submit`). Not ours; never edited.
- **Matcher** — upstream static rule in `src/analyzing/rules/<guide>.ts`.
- **Finding** — a site a matcher or an auditor flagged. **Real** when reading
  the code shows the change would help a person or remove code and our
  guidance does not choose otherwise.
- **Category** — a decision unit in this plan (A–I). A category groups guides
  by the code it touches, not by upstream folder.
- **Browser floor** — the oldest engine we support. Today implicit: the iOS
  app's WKWebView, `IPHONEOS_DEPLOYMENT_TARGET = 17.0`
  (`ios-app/*.xcodeproj`). workstreams-app and beebox-clerk: Chrome only.

## Tracks / scope

Every entry uses the same fields. "Real" counts come from the audit reports
after reading the code; sites are cited there. **Rec** is this plan's
recommendation. **Lint** says what holds the fix: an ESLint rule in
`personal-vibe-check/`, a baselined scan, or nothing.

### Category 0 — Browser floor (decide first)

- **What.** The guides assume "Baseline widely available" unless a project
  states a policy (published `SKILL.md`, "Interpreting Browser Support"). We
  have none written. The audit used Safari 17.0 as the floor, and it decided
  about 30 leans: `popover` on iOS (guide data: iOS 18.3), anchor positioning,
  `closedby`, invoker commands, `interestfor`, `light-dark()` (17.5),
  `text-wrap` (17.5), Trusted Types (26), Temporal (none).
- **Rec.** Write a one-paragraph policy in `beebox/frontend.md`: floor =
  Safari 17.0 / Chrome current; features above the floor only as progressive
  enhancement with no fallback code over about 20 lines. The upstream skill
  reads such a line and applies it.
- **Boxholder decision.** Keep iOS 17.0, or raise it. Raising to iOS 18
  would unlock `popover` for B2/C3 and change four leans; nothing else in this
  plan depends on it.

### Category A — Forms and input

**A1. Enter handlers skip IME composition** (`ime-safe-enter-submit`,
`forms/js-ajax`). **SAMPLE, committed** `f4def2b71` + `9bb68f8a3`.
- Asks: a keydown handler that acts on Enter returns early while an IME is
  composing.
- Found: 4 static-scanner findings, 4 real
  (`components/admin/AllowedEmailsSection.tsx:192`,
  `admin/GmailFiltersSection/views.tsx:65`,
  `workstreams-app/.../IssuesPane/IssueControls.tsx:90`,
  `workstreams-app/.../QuickOpen.tsx:81`). A full search found no others.
- Ours: agrees in code (`lib/ime.ts`), silent in docs.
- Size: 4 files, 9 lines. Risk none. Verified by the lint rule below.
- Lint: **ESLint, ported.** `personal-vibe-check/rules/ime-safe-enter.ts`,
  on with `react: true`. On 1,049 files it reports the same 4 sites at the
  parent commit and 0 after the fix. Exact enough to block.
- Rec: **adopt** (done as sample).

**A2. Field hints and errors are linked to the control** (`forms/labeling-state`,
`accessibility/descriptions-and-hints`, the `aria-describedby` half of
`validate-input-after-interaction`). **SAMPLE, committed** `4b36324c4`.
- Asks: hint and error text referenced by `aria-describedby`.
- Found: 6 control types set `aria-invalid` and none set `aria-describedby`
  (`ui/fields/field.tsx`, `ui/fields/radio.tsx`). Real: all. A screen reader
  heard an error once, through `role="alert"`, and never heard a hint.
- Ours: silent (`frontend.md` lists "label + input + error + helper").
- Size: 3 files changed, 1 test added (+85/−17). 224 change-selected tests
  pass.
- Lint: none needed; the primitive owns the wiring.
- Rec: **adopt** (done as sample).

**A3. Raw controls with no accessible name** (`forms/labeling-state`,
`checkbox`).
- Found: 5 real. Chat composer textareas
  (`chat/InteractiveChat-composer/view.tsx:106`,
  `InteractiveChat-mobile-row.tsx:42`, named only by placeholder);
  `DebugLog.tsx:230`; the Cloudflare revoke-acknowledge checkbox
  (`admin/CloudflarePublishConnectionsSection/view.tsx:267`); the rendered
  task-list checkbox (`Markdown/body.tsx:266`).
- Ours: conflicts with the code; `frontend.md` requires a name on every
  control. Lint misses these because `control-has-associated-label` ignores
  `input` and `textarea`.
- Size: 5 files, `aria-label` or a wrapping `<label>`. Low risk.
- Lint: a new rule (or removing `input`/`textarea` from `ignoreElements`,
  which tightens an existing rule's options and needs the boxholder's yes).
  Lean: leave the existing rule's options alone; the 5 sites are fixed by hand.
- Rec: **adopt**.

**A4. Autofill and identifier hints** (`autofill-sign-in-form`,
`autofill-sign-up-form`, `forms/autofill-hints`).
- Found: login and setup email use `autoComplete="email"`; the guides say
  `username` so a password manager pairs it with the password
  (`pages/login/components/LoginFields.tsx:24`, `pages/login/SetupPage.tsx:168`).
  About 7 identifier fields (hostname, connection name, account id, Drive URL,
  secret name) lack `spellCheck={false} autoCapitalize="none" autoCorrect="off"`,
  which the iOS keyboard needs.
- Ours: silent. Several admin fields already set these
  (`ClaudeCodeSection.tsx:73`).
- Size: 2 one-word edits; 7 call sites or one `identifier` prop on
  `TextField`. Low risk. Verify with Chrome and Safari autofill on `/login`.
- Lint: baselined scan only (which field is an identifier needs judgment).
- Rec: **adopt with changes**: the `username` token and the identifier
  attributes; skip the second-password-field removal on setup.

**A5. Checkbox and radio tint** (`brand-consistent-forms`, `forms/styling-controls`).
- Found: `ui/fields/field.tsx` checkbox and `radio.tsx` radio carry
  `text-primary focus:ring-accent`, which are `@tailwindcss/forms` classes.
  The plugin is not installed (`tailwind.config.js:155`:
  `plugins: [typography]`), so the controls render browser blue. `RadioCards`
  shows no keyboard focus.
- Size: 2 class edits (`accent-primary`), 1 `focus-within:ring` line. Check the
  checkmark contrast in Safari and on dark themes with `bin/theme-check`.
- Lint: none (class strings).
- Rec: **adopt**.

**A6. Show-password toggle** (`forms/identity-security`).
- Found: no reveal button on login, setup, or change-password.
- Size: one optional button in `TextField` for `type="password"`
  (`aria-pressed`, constant name per `frontend.md`), tests. Medium-low risk.
- Rec: **adopt with changes**; **boxholder decision** (product: is it wanted?).

**A7. Phone input font size** (`forms/responsive-typography`).
- Found: 1 real: a 14 px raw input on an admin page the iOS app can open
  (`components/admin/ClaudeCodeSection.tsx:68`) zooms the page on focus.
- Size: `text-base sm:text-sm`. Rec: **adopt** (one line).

**Rejected in A:** `:user-invalid` validation styling (controlled React forms
already decide when to show errors), customizable `<select>` (Safari 27),
OTP, address, payment, slider, switch, multi-page forms (no such forms here).

### Category B — Accessibility of shared controls

**B1. `aria-label` on elements with no role** (`accessibility/accessible-names`).
- Found: 8 real, e.g. `chat/everywhere/InteractiveChat/BackgroundTasks.tsx:70`
  `<div ... aria-label="Background tasks">`; browsers drop a name on a generic
  `div`.
- Ours: agrees (`frontend.md`: names on every control; landmark components
  render their own role).
- Size: 8 files; add `role="group"` / `role="status"` or drop the label.
- Lint: **ESLint**, a `no-restricted-syntax` selector:
  `JSXOpeningElement[name.name=/^(div|span|p)$/]:has(JSXAttribute[name.name='aria-label']):not(:has(JSXAttribute[name.name='role']))`.
  Deterministic; spread props can hide a role, so check the residue.
- Rec: **adopt**.

**B2. `Dropdown` declares `role="menu"` without menu keys** (`menu`, `navbar`).
- Found: `ui/Dropdown.tsx:312` `role="menu"`; its own comment at `:175`:
  *"full arrow-key roving focus is out of scope"*. An ARIA menu promises
  Arrow/Home/End. The PlacePill landmark lists put navigation links in it as
  `role="menuitem"` (`ui/dropdown-menu-item.tsx`).
- Ours: `frontend.md` describes `<Dropdown>` as *"menu with click-outside,
  escape-to-close, auto-close on select"*; silent on keys.
- Size: either (a) Arrow/Home/End roving in `Dropdown.tsx` plus a DOM test,
  1–2 files, medium-low risk; or (b) a `kind="navigation"` that drops the menu
  roles for link lists, 2 files, medium risk (ui-scan and tests query
  `[role=menuitem]`). The upstream path (`popover` + `focusgroup` + anchor
  positioning) fails the floor; rejected.
- Lint: none (behavior).
- Rec: **adopt with changes**, (a) for command menus, (b) for link lists.
  **Boxholder decision**: (a) only, or (a)+(b).

**B3. Tabs used as filter switches** (`tabs`).
- Found: 4 real. `TabBar` renders a tablist with no tabpanels for three
  inventory filters (`pages/inventory/components/InventoryContent/view.tsx:156`,
  `:158`) and the todo grouping (`todo-view/TodoViewControls.tsx:71`).
  `TabBar.tsx` also widens the active tab with `font-medium`.
- Size: a `mode="buttons"` on `TabBar` rendering `role="group"` +
  `aria-pressed` (the `ThemeSwatchPicker.tsx` pattern), 4 call sites. `bbx-`
  ids stay. Low-medium risk.
- Lint: none (needs judgment).
- Rec: **adopt with changes**.

**B4. Touch targets under 24 px** (`accessibility/target-sizes`,
`user-experience/form-factor-adaptation`).
- Found: 4 components. `ui/Toggle.tsx:30` (`h-5`, 20 px),
  `ui/CloseButton.tsx:61` bubble (`w-5 h-5`), `SidecarTabStrip` close/pin
  (about 16 px), `chat/ack-badge.tsx` (14 px).
- Ours: silent.
- Size: 4 components; grow the hit area with padding or a pseudo-element.
  Medium risk: the tab strip is themed (`.bbx-interface-tab-action`). Verify at
  375 px and with `bin/theme-check`.
- Lint: **baselined**: enable axe `target-size` in the tour axe run.
- Rec: **adopt with changes** (the 4 components; no global coarse-pointer
  sweep).

**B5. Hover-only control on touch** (`user-experience/natural-interactions`).
- Found: the unpinned tab's pin button is `opacity-0 group-hover:opacity-100`
  (`chat/workspace/SidecarTabStrip/view.tsx:270`): invisible on iPhone but
  tappable. `todo/TodoItem.tsx:125` already uses the right pattern
  (`[@media(hover:hover)]:opacity-0`).
- Size: 1 class string. Rec: **adopt**.

**B6. Missing focus indicators** (`accessibility/focus-indicators`).
- Found: 2 real: the full-area shutter in
  `capture/CaptureOverlay/CameraViewport.tsx:41` has `focus:outline-none` and
  no replacement; `CapturePhotoStrip.tsx:73` uses `focus:` where it means
  `focus-visible:`.
- Size: 2 class edits. Rec: **adopt**.

**B7. Scrollable code blocks are not keyboard-scrollable in Safari**
(`accessibility/tab-order-and-focus-management`).
- Found: `ui/Pre.tsx` with `scroll` has no `tabIndex`; Chrome makes scrollers
  focusable, Safari does not. `Stack` already has a `focusable` prop.
- Size: `Pre` takes the same treatment as `Stack focusable`. Rec: **adopt with
  changes** (`Pre` only; leave table wrappers).

**B8. Breadcrumbs** (`breadcrumbs`). `pages/browse/components/BrowseBreadcrumbs.tsx`
is a `div` of buttons with literal `/` separators. Add `<nav aria-label>`,
`<ol>`, `aria-current`, `aria-hidden` separators; keep the copy-friendly
layout its header comment asks for. 1 file. Rec: **adopt with changes**.

**B9. Upload progress** (`progress`). `chat/InteractiveChat-layout/view/ChatAttachments.tsx:208`
is a `role="progressbar"` span that reports 0% while the total is unknown.
Native `<progress>` without `value` announces indeterminate. 1 file. Rec:
**adopt with changes** (this site only; the workstreams `meter` stays).

**B10. Copy feedback** (`copy-button`). `ui/Button.tsx` puts `aria-live` on
the button and renames it "Copied" during the flash; a live region inside a
button is not reliably announced. Three copy sites have no `failLabel`
(`admin/InviteSection.tsx:57`, `admin/AllowedEmailsSection.tsx:112`,
`SourceViewOverlay.tsx:170`). Move the announcement to a sibling
`role="status"`; add `failLabel`. 4 files, medium-low risk (Button has many
tests). Rec: **adopt with changes**; reject Invoker Commands.

**B11. Toasts under a modal** (`persistent-toast-notifications`).
`ui/ToastViewport.tsx:22` is a `fixed z-[9999]` div; a `showModal()` dialog is
in the top layer and makes the page inert, so a toast raised while a dialog is
open is hidden and silent. Label the container and hold toasts while a modal
is open. 1 file. Rec: **adopt with changes**; keep `role="alert"`.

**B12. `<button>` without `type`** (`html/html`). 69 raw `<button>` tags lack
`type`; none is inside a `<form>` today, so no live bug.
- Lint: **ESLint**, `react/button-has-type` (plugin already loaded in
  `personal-vibe-check/preset/base-config.ts`). Turning it on is new
  enforcement, not a weakened rule, but it changes the shared preset.
- Rec: **adopt with changes**; **boxholder decision** (69 mechanical edits for
  a latent bug).

**B13. `Accordion` versus `<details>`** (`accordion`). `ui/Accordion.tsx`
re-implements disclosure with `button[aria-expanded]` and an unlabeled
`role="region"`; 14 raw `<details>` already exist beside it. A `<details>`
rewrite must keep controlled `open` (the Cloudflare editor drives it from other
state). Rec: **adopt with changes**: drop the unlabeled `role="region"` now;
leave the rewrite unless the boxholder wants one disclosure idiom
(principle 8).

**Conflict recorded, rejected:** the guide advises against `role="status"` on
loading text; `frontend.md` ("Data and state") prescribes `<StatusMessage>`
with `role="status"`. Keep ours. Also rejected: `prefer-tag-over-role` (off by
choice in `react-rules.ts`), `ariaNotify()` (Safari 27), CSS alt text, web
components guides (we write none).

### Category C — Dialogs and overlays

**C1. Contain scroll under modal dialogs** (`prevent-page-scroll-under-modal-dialog`,
`dialog`). **SAMPLE, committed** `f8630e8c3`.
- Found: 3 native modal dialogs, none with `overscroll-behavior`. Real: all.
- Size: 9 CSS lines in `src/frontend/src/index.css`. Checked in the dev app
  that the rules are served; scroll chaining itself was not driven
  (`bin/browse` scrolls programmatically).
- Lint: none (one global rule).
- Rec: **adopt** (done; add the same rule to `workstreams-app` styles).

**C2. PlacePill landmark search overlay** (`dialog`,
`accessibility/modals-native-dialogs`).
- Found: `AppNav/PlacePill-landmarks.tsx:225` `<section role="dialog"
  aria-modal="true">` with a hand-written Tab trap and no `inert` on the page.
  It sizes itself to `visualViewport` for the iOS keyboard and is portaled
  from inside a `Dropdown`.
- Size: 1 file; add `inert` to the app root while open (smallest), or move to
  `<dialog>`. High risk on iOS. Verify at phone width on a device.
- Rec: **adopt with changes** (`inert` only).

**C3. Unnamed popup bubbles** (`dialog`). `chat/ack-badge.tsx:76` and
`chat/user-message/audio-overlay-badge.tsx:165` are `role="dialog"` with no
name. Rec: **adopt with changes**: add `aria-label`; leave `popover` until the
floor allows it on iOS.

**C4. workstreams-app overlays** (`declarative-dialog-popover-control`).
`QuickOpen.tsx:72` (`div role="dialog"` + scrim button + window Escape) and
the issues filter `<details>` with a backdrop button (`IssuesPane/panel.tsx:108`).
Chrome only, so `<dialog>`, `popover` and `closedby` all work. 2 files.
Rec: **adopt**.

**C5. Clerk confirm dialog** (`dialog`). `beebox-clerk/src/entrypoints/box-relay.content.ts:96`
is a `div role="dialog" aria-modal="true"` with no focus move and no Escape,
inside a closed shadow root. `<dialog>` + `showModal()` works there. 1 file,
plus a clerk test. Rec: **adopt**.

**C6. `closedby="none"` for `ModalCard`** (`platform-controls-dismiss-dialog`).
`ui/ModalCard.tsx:72` re-opens the dialog after Chrome's repeated-Escape close.
`closedby` might make that unnecessary in Chrome; Safari lacks `closedby`.
Rec: **defer**: one manual experiment when someone next touches `ModalCard`.

**C7. Lint for hand-rolled dialogs.** After C2–C5, a `no-restricted-syntax`
selector reporting `role="dialog"`/`"alertdialog"` on any JSX element other
than `dialog` keeps new ones out (C2 and C3 keep one-line disables with a
reason). Rec: **adopt** after C2–C5.

**Rejected in C:** invoker commands (`commandfor`), `interestfor`, anchor
positioning, a `popover` rewrite of `Dropdown`, `closedby="any"` on
`ModalCard` (callers confirm before close on purpose).

### Category D — Layout and CSS

**D1. `min-h-screen` on centred pages** (`responsive-design`). **SAMPLE,
committed** `f8630e8c3`. 3 pages now use `min-h-dvh`. Lint: **ESLint**, a
className regex rule banning `\b(min-|max-)?h-screen\b` (deterministic; 1
dev-harness site would take a disable or a fix). Rec: **adopt**.

**D2. `color-scheme: dark` on dark chrome** (`dark-mode`,
`component-specific-light-dark-theme`). Five dark system themes set
`color-scheme: dark` on cards and the composer but not on the chrome root
(e.g. `themes/deck.css:2` vs `:191`), so desk scrollbars and unstyled controls
may draw light. Unverified in a browser. Rec: **adopt with changes**: check
each with `bin/theme-check`, add one declaration per theme where it shows.
Reject OS-following `prefers-color-scheme` and `light-dark()`: the app has
user-chosen themes, not OS dark mode.

**D3. Balanced headings** (`improve-text-layout-and-legibility`). Add
`text-balance` to `ui/Heading.tsx`. Safari 17.0 ignores it. Rec: **adopt with
changes** (Heading only; judge `text-pretty` on prose after a visual check).

**D4. `px` font sizes** (`typography`). 66 sites (`text-[11px]`,
`font-size: 15px`). Converting honours a changed browser font size on desktop;
WKWebView Dynamic Type does not follow `rem` alone. Rec: **reject** under
`frontend.md:5`; revisit if a reader needs larger text.

**D5. Tables at phone width** (`responsive-table`). Two tables without an
`overflow-x-auto` wrapper (`browser-task/RunsTable.tsx`, `BatchList.tsx`).
Rec: **adopt with changes**: wrap only if a 375 px check shows overflow.

**Rejected in D:** container-query sweep (needs the Tailwind plugin; no
measured problem), `scroll-state` queries, anchor positioning,
`font-size-adjust` (no visible problem shown), `scroll-axis-lock` (Chrome 153
only), scroll-driven animations, `@scope`/`@layer` restructuring.

### Category E — Performance

**E1. Image loading hints** (`optimize-image-priority`).
- Found: 3 real. Card-body Markdown images load eagerly
  (`components/Markdown/body.tsx:96`); lightbox swipe neighbours compete with
  the visible image (`ImageLightbox.tsx:288`); `box-docs/views.md` shows an
  `<img>` grid without `loading="lazy"`.
- Ours: agrees (`ui/Image/view.tsx` documents `loading` as opt-in for
  offscreen images). Chat images stay eager on purpose: the open-thread hold
  waits for them (`components/chat/AGENTS.md`).
- Size: 2 attributes, 1 docs sentence. Check first that `body.tsx` never
  renders in the chat transcript. React 18.3 needs lowercase `fetchpriority`.
- Rec: **adopt with changes**.

**Rejected in E:** `content-visibility` (deferred for the chat by
`docs/implemented-plans/chat-scroll-redesign.md:262`; no measured slow list),
LoAF attribution in the perf harness (defer until a long task needs it),
speculation rules, `fetchLater`, `scheduler.yield`, analytics batching, bfcache
tuning: no measured problem (`frontend.md:5`).

### Category F — Security and privacy headers

These change server responses, so the `security-report` skill runs with them.

**F1. Clickjacking: enforce `frame-ancestors`** (`security`).
- Found: real. `frame-ancestors 'self'` is only in the Report-Only policy,
  where browsers ignore it, and no `X-Frame-Options` is set in
  `src/webapp` or `deploy/nginx/beebox.conf`. Any site can frame the app.
  Only the `/browser/` proxy page enforces it
  (`src/webapp/routes/browser/proxy/response.ts:19`).
- Ours: `app-wide-csp.md:322` deferred `X-Frame-Options` with the helmet suite.
- Size: 1 hook beside `registerCspReportingHeaders`
  (`server-root/root-routes.ts`): send `X-Frame-Options: SAMEORIGIN` and an
  enforced `Content-Security-Policy: frame-ancestors 'self'` on HTML. A header
  test. Risk: same-origin frames (theme studio, PDF, frozen files) keep
  working; the iOS app does not frame the app.
- Rec: **adopt**. Highest-value item in the plan.

**F2. `Referrer-Policy` and `Permissions-Policy`** (`security`, `privacy`).
Set only on a few auth routes (`routes/auth/invite.ts:34`); `Permissions-Policy`
nowhere. Rec: **adopt with changes**: `strict-origin-when-cross-origin`, and a
Permissions-Policy that keeps `camera=(self), microphone=(self)` for capture.
Verify capture in the iOS app.

**F3. HSTS.** Rec: **check first** whether Cloudflare already sends it
(`security-report.md` notes Flexible SSL); add with a short `max-age` only if
not.

**F4. Trusted Types, Report-Only** (`trusted-types`). Add
`require-trusted-types-for 'script'` to the Report-Only policy as a
measurement; `pnpm csp-digest` then lists the sinks. Safari 17 ignores it.
Rec: **adopt with changes** (report only; do not enforce).

**Rejected in F:** `__Host-` cookie rename (signs everyone out; `secure` is
off on http dev), `Clear-Site-Data` on logout, Sanitizer API (Safari lacks
`setHTML`; our Markdown renderer already rebuilds HTML through an allow-list,
`security-report.md`), Origin API, `restrict-outbound-connections`, SRI (no
third-party scripts). The iOS bearer token in `localStorage`
(`lib/mobile-auth.ts:5`) is an iOS contract question, out of scope.

### Category G — JS APIs

Temporal, `Intl.DurationFormat`, global calendars, high-precision timestamps.
Our `Date` code is correct today (`ui/FriendlyDate.tsx`), and Safari has no
Temporal. Rec: **reject**; revisit when Temporal is Baseline.

### Category H — Box-authored views

- **What.** Box agents write views (`src/views/*.tsx` in a box) from
  `beebox/box-docs/views.md`. No lint runs there; `bbx view check` renders
  each view (`src/cli/commands/view/render-one.ts`).
- **Found.** The stock views (`src/schemas/*.tsx`, `src/plugins/*/view*`) had
  0 static findings and no audit findings beyond E1's grid sentence.
  `box-docs/views.md` says nothing about accessibility
  (grep for `access|screen reader|sr-only` is empty).
- **Options.**
  1. Add about 10 lines to `box-docs/views.md`: name controls, use native
     `<dialog>`/`<details>`, `loading="lazy"` on grids, IME-safe Enter. Cheap;
     covers the patterns found in our own code.
  2. Run the ported ESLint rules (A1, B1, C7, D1) over the view source in
     `bbx view typecheck`. Needs the preset inside the engine package at box
     runtime; medium.
  3. Run upstream matchers or axe over the rendered HTML in `bbx view check`.
     The upstream scanner is a separate npm package with `ts-morph` and
     `linkedom`; axe-core is a dev dependency of beebox today
     (`beebox/package.json`), not shipped to boxes. Large.
  4. Give box agents `search`/`retrieve` through a `bbx` wrapper. Box egress is
     not filtered, so it works, but the telemetry carries query text
     (see preferences); the wrapper must set `DISABLE_TELEMETRY=1` and pin the
     version, and `security-report.md` §3 gains a row.
- **Rec.** Option 1 now. Option 4 later, only if box views start using
  modern features the box agent gets wrong. Reject 3.

### Category I — Lint and baselined scan

What can become ESLint, by source:

| Rule | Source | Exact enough? | Rec |
|---|---|---|---|
| `ime-safe-enter` | upstream matcher | yes: 4/4 real, 0 false on 1,049 files | adopted (sample) |
| `aria-label` on role-less `div/span/p` | audit B1 | yes (selector) | adopt |
| `role="dialog"` outside `<dialog>` | audit C7 | yes (selector) | adopt after C2–C5 |
| `h-screen` class ban | audit D1 | yes (regex on literals) | adopt |
| `react/button-has-type` | audit B12 | yes (existing plugin rule) | boxholder decision |
| `role="progressbar"`/`"meter"` | audit B9 | yes, but 2 sites | reject (fix by hand) |
| the other 32 upstream matchers | upstream | most yes | reject as ESLint |

The other 32 upstream matchers found nothing in our code, so porting them
guards patterns nobody here writes. Instead, run `legacy-scan --json` weekly
inside `schedules/supplemental-lint/` against a baseline (empty today), the
way it treats oxlint. It catches a new legacy pattern, and it picks up new
upstream matchers with no port. Constraints: run from a pinned copy in its own
directory (never `npx @latest` in a schedule), outside the checkout's scripts;
the scanner sends no telemetry.

### Agent guidance: whole, part, or none

- **Fit.** The audit shows our code already uses most modern features the
  guides push (native dialogs, `:has()`, `dvh`, `field-sizing`, highlight API).
  Most real findings are accessibility basics a model knows but skips, not
  new platform features. The guides' main value here is as a reviewer
  checklist and for the ~20% of features a model gets wrong.
- **Dev agents.** The published skill's description says *"MANDATORY:
  Execute FIRST for all HTML/CSS and clientside JS tasks"*, so it triggers on
  most frontend work. Each trigger runs `npx -y modern-web-guidance@latest`:
  network, a fresh npm package at each call, telemetry on. The description
  costs about 1 KB of context per session; the body (9.8 KB) loads only when
  triggered.
- **Rec: in part.** Install the skill for dev agents from a pinned, vendored
  copy of the CLI (a version we bump on purpose), with
  `DISABLE_TELEMETRY=1`, and the browser-floor paragraph (Category 0) in
  `frontend.md` so its fallback advice targets Safari 17.0. Do not copy guide
  text into our docs: copies go stale and leave the evals' coverage.
- **Box agents.** Category H, option 1 now; option 4 later.
- **Order.** (1) Category 0 decision; (2) the sweep by approved category, each
  lint rule landing in the same chunk as its fixes (as sample A1 did);
  (3) the weekly baselined scan; (4) the dev-agent skill. The sweep does not
  wait on the skill: the audit already did the guide reading.

### Per-model fit

- The harness already compares guided and unguided runs per task, and flags
  guides that models pass unguided. Per-guide results are not public
  (bucket refuses anonymous reads), so we cannot see Opus 5.5's results
  without running it.
- Running it here means adapting the Vertex-only Claude agent config to our
  auth, then about 209 guides × 2 conditions × several runs of a Claude Code
  session each. Not run; cost unmeasured.
- **Rec: do not run the suite.** With on-demand `search`/`retrieve`, a guide
  the model never retrieves costs nothing, so pruning buys little. Instead,
  add one `--dev` knowledge audit (below) that checks a dev agent consults the
  skill on a frontend task and applies the floor.

## Could this be simpler?

The simplest version is the three samples plus F1 (one header hook): about
500 lines, all four static findings, every form's descriptions, the modal
scroll leak, and the clickjacking exposure. It fails on the keyboard and
screen-reader defects in shared primitives (B2, B3, B9–B11), which a person
using a screen reader or a keyboard meets on every menu and tab strip, and it
leaves no rule to stop regressions (principle 11). The fuller plan does not
add machinery: no new subsystem, no new test tier, no new dependency. The
weekly scan reuses `supplemental-lint`. Cut from the fuller version already:
the `px`→`rem` sweep, the `Dropdown` popover rewrite, container queries,
running the eval suite, and DOM matchers in `bbx view check`.

## Subplans

None. Each category is small enough to do from its entry here.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A1 rule misses a handler defined in another module | rule test documents the limit | no | silent; residue is small (all current handlers are inline or same-file) |
| A1 rule flags a `TextField` used as a button | no | one-line disable with reason | clear (lint error) |
| A2 two fields share an id, so `-message` ids collide | axe `duplicate-id` in tours | ids are `bbx-` unique by rule | clear in tours |
| B2 arrow-key roving fights a panel that holds inputs | to write with B2 | `Dropdown.tsx` notes panels hold plain controls | silent until a keyboard user hits it; B2's test covers a panel with an input |
| B3 tests and ui-scan query `[role=tab]` for the re-roled filters | existing DOM tests fail | update tests in the chunk | clear |
| B11 toasts held during a modal are lost if the modal never closes | to write with B11 | release on close or unmount | silent if mishandled; the test opens and closes a dialog |
| C2 `inert` on the app root also covers the overlay's own portal | to write with C2 | portal target outside the inert root | silent on desktop, breaks typing; verify on iOS |
| D2 `color-scheme: dark` on chrome flips a light control inside it | `bin/theme-check` | fields already pin `[color-scheme:light]` (`ui/fields/shell.tsx`) | visible in theme-check |
| F1 `X-Frame-Options` breaks a same-origin frame we use | header test | `SAMEORIGIN` keeps same-origin frames | clear (frame refuses to load) |
| F2 Permissions-Policy blocks camera in capture | no | allow `self` | clear in capture; verify on iOS before landing |
| Weekly `legacy-scan` runs a changed upstream version | no | pinned copy, bumped on purpose | silent if unpinned; the schedule must not use `@latest` |

> **Critical gap:** none. The silent rows above each name the test that the
> chunk adds.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field — ADDRESSED: A2 links whichever message shows, error
  first, through one id per field (`fieldMessageId`).
- Stale ref — ADDRESSED: `bbx-` control ids do not change in any chunk
  (`frontend.md`: *"Never rename an existing id; iOS mirrors some of them"*);
  B3 keeps the ids when it changes the role.
- Two agents touching the same card — not applicable: no card writes.
- Hand-edit drift — ADDRESSED for dev code by the lint rules (Category I); GAP
  for box views until Category H option 1 or 2 lands.
- Fabricated free-form value — not applicable.
- Validation error UX — ADDRESSED: the A1 rule message names the helper and
  the Safari case, so an agent can fix it from the message alone.
- Partial migration — ADDRESSED: each category lands on its own; no category
  depends on another except C7 (after C2–C5) and the skill (after Category 0).

## NOT in scope

- `px`→`rem` (D4): 66 sites, no reader need shown.
- `Dropdown` on `popover` + anchor positioning: fails the iOS 17 floor.
- Container queries: needs a Tailwind plugin and per-component rewrites with no
  measured problem.
- Running the upstream eval suite on Opus 5.5: cost, and on-demand retrieval
  makes pruning unnecessary.
- DOM matchers or axe inside `bbx view check` (H3): ships new dependencies to
  boxes.
- The iOS bearer token in `localStorage`: an iOS contract change
  (`bbx-ios-overlap`).
- Promoting the full CSP from Report-Only to enforcing: tracked by
  `docs/content-security-policy.md`; F1 enforces only `frame-ancestors`.
- Dead context-menu code in `pages/browse/BrowsePage.tsx` and the unread
  `--bbx-composer-height` variable found during the audit: file as issues.

## Open design questions

1. **Browser floor** (Category 0). Lean: keep iOS 17.0; write it down.
2. **Dropdown roles** (B2). Lean: arrow keys for command menus, no menu role
   for link lists.
3. **`react/button-has-type`** (B12). Lean: adopt; the edits are mechanical.
4. **Show-password toggle** (A6). Lean: yes on login and setup.
5. **Dev-agent skill** — install the pinned, telemetry-off copy, or none.
   Lean: install after Category 0 is written.
6. **One disclosure idiom** (B13). Lean: keep `Accordion`, drop its region.

## Knowledge audits

The plan adds two agent-facing rules: the browser-floor paragraph in
`frontend.md`, and (if adopted) the box-view paragraph in `box-docs/views.md`.
- Dev audit (`--dev`): given "add a popup menu to X", the agent stays within
  Safari 17.0 (no anchor positioning without a fallback).
- Box audit: given "make a view with a text field that submits on Enter", the
  view checks IME composition and names the field.
Both land with their docs chunk and are run once
(`pnpm knowledge-audit run ... --filter <id>`).

## What will hold this after it ships

- Lint (Category I) holds A1, B1, C7, D1, and B12 if adopted. Each rule has
  RuleTester cases and is measured against the real tree before it lands, as
  sample A1 was.
- DOM tests in `src/frontend/test/components/ui/` hold primitive behavior:
  A2 (`fields.described-by.test.ts`, added), B2 (keys), B3 (roles), B9, B10,
  B11.
- A header test holds F1/F2 on the HTML route.
- axe `target-size` in tours holds B4.
- The weekly baselined `legacy-scan` reports any new upstream-detected
  pattern.
- Not held by a test: visual items (D2, D3, A5) — `bin/theme-check` at change
  time only.

## Implementation order

Each line is a chunk; each lands with its own lint rule and test. Order
follows dependency, then value.

0. Category 0: browser-floor paragraph in `frontend.md`.
1. Samples (done): A1 fix + rule, A2, C1 + D1 fix.
2. F1 (+F2, F4 if approved), with `security-report` skill update.
3. A3, A4, A5, A7, B5, B6 (small, independent).
4. B1 + its selector rule; D1's `h-screen` rule.
5. B2, B3 (primitive changes; update tests).
6. B9, B10, B11, B7, B8, B13 (drop region).
7. C3, C4, C5, then C2 (iOS check), then C7 rule.
8. B4 + axe `target-size`; D2, D3, D5 (theme-check).
9. E1 (after confirming `body.tsx` is not in chat).
10. A6 and B12 if approved.
11. Category H option 1 (`box-docs/views.md`), knowledge audits.
12. Weekly baselined `legacy-scan` in `schedules/supplemental-lint/`.
13. Dev-agent skill install (pinned, telemetry off), dev knowledge audit.

## Rollout shape

Tests first per chunk, named above. Done when: each approved category's
lint rule reports zero on the tree; `pnpm test:changed`, `pnpm typecheck`, and
`pnpm lint:changed` pass; the header test passes; tours pass with axe
`target-size`; the knowledge audits are run and recorded. No data migration.
Each chunk is reversible on its own.
