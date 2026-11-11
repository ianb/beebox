# Audit: accessibility, html, user-experience guides

## Slice summary

- The app already follows most of this guidance. `jsx-a11y` recommended plus `control-has-associated-label`, `no-aria-hidden-on-focusable` and `anchor-ambiguous-text` cover most DON'Ts. Dialogs are native (`ModalCard`, `useModalDialog`, `ImageLightbox`). Headings, landmarks, `lang`, titles, `autocomplete`, image `alt` and live-region roles are in place.
- Real gaps, by value:
  1. Form errors and helper text are not linked to their inputs (`aria-describedby` missing in `ui/fields/*`). One primitive edit fixes every form. Lean: adopt.
  2. `aria-label` on a plain `div` (8 sites, names are ignored by assistive tech). Fix is mechanical and lint-able with a `no-restricted-syntax` selector. Lean: adopt.
  3. Targets under 24 px (Toggle h-5, `CloseButton` bubble 20 px, Sidecar tab close/pin about 16 px, ack-badge 14 px) and a hover-only pin button in `SidecarTabStrip` that is invisible on touch. Lean: adopt with changes.
- Smaller real items: the shutter button in `CameraViewport.tsx` has `focus:outline-none` and no replacement; the Clerk confirm dialog has no focus move or Escape; scrollable `<Pre>` and table wrappers are not keyboard-focusable in Safari; `StatusMessage` loading text conflicts with the guide's "no live region for Loading".
- No applicable code: all custom-element guides (no custom elements authored), `respect-os-text-scale` (Chrome 146 only; iOS WKWebView ignores the meta), scroll-hiding bars, audio/video captions, CSS generated content (only `phosphor.css`, decorative theme).
- Browser floor: everything recommended below works on Safari 17.0 except CSS alt text (`content: x / ""`, Safari 17.4, needs a one-value fallback line), `<details name>` (17.2), `dialog closedby` (Safari no), scroll-state queries (Chrome 144), `<meta name=text-scale>` (Chrome 146).

Counts below come from grep over `beebox/src/frontend/src`, `beebox/src/schemas`, `beebox/src/plugins`, `workstreams-app/src/frontend`, `beebox-clerk/src`, excluding tests.

---

# accessibility/accessibility.md, split by sub-section

### accessibility/landmarks
- Asks: Put page content in `header/nav/main/aside/footer`; one `main`; label multiple `nav`; do not label `<section>` (it becomes a `region` landmark).
- Applies here: yes.
- Findings: 29 candidates; 1 real class.
  - `beebox/src/frontend/src/main/app-shell.tsx:139` `<main className="flex-1 min-h-0">` — not real (one `main` per shell; login and setup pages own theirs).
  - `AppNavFace.tsx:12` `<nav aria-label="Primary"` and `OpsLinks.tsx:23` `<nav aria-label="Box tools"` — not real (labelled, distinct).
  - 25 `<section aria-label=...>` sites, e.g. `components/MarkdownCardView/Composition.tsx:106` `<section aria-label="Composition"`, `components/dashboard/SystemInfo.tsx:23` `<section aria-label="System info"` — real in the sense the guide names, though many groups are deliberate: `beebox/frontend.md:156` asks for `role="group"` + `aria-labelledby` on repeated controls. Each would be judged one by one.
  - `Sidebar.tsx:102` and `CommitDetail.tsx:98` `role="region" tabIndex={0} aria-label` — not real (APG scrollable region, justified in an eslint-disable comment).
- Our guidance: silent on landmarks. `frontend.md:156` prefers named groups for repeated controls.
- Fix size: for the 25 sections, change `section` to `div role="group"` where no landmark is wanted. Many files, low risk. Verify with `bin/browse` accessibility snapshot.
- Lint-able: baselined scan (judgment: is this section a landmark worth having). Not a clean AST rule.
- Browser: Baseline widely available; Safari 17.0 ok.
- Lean: reject as a sweep. Keep as a reviewer note for new code.

### accessibility/headings
- Asks: Real `h1`-`h6`, no fake headings, one `h1`, no skipped levels, no heading inside `<summary>`.
- Applies here: yes.
- Findings: 0 fake headings found; `h1` sites are one per view (`RouteError.tsx:49`, `CommentaryView.tsx:45`, `BoxScreenPage.tsx:139` `<VisuallyHidden as="h1">`); `h4` appears twice (`SystemThemePicker.tsx:170` `<h4>System theme</h4>`, `ThemeSwatchPicker.tsx:69` `<h4 className="bbx-theme-swatch-group">`) under unknown parents, not verified for a skip.
  - `ChatMessages/activity-rendering.tsx:105` `<summary className="cursor-pointer list-none ...">` — not real (text, no heading inside).
- Our guidance: agrees. `frontend.md:191` "`<Heading level={2|3}>` ... Pick the level from the page outline, never for size."
- Fix size: none.
- Lint-able: eslint partly. `jsx-a11y/heading-has-content` is already on. Skipped levels need runtime (axe `heading-order`, already in `test/tours/tour-lib/axe.ts`).
- Browser: n/a.
- Lean: n/a (already met).

### accessibility/lists
- Asks: Use `ul/ol` for lists; Safari drops list semantics when `list-style: none`, so add `role="list"`.
- Applies here: partly.
- Findings: Tailwind 3 preflight sets `list-style: none` on every `ul/ol`, so every list in the app loses list semantics in Safari/VoiceOver. 0 `role="list"` in code; 1 explicit `list-none`: `OpenRouterModelsSection/view.tsx:92` `<ul className="list-none p-0 m-0 ..." aria-label="Added OpenRouter models">`.
  - Real impact is small: VoiceOver loses "list, N items" announcements. This is the guide's own caveat.
