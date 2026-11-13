# ui-behaviors audit

## Slice summary

- 40 guides in `ui-behaviors`. 29 do not apply (no such feature, or the guide needs a browser newer than Safari 17.0 with no fallback). 11 have at least one candidate.
- Real findings: `prevent-page-scroll-under-modal-dialog` (3 dialog sites, 0 CSS rules), `declarative-dialog-popover-control` / `light-dismiss-a-dialog` / `custom-button-actions` (workstreams-app only, Chrome-only), `search-hidden-content` (1 primitive, `Accordion`), `scroll-completion-effects` (0 real), `2d-panning` (1 site).
- Dialogs are already native `<dialog>` + `showModal()` in `ModalCard`, `ImageLightbox`, and `DefaultExhibit`. The app already uses the CSS Custom Highlight API (`lib/selection/quote-anchor.ts`) and `<details>`.
- Most valuable fixes:
  1. Add `dialog:modal { overscroll-behavior: contain }` and `dialog::backdrop { overflow: hidden; overscroll-behavior: contain }` once in `beebox/src/frontend/src/index.css`. Two CSS rules, covers all three native dialogs, progressive on Safari.
  2. workstreams-app `QuickOpen.tsx`: replace the `div role="dialog"` + scrim button with a native `<dialog closedby="any">` (Chrome-only app, no fallback needed). Same app: the Filter `<details>` + invisible backdrop button + Escape listener becomes a `popover`.
  3. Test `closedby="none"` on `CaptureResumeDialog` to remove the repeated-Escape workaround in `ModalCard.onClose` (untested; Chrome only).
- Rejected on browser floor: invoker commands (Safari 26.2), `closedby` as the sole mechanism (no Safari), `moveBefore` (no Safari), anchor positioning, `scroll-initial-target`, `scrollsnapchange`, element-scoped view transitions.
- No sortable tables, drag/reorder, swipe rows, carousels, parallax, scrollytelling, or view transitions exist in the code.

---

### 2d-panning
- Asks: set `scroll-axis-lock: none` on 2D scroll containers (maps, grids, canvases) so diagonal panning is not railed.
- Applies here: partly — one genuine 2D scroller.
- Findings: 33 `overflow-auto|overflow-x-auto` sites; 1 real
  - `beebox/src/frontend/src/components/SheetTable.tsx:46` `<div className="overflow-auto border border-warm-300 rounded">` around a spreadsheet grid with sticky row/column headers — real (scrolls both axes)
  - `ImageLightbox.tsx:139` `touch-none select-none` — not real (custom pointer-gesture pan, not a native scroller)
  - Other 31 are 1D lists, code blocks, tab strips — not real
- Our guidance: silent
- Fix size: one Tailwind arbitrary class or CSS rule on one div; no risk; browse a Google Sheet card in Chrome.
- Lint-able: no (judgment: which scrollers are 2D)
- Browser: Chrome 153 only; ignored elsewhere, harmless on Safari 17.0.
- Lean: adopt with changes — one-line, optional; low value (spreadsheet cards are rare).

### anchor-positioning-tab-underline
- Asks: animate a tab underline between tabs with CSS anchor positioning.
- Applies here: no — tabs (`ui/TabBar.tsx:103` `px-4 py-1.5 text-sm border-b-2`) draw a static per-tab border; no sliding indicator exists or is requested. Guide lists Safari 27 only.
- Lean: n/a

### animate-element-entry-exit
- Asks: use `@starting-style` and `transition-behavior: allow-discrete` for enter/exit animations of elements added or hidden.
- Applies here: no — the app has almost no enter/exit animations; the only keyframed ones are `themes/card-turn.css` (data-attribute driven, already complete) and decorative theme drift. Panels mount and unmount with no transition. Adding animation would be new design, not a fix.
- Lean: n/a

### animate-to-from-top-layer
- Asks: animate `<dialog>`/popover open and close with `@starting-style` + `overlay`.
- Applies here: partly — three native dialogs exist (`ModalCard`, `ImageLightbox`, `DefaultExhibit`) and none animates.
- Findings: 3 candidate sites; 0 real (no requested animation; `overlay` is Chrome-only, so exit needs the `data-closing` fallback the guide describes, which is more code than the effect is worth).
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: `@starting-style` Safari 17.5 (not 17.0); `overlay` Chrome only.
- Lean: reject — new polish, not a defect; floor lacks `@starting-style`.

