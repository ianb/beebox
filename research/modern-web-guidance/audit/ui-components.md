# Audit: ui-components guides (22)

## Slice summary

- Guides with real findings: dialog (4 real), tabs (4), checkbox (2), breadcrumbs (1), menu (1 plus a role-fit issue shared with navbar), accordion (1 design choice), copy-button (1), progress (2), persistent-toast-notifications (1), navbar (1, same Dropdown), toolbar (0 real).
- No feature in our code: app-menus, carousel, dark-mode-toggle, hovercard, navigation-drawer, persistent-app-tours, scrollspy, stack-drill-down, card, toolbar (no `role="toolbar"` anywhere).
- Our app already uses native `<dialog>` + `showModal()` through `ModalCard` and `useModalDialog` (ImageLightbox, 5 `ModalCard` users, workstreams-app `DefaultExhibit`). Closed issue `issues/closed/bugs/2026-10-09-image-lightbox-has-no-dialog-role.md` records that migration. Three hand-rolled `role="dialog"` popovers remain, plus two in Chrome-only code.
- Most valuable fixes:
  1. `Dropdown.tsx` declares `role="menu"` / `aria-haspopup="menu"` and its own comment says "full arrow-key roving focus is out of scope". Add ArrowUp/Down/Home/End (ordinary keydown code), or drop `role="menu"`. Some panels hold navigation links (PlacePill) or free-form content.
  2. Add `dialog:modal { overscroll-behavior: contain }` and `dialog::backdrop` equivalents: one CSS rule, no scroll containment exists today.
  3. `TabBar` marks up a tablist in 4 places that have no tab panels (filters and a group-by switch). Use a pressed-button group or radio group there.
- Native `focusgroup`, `interestfor`, `popover="hint"`, Invoker Commands, anchor positioning and `ariaNotify()` are not usable at the Safari 17.0 floor. No guide pattern that depends on them is recommended.
- Browser-data caveat: the guides list Popover as "Safari 17 (Sep 2023), and Safari iOS 18.3 (Jan 2025)". The iOS entry is later than the iOS 17.0 WKWebView floor. Do not move `Dropdown` onto `popover` without testing in the iOS app first.

---

### accordion
- Asks: Build accordions from adjacent `<details>`/`<summary>`; no roving arrow keys; avoid exclusive (`name`) groups; no `region` wrapper on small accordions.
- Applies here: yes — `components/ui/Accordion.tsx` is a button + `aria-expanded` + `aria-controls` re-implementation, and 14 raw `<details>` elements already exist beside it.
- Findings: 10 `<Accordion>` call sites + the primitive; 1 real (the primitive).
  - `beebox/src/frontend/src/components/ui/Accordion.tsx:93` `<div id={bodyId} role="region" hidden={!open}>` — real (unlabeled `region` on every body, which the guide says adds landmark noise; browsers do not expose a region without a name, so effect is small)
  - `Accordion.tsx:78-85` `<button id={id} type="button" onClick={toggle} disabled={disabled} aria-expanded={open} aria-controls={bodyId}` — real as a design question. A `<details>` build drops `useId`, `aria-controls`, the manual chevron state and the `hidden` toggle. It must keep: controlled `open` + `onOpenChange` (via the `toggle` event), `disabled`, `keepMounted` (details keeps children mounted by default, so this becomes free), and `id` on `<summary>` for the `bbx-` control address.
  - `components/chat/ChatMessages/activity-rendering.tsx:104` `<details className="group/tool">` — not real (already the recommended pattern; 14 such sites in `chat/`, `dashboard/ScheduleOverview/`, `themes/`)
  - `components/admin/CloudflarePublishConnectionsSection/view.tsx:120-124` `<Accordion id="bbx-admin-cf-publish-add" keepMounted open={editorOpen || rotateTarget !== null || ...}` — not real (controlled open driven by other state; the strongest reason to keep the custom component)
  - `Accordion.tsx` has no arrow-key handling — not real (agrees with the guide)
