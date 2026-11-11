# Audit: css + ui-atoms guides

## Slice summary

- Tailwind is 3.4 (`beebox/src/frontend/package.json`: `"tailwindcss": "^3.4.0"`), plugins: typography only (`tailwind.config.js:155`). No container-queries plugin, no `@layer`, no `@scope` anywhere in our CSS. Tailwind 3.4 emits `h-dvh`/`min-h-dvh`, `has-[]`, `line-clamp`, `ms-/me-/ps-/pe-`, but we use none of them for the legacy forms below, except `truncate`.
- Our CSS already uses `:has()` (9 sites), one `@container` (interface.css:40), `overflow: clip` (5), `color-scheme` on dark themes (7 files), `color-mix()`, relative color `color(from ...)`, `<dialog>`+`showModal()` (ModalCard, ImageLightbox), `100dvh` (`.h-app`, index.css:19).
- No guide has a large pool of real sites. Most guides are `no` or `n/a`: no scroll-driven animation, no anchor positioning, no popover attribute, no pull-to-reveal, no carousel, no tooltips beyond native `title`.
- Real findings: `scrollability-affordance-hints` (SidecarTabStrip edge fades driven by JS scroll listener, 1 site), `viewport-aware-dropdowns` (`ui/Dropdown.tsx` JS positioning, 1 primitive used app-wide, but needs Safari 17.0 fallback), `calculate`/`animate-to-intrinsic` (0 real; `max-width: 0` label transition card-themes.css:163 is a width-to-0 case, Chrome-only feature), `responsive-design` (3 `min-h-screen` pages should be `min-h-dvh`; Tailwind 3.4 supports it).
- Most valuable fixes: (1) `min-h-screen` to `min-h-dvh` on 3 login/box-selection pages (trivial, Baseline). (2) SidecarTabStrip fade via scroll-driven animation, only with Safari 26 gate, so likely wait. (3) Dropdown `ui/Dropdown.tsx` anchor positioning, wait: Safari 26 only, and JS clamp covers iOS keyboard visualViewport case that CSS does not.
- Dead code found incidentally: `--bbx-composer-height` is set by `ChatComposerSection.tsx:248` and read nowhere in the repo (`git grep` shows only the two lines in that file). Candidate for removal; unrelated to any guide.
- Static scanner caveat: upstream scanner reads `.css` only. For our code, legacy patterns hide in Tailwind classes in these guides: `responsive-design` (`min-h-screen`, `max-h-[95vh]`), `single-line-overflow` (`truncate`, 137 sites in tsx), `individual-transform-properties` (Tailwind's own `transform` composition, not hand-written).

Browser floor reminder: Safari 17.0 at the iOS WKWebView floor. Safari 26 features (scroll-driven animations, sibling-index) are not available there; Safari 18 features (container style queries) are not available there.

---

## css

### animate-to-intrinsic-sizes
- Asks: Use `interpolate-size: allow-keywords` instead of JS or `max-height` hacks to animate to `auto`/`max-content`.
- Applies here: partly — we animate sizes in a few places, none is an animation to `auto`.
- Findings: 3 candidate sites; 0 real after reading the code
  - `beebox/src/frontend/src/themes/card-themes.css:181` `max-height: 24rem;` — not real (static cap on a chat card front, no transition)
  - `beebox/src/frontend/src/themes/card-themes.css:163-165` `max-width: 0; margin-left: -0.3rem;` with `transition: max-width 0.25s` at :148 — not real (collapses a label to 0 with a known `max-width: 14rem` cap at :135; no `auto` keyword involved, and works in all browsers already)
  - `workstreams-app/src/frontend/styles.css:106` `max-height: 50vh` — not real (static cap)
  - Tailwind classes: `max-h-96`, `max-h-[...]` are static caps; no `transition-[max-height]` found.
- Our guidance: silent
- Fix size: n/a
- Lint-able: no (no static footprint)
- Browser: Chrome 129+ only; Safari and Firefox unsupported. Not Baseline.
- Lean: n/a — no animate-to-auto pattern exists. Worth reconsidering for workstreams-app (Chrome only) if it gains an expand/collapse animation.

### atrule-support-conditionals
- Asks: Use `@supports at-rule(@x)` to gate rules on at-rule support.
- Applies here: no — we use one `@property` (themes/doodlebit.css:2) unguarded and no other at-rule that needs a gate.
- Findings: 1 candidate; 0 real
  - `themes/doodlebit.css:2` `@property --doodlebit-walkers {` — not real (Baseline since 2024-07, Safari 16.4 ok)
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Chrome 148, Firefox 157; Safari unsupported. Not Baseline.
- Lean: n/a — no use. Also would not work on Safari at all, so no use for iOS.

### calculate-with-intrinsic-sizes
- Asks: Use `calc-size()` for math on `auto`/`min-content` etc.; use `interpolate-size` for plain keyword animation.
- Applies here: no — no calculation on intrinsic sizes in our CSS.
- Findings: 0 sites for `calc-size`; `calc(100% - 1.5rem)` at `plugins/courseware/view/graph/concept-map.css:201` is a length calc on a definite size, not intrinsic.
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Chrome 129+ only; Safari and Firefox unsupported.
- Lean: n/a — no use case.

### child-state-based-styling
- Asks: Use `:has()` to style a container from descendant state instead of JS-injected classes.
- Applies here: yes — already adopted.
- Findings: 9 `:has()` sites in CSS; 0 sites where JS toggles a parent class that `:has()` could replace
  - `themes/card-themes.css:160` `.bbx-card-contents:not([data-scrolling], :hover, :focus-within, :has([aria-expanded="true"]))` — already modern
  - `themes/question-beside.css:8` `.bbx-card-surface:has([data-question-beside])` — already modern
  - JS-set parent attributes found: `data-scrolling` (CardContentsMenu.tsx:156 `element.setAttribute("data-scrolling", "")`) tracks scroll recency, not child state — not real. `data-overflow-left/right` (SidecarTabStrip view.tsx:289) tracks scroll position — not real.
  - Tailwind `group-has-`/`has-[` : 0 uses; React `hasX ? "class" : ""` patterns found are `hasControlIds` id toggles, unrelated.
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Baseline widely available (2023-12-19); Safari 15.4. OK on 17.0.
- Lean: n/a — already in use; nothing left to convert.

### content-based-styling
- Asks: Use `:has()` for content-dependent layouts (`:has(img)`) instead of modifier classes.
- Applies here: partly — same `:has()` usage as above.
- Findings: 2 candidate sites; 0 real
  - `themes/question-beside.css:8` already `:has()`.
  - `index.css:65` `.bbx-include-file:not(:has(+ .bbx-include-file)):not(:last-child)` — already `:has()`.
  - No `card--has-image` style modifier-class pairs found (`rg 'has-image|with-image|--has'` yields none in tsx/css).
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Baseline widely available; Safari 15.4.
- Lean: n/a — no legacy modifier-class pattern left.

### css-layout
- Asks: Pick flex/grid/subgrid correctly; avoid `order`/`*-reverse` for interactive content; grid-lanes only when Baseline.
- Applies here: partly — general advice. Our layout is Tailwind flex/grid.
- Findings: 2 candidate classes of site; 0 verified real
  - `flex-row-reverse|flex-col-reverse|order-` in interactive content: not audited site by site; no theme CSS uses `order:` (grep not run exhaustively). Not counted as real.
  - `themes/card-themes.css:124-125` `.bbx-card-back dl { display: grid; grid-template-columns: minmax(6rem, auto) minmax(0, 1fr)` — correct usage, not real.
  - No masonry; no subgrid use needed.
- Our guidance: silent
- Fix size: n/a
- Lint-able: baselined scan (needs judgment) for `order`/`row-reverse` on focusable content; low value.
- Browser: Subgrid Baseline widely available (Safari 16). Grid lanes Chrome 150 only.
- Lean: n/a — general reference, no concrete defect found.

### css
- Asks: Architecture rules: `@layer` for priority, `:where()` for low specificity, `@scope` over `:not()`, logical properties, `currentColor`, `inherit`, nesting, no BEM.
- Applies here: partly — theme CSS is hand-written with `.bbx-` prefixed names and long selectors; the rest is Tailwind.
- Findings: 5 candidate classes; 2 notable
  - No `@layer` and no `@scope` in any CSS file (`rg '@layer|@scope'` returns 0). Theme overrides rely on specificity and 28 `!important` lines across 4 files (print block in `index.css:121-139` accounts for several: `.h-screen, .overflow-hidden {... !important}`).
  - 44 physical-property lines in CSS across 14 files (`margin-left`, `padding-right`, `border-left` ...) vs 15 logical lines across 11 files. Tailwind side: 122 `ml-/mr-/pl-/pr-` uses, 0 `ms-/me-/ps-/pe-`. Real only if RTL or vertical writing is planned; no i18n/RTL policy exists. Not real today.
  - `themes/card-themes.css:160-164` repeats the same `:not([data-scrolling], :hover, :focus-within, :has([aria-expanded="true"]))` list in two selectors — could be one nested rule; cosmetic.
  - 341 `:is()`/`:where()` lines: already heavily used.
- Our guidance: silent on layers/scope/logical; `beebox/code-style.md` does not cover CSS (no hit for `@layer`).
- Fix size: adopting `@layer` for themes means wrapping 50 files in `themes/` and changing how Tailwind utilities cascade (Tailwind 3 emits unlayered utilities; layering themes below them changes outcomes). High risk; verify with `bin/theme-check` across all themes plus phone-width browse. Not worth it without a measured problem.
- Lint-able: baselined scan (needs judgment): count of `!important`, physical vs logical properties. A stylelint rule would work but we have no stylelint.
- Browser: `@layer` Baseline widely (Safari 15.4); `@scope` Baseline 2025 (Safari 17.4, so not on 17.0); nesting Baseline (Safari 16.5/17.2 for relaxed nesting).
- Lean: reject — broad architecture advice; the `@layer` migration is a theme-wide rewrite with no failing behavior to justify it. Keep as reference for new theme files.

### design-token-reactivity
- Asks: Use container style queries (`@container style(--x: y)`) so descendants react to token changes on an ancestor.
- Applies here: partly — our themes switch with `data-card-theme` / `data-chrome-theme` attribute selectors and set `--bbx-*` custom properties.
- Findings: 0 style queries; candidate pattern = attribute-selector theme switches (`[data-chrome-theme="gilt"] .bbx-composer-material` ~ dozens of lines in `themes/*-chrome.css`); 0 real
  - Attribute selectors work in every browser and the markup already carries the data attribute; style queries would not remove code.
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Newly available (2026-05-19); Chrome 111, Firefox 151, Safari 18. Not on Safari 17.0. The guide itself says not to use for core features without Baseline and notes fallbacks are hard.
- Lean: reject — iOS floor lacks it and attribute selectors already do the job.

### dynamic-sibling-styling
- Asks: Use `sibling-index()`/`sibling-count()` instead of `:nth-child` loops or inline index styles.
- Applies here: no — `rg 'nth-child\('` in theme/plugin CSS finds no loops; no inline `--i`/`animationDelay` index styles found. Only `index.html:75-76` boot animation uses two `nth-child` rules.
- Findings: 2 candidate; 0 real (`index.html:75` `#root .app-boot-cards i:nth-child(2)` is a 3-element splash, fixed).
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Newly available (2026-08-18); Safari 26.2. Not on 17.0.
- Lean: n/a — no pattern.

### fluid-scaling
- Asks: Use container query units (`cqi`) and `clamp()` to scale components to their container; do not shrink on browser zoom.
- Applies here: partly — we use `clamp()` in a few places.
- Findings: 3 candidate sites; 0 real
  - `themes/materials.css:36` `--bbx-content-padding: clamp(1rem, 3vw, 2rem);` — already fluid, viewport-based; fine.
  - `workstreams-app/src/frontend/styles.css:15` `font-size: clamp(1.55rem, 2.6vw, 2.35rem)` — already modern.
  - `themes/interface.css:40-42` one `container-type: inline-size` + `@container (max-width: 8rem)` — already used.
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Container queries (size) Baseline widely (2023-02-14); Safari 16. Fine.
- Lean: n/a — the pattern is already in use where it is useful.

### individual-transform-properties
- Asks: Use `translate`, `rotate`, `scale` properties instead of composing `transform` chains, so keyframes can animate each independently.
- Applies here: partly — theme CSS animates with `transform:` shorthand.
- Findings: ~47 `transform` lines in CSS; 3 plausible, 0 clearly real
  - `themes/doodlebit-controls.css:35-37` `0%, 100% { transform: translateY(-2px); } 30% { transform: translateY(-2px) rotate(-3deg); }` — one keyframe sets translate and rotate together; separate properties would allow independent timing, but nothing overrides one part. Not real.
  - `themes/card-turn.css:23` `transform: rotate(-90deg) translateY(-100%);` — static composition, order matters; not real.
  - `themes/card-turn.css:41` `.bbx-card-properties:focus-visible { transform: scale(1.12); }` over a base `transform` at :23 — this replaces the rotate/translate on focus. Check by reading: line 23 belongs to a different selector (`::before`/label), so not real without a hover collision. Marked not real.
  - Tailwind: `rotate-90`, `-translate-x-1/2` etc. compose through Tailwind 3's `--tw-*` variables on `transform`; Tailwind 3.4 still emits `transform`, so Tailwind does not emit individual properties. Utility use is fine.
- Our guidance: silent
- Fix size: n/a
- Lint-able: baselined scan (multiple `transform` declarations on one element in one file).
- Browser: Baseline widely (2022-08-05); Safari 14.1.
- Lean: reject — no site where it fixes a bug or removes code; keep for new keyframes.

### overflow-clipping-control
- Asks: Use `overflow: clip` (plus `overflow-clip-margin`) when you want clipping without a scroll container; `hidden` makes one.
- Applies here: partly — we already use `clip` in 5 theme sites and `hidden` in 51 CSS lines plus `overflow-hidden` in Tailwind.
- Findings: 51 CSS `overflow: hidden` sites; ~3 plausibly real
  - `themes/posy.css:29` `.bbx-card-heading{position:relative;overflow:hidden;...}` — decorative clip; `clip` would avoid creating a scroll container. Not verified to cause a bug; not real.
  - `themes/candy.css:44` `overflow: hidden;` — same class.
  - `ChatMessages/view.tsx:191` comment records "a sticky child of an overflow:hidden box" breaks stickiness. That is the documented bug class `overflow: clip` fixes. Comment-only; code already moved the sticky bar outside. Not real now.
  - Tailwind `overflow-clip` exists in 3.4; the repo has 0 uses of it.
- Our guidance: silent
- Fix size: n/a unless a sticky-in-hidden bug recurs.
- Lint-able: baselined scan (needs judgment): `overflow-hidden` on an element with sticky descendants.
- Browser: `overflow: clip` Baseline widely (2022-09-12); Safari 16. `overflow-clip-margin` is Firefox only, skip.
- Lean: n/a — optional tool for the sticky-in-hidden bug class; nothing to convert today.

### reduce-style-repetition
- Asks: Use CSS `@function` to share parameterized logic.
- Applies here: no — we use no CSS `@function`; theme CSS repeats literal `color-mix(...)` expressions but themes are authored in Chrome and Safari.
- Findings: 0 real. Candidate: repeated `color(from var(--bbx-selection, #bcd4f6) srgb-linear clamp(0, sign(...), 1) ...)` in `themes/chrome.css:13,17,21,25` (4 copies of a long contrast formula) — a real duplication, but `@function` is Chrome 139 only.
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Chrome 139+ only; Safari and Firefox unsupported.
- Lean: reject — no Safari. The guide itself suggests a precompiler for static logic; a custom property holding the formula would remove the duplication today if wanted (not part of this guide).

### responsive-design
- Asks: Fluid type with `clamp()`, relative units, media/container queries, avoid `vw` alone, mobile viewport units.
- Applies here: yes — phone-width use is a real client (iOS app).
- Findings: 30 `vh`/`screen` sites; 3 real
  - `beebox/src/frontend/src/pages/BoxSelection.tsx:22` `<Row justify="center" align="center" className="min-h-screen p-4">` — real: `min-h-screen` is `100vh`, which on mobile Safari includes the collapsed toolbar area; `min-h-dvh` (Tailwind 3.4) avoids the overshoot.
  - `pages/login/SetupPage.tsx:205` same `min-h-screen p-4` — real
  - `pages/login/LoginPage.tsx:87` same — real
  - `components/ImageLightbox.tsx:184` `max-w-[95vw] max-h-[95vh]` and `:198` `max-h-[80vh]`/`max-h-[92vh]` — not real (inside a `<dialog>` lightbox where exact fit to the small viewport matters on iOS, but it is `vh` of the largest viewport; arguably real on iOS toolbar collapse. Left not real because the lightbox also has a visualViewport-aware gesture controller; needs a device check).
  - `components/ui/Image/view.tsx:13` `max-h-[70vh]`, `ui/Image/layers.tsx:17` `height: "70vh"` — not real (a proportion cap).
  - `QuestionForm/view.tsx:69` `max-h-[30vh]` — not real
  - `pages/dev/components/CaptureModeHarness.tsx:297` `min-h-screen` — not real (dev harness)
  - `workstreams-app/.../exhibits/Container.tsx:114` `min-h-screen` — not real (Chrome-only desktop)
  - Already modern: `index.css:19` `height: var(--app-height, 100dvh)`, `workstreams-app styles.css` uses `100dvh`; `DefaultExhibit.tsx:29` `h-dvh`.
  - `index.css:121` print block `.h-screen` — not real (print override).
  - Font sizes with `vw`: none beyond the clamp cases above.
- Our guidance: agrees — `index.css:14-19` comment: "Falls back to 100dvh where the variable is unset." No rule against `h-screen` in `frontend.md`.
- Fix size: 3 tsx files, `min-h-screen` to `min-h-dvh`; trivial; verify with browse at phone width on `/login`. Optional ESLint-style ban on `h-screen|min-h-screen|max-h-screen`.
- Lint-able: eslint — a `no-restricted-syntax` regex on className string literals for `\b(min-|max-)?h-screen\b`, or a class-name check in `personal-vibe-check`. Deterministic.
- Browser: `dvh` Baseline widely (Safari 15.4). Fine on 17.0.
- Lean: adopt with changes — swap the 3 page-level `min-h-screen`, optionally ban `h-screen` going forward; leave proportional `vh` caps.

### selector-atrule-combinations
- Asks: Use nesting and `@container style()`/`@media` combinations to avoid duplicating selectors.
- Applies here: partly — we have duplicated selector lists, no nesting.
- Findings: 1 candidate; 0 real
  - `themes/card-themes.css:160-164` repeated `:not(...)` list. Cosmetic.
  - Style queries unavailable on Safari 17.0.
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Style queries Newly available (2026-05-19), Safari 18; nesting Baseline.
- Lean: reject — no need; iOS floor lacks style queries.

### size-aware-styling
- Asks: Use container queries (`container-type`, `@container`) instead of JS measuring or viewport media queries.
- Applies here: partly — component widths vary (card panes, companion desk, tabs).
- Findings: 6 candidate JS-measure sites; 1 plausibly real
  - `components/chat/workspace/SidecarTabStrip/view.tsx:114` `new ResizeObserver(() => revealTab(...))` — not real (it scrolls the active tab into view; needs script)
  - `components/PdfCardView/view.tsx:140` `new ResizeObserver(measure)` — not real (page rendering scale for pdf.js)
  - `components/CardContents/CardContentsMenu.tsx:174` ResizeObserver to recompute current heading — not real
  - `beebox/src/schemas/figure.ts:61,103` `ResizeObserver` in figure guidance for canvas drawing — not real (JS canvas)
  - `components/AppNav/PlacePill-landmarks.tsx:74` `matchMedia("(max-width: 639px), (max-height: 499px)")` plus visualViewport — not real (visual viewport vs keyboard)
  - `chat/everywhere/use-mobile-card-navigation.ts:4`, `lib/chat-channel.ts:43` `matchMedia("(max-width: 767px)")` — not real: they pick a React tree (mobile vs desktop components), not a style.
  - Tailwind: no `@container` variants (the `@tailwindcss/container-queries` plugin is not installed), so tailwind `sm:` / `md:` classes (115 lines) are all viewport-based. A card in a narrow companion pane on a wide window gets desktop classes. Real only if a layout bug is reported; none found.
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Baseline widely (Safari 16).
- Lean: n/a — usable per component when a pane-width layout bug appears; no existing defect.

### style-parent-with-has
- Asks: Style a form group from `:user-invalid` of a field using `:has()`, with a WeakMap-based dirty tracker for aria-invalid.
- Applies here: no — our field error is app state, not native validity.
- Findings: 6 candidate sites; 0 real
  - `components/ui/fields/field.tsx:60` `aria-invalid={hasError ? true : undefined}` — not real (`error` is a caller prop from server/app validation; native constraint validation is not the source)
  - same pattern at field.tsx:116,169,225,296 and `radio.tsx:62`
  - No `:invalid` / `:user-invalid` CSS; no `setCustomValidity` uses.
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: `:user-invalid` Baseline widely (2023-11-02), Safari 16.5.
- Lean: reject — errors do not originate from native validity; swapping would lose app-supplied messages.

### usage-aware-component-variations
- Asks: Use style queries to vary a component by context custom properties set by ancestors.
- Applies here: partly — card themes vary child components via ancestor `data-card-theme` and `--bbx-*` variables.
- Findings: 0 style queries; 0 real
  - Attribute selectors in `themes/*.css` already do contextual variation.
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Newly available (2026-05-19); Safari 18; Firefox 151. Not Safari 17.0.
- Lean: reject — iOS floor lacks it.

---

## ui-atoms

### carousel-slide-effects
- Asks: Scroll-driven `view()` animations for carousel slide fade/scale.
- Applies here: no — no carousel in the app (`rg 'carousel|scroll-snap'` finds none).
- Lean: n/a

### component-specific-light-dark-theme
- Asks: Set `color-scheme` on a subtree that must differ from the page, and use `light-dark()`.
- Applies here: yes — already adopted for themes.
- Findings: 19 `color-scheme` lines; 0 missing found
  - `themes/deck.css:191` `color-scheme: dark;`, `night-atlas.css:195`, `gilt-chrome.css:58`, `tempest-chrome.css:68`, `textile-chrome.css:76`, `phosphor.css` (inline in custom-property block), `figure-controls.css:22` `color-scheme: light;` — correct.
  - Dark paper themes without an observed `color-scheme: dark`: `themes/gilt.css:3` (`--gilt-paper: #173f50`) and `themes/tempest.css` (`--bbx-bar-paper: #0b1b2b` in tempest-chrome.css:6, whose color-scheme is set at :68 for card theme and composer material only, not the bar). Whether native controls (scrollbars, form inputs) inside the bar render light on dark paper is unverified; I did not run it.
  - `light-dark()` : 0 uses; themes set explicit variables per theme, which is fine.
  - `index.html:90` `@media (prefers-color-scheme: dark)` — the boot splash only; app has no OS dark mode (frontend.md has a fixed palette, no dark mode).
- Our guidance: agrees — no dark-mode feature; per-theme color-scheme applied where themes are dark.
- Fix size: check `bin/theme-check` and browse each dark theme's scrollbars/inputs; if a gap exists, add `color-scheme: dark` to the missing selector (1 line each).
- Lint-able: baselined scan (needs judgment): a dark paper variable without `color-scheme`.
- Browser: `color-scheme` Baseline widely (Safari 13); `light-dark()` Safari 17.5, so not on 17.0 floor.
- Lean: adopt with changes — audit the dark themes for missing `color-scheme: dark` on bars and menus; do not adopt `light-dark()` (Safari 17.5 and unnecessary).

### icons
- Asks: Icons as CSS-driven tokens (`mask`/`background` from custom properties), inline SVG or `<use>` sprites; recolor via `currentColor`, not `<img>` filters.
- Applies here: partly — icons are inline SVG in React with `currentColor`.
- Findings: 51 tsx files contain `<svg`; 0 `<img>` + filter recolor; 0 real
  - `components/ui/CloseButton.tsx:43` `<svg className={dim} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">` — already the recommended technique (inline, `currentColor`, hidden from AT).
  - `ui/Button.tsx:139-149` spinner SVG with `currentColor` — same.
  - `themes/doodlebit-controls.css:5` `mask: var(--pixel-icon) center / contain no-repeat;` — already a CSS mask icon with a token.
  - Icons are duplicated per component rather than shared via sprite; no measured cost.
- Our guidance: agrees — `frontend.md:157` "An icon-only control sets `aria-label`... `title` alone is not enough".
- Fix size: n/a
- Lint-able: no
- Browser: masks Baseline widely (Safari 15.4); registered custom properties Safari 16.4.
- Lean: n/a — current approach matches; no conversion to the CSS icon engine (large refactor, no gain).

### position-aware-tooltips
- Asks: Anchor-positioned popovers with an arrow that follows the flipped position via anchored container queries.
- Applies here: no — we have no custom tooltips (215 hits for `title=`/hover utilities are native `title` tooltips). The floating label `SourceViewOverlay.tsx:258` `HoverLabel` is a dev overlay with JS clamp, not a tooltip primitive.
- Findings: 1 candidate; 0 real
  - `SourceViewOverlay.tsx:263-264` `const top = Math.max(28, rect.top - 24); const left = Math.max(4, Math.min(rect.left, window.innerWidth - 300));` — dev overlay, not real.
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Anchored container queries Chrome 143 only; Popover Baseline (Safari 17, iOS 18.3 for full).
- Lean: n/a

### pull-to-reveal
- Asks: Scroll-snap and scroll-driven techniques to hide a search bar above the fold and reveal on pull.
- Applies here: no — no such pattern in app (`rg 'pull|snap'` finds none).
- Lean: n/a (Chrome 133 only anyway)

### responsive-table
- Asks: Sticky headers plus a stacked mobile layout for tables.
- Applies here: partly — 8 `<table>` sites, mostly small internal tables.
- Findings: 8 candidate; 1 real-ish
  - `components/SheetTable.tsx:49` `<tr className="bg-warm-100 sticky top-0 z-10">` and `:50` `sticky left-0` — already sticky headers.
  - `dashboard/ScheduleOverview/view.tsx:192-193` and `pages/inventory/.../InventoryTable.tsx:10-11` wrap in `overflow-x-auto` — already scroll-safe.
  - `browser-task/RunsTable.tsx:58` `<table className="w-full text-sm">` and `browser-task/BatchList.tsx:117` — no wrapper seen at the table; may overflow on phone widths. Real only if used on phone; these are admin/inspection views. Not verified in a browser.
  - `DoclingView/DoclingPageSection.tsx:50` `<table className="border-collapse">` — document tables; stacking would break semantics.
  - Stacked (`display:block` per row) layout: 0 uses; 11 `overflow-x-auto` wrappers elsewhere.
- Our guidance: silent
- Fix size: wrap two tables in `overflow-x-auto`, 2 files; verify by browse at phone width.
- Lint-able: baselined scan: `<table>` without `overflow-x-auto` parent.
- Browser: `position: sticky` Baseline widely.
- Lean: adopt with changes — only the missing `overflow-x-auto` wrappers if a phone-width check shows overflow; do not adopt stacked layout.

### scroll-position-aware-elements
- Asks: Scroll-state container queries (`scrolled`, `snapped`) to style elements by scroll position.
- Applies here: partly — we track scroll recency and edge overflow in JS.
- Findings: 3 candidate sites; 1 plausible
  - `CardContentsMenu.tsx:156` sets `data-scrolling` from a scroll listener — this is time-since-scroll recency with a rest timer, not a scroll-state query feature; not real.
  - `SidecarTabStrip/view.tsx:289-293` `data-overflow-left={overflow.left || undefined}` — covered under scrollability-affordance-hints.
  - `BrowsePage.tsx:89` `window.addEventListener("scroll", closeMenu, true)` — closes menu on scroll; behavior, not style; not real.
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Chrome 144 only; Safari and Firefox unsupported.
- Lean: reject — Chrome-only; JS covers all clients.

### scroll-progress-indicator
- Asks: Progress bar via `animation-timeline: scroll()` instead of scroll listener plus `width`.
- Applies here: no — no scroll progress bar in app (`rg 'progress'` hits are task/upload progress, not scroll).
- Lean: n/a

### scrollability-affordance-hints
- Asks: Edge fades or shadows that show hidden scroll content, using scroll-driven animations or `background-attachment: local` shadows.
- Applies here: yes — one site.
- Findings: 3 candidate sites; 1 real
  - `themes/interface.css:149-152` `... > [role="none"][data-overflow-left]::before, ... [data-overflow-right]::after { opacity: 0.9; }` with JS at `SidecarTabStrip/view.tsx:122` `const update = () => setOverflow({ left: scroller.scrollLeft > 1, right: ... })` plus scroll listener at :116 — real: a React state, scroll listener, ResizeObserver and two data attributes exist only to toggle fade opacity. A scroll-driven fade removes the state and the listener part (the ResizeObserver also serves `revealTab`).
  - `index.css:28-32` `.bbx-scroll-fade-bottom { mask-image: linear-gradient(to bottom, black calc(100% - 16px), transparent) }` — not real: static fade; it fades even without overflow (stated in the comment), acceptable.
  - `workstreams-app/styles.css:36` `.issue-category-nav {... overflow-x: auto; ...}` — horizontal nav strip with no hint; Chrome-only app, so scroll-driven fade is allowed; value is small.
- Our guidance: agrees with the mask approach (comment at `index.css:22-31`).
- Fix size: 1 CSS file + 1 tsx hook (`view.tsx:100-125`), medium risk because `overflow` state drives other logic? Read: `overflow` returned only for the data attributes. Verify with bin/tour or browse of a sidecar strip at narrow widths.
- Lint-able: baselined scan (needs judgment).
- Browser: Scroll-driven animations Newly available (2026-10-27); Safari 26. Not on Safari 17.0 (iOS floor). The guide's own fallback section is JS (what we already have).
- Lean: reject for beebox (iOS floor lacks it; we already have a working JS version). Adopt for workstreams-app only if a hint is wanted.

### shrinking-header-on-scroll
- Asks: Scroll-driven animation to shrink a header instead of a scroll listener.
- Applies here: no — no header shrinks on scroll (`rg 'shrink'` hits are Tailwind `flex-shrink`).
- Lean: n/a

### single-line-overflow
- Asks: Truncate single-line text with ellipsis, keep full text in DOM, give a way to see the full text (title, scroll reveal, fade), `min-inline-size: 0` on flex items, `table-layout: fixed` in tables.
- Applies here: yes — heavy use of `truncate`.
- Findings: 137 `truncate|text-ellipsis|text-overflow` hits (many are the word in comments/names); ~3 checked
  - `components/box-screen/BoxScreenSections.tsx:44` `<span className="min-w-0 truncate font-medium">{chat.label}</span>` — correct (`min-w-0` present, full text in DOM). Not real.
  - `components/themes/ThemedFileCard/CardThemeSurface.tsx:118` `<Text ... truncate title={detail}>` — correct, with `title` for full text.
  - `SourceViewOverlay.tsx:279` `<span key={i} className="truncate">` — dev overlay; no `title`, not real.
  - `themes/card-themes.css:135-140` `.bbx-card-contents-label { max-width: 14rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }` — correct.
  - Missing `min-w-0` on flex children of `truncate`: not sampled across all 137; the `Text` primitive's `truncate` prop (`frontend.md:195`) centralizes it. A regex over `truncate` without `min-w-0` or `w-full|flex-1` is a baselined scan candidate; not counted as real.
  - Tooltips for truncated labels: some use `title`, some not; app policy on this is silent.
  - Tables: no `table-layout: fixed`/`table-fixed` use with `truncate` in a table cell found.
- Our guidance: silent; `frontend.md:195` lists `truncate` as a `Text` prop only.
- Fix size: no change recommended. Possible small check: ensure `truncate` on flex items has `min-w-0`.
- Lint-able: baselined scan (needs judgment).
- Browser: ellipsis universal; scroll-driven reveal Safari 26; masks Baseline.
- Lean: n/a — we already follow the base technique; the advanced reveal/fade parts need Safari 26.

### state-aware-sticky-headers
- Asks: Use `container-type: scroll-state` and `@container scroll-state(stuck: top)` to restyle stuck headers.
- Applies here: partly — sticky exists in few places.
- Findings: 6 candidate sites; 0 real
  - `themes/card-themes.css:124` `.bbx-card-contents { position: sticky; top: 0.5rem; ...}` — no stuck-state style.
  - `QuestionForm/view.tsx:95` `"sticky bottom-0 bg-white py-2 -mb-2"` — no stuck style.
  - `SheetTable.tsx:49,50,66`, `ChatMessages/view.tsx:196` — no stuck style, no JS stuck detection.
  - No IntersectionObserver-based "stuck" sentinel exists (`rg IntersectionObserver` returns only ResizeObserver hits in non-test source: 0).
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: Chrome 144 only.
- Lean: n/a — no stuck-state styling exists.

### viewport-aware-dropdowns
- Asks: Use popover + CSS anchor positioning with `position-try` fallbacks instead of Popper/Floating UI style JS.
- Applies here: yes — our own `ui/Dropdown.tsx` does the JS positioning.
- Findings: 3 candidate sites; 1 real primitive
  - `beebox/src/frontend/src/components/ui/Dropdown.tsx:220-246` `const rect = root.getBoundingClientRect(); ... next.maxHeight = viewportTop + vh - (rect.bottom + gap) - margin; ... next.left = Math.max(viewportLeft + margin, Math.min(anchored, ...))` plus listeners at :251-254 (`scroll`, `resize`, `visualViewport` resize/scroll) and a `ResizeObserver` at :265 — real: ~60 lines of measure-and-clamp that anchor positioning with `position-try-fallbacks` and `position-area` replaces.
  - Why it is not a clean swap: the code clamps to `visualViewport` so menus stay above the iOS keyboard (comment at :229-231). CSS anchor positioning clamps to the layout viewport, so that case may regress.
  - `SelectionCapture.tsx:318` `left: \`clamp(8px, ${button.left + 6}px, calc(100% - 2.75rem - 8px))\`` — positions a floating button from selection rects; not a dropdown, not real.
  - `workstreams-app` `.quota-panel` `position: absolute; ... width: min(58rem, calc(100vw - 2rem))` at styles.css:33 — uses `<details>`; CSS-only already, not real.
  - `popover=`/`popovertarget`: 0 uses; native `<dialog>` used for modals.
- Our guidance: agrees with current approach — `Dropdown.tsx:229-231` documents the iOS keyboard reason.
- Fix size: 1 file (`ui/Dropdown.tsx`, used by many menus) plus every menu theme; high risk; verify with browse at phone width with the keyboard open, and `bin/tour`.
- Lint-able: no
- Browser: Popover Baseline (2025-01-27; Safari 17, iOS 18.3 caveats). Anchor positioning: the guide shows Safari 27 (Sep 2026) in the support line at `viewport-aware-dropdowns.md:101`, unsupported in Chrome/Edge/Firefox for that sub-feature. The core anchor positioning is not on Safari 17.0.
- Lean: reject for now — iOS floor lacks anchor positioning, and the JS version handles the on-screen keyboard case. Revisit when the iOS deployment target reaches Safari 26.