### carousel-snap-highlights
- Asks: style the snapped/stuck item using scroll-state container queries.
- Applies here: no — no scroll-snap anywhere (`git grep scroll-snap|snap-x` in frontends returns nothing). Chrome 144 only.
- Lean: n/a

### consistent-cross-document-transitions
- Asks: keep cross-document view transitions consistent across MPA pages.
- Applies here: no — SPA (TanStack Router); no multi-page navigation inside the app.
- Lean: n/a

### cross-document-transitions
- Asks: `@view-transition { navigation: auto }` for MPA page navigations.
- Applies here: no — SPA. The only MPA-like surfaces are the public site (out of slice).
- Lean: n/a

### custom-button-actions
- Asks: use `command`/`commandfor` on buttons for custom actions, instead of JS listeners.
- Applies here: partly — only where a button opens a native dialog/popover with no React state coupling.
- Findings: ~10 buttons toggle React `open` state; 0 real in beebox (state is React-owned and `ModalCard` mounts conditionally; `commandfor` would fight the controlled state); 1 candidate in workstreams-app
  - `workstreams-app/src/frontend/components/QuickOpen.tsx:37` `window.addEventListener("keydown", onKey)` — not real (a keyboard shortcut, not a button)
  - `workstreams-app/src/frontend/components/IssuesPane/panel.tsx:108` `<summary id="bbx-issues-filter">Filter</summary>` — not real (already declarative via `<details>`)
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Safari 26.2; Chrome 135. Not on Safari 17.0 and no polyfill in the guide.
- Lean: reject for beebox (floor); workstreams-app could use it only after QuickOpen becomes a `<dialog>` (see `declarative-dialog-popover-control`).