- Our guidance: silent on `<details>` vs `Accordion`. `beebox/frontend.md:201` "`<Accordion>` — collapsible disclosure." and `frontend.md:158` "`aria-expanded` on a disclosure" (needs one name in both states; `<summary>` has that). No comment explains why `<details>` was not used.
- Fix size: 1 file (`Accordion.tsx`) plus its DOM tests; medium risk because controlled mode through `toggle` events can loop and `ui-scan` addresses the toggle by `id`. Verify with the Accordion tests, `bin/tour` on admin Secrets, and `bin/browse` at phone width.
- Lint-able: baselined scan (a `<button aria-expanded aria-controls>` followed by a conditional body needs judgment).
- Browser: `<details>`/`<summary>` Baseline widely available. `name` exclusive groups: Safari 17.2, fine but the guide advises against them. `::details-content` (Safari 18.4) and `interpolate-size` (Chrome only) are optional; skip.
- Lean: adopt with changes — make the 10 `Accordion` sites render `<details>` only if the controlled-open case can stay simple; otherwise keep `Accordion` and drop the unlabeled `role="region"`.

### app-menus
- Asks: Build File/Edit/View command bars as one `role="menubar"` widget with one tab stop.
- Applies here: no — no application menu bar exists in the main app, workstreams-app or beebox-clerk (`git grep menubar` finds nothing).
- Lean: n/a

### breadcrumbs
- Asks: `<nav aria-label>` + `<ol>` of links, `aria-current="page"` on the last item, CSS-generated separators hidden from screen readers.
- Applies here: yes — one breadcrumb strip in the browse sidebar.
- Findings: 1 candidate; 1 real.
  - `pages/browse/components/BrowseBreadcrumbs.tsx:51` `<div className="px-3 py-2 border-b text-sm break-words">` with `<button ... onClick={() => onNavigate(segPath)}>` and `<span className="text-warm-700 px-0.5">/</span>` — real. No `nav` landmark, items are buttons (no link semantics, cannot open in a new tab), the `/` is real text read by screen readers, the last crumb is a `<span>` with no `aria-current`. File header comment says the `/` and no-whitespace layout exist so "the rendered path copies cleanly"; that is a deliberate choice about copying that conflicts with the separator rule, but `nav`, `ol`, `aria-current` do not conflict with it.
- Our guidance: silent.
- Fix size: 1 file. Wrap in `<nav aria-label="Breadcrumbs"><ol>`, give the last item `aria-current="page"` (as `<span>` is allowed only if still a link per guide; here a current-page `<span>` is acceptable since it is the directory being viewed), mark separators `aria-hidden`. Low risk. Verify with a DOM test and `bin/browse` on `/browse`. Switching to `<a href>` needs a browse URL helper; skip unless wanted.
- Lint-able: no (one site).
- Browser: plain HTML/CSS, fine everywhere.
- Lean: adopt with changes — landmark, list and `aria-current` only.

### card
- Asks: Use `<article>` as the card root, native links/buttons for actions, container queries for adaptive layout.
- Applies here: no — our `Card` primitive (`components/ui/Card.tsx`) is a styled material container; I did not find a stretched-link card pattern or card grid to compare. Cards in beebox are user content (`.card` files), not marketing tiles.
- Lean: n/a

### carousel
- Asks: Scroll-snap track with Previous/Next and marker buttons, `aria-roledescription="carousel"`.
- Applies here: no — no carousel. `ImageLightbox.tsx` (333 lines) plus `hooks/use-lightbox-gestures.ts` is a modal image viewer with pointer-drag swipe and arrow keys, not a page carousel. Rewriting its drag layer on scroll-snap is possible but it is a gesture rewrite with peer images and swipe-to-dismiss; not proposed here.
- Lean: n/a