- Our guidance: silent.
- Fix size: either a global approach is impossible in markup; add `role="list"` to labelled lists only (about 5 `ul aria-label` sites, e.g. `QuickChatList.tsx:140`). Low risk, but `jsx-a11y/no-redundant-roles` flags `ul role="list"`, which would force an eslint-disable with the Safari justification.
- Lint-able: no for a global rule; the lint rule conflicts with the fix.
- Browser: Safari behavior, not a feature gap.
- Lean: reject (churn for a narrow VoiceOver announcement; lint rule opposes it).

### accessibility/tables
- Asks: `table` + `caption`, `th scope`, no layout tables, avoid complex tables.
- Applies here: partly.
- Findings: 7 files with `<th>`; 6 tables lack `scope` and `caption`.
  - `ScheduleOverview/view.tsx:180` `<th className="pb-2 font-medium">Name</th>` — real but weak (simple header row in `thead`; AT infers column headers).
  - `InventoryTable.tsx:12` `<thead><tr ...><th className="py-2 pr-3 font-medium">Type</th>` — same.
  - `BatchList.tsx:120`, `RunsTable.tsx:60`, `SheetTable.tsx:50` — same.
  - `DoclingPageSection.tsx:35` `<th scope="col" ...>` and `:51` `<caption ...>` — not real (already done).
  - `ScheduleOverview/view.tsx:184` `<th ...><VisuallyHidden>Actions</VisuallyHidden></th>` — not real (named empty header).
- Our guidance: silent.
- Fix size: 5 files, add `scope="col"` and a `caption` (or `aria-label`). Low risk. Verify with axe tour.
- Lint-able: eslint possible but no recommended rule requires `scope`; a custom selector `th` without `scope` is deterministic.
- Browser: n/a.
- Lean: reject (no user-visible gain for simple tables). Revisit if a screen-reader user reports it.

### accessibility/skip-links
- Asks: Provide a skip link before repeated navigation.
- Applies here: partly. Dense app shell (app nav bar, then main), no skip link.
- Findings: 0 skip links (`grep "skip to"` only matches a speech-menu icon comment). 1 candidate: `main/app-shell.tsx:139` after `AppNavFace`. Real but small; the nav bar has a handful of controls.
- Our guidance: silent.
- Fix size: one component in the shell plus `sr-only focus:not-sr-only` classes; focus target needs `tabindex="-1"` on a heading, which the guide itself warns about for multi-pane layouts. Medium design cost.
- Lint-able: no.
- Browser: n/a.
- Lean: reject. Internal app, short nav bar; the multi-pane focus target makes it awkward.

### accessibility/prefer-native-html
- Asks: Native elements over `role=` on divs; no redundant roles; do not put interactive roles on `li`.
- Applies here: yes.
- Findings: 2 candidates for custom `role="button"`; 1 real.
  - `Markdown/Redacted.tsx:62` `role="button" tabIndex={0} aria-label="Redacted — tap to reveal"` on a `div`/`span` wrapper — real in part: the wrapper holds block children (`{children}`), so a native `<button>` fits only the inline variant.
  - `ui/dropdown-menu-item.tsx:77` `role="menuitem"` on `span`/`a`/`Link` — not real (menu pattern, roles needed).
  - `Toggle.tsx:39` `role="switch"` on a `button` — not real (no native switch).
- Our guidance: agrees. `jsx-a11y/prefer-tag-over-role` is deliberately off (`react-rules.ts:33`).
- Fix size: `Redacted.tsx` only; use `<button>` for the inline case. Low risk, DOM test.
- Lint-able: eslint, already: `jsx-a11y/no-static-element-interactions`, `no-redundant-roles`, `interactive-supports-focus`.
- Browser: n/a.
- Lean: n/a (already enforced), optional fix in `Redacted.tsx`.

### accessibility/aria-states
- Asks: `aria-expanded/pressed` on toggles; deliberate `disabled` vs `aria-disabled`; never `aria-hidden` or `role=presentation/none` on focusable elements.
- Applies here: yes.
- Findings: `aria-expanded`/`aria-pressed` present on `Accordion.tsx:94`, `Toggle.tsx`, `SidecarTabStrip/view.tsx:263`. 0 positive `tabindex`.
  - `WorkspaceCanvas/view.tsx:61` `tabIndex={0} aria-hidden={!visible}` on a `tabpanel` — not real (when `!visible` the whole pane has the `hidden` class/`inert`, line 52).
  - `SelectionCapture.tsx:275` `role="none"` on a wrapper `div` with capture handlers — not real (no widget role to strip; comment explains).
  - 15 `role="none"` in menus and tab strips (`SessionChip-model-panel.tsx:72`, `SidecarTabStrip/view.tsx:289`) — not real (layout wrappers inside `menu`/`tablist`).
- Our guidance: agrees. `frontend.md:158`: "`aria-checked` on a switch, `aria-pressed` on a toggle button, `aria-expanded` on a disclosure." Lint: `no-aria-hidden-on-focusable` is on.
- Fix size: none.
- Lint-able: eslint, already on.
- Browser: n/a.
- Lean: n/a (already met).