### declarative-dialog-popover-control
- Asks: open/close `<dialog>` and `[popover]` from buttons with `commandfor`/`command`, and use `popover` for menus and light dismiss.
- Applies here: yes in workstreams-app (Chrome only); partly in beebox.
- Findings: 6 hand-rolled overlays; 3 real
  - `workstreams-app/src/frontend/components/QuickOpen.tsx:72` `<div className="quick-open" role="dialog" aria-label="Open a file">` plus `<button className="quick-open-scrim">` and a window Escape listener — real: no `aria-modal`, no focus trap, page behind stays interactive by Tab. A native `<dialog>` removes the scrim button and the Escape code.
  - `workstreams-app/src/frontend/components/IssuesPane/panel.tsx:108` `<details className="filter-menu" ...><button className="filter-backdrop" aria-hidden="true" tabIndex={-1} .../>` plus `window.addEventListener("keydown", closeOnEscape)` at `panel.tsx:95` — real: `popover` gives light dismiss and Escape with no backdrop button.
  - `beebox/src/frontend/src/components/AppNav/PlacePill-landmarks.tsx:225` `<section ... role="dialog" ... aria-modal="true" ...>` with a hand-written Tab trap (`trapTab`, lines ~150-160) — real as a pattern, risky to change: it is sized to the visual viewport for the iOS keyboard and portaled from inside a `Dropdown`.
  - `beebox/src/frontend/src/components/chat/ack-badge.tsx:76` and `chat/user-message/audio-overlay-badge.tsx:165` `role="dialog"` bubbles dismissed by `useDismiss` — not real (non-modal hover cards; `popover` would add no behavior we lack, and anchor positioning is unavailable)
  - `beebox/src/frontend/src/components/ui/Dropdown.tsx:281` `useDismiss({ root: rootRef, portal: menuRef, open, onDismiss: closeMenu })` — not real (needs the manual `getBoundingClientRect` placement because anchor positioning is not on Chrome/Safari 17; popover would only replace dismiss and z-index)
  - `beebox/src/frontend/src/pages/browse/BrowsePage.tsx:88` `window.addEventListener("click", closeMenu)` — not real (a context menu's dismiss listener). [Correction 2026-11-11: this report first called the menu dead code; it is live, `handleFileContextMenu` at `BrowsePage.tsx:121` is passed as `onFileContextMenu` at `:141`.]
- Our guidance: `beebox/frontend.md:113` says task-specific dialogs stay separate from the primitives; `useModalDialog.ts` header already documents the native-dialog choice. Agrees with native `<dialog>`.
- Fix size: workstreams-app: 2 files, tsx + css, low risk, verify by `bin/browse` on the dev dashboard (open palette with Ctrl+P, Tab, Escape; open Filter, click outside). beebox `PlacePill-landmarks`: 1 file, medium risk (iOS keyboard), verify at phone width.
- Lint-able: eslint — jsx-a11y `no-static-element-interactions` / `no-noninteractive-element-to-interactive-role` already flag some; a custom rule "`role=\"dialog\"` with `aria-modal` on a non-`<dialog>` element" is deterministic JSX.
- Browser: `popover` Baseline since 2025-01-27 (Safari 17.0 ok); invoker commands Safari 26.2 (not ok); native `<dialog>` ok.
- Lean: adopt with changes — workstreams-app now (Chrome only); beebox only the `popover`/`<dialog>` part, never `commandfor`.

### directional-navigation-transitions
- Asks: directional view transitions (slide left/right) between SPA views.
- Applies here: no — `createRouter` at `beebox/src/frontend/src/main/router.tsx:365` has no `defaultViewTransition`, and no ordered spatial navigation exists (chat, browse, settings are not a forward/back sequence). Safari 18 needed.
- Lean: n/a

### drag-and-drop
- Asks: reorder list items by drag with real DOM order, keyboard alternative, `moveBefore`.
- Applies here: no — no reorderable list. File drops into the composer (`InteractiveChat-composer/view.tsx:115` `onDrop={onDrop}`) are file ingestion, not reordering. `git grep -i reorder` finds only comments.
- Lean: n/a

### drag
- Asks: make floating panels/dialogs draggable with pointer events.
- Applies here: no — no draggable floating element (`draggable`, `setPointerCapture` appear only in the lightbox gesture controller, which is zoom/swipe).
- Lean: n/a

### dynamic-sibling-animations
- Asks: stagger animations across siblings with `sibling-index()`.
- Applies here: no — no staggered list animations.
- Lean: n/a

### dynamic-sort
- Asks: apply user-triggered sort order to the DOM with view transitions/`moveBefore`, with announcements.
- Applies here: no — no user-triggered sorting in beebox. workstreams-app has a sort `<select>` (`IssuesPane/panel.tsx` `setSort`) that re-renders React rows; animating that is new polish.
- Lean: n/a

### group-element-transitions
- Asks: use `view-transition-name`/`view-transition-class` to animate cards and lists on add/remove/reorder.
- Applies here: no — no animated list changes today. Safari 18.2 for `view-transition-class`; floor is 17.0.
- Lean: n/a

### highlight-text-ranges
- Asks: use the CSS Custom Highlight API instead of wrapping text in `<mark>`/spans.
- Applies here: yes — already adopted.
- Findings: 4 sites; 0 to change
  - `lib/selection/quote-anchor.ts:32` `CSS.highlights.set(QUOTE_HIGHLIGHT, new Highlight(range))` — already the guide pattern (feature-checked at line 31)
  - `workstreams-app/src/frontend/lib/selection-anchor.ts:170` `CSS.highlights.set(COMMENT_HIGHLIGHT, ...)` — already
  - `components/search/SearchResults.tsx:13` `<mark className="bg-accent-100">` — not real (wraps a short excerpt string we build ourselves, not live page text; the API needs a Range over existing DOM)
  - `chat/everywhere/InteractiveChat/session-search.tsx:159` `<Highlight text={hit.snippet} query={query} />` — not real (same)
- Our guidance: agrees (comment in `themes/chrome.css:9` keeps `::selection` as the fallback).
- Fix size: none.
- Lint-able: no
- Browser: Baseline 2026-03-24; Safari 17.2 (not 17.0, but both uses are feature-guarded).
- Lean: n/a — already adopted.

### interactive-content-reveal
- Asks: masked reveal that follows the pointer, with registered custom properties.
- Applies here: no — decorative effect; none present or planned.
- Lean: n/a

### interest-triggered-action-previews
- Asks: preview an action on hover/focus of its button with interest invokers (experimental).
- Applies here: no — experimental, Chrome 149 only; no preview-before-commit UI.
- Lean: n/a

### interest-triggered-tooltips
- Asks: tooltips via `interestfor` + `popover="hint"`, anchor positioning.
- Applies here: no — the app has no tooltip component; `git grep -E '\btitle=[{"]'` finds 2 hits, both `Sidebar` prop names. Icon buttons use `aria-label` (`ack-badge.tsx:68`). Support: Chrome 149 only; anchor positioning absent on Chrome.
- Lean: n/a

### light-dismiss-a-dialog
- Asks: add `closedby="any"` to modal dialogs; keep a click-on-backdrop fallback where unsupported.
- Applies here: yes — `ModalCard` already implements backdrop dismissal by hand.
- Findings: 3 native dialogs; 1 relevant
  - `beebox/src/frontend/src/components/ui/ModalCard.tsx:49-57` `dialog.addEventListener("mousedown", onPress)` with `if (event.target === dialog) onBackdropClick()` — real as a pattern, not worth changing: this is already the guide's fallback. Safari has no `closedby`, so the listener stays. Adding `closedby="any"` also makes Chrome call `onCancel` on a backdrop press; `QuickSearchOverlay.tsx:53` and `ScreenshotConsentPopup.tsx:90` pass the same function to both props, so it would run twice.
  - `ImageLightbox.tsx:131` `<dialog ... onCancel={(event) => event.preventDefault()}>` — not real (dismisses via its own full-screen button by design)
  - `workstreams-app/src/frontend/exhibits/boot/DefaultExhibit.tsx:27` `<dialog` — not real (exhibit host)
- Our guidance: agrees — `ModalCard.tsx` docblock says the backdrop press is "a pointer shortcut for Escape, so it is a listener rather than a control", with callers choosing it per dialog.
- Fix size: none recommended.
- Lint-able: no
- Browser: Chrome 134, Firefox 141, no Safari. Fallback required.
- Lean: reject — duplicate handler path and the fallback must remain.

### motion
- Asks: general motion rules (clip-path/mask for reveals, keep focus rings unclipped, respect reduced motion).
- Applies here: partly — only the reduced-motion and focus-ring rules.
- Findings: reduced motion is handled in every themed animation (`themes/card-turn.css:61`, `card-themes.css:167`, `goldfish.css:125`, `night-atlas-motion.css:16`; JS paths use `lib/reduced-motion.ts`). `components/app-bar-faces/AttentionBadgesFace.tsx:53` already comments that `overflow-hidden` clips an outside focus ring and uses `focus-visible:ring-inset`. 0 real.
  - Unchecked: `ui/Accordion.tsx:34` `transition-transform` has no `motion-reduce` (one 90-degree chevron rotate) — not real (tiny, not vestibular).
- Our guidance: agrees (`lib/reduced-motion.ts` exists as the shared helper).
- Fix size: none.
- Lint-able: baselined scan (`animation:`/`transition:` in CSS without a `prefers-reduced-motion` block in the same file).
- Browser: n/a
- Lean: n/a — already followed.

### move-dom-element-without-losing-state
- Asks: use `Node.moveBefore()` instead of `appendChild`/`insertBefore` to move iframes, animating or focused elements without reset.
- Applies here: partly — one DOM move.
- Findings: 6 DOM-mutation sites in app code; 1 candidate
  - `beebox/src/frontend/src/components/MarkdownCardView/compose/ComposeEditor.tsx:112` `slot.current?.append(view.dom);` with cleanup `return () => view.dom.remove();` and the comment "Moved to a remounted block: give back the focus the move took." — real in intent (a focus loss from the remove+append), but `moveBefore` cannot apply: the cleanup removes the node before the new slot's effect appends it. Using it would need a shared owner and a Safari fallback; the existing `view.focus()` repair must stay.
  - `FigureMount.tsx:134` `el.replaceChildren()` — not real (clears content)
  - `beebox-clerk/src/entrypoints/background.ts:263`, `box-relay.content.ts:111-112`, `workstreams-app/.../controls/mount.tsx:38-42` — not real (first insertion, not a move)
  - `<iframe>` only at `ui/VideoEmbed.tsx:21`, `ThemeStudioHarness/view.tsx:111` — not real (never reparented)
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Chrome 133, Firefox 144, no Safari; the repair code stays.
- Lean: reject — working focus repair exists and Safari lacks the API.

### parallax-scroll-effects
- Asks: scroll-driven parallax using `animation-timeline`.
- Applies here: no — internal app; no decorative scroll effects.
- Lean: n/a

### persistent-top-layer-ui
- Asks: use `moveBefore` so open dialogs/popovers survive reparenting.
- Applies here: no — no code moves an open `<dialog>` or popover; dialogs render through `createPortal`, and React portals do not reparent live nodes.
- Findings: 0 candidates (`git grep` for `appendChild|insertBefore|moveBefore` against dialogs returns none).
- Lean: n/a

### physics-based-easing
- Asks: use `linear()` easing for springs and bounces in CSS.
- Applies here: no — the one spring is `lib/lightbox-gesture-controller/lightbox-spring.ts` ("critically-damped, velocity-carrying, interruptible rAF spring"), which must carry pointer velocity and be interrupted mid-flight; a baked `linear()` curve cannot. `chat/chat-scroll/ease.ts` is a convergent per-frame scroll ease that absorbs growing content (documented there).
- Lean: n/a

### platform-controls-dismiss-dialog
- Asks: modal dialogs opened with `showModal()` respond to Escape and the platform back gesture with no extra code.
- Applies here: yes — already the case for all native dialogs.
- Findings: 3 native dialogs, all via `showModal()` (`hooks/useModalDialog.ts:19`, `workstreams-app/.../DefaultExhibit.tsx:24`). Two cancel/close points differ from default on purpose:
  - `ModalCard.tsx:67-70` `onCancel={(event) => { event.preventDefault(); onCancel?.(); }}` — not real (intentional)
  - `ModalCard.tsx:71-85` `onClose` re-opens the dialog after a repeated Escape because "Chrome stops honoring preventDefault on a repeated Escape with no click in between" — candidate. Dialogs with no `onCancel` (for example `CaptureResumeDialog.tsx`) want Escape to do nothing; `closedby="none"` is the declarative form and may skip the close watcher, which would make the workaround unneeded in Chrome. Untested; needs one manual check in Chrome.
  - `PlacePill-landmarks.tsx:225` `role="dialog" aria-modal="true"` on a `<section>` — see `declarative-dialog-popover-control`.
- Our guidance: agrees (`ModalCard` docblock).
- Fix size: experiment only; 1 attribute plus a Chrome check against `beebox/src/frontend/test/components/ui/ModalCard.test.ts`'s scenario.
- Lint-able: no
- Browser: `closedby` Chrome 134, Firefox 141, no Safari; the Safari behavior the hack covers is Chrome-specific, so no fallback needed.
- Lean: adopt with changes — try `closedby="none"` when `onCancel` is absent; delete the hack only if Chrome stops closing.

### prevent-page-scroll-under-modal-dialog
- Asks: add `overscroll-behavior: contain` on `dialog:modal` and `overflow: hidden; overscroll-behavior: contain` on `dialog::backdrop`; never lock `body` overflow.
- Applies here: yes — all three native dialogs, no containment rule anywhere.
- Findings: 3 dialogs; 3 real
  - `beebox/src/frontend/src/components/ui/ModalCard.tsx:63` className `"m-auto max-h-[calc(100%-3rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg p-0 shadow-xl backdrop:bg-black/60"` — real (no overscroll rule; five callers: `CaptureResumeDialog`, `CardActions`, `DeleteChatDialog`, `ScreenshotConsentPopup`, `QuickSearchOverlay`)
  - `ImageLightbox.tsx:134` `className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent"` — real
  - `workstreams-app/.../DefaultExhibit.tsx:29` `className="m-0 h-dvh max-h-none w-screen max-w-none overflow-auto bg-stone-900 p-0 backdrop:bg-stone-900"` — real, lower value
  - `git grep -n "overscroll" ` for `::backdrop` finds none; no `body.style.overflow` lock exists (the rule against it is already satisfied).
  - Whether the page itself scrolls: the shell uses `.h-app` with inner scrollers, but `CardContentsMenu.tsx` handles `scroller ?? window`, so some pages scroll the window; the backdrop scroll leak is reachable there.
- Our guidance: silent (grep of `frontend.md`, `code-style.md` for overscroll returns nothing).
- Fix size: 1 file, ~6 CSS lines in `beebox/src/frontend/src/index.css` (and `workstreams-app/src/frontend/styles.css`); no risk; verify with `bin/browse` on a long card page: open a `ModalCard` dialog and wheel over the backdrop.
- Lint-able: baselined scan (stylelint-style check that a stylesheet with `dialog` styles contains the pair); not an ESLint rule.
- Browser: `overscroll-behavior` on non-scrollable containers Chrome 144, Firefox 150, no Safari; on Safari 17.0 it still contains chaining when the dialog's own content overflows. The guide calls this progressive enhancement.
- Lean: adopt — cheapest finding in the slice.

### same-document-transitions
- Asks: wrap DOM updates in `document.startViewTransition()` for animated state changes.
- Applies here: no — no `startViewTransition` call anywhere; the router has no `defaultViewTransition`. Adding it would be new polish that interacts with the chat scroll model (`components/chat/chat-scroll/`), whose docs emphasize predictable scroll position. Safari 18 (not 17.0).
- Lean: n/a

### scoped-component-transitions
- Asks: element-scoped view transitions so the `::view-transition` overlay does not block the page.
- Applies here: no — no view transitions to scope. Chrome 147 only.
- Lean: n/a

### scroll-completion-effects
- Asks: wait for `scrollIntoView({behavior:"smooth"})` to finish (promise or `scrollend`) before triggering a follow-up highlight, focus, or animation.
- Applies here: partly — 3 smooth scrolls.
- Findings: 3 smooth-scroll sites; 0 real
  - `components/admin/GoogleServicesSection/view.tsx:69` `scrollIntoView({ behavior: "smooth", block: "center" })` then `onArrivalConsumed()` — not real (the follow-up is state cleanup, not a visual effect that needs the target on screen)
  - `lib/selection/quote-anchor.ts:41` `el.scrollIntoView({ block: "center", behavior: "smooth" })` — not real (the Custom Highlight is set first and is not time-sensitive)
  - `chat/workspace/SidecarTabStrip/view.tsx:87,96` `scroller.scrollTo({ left, behavior: ... "smooth" })` then `setOverflow(...)` — not real (the `scroll` listener at line ~110 recomputes overflow on every position, so a late value self-corrects)
  - `land-on-section.ts:12` uses instant `scrollIntoView` and then `focus({ preventScroll: true })` — correct as is
- Our guidance: silent
- Fix size: none.
- Lint-able: no
- Browser: promise-returning scroll Chrome 150 only; the fallback is `scrollend` (Safari 17.0 lacks it, Baseline 2025-12 in Safari 26.2).
- Lean: n/a — no site waits on a smooth scroll.

### scroll-entry-exit-effects
- Asks: scroll-driven entry/exit animations with `animation-timeline: view()`.
- Applies here: no — no reveal-on-scroll effects. Safari 26, Firefox 159; not on the floor.
- Lean: n/a

### scroll-snap-realtime-feedback
- Asks: update UI in real time while a snap scroller moves (`scrollsnapchanging`).
- Applies here: no — no scroll-snap containers.
- Lean: n/a

### scroll-snap-state-sync
- Asks: use `scrollsnapchange` to sync UI (dots, counters) to the snapped item.
- Applies here: no — no scroll-snap containers; Chrome only.
- Lean: n/a

### scroll-target-on-load
- Asks: use `scroll-initial-target` to bring a descendant into view at first render instead of JS `scrollIntoView`.
- Applies here: partly — initial-position scrolls exist but all need JS for other reasons.
- Findings: 4 candidate sites; 0 real
  - `components/PdfCardView/PdfPageStrip.tsx:36` `target.scrollIntoView({ block: "nearest", inline: "center" })` — not real (re-runs when `activePage` changes, not only at load)
  - `hooks/useFragmentJump.ts:60` `result.element.scrollIntoView({ block: "start" })` — not real (waits for async-rendered sections with a `MutationObserver`; no static target at first render)
  - `components/admin/land-on-section.ts:12` — not real (also moves focus)
  - `components/CardContents/CardContentsMenu.tsx:201` `heading.scrollIntoView({ block: "start" })` — not real (user-initiated jump)
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Chrome 133 only; no Safari.
- Lean: reject — every site needs JS anyway.

### scrollytelling
- Asks: scroll-driven narrative animation with CSS scroll timelines.
- Applies here: no — internal app; no narrative scroll pages.
- Lean: n/a

### search-hidden-content
- Asks: make collapsed content findable by browser find-in-page: use `<details>` or `hidden="until-found"` rather than `display:none` or unmounting.
- Applies here: yes — one primitive.
- Findings: 9 `<Accordion>` uses and ~12 raw `<details>` uses; 1 primitive real
  - `beebox/src/frontend/src/components/ui/Accordion.tsx:105-109` `{open || keepMounted === true ? (<div id={bodyId} role="region" hidden={!open}>` — real: closed content is unmounted (default) or `hidden` (`display:none`), so Ctrl+F does not find or open it. Raw `<details>` sites (`chat/ChatMessages/activity-rendering.tsx:104`, `dashboard/ScheduleOverview/RunHistory.tsx:52`, `themes/ThemedFileCard/view/CardProperties.tsx:69`) — not real (already native; Chrome opens them on find)
  - Accordion callers: `AttachedComments.tsx:69`, `BrowserTaskView.tsx:128,154`, `admin/SecretsSection/box.tsx`, `machine.tsx`, `browser-task/BatchList.tsx`, `pages/browse/.../BrowseSidebarList.tsx`, `directory-listing.tsx`, `chat/ambient/.../AmbientSessionReply.tsx`. Most hold forms or secrets where find-in-page of hidden text is not wanted.
- Our guidance: `beebox/frontend.md:201` lists `<Accordion>` as "collapsible disclosure"; does not mention find-in-page. Agrees with a custom button disclosure.
- Fix size: option A, `hidden={open ? undefined : "until-found"}` plus an `onBeforeMatch` handler setting open, and `keepMounted` for finds to work: 1 file, low risk; but the default unmounts the body, so find would need `keepMounted` by default (cost: mounted hidden forms and queries). Option B, rebuild on `<details>`: conflicts with controlled `open`, the `id` on the toggle button that `lib/ui-scan` addresses, and `keepMounted`.
- Lint-able: baselined scan
- Browser: `<details>` Baseline widely; `hidden="until-found"` Chrome 102, Firefox 148, no Safari (the guide asks for feature detect and show-all fallback).
- Lean: reject — value is small for an internal app, and the secrets and form accordions should not expose hidden text to Ctrl+F.

### sortable-table
- Asks: sortable semantic tables with `aria-sort`, header buttons, optional view transitions.
- Applies here: no — 7 `<table>`s (`SheetTable.tsx:47`, `browser-task/RunsTable.tsx:58`, `BatchList.tsx:117`, `dashboard/ScheduleOverview/view.tsx:193`, `pages/inventory/.../InventoryTable.tsx:11`, `InventoryContent/view.tsx:87`, `DoclingPageSection.tsx:50`); none has sort controls or `aria-sort`. Sorting is server-side order only.
- Lean: n/a — would apply if a table gained user sorting.

### spatial-navigation
- Asks: directional (D-pad/arrow) focus navigation with `spatial-navigation` features.
- Applies here: no — pointer/touch/keyboard web app; no TV or D-pad targets.
- Lean: n/a

### swipe-to-remove
- Asks: swipe-to-remove list rows built on CSS scroll snap.
- Applies here: no — no swipe-to-remove rows. The only swipe is the lightbox image paging in `lib/lightbox-gesture-controller/` (custom pointer + spring, with pinch zoom).
- Lean: n/a

### swipe-to-reveal
- Asks: swipe a row to reveal action buttons via scroll snap.
- Applies here: no — none exists; row actions are visible buttons (`workstreams-app` `issue-actions-row`; beebox menus).
- Lean: n/a