### checkbox
- Asks: Label every checkbox (nest or `for`/`id`); style with `accent-color` or `appearance: none`; set `indeterminate` via JS.
- Applies here: yes — 9 `type="checkbox"` inputs.
- Findings: 9 candidates; 2 real.
  - `components/admin/CloudflarePublishConnectionsSection/view.tsx:269` `<input id={`bbx-admin-cf-publish-revoke-ack-${connection.name}`} type="checkbox" checked={revokeAcknowledged} ...` — real. The sentence "Revoking removes this host's token ..." sits in a sibling `<Text size="sm">`, not a `<label>`. The control has no accessible name and its click target is the 13px box only. This violates `frontend.md:154` ("Every control also has an accessible name"). jsx-a11y `label-has-associated-control` does not fire because there is no label element.
  - `components/Markdown/body.tsx:266` `<input type="checkbox" checked={done === true} disabled readOnly className="mr-2 align-middle accent-warm-500" />` — real but minor: rendered task-list checkbox is unnamed. The item text follows in the same `<li>`; naming needs `aria-labelledby` from the list item.
  - `components/ui/fields/field.tsx:220` (`CheckboxField`) — not real (wraps input in `<label htmlFor>`, `accent`-style classes from the forms plugin)
  - `components/todo/TodoItem.tsx:98` — not real (`aria-label={checkboxName(status, text)}`)
  - `components/history/HistoryFilterBar.tsx:221` — not real (nested in `<label>`, `accent-primary`)
  - `themes/card-themes.css:273` `.bbx-card-theme input[type="checkbox"] { accent-color: var(--bbx-pen); }` — not real (the guide's recommended `accent-color`)
  - 3 dev-harness pages (`pages/dev/components/...`) — not real (internal harnesses)
  - No `indeterminate` use exists — not real.
- Our guidance: agrees (`frontend.md:168` `<CheckboxField>`; `frontend.md:154` accessible-name rule). The Cloudflare site breaks it.
- Fix size: 2 files, one-line edits (wrap in `<label>` or use `CheckboxField`). Verify with the admin DOM test and `bin/tour` admin.
- Lint-able: baselined scan. An ESLint rule "`<input type=checkbox>` must be inside `<label>` or have `id` matched by a `htmlFor` or `aria-label`" is deterministic only inside one file; the existing `control-has-associated-label` ignores `input` (`react-rules.ts:22`). Adding `input` to that rule would be a lint-weakening-direction change in reverse (stricter); it would need a person's decision.
- Browser: `accent-color` Safari 15.4+ on checkboxes (guide lists 26.2 for `<progress>` only); fine at 17.0.
- Lean: adopt — fix the two sites.

### copy-button
- Asks: Copy buttons use Invoker Commands (`command="--copy"`) and a `role="status"` bubble outside the button; do not disable the button during feedback; name icon-only buttons.
- Applies here: partly — 9 copy sites; all already go through `Button flash={{ label: "Copied" }}`.
- Findings: 9 candidates (`navigator.clipboard.writeText`); 2 real.
  - `components/ui/Button.tsx:308` `aria-live={rest["aria-live"] ?? (flash !== undefined ? "polite" : undefined)}` — real. The live region is the button itself; the guide says a button's children are presentational and a live region inside one is not reliably announced. Also the accessible name changes to "Copied" during the flash, and the button is `isDisabled` while an async onClick runs (`Button.tsx:~243`), which drops focus for a slow handler.
  - `components/admin/InviteSection.tsx:57` `if (inviteUrl) await navigator.clipboard.writeText(inviteUrl);` — real. Failures go to the generic `console.error` (no `failLabel`, so the user sees no "Copy failed"). `AllowedEmailsSection.tsx:112` and `SourceViewOverlay.tsx:170` have the same shape.
  - `components/admin/EncryptedBackupsSection.tsx:61` — not real (own try/catch plus `copyFailed` state)
  - `components/Markdown/body.tsx:189` `aria-live="polite" onClick={copy}` on the Button — same live-region issue as above, counted once
  - `lib/copy-file-to-clipboard.ts` — not real (richer clipboard types)
  - Invoker Commands (`command`/`commandfor`) — not applicable: we use React handlers and have a single `Button`; the declarative form would add nothing.
- Our guidance: agrees with `flash` (`frontend.md:164` "Has `flash` for clipboard copies").
- Fix size: `Button.tsx` (move the live message to a sibling `role="status"` span) plus adding `failLabel` at 3 call sites. Medium-low risk; Button has many DOM tests. Verify with Button tests and a manual screen reader pass.
- Lint-able: baselined scan (`writeText` in a `Button` with no `failLabel`).
- Browser: Async Clipboard `writeText` Baseline widely available (Safari 13.1). Invoker Commands: Safari 26.2, **not** at 17.0, and not wanted.
- Lean: adopt with changes — fix feedback announcement and failure labels only; reject Invoker Commands.

### dark-mode-toggle
- Asks: Offer a system/light/dark override via `<meta name="color-scheme">`, persist in localStorage, avoid FOUC.
- Applies here: no — beebox themes are per-box presentation themes (`themes/*.css`, `data-chrome-theme`), chosen in `SystemThemePicker`; the app does not follow `prefers-color-scheme` apart from the boot splash (`index.html:90`). Themes set `color-scheme: dark|light` per theme for native controls, which matches the guide's intent.
- Lean: n/a

### dialog
- Asks: Use native `<dialog>` with `showModal()`; no `role="dialog"`/`aria-modal`, focus trap or Escape handler on a native modal; contain overscroll; use `closedby` as enhancement; non-modal panels use `<dialog popover>`.
- Applies here: yes — mostly already adopted.
- Findings: 8 candidate sites; 4 real.
  - `components/AppNav/PlacePill-landmarks.tsx:225` `<section ref={overlayRef} role="dialog" aria-label="Search landmarks" aria-modal="true" ...>` plus a manual Tab trap (`:150-160`) and a manual Escape handler — real. This is the hand-rolled modal the guide says to replace. Cost: it sits inside a portaled `Dropdown` and sizes itself to `visualViewport` for the iOS keyboard (`useSearchViewport`); a `<dialog>` would also make the parent `Dropdown` inert, so the Dropdown's `useDismiss` interplay needs a test on iOS.
  - `components/chat/ack-badge.tsx:76` `<div role="dialog" className="absolute left-0 top-full mt-1 z-50 ...">` — real. Unnamed dialog (no `aria-label`/`aria-labelledby`), no focus handling, trigger has `aria-haspopup="dialog"`. It is a small non-modal info popover: Rule 3 says use a `popover` element, not a dialog.
  - `components/chat/user-message/audio-overlay-badge.tsx:165` `<div role="dialog" className="absolute left-0 top-full mt-1 z-50 ...">` — real, same shape as ack-badge (it copies it per its header comment).
  - No `dialog:modal { overscroll-behavior: contain }` rule exists (`git grep` of CSS/tailwind finds no `::backdrop` or dialog `overscroll`) — real. `ModalCard.tsx:60` classes `... overflow-y-auto rounded-lg p-0 shadow-xl backdrop:bg-black/60` do not contain scroll chaining to the page.
  - `components/ui/ModalCard.tsx:58` and `hooks/useModalDialog.ts:19` `dialog.showModal();` — not real (adopted). Its `onClose` handler re-opens the dialog after Chrome's repeated-Escape close, deliberate and commented.
  - `components/ImageLightbox.tsx:130` `return createPortal(<dialog ...` — not real as a dialog; the `createPortal` is redundant since a modal dialog is in the top layer (removable, small).
  - `workstreams-app/src/frontend/components/QuickOpen.tsx:72` `<div className="quick-open" role="dialog" aria-label="Open a file">` — real (Chrome-only; fixed overlay with a scrim `<button>`, `autoFocus`, Escape on `window`; no inert page, Tab escapes to the page behind).
  - `beebox-clerk/src/entrypoints/box-relay.content.ts:96` `<div class="backdrop" role="dialog" aria-modal="true" aria-labelledby="clerk-confirm-title">` — real (Chrome-only content script in a closed shadow root: no focus move, no Escape, no trap; `<dialog>` + `showModal()` works inside a shadow root).
  - `workstreams-app/.../exhibits/boot/DefaultExhibit.tsx:27` `<dialog ... ref={dialogRef}` with `showModal()` — not real (adopted).
  - `closedby="any"` — not applicable: `ModalCard` implements backdrop click with a `mousedown` listener and per-caller choice (`onBackdropClick`); `closedby` is Chrome/Firefox only and ModalCard blocks default close on purpose (callers confirm).
- Our guidance: agrees. `frontend.md:113` "Source editing, image lightboxes, capture, and other task-specific dialogs remain appropriate overlays". `issues/code-quality/2026-10-13-component-reuse-review.md:31` says "There is no Dialog or Modal primitive. Eight components set `role="dialog"`" (now partly done: `ModalCard`). Lint: `react-rules.ts:23` includes `dialog` in `control-has-associated-label` `includeRoles`, but does not catch an unnamed div dialog with children.
- Fix size: (a) overscroll CSS: 1 line in a global CSS file, trivial, verify by scrolling a long page behind `ModalCard` at phone width with `bin/browse`. (b) ack-badge and audio-overlay-badge: 2 files, convert to a `popover="auto"` element with `popovertarget`, or at minimum add `aria-label`; medium (anchoring currently relies on `absolute top-full`). (c) PlacePill landmark search: 1 file, high risk (iOS keyboard). (d) QuickOpen and Clerk confirm: 1 file each, low risk, Chrome only.
- Lint-able: eslint (`no-restricted-syntax` on JSX `role="dialog"`/`role="alertdialog"` attribute outside `ModalCard`; deterministic; 3 beebox sites would need fixing first). The existing exception route is one `eslint-disable-next-line` per narrow case.
- Browser: `<dialog>`/`showModal()` Baseline widely available (Safari 15.4). `closedby` Limited (no Safari). `overscroll-behavior` guide lists Safari as unsupported; harmless enhancement. Popover: Safari 17 desktop; iOS listed as 18.3 by the guide — test before relying on it at iOS 17 floor.
- Lean: adopt with changes — add the overscroll rule, name or convert the 2 badge popups, migrate the PlacePill overlay and the 2 Chrome-only sites; skip `closedby`.

### hovercard
- Asks: Link previews via Interest Invokers (`interestfor` + `popover="hint"`) with anchor positioning.
- Applies here: no — no hovercards in any of the four code areas (search for `onMouseEnter`/`role="tooltip"`/`group-hover` popups finds only hover-revealed icon buttons). The needed APIs are Chrome 149+ only (not Safari or Firefox).
- Lean: n/a

### menu
- Asks: Popup menus use `popover` + Invoker Commands + `focusgroup="menu"` for arrow keys, anchor positioning, native roles inferred; ArrowDown/Home/End/Escape behave per APG.
- Applies here: yes — `components/ui/Dropdown.tsx` plus `MenuItem` (18 `<Dropdown` sites, 8 production files).
- Findings: 3 candidates; 2 real.
  - `Dropdown.tsx:312` `role="menu"` with `Dropdown.tsx:302` `ariaProps: { "aria-haspopup": "menu", "aria-expanded": open }` — real. The component's own comment (`:70`) says "full arrow-key roving focus is out of scope". An ARIA `menu` promises ArrowUp/Down, Home/End; only Escape and Tab work (`useDismiss`). Several panels hold free content (inputs, expanders), not items: `Dropdown.tsx:11` "several existing menus nest plain focusable controls".
  - `Dropdown.tsx:223-262` JS positioning (`getBoundingClientRect`, `visualViewport` listeners, `ResizeObserver`) and `createPortal(..., document.body)` with `z-[100]` — not real as a change item. The guide's CSS anchor positioning is listed "Safari 27 only" in its data and the Dropdown also clamps to the iOS keyboard viewport; native replacement cannot do that at the 17.0 floor. A top-layer `popover` would also fix the stacking case where a `Dropdown` opened from inside a `showModal()` dialog renders behind it (no such nesting found in the 6 dialog users, so no live bug).
  - `hooks/useDismiss.ts` `document.addEventListener("mousedown", ...)` — not real (needed for the portal-aware click-outside; `popover="auto"` would remove it only if Dropdown moved to popover).
- Our guidance: conflicts in effect — `frontend.md:205` "menu with click-outside, escape-to-close, auto-close on select" describes no arrow keys, and `Dropdown.tsx:70` defers them.
- Fix size: arrow-key roving in `Dropdown.tsx`: 1 file (`keydown` on the menu, move focus among `[role=menuitem]`, Home/End), medium-low risk, plus a DOM test; verify with a keyboard pass through `PlacePill`, `CardActions`. A full `popover` migration: large, not proposed.
- Lint-able: no (behaviour, not syntax).
- Browser: `focusgroup` Chrome/Edge 150 only; Invoker Commands Safari 26.2; anchor positioning per guide data Safari 27 only; Popover Baseline (iOS 18.3 per guide). None usable at Safari 17.0 as the guide writes them.
- Lean: adopt with changes — take only the keyboard model (script roving, Home/End), reject focusgroup, invoker commands and anchor positioning.

### navbar
- Asks: One `<nav>`; narrow layout uses a `popover` disclosure; nested site navigation is `button[aria-expanded][aria-controls]` + list; no `role="menu"`/`menuitem`/`aria-haspopup="menu"` for navigation links.
- Applies here: partly — `components/AppNav/AppNavFace.tsx:12` has `<nav aria-label="Primary">`, but the navigation targets live in `PlacePill`'s `Dropdown` menus.
- Findings: 1 candidate; 1 real.
  - `components/ui/dropdown-menu-item.tsx:80` `<Link id={id} role="menuitem" to={props.to} onClick={close} ...>` and `:91` `<a id={id} role="menuitem" href={props.href} ...>` inside a `role="menu"` — real for the PlacePill landmark/folder menus (`AppNav/PlacePill.tsx:153`): destinations are announced as menu commands, and the arrow-key behavior that role implies is absent. Same root cause as the menu finding; counted once there for the fix.
  - There is no responsive link row or hamburger (`AppNav/nav.tsx:7` "There is no link row, box `<select>`, or hamburger any more") — not real; the width-measurement and `popover` navbar pattern has no counterpart.
- Our guidance: silent on nav-vs-menu roles.
- Fix size: `Dropdown` could take a `kind="navigation"` prop that omits `role="menu"`, `aria-haspopup`, and `role="menuitem"`; 2 files, medium risk because `ui-scan` and tests query `[role=menuitem]`. Verify with `bin/tour` and ui-scan tests.
- Lint-able: no.
- Browser: plain ARIA; fine.
- Lean: adopt with changes — fold into the Dropdown decision: either arrow keys for true menus, or no menu role for link lists.

### navigation-drawer
- Asks: Slide-in nav panel as a top-layer `<dialog>` with scroll-snap swipe-to-dismiss.
- Applies here: no — no drawer, hamburger or off-canvas nav (`AppNav/nav.tsx:7`). Needs `scroll-initial-target` (Chrome only) and scroll-driven animations (Safari 26).
- Lean: n/a

### persistent-app-tours
- Asks: Onboarding tour steps as `popover="manual"` tethered by anchor positioning.
- Applies here: no — "tours" in this repo are test/verification runs (`bin/tour`, `docs/testing/tours.md`) and `components/ui/ControlRing.tsx` / `lib/ui-scan/ring.ts` is an agent-pointing ring with "no mask, no popover, no modal layer" by design. No user-facing onboarding tour exists.
- Lean: n/a

### persistent-toast-notifications
- Asks: Toasts as `popover="manual"` in a named `region`; announce with `ariaNotify()`; persistent by default; dismiss button; do not toast over modal dialogs.
- Applies here: partly — `components/ui/ToastViewport.tsx` + `toast-store.ts`, ~60 `toastError` call sites, errors only.
- Findings: 3 candidates; 1 real.
  - `ToastViewport.tsx:21` `<div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-[9999] flex flex-col gap-2">` — real. A `fixed` div with `z-[9999]` cannot paint above a `showModal()` dialog (top layer), and content outside a modal dialog is inert, so a toast raised while `ModalCard`/`ImageLightbox` is open is invisible and unannounced. The guide says suppress until the dialog closes. No dialog file calls `toastError` directly (checked the 6 dialog files), so this affects only errors from shared hooks (clipboard, uploads) while a dialog is open.
  - `ToastViewport.tsx:34-35` `role="alert"` + `aria-live="assertive"` per toast — not real (the store comment sets this on purpose for errors; `ariaNotify()` is Safari 27 only).
  - `toast-store.ts:20` `DEFAULT_TTL_MS = 10_000` auto-expiry — not real (guide prefers persistence; `persist` already exists for conditions that stay true, and the store carries a dismiss button).
  - Missing `role="region" aria-label="Notifications"` on the container — real but minor (the file header says components own their landmark; the container has none).
- Our guidance: agrees with errors only (`code-style.md:70` "User-initiated actions never silently no-op: a toast/inline error").
- Fix size: 1 file: label the container, and either hold toasts while a modal `<dialog>` is open or render the viewport in the top layer (`popover="manual"` + `showPopover()`). Low-medium risk. Verify with the toast-store tests and a manual run: open `ModalCard`, trigger `toastError`.
- Lint-able: no.
- Browser: Popover per guide Safari 17 desktop (iOS 18.3 in guide's data); `ariaNotify()` Safari 27, so keep `role="alert"`.
- Lean: adopt with changes — container label and modal-aware display only; keep `role="alert"`.

### progress
- Asks: Use native `<progress>` (indeterminate = no `value`); label it; style with `accent-color` or `appearance: none` pseudo-elements.
- Applies here: partly — one determinate bar in the main app, one `meter` in workstreams-app.
- Findings: 2 candidates; 2 real.
  - `components/chat/InteractiveChat-layout/view/ChatAttachments.tsx:208` `role="progressbar" aria-label={`Uploading ${attachment.originalName}`} aria-valuenow={Math.round(state.progress * 100)} aria-valuemin={0} aria-valuemax={100}` — real. A `<span>` with ARIA instead of `<progress>`. The comment above says "Indeterminate until the first progress event reports a total", yet `aria-valuenow` reports 0, so a screen reader announces 0% rather than indeterminate; native `<progress>` with no `value` fixes that. Styling the inner span with a 4% minimum fill needs `appearance: none` pseudo-element CSS.
  - `workstreams-app/src/frontend/components/QuotaPanel.tsx:8` `<div className={`race-lane ${tone}`} role="meter" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={...}>` — real but low value (Chrome-only dev dashboard; the lane is a custom "race" visual with a runner glyph, not a bar; `<meter>` could carry the semantics).
- Our guidance: silent.
- Fix size: ChatAttachments: 1 file, low risk; verify with the attachment DOM test and `bin/browse` at phone width during an upload. QuotaPanel: 1 file, skip unless convenient.
- Lint-able: eslint — jsx-a11y `prefer-tag-over-role` would flag `role="progressbar"`, but `react-rules.ts` keeps that rule off on purpose ("churn without a user-visible gain"). A scoped `no-restricted-syntax` for `role="progressbar"|"meter"` is deterministic (2 sites).
- Browser: `<progress>` Baseline widely available. `accent-color` on `<progress>`: guide lists Safari 26.2, so Safari 17.0 needs the `appearance: none` styling path.
- Lean: adopt with changes — ChatAttachments only.

### progress-ring
- Asks: Circular progress as `<progress>` styled with `conic-gradient` and `mask`.
- Applies here: no — no circular determinate progress. (The only ring-like UI is the agent-pointing `ControlRing`, not a progress display.)
- Lean: n/a

### scrollspy
- Asks: Highlight the in-view section's link with `scroll-target-group` + `:target-current`.
- Applies here: no — no table of contents or section-tracking nav. No `IntersectionObserver` or `aria-current` scrollspy exists (`CommitTimeline.tsx:148` `aria-current` marks the selected commit, not scroll position). Property is Chrome 140+ only.
- Lean: n/a

### spinner
- Asks: Indeterminate spinner as `<progress>` styled with `conic-gradient` and `background-clip: border-area`.
- Applies here: partly — 5 spinner sites; all are decorative `aria-hidden` shapes next to text.
- Findings: 5 candidates; 1 real.
  - `components/capture/CaptureOverlay/CapturePhotoStrip.tsx:81` `<span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />` — real but minor: unlike its two siblings in `CaptureControls.tsx:71,169` (which add `aria-hidden="true"`) it has no `aria-hidden` and no status text of its own; an empty span is still ignored by screen readers, so the effect is nil.
  - `components/ui/Button.tsx:140` `<svg className="animate-spin w-4 h-4" ... aria-hidden="true">` — not real as a semantics issue (decorative; loading text carries the state). Separate real point: Tailwind `animate-spin` has no reduced-motion guard and none of the 5 spinners adds `motion-reduce:animate-none`.
  - `ChatAttachments.tsx:77` `<svg className="w-5 h-5 animate-spin ... aria-hidden="true">` — not real (same as Button).
  - The native-`<progress>` spinner approach would replace small Tailwind spans with 150 lines of CSS and needs `border-area` (Safari 18.2): rejected for the floor.
- Our guidance: `frontend.md:59` mentions a frozen spinner reading as "stuck" — consistent with keeping motion.
- Fix size: add `motion-reduce:animate-none`/slower variant to 5 spinner class strings, low risk; verify with `bin/browse` emulated reduced motion.
- Lint-able: baselined scan (class-string match for `animate-spin` without `motion-reduce:`; deterministic enough for a grep rule in `personal-vibe-check` if wanted).
- Browser: `@property` Safari 16.4 fine; `background-clip: border-area` Safari 18.2, not 17.0.
- Lean: reject the guide's `<progress>` spinner; adopt the reduced-motion point only.

### stack-drill-down
- Asks: Mobile push-navigation stack on horizontal scroll-snap with `scrollsnapchange`, `inert` and `pushState`.
- Applies here: no — mobile two-pane views use a `MobileBackButton` (4 uses) and router state; no swipe-back stack. Needs scroll-snap events (Chrome 129 only) and scroll-driven animations.
- Lean: n/a

### tabs
- Asks: Tablist with `aria-selected`, panels with `role=tabpanel` and a label; no `aria-controls`; selected state not color alone and with no size change; keep tabs on one row (scroll or overflow menu); use `focusgroup` for keys.
- Applies here: yes — `components/ui/TabBar.tsx` (6 uses) and `chat/workspace/SidecarTabStrip/view.tsx`.
- Findings: 6 `TabBar` sites; 4 real plus 2 smaller points.
  - `pages/inventory/components/InventoryContent/view.tsx:156-159` three `<TabBar value={...} idPrefix="bbx-inventory-..." label="Incoming reference filter" ...>` — real. They filter or re-count one list; there are no panels. `todo-view/TodoViewControls.tsx:71` (`label="Group todos by"`) is the same. A tablist with no tabpanel announces "tab 1 of 3" for what are mode switches.
  - `components/ui/TabBar.tsx:95` `aria-controls={controlsPrefix !== undefined ? ...}` — real but trivial: only `AdminPage.tsx:64` passes it, and the guide says no screen reader uses it. Harmless.
  - `TabBar.tsx:82` `pills ? "flex flex-wrap gap-2"` — real for `AdminPage.tsx:60` (`variant="pills"`): tabs wrap onto several rows, which the guide says to avoid (scroll or overflow).
  - `TabBar.tsx:48` `active: "border-primary text-primary font-medium"` — real, small: `font-medium` on the active tab changes its width and shifts neighbors; the guide says styling must not change tab dimensions. The underline is a border (not color alone).
  - `pages/AdminPage.tsx:120` `<div role="tabpanel" id={`bbx-admin-panel-${tab}`} aria-labelledby={`bbx-admin-tab-${tab}`} hidden={tab !== open}>` — not real (the correct pattern)
  - `TabBar.tsx` keydown (roving tabindex, Arrow/Home/End, selection follows focus) — not real; matches the guide's script path. `focusgroup` is Chrome 150 only so script roving stays.
  - `SidecarTabStrip/view.tsx:220` `role="tab"` with `aria-controls` and `workspacePanelId` — not real (document-style tabs with panels).
- Our guidance: `frontend.md:206` "`<TabBar>` — generic tab group with active state." Silent on use for non-panel switches. `frontend.md:158` only covers state exposure.
- Fix size: add a `TabBar`-like segmented button group (`aria-pressed` per item, like `ThemeSwatchPicker.tsx:68` `role="group"` + `aria-pressed`) and switch the 4 filter/mode sites; 4 files plus a new small component or a `TabBar` `mode="buttons"` prop. Low-medium risk; the `bbx-` ids stay. Verify with the DOM tests that look up `[role=tab]` and `bin/tour` inventory/todo.
- Lint-able: no (judgment: is there a panel?).
- Browser: all plain ARIA. `hidden="until-found"` unsupported in Safari — not needed here.
- Lean: adopt with changes — re-role the 4 panel-less sites; leave `TabBar` keyboard code; drop `font-medium` shift if it is visible.

### toolbar
- Asks: `role="toolbar"` composites with one tab stop via `focusgroup`; `aria-pressed` toggles; tooltips via `title` or `interestfor` hints.
- Applies here: no — no toolbar composite exists (`git grep 'role="toolbar"'` finds none; the `aria-pressed` buttons are single toggles or groups: `ThemeSwatchPicker.tsx:68`, `SidecarTabStrip/view.tsx:263`). `aria-pressed` use already matches the guide and `frontend.md:158`. `focusgroup` and `interestfor` are Chrome-only, so a new toolbar would need script roving anyway.
- Lean: n/a