### accessibility/accessible-names
- Asks: Native naming; disambiguate repeated controls; no `aria-label` on elements with no role; no `title`/`placeholder` as the name.
- Applies here: yes.
- Findings: 12 candidates; 8 real.
  - `chat/everywhere/InteractiveChat/BackgroundTasks.tsx:70` `<div className="mx-3 sm:mx-6 mb-1 flex flex-col gap-1" aria-label="Background tasks">` — real (name on a generic `div` is dropped).
  - `ScreenshotIndicatorStrip.tsx:69` `<div ... aria-label="Shared screenshots">` — real.
  - `chat/workspace/PaneControls.tsx:17` `<div className="flex shrink-0 items-center gap-1 px-2" aria-label="Pane controls">` — real.
  - `PdfCardView/view.tsx:207` `<div ... aria-busy="true" aria-label="Loading page renders" />` — real.
  - `DoclingView/view.tsx:108` `<div className="p-4" aria-busy="true" aria-label="Loading extraction">` — real.
  - `browse/components/BrowseLoading.tsx:3` `<div aria-busy="true" aria-label="Loading Browse location" ...>` — real.
  - `workstreams-app/.../exhibits/CommentPanel.tsx:214` `<div className="flex flex-col gap-2" aria-label="Comments">` — real.
  - `title`-only controls: `jsx-a11y/control-has-associated-label` already errors — not real.
  - Per-row names such as `SidecarTabStrip/view.tsx:138` ``aria-label={`Close ${title}`}`` — not real (already the guide's pattern).
- Our guidance: agrees and goes further. `frontend.md:156-158` ("Delete Soup, not Delete"; `title` alone is not enough).
- Fix size: 8 files, add `role="group"` (or `role="status"` for the loading ones) or drop the label. Trivial. Verify with `bin/browse` accessibility snapshot; `bin/tour` axe.
- Lint-able: eslint. A `no-restricted-syntax` selector: `JSXOpeningElement[name.name=/^(div|span|p|section)$/]:has(JSXAttribute[name.name='aria-label']):not(:has(JSXAttribute[name.name='role']))`. `section` needs exclusion because it is a landmark when labelled. Needs a 5-minute check for false positives on spread props.
- Browser: n/a.
- Lean: adopt (fix 8 sites, add selector).

### accessibility/descriptions-and-hints
- Asks: Tie errors, hints and instructions to the control with `aria-describedby`; set `aria-invalid` only with an error message present.
- Applies here: yes.
- Findings: 6 control types set `aria-invalid` and none set `aria-describedby`.
  - `ui/fields/field.tsx:60` `aria-invalid={hasError ? true : undefined}` (TextField), `:116` (Textarea), `:169` (Number), `:225` (Checkbox), `:296` (Select); `ui/fields/radio.tsx:62` — real.
  - `ui/fields/shell.tsx:48` `<div className="text-danger-dark text-sm mt-1" role="alert">{error}</div>` and `:50` `<div className={`text-xs ${ink.helper} mt-1`}>{helper}</div>` — the message has no `id`. `role="alert"` announces the error when it appears, but a user who tabs back to the field hears only "invalid".
  - `Composition.tsx:156` `aria-describedby={hasNote ? noteId : undefined}` — not real (already linked).
- Our guidance: silent (`frontend.md:167` says fields have "label + input + error + helper" but not how they link).
- Fix size: `fields/shell.tsx` (give `error` and `helper` ids derived from `id`), `field.tsx`, `radio.tsx` (pass `aria-describedby`). 3 files, low risk. Verify with the DOM tests of fields plus an axe tour.
- Lint-able: no (runtime wiring in one primitive).
- Browser: n/a.
- Lean: adopt.

### accessibility/language-titles-iframes
- Asks: `lang` on `html`; unique page `<title>` updated on route change; `title` on every `<iframe>`; no `scrolling="no"`.
- Applies here: yes.
- Findings: all met.
  - `beebox/src/frontend/index.html:2` `<html lang="en">`, `:15` `<title>Bee Box</title>`; `usePageTitle` per route (`frontend.md:24-27`).
  - `ui/VideoEmbed.tsx:21` `<iframe src={embedUrl} title={title} ...>` — not real (titled).
  - `PdfFrame.tsx:5` uses `<object>` on purpose.
  - Content-language changes: not tracked; box content has no `lang` markers (`<span lang>`). Not verified as needed.
- Our guidance: agrees. `frontend.md:24` requires a route title.
- Fix size: none.
- Lint-able: eslint, already: `jsx-a11y/iframe-has-title`, `html-has-lang`.
- Browser: n/a.
- Lean: n/a.

### accessibility/tab-order-and-focus-management
- Asks: Logical order; `tabindex` only when needed; no positive `tabindex`; move and restore focus around updated content.
- Applies here: yes.
- Findings: 0 positive `tabindex`; 4 `tabIndex={0}` sites, all on role-bearing scroll regions or custom buttons (`Sidebar.tsx:102`, `CommitDetail.tsx:98`, `Redacted.tsx:63`, `WorkspaceCanvas/view.tsx:61`) — not real.
  - Scrollable non-region containers: 10 `<Pre scroll=...>` sites (`ui/Pre.tsx` has no `tabIndex`) and 7 `overflow-x-auto` wrappers around tables (`RunsTable.tsx:46`, `ScheduleOverview/view.tsx:192`, `InventoryTable.tsx:10`, `BatchList.tsx:108`, `DoclingPageSection.tsx:49`, `InventoryContent/view.tsx:86`, `PdfPageStrip.tsx:42`) — real for Safari only: Chrome 130+ makes scrollers keyboard-focusable by default, Safari does not.
  - `Stack` already has a `focusable` prop (`Stack.tsx:82`) — the house mechanism exists.
- Our guidance: agrees (`Stack focusable`, `frontend.md:198`).
- Fix size: `ui/Pre.tsx` (add `tabIndex={0}` and an accessible name when `scroll` is set) plus 7 wrappers. Low risk. Verify keyboard-scroll in Safari.
- Lint-able: partly. `jsx-a11y/no-noninteractive-tabindex` already complains when someone adds `tabIndex={0}` without a role; the existing code needs `role="region"`+label, as in the two eslint-disable comments.
- Browser: Safari 17.0 needs the `tabindex` (not a new feature).
- Lean: adopt with changes (only `Pre`; skip table wrappers).

### accessibility/keyboard-handlers
- Asks: Custom button-likes handle Enter on `keydown`, Space on `keyup`; no handlers on native buttons.
- Applies here: partly.
- Findings: 23 `onKeyDown/onKeyUp` sites; 1 matches the guide's pattern.
  - `Markdown/Redacted.tsx:66` `onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onReveal(); } }}` — real, minor: Space fires on keydown instead of keyup.
  - Other sites are list/tab/search navigation (`TabBar.tsx:67`, `SidecarTabStrip/view.tsx:224`, `PlacePill-landmarks.tsx:195`) — not real (arrow-key patterns).
- Our guidance: silent.
- Fix size: `Redacted.tsx` only; or replace with `<button>` for the inline case.
- Lint-able: no.
- Browser: n/a.
- Lean: reject (one site, one-keystroke difference).

### accessibility/focus-indicators
- Asks: Style `:focus-visible`, never drop the outline without a 3:1 replacement; use `outline` or provide a `forced-colors` fallback; pair with `outline-offset`.
- Applies here: yes.
- Findings: 35 `focus:outline-none` sites; 37 `focus:ring/border/shadow` sites; 67 `focus-visible` uses. 2 real.
  - Standard pattern `ui/Button.tsx:110` `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent` — not real. Tailwind 3 `outline-none` is `outline: 2px solid transparent`, which stays visible in forced-colors mode; the ring paints the visible indicator.
  - `capture/CaptureOverlay/CameraViewport.tsx:41` `className="absolute inset-0 flex items-center justify-center cursor-pointer focus:outline-none"` — real: full-area shutter button has no replacement indicator.
  - `capture/CaptureOverlay/CapturePhotoStrip.tsx:73` `focus:outline-none focus:ring-2 focus:ring-white` — real, minor: uses `:focus`, so a mouse click draws the ring (should be `focus-visible`).
  - `ui/fields/field.tsx:226` `focus:ring-accent` on checkbox, `radio.tsx:112` `focus:ring-accent` — not real (native form control, ring only where `ring-*` width is set).
  - `fields/shell.tsx:10` input uses `focus:` with a darker border; correct for text inputs, which match `:focus-visible` always.
- Our guidance: agrees. `frontend.md:81` lists `accent` for "focus rings".
- Fix size: 2 files, add `focus-visible:ring-2 focus-visible:ring-inset ...`. Verify via keyboard in `bin/browse`.
- Lint-able: baselined scan. A selector for `outline-none` without `focus-visible:` in the same class string is deterministic but string-based and not worth it for 1 miss.
- Browser: `:focus-visible` Safari 15.4; ok.
- Lean: adopt (2 fixes only).

### accessibility/target-sizes
- Asks: 24x24 CSS px minimum via `min-*` or padding; larger on `pointer: coarse`; scope `touch-action`.
- Applies here: yes (iPhone app uses the web UI).
- Findings: 6 sites under 24 px; no `pointer: coarse` media query anywhere.
  - `ui/Toggle.tsx:30` `"relative inline-flex h-5 w-9 shrink-0 items-center rounded-full ..."` — real (20 px high).
  - `ui/CloseButton.tsx:61` `"w-5 h-5 rounded-full bg-danger text-white ..."` (bubble variant, 3 uses in `ChatAttachments.tsx:112,221`, `ChatSelections.tsx:59`) — real (20 px).
  - `SidecarTabStrip/view.tsx:142` `"... flex-shrink-0 mr-1 p-0.5 rounded ..."` with a 12 px icon (about 16 px target) and the pin button at `:266` — real.
  - `chat/ack-badge.tsx:68-70` `inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-info` (14 px, popover trigger) — real.
  - `ui/Button.tsx:98` circle `sm` `w-8 h-8`, `:104` icon rect `sm` `w-7 h-7` — not real (28 px or more).
  - `ImageLightbox.tsx:139,192` `touch-none` — not real (full-screen pan/zoom surface, the guide's drawing-canvas exception).
  - Spacing exception (24 px circles do not overlap) not checked per site.
- Our guidance: silent. `frontend.md:150` asks for a phone-width check only for two-pane layout.
- Fix size: 4 components (`Toggle`, `CloseButton`, `SidecarTabStrip`, `ack-badge`); grow hit area with padding or an `after:absolute after:-inset-1` pseudo-element. Medium risk: themes style `.bbx-interface-tab-action` and the tab strip is dense. Verify with `bin/browse` at 375 wide and `bin/theme-check`.
- Lint-able: baselined scan (needs layout; axe `target-size` rule in the tour can report at runtime). The existing axe tour (`test/tours/tour-lib/axe.ts`) could enable `target-size`.
- Browser: Baseline; `pointer: coarse` Safari 9+.
- Lean: adopt with changes (fix the 4 components; add `target-size` to the axe tour; skip a global coarse-pointer sweep).

### accessibility/images-alt
- Asks: `alt` on every `img`; `alt=""` for decorative; no "Image of".
- Applies here: yes.
- Findings: 6 `<img>` JSX sites, all with `alt`.
  - `ui/CardMark.tsx:58` `alt="" aria-hidden` — not real (decorative).
  - `CapturePhotoStrip.tsx:78` `<img src={src} alt="" ...>` — not real (inside a labelled `li` list).
  - `ui/Image/view.tsx:157` `alt={alt}` — not real (caller supplies; type requires it).
  - `ui/Avatar.tsx:51` `alt={altText}` — not real.
- Our guidance: agrees via lint. `jsx-a11y/alt-text`, `img-redundant-alt` on.
- Fix size: none.
- Lint-able: eslint, already on.
- Browser: n/a.
- Lean: n/a.

### accessibility/inline-svg
- Asks: Meaningful SVGs get `role="img"` + name; decorative ones `aria-hidden="true"`.
- Applies here: yes.
- Findings: 87 `<svg>` in JSX; 50 carry `aria-hidden`/`role`; 37 do not.
  - Unhidden ones inside labelled buttons: `Sidebar.tsx:77` `<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">` inside `<button aria-label=...>`; `TargetStrip.tsx:52`, `InteractiveChat-mobile-row.tsx:85` — not real (name comes from the parent; an unnamed `svg` adds nothing).
  - Unhidden icons in text chips: `chat/user-message-text.tsx:130`, `InteractiveChat-controls.tsx:43` — not real (no title or role, so exposed as nothing meaningful).
  - Meaningful standalone SVG with a name: not found.
- Our guidance: silent for svg; `frontend.md:157` covers icon-only controls.
- Fix size: adding `aria-hidden="true"` to 37 icons is mechanical, no user-visible gain.
- Lint-able: no AST rule exists in `jsx-a11y`; a custom selector would flag decorative icons broadly.
- Browser: n/a.
- Lean: reject (no benefit shown).

### accessibility/complex-images-charts
- Asks: Long description or data-table alternative for charts.
- Applies here: partly. Charts and figures come from box views (agent-authored, `box-docs/views.md`) and `FigureView`; the shipped frontend has no chart code.
- Findings: 0 in shipped code. `components/FigureView/FigureMount.tsx` mounts agent figures; no check of alt text for them.
- Our guidance: silent. `box-docs/views.md` has no accessibility section (grep for "access|screen reader|sr-only" returns nothing).
- Fix size: guidance text in `box-docs/views.md` only (a few lines), no code.
- Lint-able: no.
- Browser: n/a.
- Lean: adopt with changes (one paragraph in `views.md` for box agents; judge value separately).

### accessibility/audio-video
- Asks: Captions, transcripts, audio descriptions for media.
- Applies here: no. `CommitDetail-tabs.tsx:46` plays user files in `<audio controls>` with an empty `<track kind="captions" />`; `CameraViewport.tsx:27` is a live camera preview. No authored media.
- Findings: n/a.
- Lean: n/a.

### accessibility/css-generated-content
- Asks: Alt-text form of `content` for generated content; keep meaning in DOM.
- Applies here: partly. Only `themes/phosphor.css` has text `content:` (26 declarations), e.g. `phosphor.css:25` `.bbx-app-nav button:not(#bbx-nav-errors)::before{content:"[ ";` and `:31` `::before{content:"┌─ INCOMING ────────`. Screen readers read the box-drawing text.
- Findings: 26 candidates in one theme file; real in the sense that decorative text is announced.
  - `phosphor.css:52` `#bbx-composer-mic[title="Voice input"]::after{content:"[REC]";` — also couples to `title` strings.
- Our guidance: silent.
- Fix size: one file; for each decorative string write `content: "[ "; content: "[ " / "";` (fallback line first). The `/ ""` form is ignored before Safari 17.4, which then keeps announcing the text (current behavior). Verify with `bin/theme-check`.
- Lint-able: baselined scan (stylelint could require `/` on text content; judgment about which strings are decorative).
- Browser: Baseline newly available (2024-07-09). Safari 17.4; at the 17.0 floor the declaration is dropped as invalid, hence the one-value fallback line.
- Lean: reject (one decorative theme, an opt-in look).

### accessibility/forms-labels-hints
- Asks: Label every control; `for`/`id`; placeholders as hints only; hint linked with `aria-describedby`; hint above the input.
- Applies here: yes.
- Findings: `ui/fields/shell.tsx:35` `<label htmlFor={id} className={labelClass}>` — not real (all `*Field` primitives label via `htmlFor`; `hideLabel` uses `sr-only`).
  - Raw inputs: 14 `<input>/<textarea>` sites outside `ui/fields`, e.g. `chat/InteractiveChat-composer/view.tsx:106` `<textarea`, `PendingSendStorageRecovery.tsx:17` `<textarea aria-label=...` — not real (named; `jsx-a11y/label-has-associated-control` is on).
  - Hint link missing: see `descriptions-and-hints`.
- Our guidance: agrees (`frontend.md:167`).
- Fix size: none beyond `descriptions-and-hints`.
- Lint-able: eslint, already on.
- Browser: n/a.
- Lean: n/a.

### accessibility/input-assistance-validation
- Asks: `autocomplete` on personal-data fields; `required`; no context shift on focus.
- Applies here: yes.
- Findings: met.
  - `pages/login/components/LoginFields.tsx:24` `<TextField id="bbx-login-email" label="Email" type="email" autoComplete="email" required` and `:29` `autoComplete="current-password"` — not real.
  - `PasswordSection.tsx:91` `autoComplete="new-password"` — not real.
  - `autoComplete="off"` on `SecretsSection/forms.tsx:138`, `ClaudeCodeSection.tsx:73`, `EncryptedBackupsSection.tsx:105` — not real (API tokens, not credentials a password manager should fill; `html/html` guide objects only for credential, address, payment, contact fields).
- Our guidance: silent. Lint `jsx-a11y/autocomplete-valid` is on.
- Fix size: none.
- Lint-able: eslint, already on.
- Browser: n/a.
- Lean: n/a.

### accessibility/live-regions
- Asks: `assertive` only for critical updates; no live region for "Loading…"; one polite and one assertive region per page; debounce.
- Applies here: yes.
- Findings: about 80 `role="alert"/"status"` sites (grep above); 2 classes of mismatch.
  - Loading and progress text as `role="status"`: `components/themes/ThemedFileCard/view/CardAttachments.tsx:38` `<p className="text-sm" role="status">Checking attachments…</p>`, `CardLastChange.tsx:27`, `CardProperties.tsx:90`, `SystemThemePicker.tsx:150` `Saving system theme…`, `ThemeSwatchPicker.tsx:55`, `AgentEngineSection/view.tsx:178` `Saving…`, `chat/TargetStrip.tsx:38` `Catching up…` — real by the guide, minor noise.
  - `ui/StatusMessage.tsx:33` `role="status" aria-busy=...` documented for loading in `frontend.md:139` — conflict with the guide.
  - `ui/ToastViewport.tsx:34` `role="alert" aria-live="assertive"` — not real: toasts are all error tone (`NOTICE_TONE_CLASSES.error`).
  - Many `role="alert"` wrappers for form and mutation errors (`admin/*`) — not real (error appearing after an action).
  - Per-component regions instead of one central region: guide's "centralize" advice; not adopted anywhere. Not real at this scale (the `role` is mounted with the message, which is reliable).
- Our guidance: `frontend.md:138-139` prescribes `<StatusMessage>`/`aria-busy` skeletons for loading. Conflicts with "no live region for loading".
- Fix size: 8 sites; replace `role="status"` with plain text for "Saving…/Checking…" and keep it for results. Low risk. Verify by reading the accessibility snapshot.
- Lint-able: baselined scan (cannot tell loading text from results).
- Browser: n/a.
- Lean: reject (benefit is less speech from short, rare messages; our own doc states the opposite).

### accessibility/color
- Asks: Pointer to `color` guide (contrast, schemes, forced colors).
- Applies here: pointer only; covered by the auditor of the `color` guide. Existing tooling: `test/tours/tour-lib/contrast.ts`.
- Lean: n/a.

### accessibility/typography
- Asks: Pointer to `typography` guide.
- Applies here: pointer only; covered by another slice.
- Lean: n/a.

### accessibility/motion
- Asks: Pointer to `motion` guide.
- Applies here: pointer only; covered by another slice. 12 files already reference `prefers-reduced-motion` (`lib/reduced-motion.ts`, theme CSS).
- Lean: n/a.

### accessibility/modals-native-dialogs
- Asks: Native `<dialog>` with `showModal()`; no focus trap; `inert` plus `role="dialog"` for custom overlays; move focus into the overlay.
- Applies here: yes.
- Findings: 3 native, 5 custom.
  - `ui/ModalCard.tsx:58` `<dialog ref={dialogRef} ...>` via `hooks/useModalDialog.ts:19` `dialog.showModal()`; `ImageLightbox.tsx:131` `<dialog` — not real (met).
  - `AppNav/PlacePill-landmarks.tsx:225` `<section ref={overlayRef} role="dialog" aria-label="Search landmarks" aria-modal="true" className="fixed z-[110] ...">` in a portal, with no `inert` on the page behind and no native `<dialog>` — real (declares modal, does not make the rest inert). The overlay tracks `visualViewport` for the iOS keyboard, which is probably why it is not a `<dialog>`.
  - `chat/ack-badge.tsx:76` `<div role="dialog" className="absolute left-0 top-full mt-1 ...">` and `chat/user-message/audio-overlay-badge.tsx:165` — popover-like, non-modal, no Escape or focus handling found (`grep "Escape|focus" ack-badge.tsx` empty) — real but is a popover question; see `html/html` section 4.
  - `beebox-clerk/src/entrypoints/box-relay.content.ts:96` `<div class="backdrop" role="dialog" aria-modal="true" aria-labelledby="clerk-confirm-title">` — real: no focus move into the dialog, no Escape, page behind not inert. Chrome-only, fix is `<dialog>` + `showModal()` inside the shadow root.
  - `workstreams-app/.../QuickOpen.tsx:72` `<div className="quick-open" role="dialog" aria-label="Open a file">` — real, not verified (focus/inert handling not read).
- Our guidance: agrees. `ModalCard` doc: "a native `<dialog>` opened with `showModal()`". `frontend.md` has no rule for custom overlays.
- Fix size: Clerk content script (1 file, medium: shadow-root `<dialog>`, test in `beebox-clerk/test`), PlacePill overlay (1 file, add `inert` on `#root` siblings or portal into a `<dialog>`; risk with the iOS keyboard viewport logic; verify at phone width), QuickOpen (1 file).
- Lint-able: eslint partly: `role="dialog"` on a non-`dialog` element via `no-restricted-syntax` selector, with an allow-list. Whether it also moves focus needs a test.
- Browser: `<dialog>` Baseline widely (Safari 15.4); `inert` Safari 15.5; ok at 17.0.
- Lean: adopt with changes (Clerk and PlacePill; leave QuickOpen unless it fails a keyboard check).

### accessibility/testing
- Asks: Run axe/Lighthouse; test with keyboard and screen readers.
- Applies here: yes, already: `beebox/test/tours/tour-lib/axe.ts` injects axe-core into tours.
- Findings: n/a. Axe tours exist; could add the `target-size` rule (see `target-sizes`).
- Our guidance: `frontend.md:150` "Check changed UI in a browser with the browse skill".
- Lean: n/a.

---

### accessibility/accessible-error-announcement
- Asks: Drive `aria-invalid` and `aria-describedby` from `:user-invalid` timing; announce through one polite region; move focus to the first invalid field or error summary on failed submit.
- Applies here: partly. Forms are React-controlled and validated on submit or by the server, not by native constraint validation after blur. The CSS `:user-invalid` bridge adds little here.
- Findings: 6 control types already set `aria-invalid` from state (`ui/fields/field.tsx:60`); errors render `role="alert"` (`shell.tsx:48`). Missing: `aria-describedby` (see `descriptions-and-hints`) and focus on failed submit.
  - `settings/PasswordSection.tsx:84` `<form onSubmit={(event) => void submit(event)}>` sets `errors.current/next/confirm` and does not focus the first invalid field — real, minor (3 fields).
  - 14 `<form>` sites in total; the focus-first-invalid check was not run on the other 13.
- Our guidance: silent.
- Fix size: error-linking is in `descriptions-and-hints`. Focus-first-invalid is a hook per form; skip.
- Lint-able: no.
- Browser: `:user-invalid` Baseline widely (Safari 16.5).
- Lean: reject the `:user-invalid` machinery (controlled React forms); take only the `aria-describedby` part via `descriptions-and-hints`.

### accessibility/accessible-generated-content
- Asks: Use `content: x / "alt"` for generated content; keep meaning in the DOM.
- Applies here: partly. See `accessibility/css-generated-content`: one theme file (`themes/phosphor.css`, 26 text declarations).
- Findings: 26 candidates, 1 file; decorative.
- Our guidance: silent.
- Fix size: one CSS file.
- Lint-able: baselined scan.
- Browser: Safari 17.4; fallback line needed for 17.0.
- Lean: reject.

### accessibility/respect-os-text-scale
- Asks: `<meta name="text-scale" content="scale">` to follow OS text size; rem-based sizes; no root `font-size`.
- Applies here: no for the shipped clients. Chrome 146 and Edge only; Safari and WKWebView ignore it, so the iOS app (the client where OS text size matters) gains nothing. workstreams-app and clerk are desktop Chrome.
- Findings: no root `font-size` override found (0 matches for `html|:root { font-size`); 40 `text-[Npx]` sizes in TSX (e.g. `ChatAttachments.tsx:196` `text-[10px]`) would not scale.
- Our guidance: silent.
- Fix size: n/a.
- Lint-able: eslint possible for `text-[Npx]` (Tailwind class string), not useful without the meta.
- Browser: Limited availability (Chrome 146); Safari not supported, no fallback exists.
- Lean: reject.

---

# html/*

### html/html
- Asks: Semantic HTML basics (doctype, `lang`, viewport, one `h1`, landmarks, `<search>`, buttons vs links, `type="button"`), figure/code, image loading hints, native dialog/popover/details, `inert`, forms and `autocomplete`, media, no inline handlers.
- Applies here: partly (React app, so inline-handler and doctype rules are met). Per-section verdicts:
  1. Semantics: met (`index.html` has doctype, `lang`, viewport without `user-scalable`). `<search>` unused: search inputs are `TextField type="search"` (`renderers/search.tsx:43`, `QuickSearchOverlay.tsx:55`, `LandmarksList.tsx:124`) — 3 forms wrapped in no `<search>`; real but only adds a landmark; low value. `<button>` without `type`: 69 raw `<button>` tags lack `type` (e.g. `DebugLog.tsx:238`, `Sidebar.tsx:70`); 0 of them sit inside a `<form>` (14 forms checked), so none is a live bug.
  2. Grouping: `Pre` is used for code; `figure` present in `PdfPageStrip.tsx:44`. Not audited deeper.
  3. Resource hints: `<img>` already takes `loading`, `srcSet`, `sizes` (`ui/Image/view.tsx:157`); `Image` does not set `width`/`height` — outside this slice (performance; `frontend.md` says not to optimize without measurement).
  4. Dialogs and popovers: dialogs native (met). Dropdown is a 372-line custom `createPortal` plus `position: fixed` menu (`ui/Dropdown.tsx:210-250`) that handles the iOS keyboard viewport; the popover API would drop the portal and z-index but anchor positioning is Safari 26, so the positioning JS would stay. Real in principle, large change. `dialog closedby` is not in Safari.
  5. Details: 10 native `<details>` sites in use. `Accordion.tsx:94` uses `button aria-expanded` + `role="region"` (heading-safe pattern the guide prefers when headings matter). `<details name>` exclusive groups: Safari 17.2; not used and not needed.
  6. `inert`: used (`WorkspaceCanvas/view.tsx:52`). Met.
  7. Forms: `autocomplete` correct; `inputMode` unused (0), `type="email"` already gives the keyboard — not real.
  8. Media: no authored media.
  9. Dynamic styles: React `style` objects are used for dynamic values; no inline handlers. Met.
- Our guidance: `beebox/code-style.md` and `frontend.md` do not cover these; jsx-a11y covers the a11y subset.
- Fix size: `react/button-has-type` (plugin already loaded in `personal-vibe-check/preset/base-config.ts:5`) would flag 69 sites to fix mechanically across about 25 files; low risk, no behavior change today.
- Lint-able: eslint for `button-has-type` (deterministic). Others: baselined scan.
- Browser: `<search>` Safari 17.0 ok; popover Safari 17.0 ok; `closedby`, `details name`, anchor positioning not at floor.
- Lean: adopt with changes (only `react/button-has-type` as a guard against a latent bug; leave `<search>` and popover migration to the dropdown/popover auditor).

### html/accessible-web-components
- Asks: How to expose semantics from custom elements (`ElementInternals`, ARIA).
- Applies here: no — the code defines no custom elements (`grep customElements|attachInternals` returns nothing).
- Lean: n/a.

### html/custom-elements
- Asks: Lifecycle and registration of custom elements.
- Applies here: no — no custom elements; UI is React.
- Lean: n/a.

### html/form-associated-custom-elements
- Asks: `ElementInternals` form participation.
- Applies here: no — no custom form controls.
- Lean: n/a.

### html/prerendering-custom-elements
- Asks: Custom elements and prerendering (speculation rules).
- Applies here: no — no custom elements; no prerender.
- Lean: n/a.

### html/shadow-dom
- Asks: Attach shadow roots with `delegatesFocus`, clone templates, share stylesheets.
- Applies here: partly. Two shadow roots exist, both attached to plain hosts by script, not by custom elements.
- Findings: 2 candidates; 0 real.
  - `workstreams-app/src/frontend/exhibits/controls/mount.tsx:34` `const shadow = host.attachShadow({ mode: "open" });` with a `<style>` per mount (one instance) — not real.
  - `beebox-clerk/src/entrypoints/box-relay.content.ts:84` `host.attachShadow({ mode: "closed" })` — not real (closed on purpose to isolate from page scripts; guide says `open` "in almost all cases" and this is a content script on foreign pages).
- Our guidance: silent.
- Fix size: none.
- Lint-able: no.
- Browser: Baseline widely.
- Lean: n/a.

### html/styling-web-components
- Asks: Style custom elements via `::part`, `:host`, custom properties.
- Applies here: no — no custom elements.
- Lean: n/a.

### html/web-components
- Asks: Overview of building web components.
- Applies here: no — React app. Box agents author views in React (`box-docs/views.md` has no custom-element guidance).
- Lean: n/a.

---

# user-experience/*

### user-experience/content-first-noise-reduction
- Asks: No interrupting modals on load; compact persistent bars; hide top/bottom bars while scrolling down; popovers for secondary UI; `details` for rare content.
- Applies here: partly. The app is an internal tool with no promos or banners at load; bars and popovers are the relevant parts.
- Findings: 3 candidates, 0 real.
  - Auto-hiding top bar: `AppNavFace.tsx:12` `<nav aria-label="Primary" className="bbx-app-nav ... flex-shrink-0 shadow-sm print:hidden">` is a static flex-shrink bar in an app-shell, not a sticky page header; the scroll container is the inner `Stack`, so a root `container-type: scroll-state` would not see its scrolls. Not real.
  - Popovers for menus: `ui/Dropdown.tsx` is custom (see `html/html` §4). Real in principle, large change, see there.
  - `details` for rare content: already used 10 times (`RunHistory.tsx:52`, `ChatMessages/view.tsx:254`).
  - Hide-on-scroll needs `scrolled: bottom` query: Chrome 144 only; the guide's JS fallback is needed for Safari.
- Our guidance: silent. `frontend.md` ("internal app... do not optimize before a measurement") discourages reading-focused polish.
- Fix size: n/a for hide-on-scroll (vertical space matters less in a desktop-first tool, and the iOS app owns the chrome).
- Lint-able: no.
- Browser: scroll-state Chrome 144 only; popover Safari 17.0.
- Lean: reject.

### user-experience/form-factor-adaptation
- Asks: 24 px and 44 px (coarse) touch targets; container queries over viewport media queries; safe-area insets; `text-wrap: balance/pretty`; names on icon-only buttons; no clipping down to 320 px.
- Applies here: partly.
- Findings: 5 areas.
  - Targets: see `accessibility/target-sizes` (4 real components; no `pointer: coarse` rule; the guide's 44 px level is not met by `Button sm` 28 px or `h-8` circles).
  - Container queries: 2 matches for `@container`/`container-type` in all frontend sources; layout uses Tailwind `sm:` breakpoints (`hideOnMobile`, `hidden sm:flex`). Panels (companion pane, sidecar) change width without the viewport changing, which is the case the guide describes; real but unmeasured, and Tailwind 3.4 needs `@tailwindcss/container-queries` (not checked as installed).
  - Safe-area: `viewport-fit=cover` absent from `index.html`; the one `env(safe-area-inset-bottom)` at `chat/everywhere/InteractiveChat/messages.tsx:115`. Not real: `beebox/docs/mobile-contract.md:251` says "Viewport/safe-area is owned by native".
  - `text-wrap`: 0 uses. `balance` on headings is cosmetic; Safari 17.5 (ignored at 17.0, harmless). Not real value.
  - Icon-only button names: enforced (`frontend.md:157`, lint). Met.
- Our guidance: `frontend.md:150` asks for a phone-width check only for the two-pane layout. Safe-area owned by native (`mobile-contract.md:251`).
- Fix size: container queries need a plugin and a per-component rewrite (unmeasured gain); targets are in `target-sizes`.
- Lint-able: no for layout; icon names already linted.
- Browser: container queries Safari 16; `pointer: coarse` ok; `text-wrap: balance` Safari 17.5, `pretty` Safari 26.
- Lean: adopt with changes (only the target-size part via `accessibility/target-sizes`; reject container-query and text-wrap sweeps).

### user-experience/natural-interactions
- Asks: Hover/press/focus feedback on every control; popovers open from the trigger; scroll-snap on horizontal scrollers; reveal-on-hover controls must also appear on focus and without hover.
- Applies here: partly.
- Findings: 6 candidates; 2 real.
  - `SidecarTabStrip/view.tsx:270` `tab.pinned ? "bbx-interface-tab-pin" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"` — real: on touch (iOS) there is no hover, so an unpinned tab's pin button is invisible but still tappable. Compare `todo/TodoItem.tsx:125` `[@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100`, the pattern the guide wants.
  - `SidecarTabStrip/view.tsx:145` `pinned ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : ""` on the close button of a pinned tab — real, same fix, but the code comment says it is deliberately quiet ("the thing you did not ask for").
  - Feedback states: `Button.tsx:80` has `hover:` on intents and a focus ring; `active:` appears once. Not real (visual polish, no accessibility need).
  - Horizontal scrollers: 0 `scroll-snap` uses; 7 `overflow-x-auto` (`CapturePhotoStrip.tsx:35`, `PdfPageStrip.tsx:42`, `SidecarTabStrip/view.tsx:289`) — not real: tab strip, photo strip and page strip hold focusable children (the guide says no `tabindex` needed) and snapping would fight the strip's own overflow controls.
  - Popover origin animation: n/a (custom `Dropdown`).
- Our guidance: `TodoItem.tsx` shows the pattern in code; `frontend.md` silent.
- Fix size: `SidecarTabStrip/view.tsx` (2 class strings): add `[@media(hover:none)]:opacity-100 group-focus-within:opacity-100`. Low risk; verify at phone width and with `bin/theme-check` because the strip is themed (`.bbx-interface-tab-action`).
- Lint-able: baselined scan (a selector for `opacity-0` with `group-hover:` but without `focus` is string-based; 3 hits total, no rule needed).
- Browser: `@media (hover: none)` Safari 9+; ok.
- Lean: adopt with changes (fix the pin button; leave the rest).
