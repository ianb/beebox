# modern-web-guidance — scan and guide-by-guide audit (2026-11-11)

A dated snapshot of how our web code measures against
[GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance)
(guides at commit `4dd96834`, 2026-11-10) and its scanner in
[modern-web-guidance-src](https://github.com/GoogleChrome/modern-web-guidance-src)
(commit `596acbc7`, 2026-11-11). The decisions it feeds are in
[the adoption plan](../../beebox/docs/implemented-plans/modern-web-guidance-adoption.md).
The issue is
[adopt-modern-web-guidance-skill](../../issues/closed/exploration/2026-11-10-adopt-modern-web-guidance-skill.md).

## What was scanned

Code: `beebox/src/frontend/src/`, the stock views (`beebox/src/schemas/*.tsx`,
`beebox/src/plugins/*/view*`), `workstreams-app/src/frontend/`, and
`beebox-clerk/`. Tests, fixtures and generated output were skipped.
Templates were added after the plan's cross-model review: `beebox/src/templates/`
(including the four figure starter sketches, `p5js`, `three`, `d3` and
`canvas-loop`, written out from their string literals), `beebox/templates/`, and `beebox/src/schemas/guide/`. The static
scan found 0 there; the reading found one item (reduced motion in the figure
starters, plan item H0).

Two passes:

1. **Static scan.** `legacy-scan --json` with the scanner's 33 rules, run from a
   clone outside the checkout, with no LLM verifier. Seven candidates came back:
   four `ime-safe-enter-submit` (all real) and three `dark-mode` (one in the app,
   a boot-splash fallback, not real; two in `dev/` pages, out of scope). The
   scanner covers about 20% of the guides (its own note), and its CSS matchers
   read only `.css` files, so Tailwind class strings are invisible to them.
2. **Guide audit.** Eight agents read every published guide (209 files) in
   category slices and checked our code against each. Broad guides
   (`accessibility`, `forms`, `html`) were split by section. Each entry records
   what the guide asks, the candidate and real sites, where our own guidance
   agrees or conflicts, the fix size, whether a lint rule can hold it, the
   browser floor, and a lean. The reports are in [`audit/`](audit/).

Browser floor used for every lean: the iOS app's WKWebView at
`IPHONEOS_DEPLOYMENT_TARGET = 17.0` (Safari 17.0 engine). workstreams-app and
beebox-clerk are Chrome-only. No written browser policy exists; the plan asks
for one.

## Totals

| Lean | Entries |
|---|---|
| adopt | 9 |
| adopt with changes | 38 |
| reject | 52 |
| n/a (no such feature here, or already done) | 140 |

Leans are the auditors'. The plan regroups the adopt entries into decision
units and revises some of them.

## Per-guide triage

"Real" is the count of sites that would change after reading the code ("—"
where the report gives no single count).

| Guide | Report | Lean | Real | Reason |
|---|---|---|---|---|
| `accessibility/landmarks` | [a11y-html-ux](audit/a11y-html-ux.md) | reject | 1 | reject as a sweep. Keep as a reviewer note for new code. |
| `accessibility/headings` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a (already met). |
| `accessibility/lists` | [a11y-html-ux](audit/a11y-html-ux.md) | reject | — | reject (churn for a narrow VoiceOver announcement; lint rule opposes it). |
| `accessibility/tables` | [a11y-html-ux](audit/a11y-html-ux.md) | reject | — | reject (no user-visible gain for simple tables). Revisit if a screen-reader user reports it. |
| `accessibility/skip-links` | [a11y-html-ux](audit/a11y-html-ux.md) | reject | — | reject. Internal app, short nav bar; the multi-pane focus target makes it awkward. |
| `accessibility/prefer-native-html` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 1 | n/a (already enforced), optional fix in `Redacted.tsx`. |
| `accessibility/aria-states` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a (already met). |
| `accessibility/accessible-names` | [a11y-html-ux](audit/a11y-html-ux.md) | adopt | 8 | adopt (fix 8 sites, add selector). |
| `accessibility/descriptions-and-hints` | [a11y-html-ux](audit/a11y-html-ux.md) | adopt | — | adopt. |
| `accessibility/language-titles-iframes` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `accessibility/tab-order-and-focus-management` | [a11y-html-ux](audit/a11y-html-ux.md) | adopt with changes | — | adopt with changes (only `Pre`; skip table wrappers). |
| `accessibility/keyboard-handlers` | [a11y-html-ux](audit/a11y-html-ux.md) | reject | — | reject (one site, one-keystroke difference). |
| `accessibility/focus-indicators` | [a11y-html-ux](audit/a11y-html-ux.md) | adopt | 2 | adopt (2 fixes only). |
| `accessibility/target-sizes` | [a11y-html-ux](audit/a11y-html-ux.md) | adopt with changes | — | adopt with changes (fix the 4 components; add `target-size` to the axe tour; skip a global coarse-pointer sweep). |
| `accessibility/images-alt` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `accessibility/inline-svg` | [a11y-html-ux](audit/a11y-html-ux.md) | reject | — | reject (no benefit shown). |
| `accessibility/complex-images-charts` | [a11y-html-ux](audit/a11y-html-ux.md) | adopt with changes | — | adopt with changes (one paragraph in `views.md` for box agents; judge value separately). |
| `accessibility/audio-video` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `accessibility/css-generated-content` | [a11y-html-ux](audit/a11y-html-ux.md) | reject | — | reject (one decorative theme, an opt-in look). |
| `accessibility/forms-labels-hints` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `accessibility/input-assistance-validation` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `accessibility/live-regions` | [a11y-html-ux](audit/a11y-html-ux.md) | reject | — | reject (benefit is less speech from short, rare messages; our own doc states the opposite). |
| `accessibility/color` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `accessibility/typography` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `accessibility/motion` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `accessibility/modals-native-dialogs` | [a11y-html-ux](audit/a11y-html-ux.md) | adopt with changes | — | adopt with changes (Clerk and PlacePill; leave QuickOpen unless it fails a keyboard check). |
| `accessibility/testing` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `accessibility/accessible-error-announcement` | [a11y-html-ux](audit/a11y-html-ux.md) | reject | — | reject the `:user-invalid` machinery (controlled React forms); take only the `aria-describedby` part via `descriptions-and-hints`. |
| `accessibility/accessible-generated-content` | [a11y-html-ux](audit/a11y-html-ux.md) | reject | — | reject. |
| `accessibility/respect-os-text-scale` | [a11y-html-ux](audit/a11y-html-ux.md) | reject | — | reject. |
| `html/html` | [a11y-html-ux](audit/a11y-html-ux.md) | adopt with changes | — | adopt with changes (only `react/button-has-type` as a guard against a latent bug; leave `<search>` and popover migration to the… |
| `html/accessible-web-components` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `html/custom-elements` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `html/form-associated-custom-elements` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `html/prerendering-custom-elements` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `html/shadow-dom` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `html/styling-web-components` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `html/web-components` | [a11y-html-ux](audit/a11y-html-ux.md) | n/a | 0 | n/a. |
| `user-experience/content-first-noise-reduction` | [a11y-html-ux](audit/a11y-html-ux.md) | reject | 0 | reject. |
| `user-experience/form-factor-adaptation` | [a11y-html-ux](audit/a11y-html-ux.md) | adopt with changes | — | adopt with changes (only the target-size part via `accessibility/target-sizes`; reject container-query and text-wrap sweeps). |
| `user-experience/natural-interactions` | [a11y-html-ux](audit/a11y-html-ux.md) | adopt with changes | 2 | adopt with changes (fix the pin button; leave the rest). |
| `forms/structure` | [forms](audit/forms.md) | adopt with changes | 1 | only the two Enter-handler sites; leave the rest. |
| `forms/labeling-state` | [forms](audit/forms.md) | adopt | 4 | the `aria-describedby` linkage in `FieldShell`/`RadioGroup` is the highest-value item in this category. |
| `forms/autofill-hints` | [forms](audit/forms.md) | adopt with changes | 9 | do the login `username` change and the identifier attributes; skip the rest. |
| `forms/validation` | [forms](audit/forms.md) | reject | 1 | reject the CSS approach (no `:user-invalid`); adopt the clear-on-input tweak only if PasswordSection is touched. |
| `forms/responsive-typography` | [forms](audit/forms.md) | adopt with changes | — | only the zoom fix on ClaudeCodeSection if the admin page is reached on a phone; reject the rest. |
| `forms/styling-controls` | [forms](audit/forms.md) | adopt with changes | 2 | focus-within on radio cards; accent colour via brand-consistent-forms. |
| `forms/js-ajax` | [forms](audit/forms.md) | adopt | 4 | adopt (IME portion only). |
| `forms/identity-security` | [forms](audit/forms.md) | adopt with changes | 2 | reveal toggle on the primitive; skip the second-field and hidden-username items. |
| `forms/address` | [forms](audit/forms.md) | n/a | 0 | n/a. |
| `forms/analytics` | [forms](audit/forms.md) | n/a | 0 | n/a. |
| `forms/multi-page` | [forms](audit/forms.md) | n/a | 0 | n/a. |
| `ime-safe-enter-submit` | [forms](audit/forms.md) | adopt | 4 | four one-line edits plus an optional lint rule. |
| `autofill-address-form` | [forms](audit/forms.md) | n/a | 0 | n/a. |
| `autofill-highlight-inputs` | [forms](audit/forms.md) | n/a | 0 | n/a. (Browser note: `:autofill` Safari 15, Chrome 110, not Firefox.) |
| `autofill-payment-form` | [forms](audit/forms.md) | n/a | 0 | n/a. |
| `autofill-sign-in-form` | [forms](audit/forms.md) | adopt with changes | 1 | the `username` token only. |
| `autofill-sign-up-form` | [forms](audit/forms.md) | adopt with changes | 2 | `username` token only. |
| `animated-select-picker` | [forms](audit/forms.md) | n/a | 0 | n/a. |
| `branded-select-styling` | [forms](audit/forms.md) | reject | — | no visual need, and it would add a Chrome-only style path next to the Safari native one. |
| `custom-select-picker-layouts` | [forms](audit/forms.md) | reject | — | reject. |
| `rich-media-picker` | [forms](audit/forms.md) | n/a | 0 | n/a. |
| `select-menu-interaction` | [forms](audit/forms.md) | reject | 0 | reject. |
| `required-field-feedback` | [forms](audit/forms.md) | reject | 0 | the React-state path covers the same ground; a second `:user-invalid` path would give two error styles. |
| `validate-input-after-interaction` | [forms](audit/forms.md) | reject | 1 | reject (as above); the `aria-describedby` part is adopted under forms/labeling-state. |
| `brand-consistent-forms` | [forms](audit/forms.md) | adopt | 3 | a two-class change that makes the control match the palette. |
| `form-fields-automatically-fit-contents` | [forms](audit/forms.md) | n/a | 0 | already adopted; the iOS 17 no-grow case is a recorded boxholder decision. |
| `slider` | [forms](audit/forms.md) | n/a | 0 | n/a. |
| `switch` | [forms](audit/forms.md) | reject | 0 | the existing role="switch" button works on every client and needs no polyfill. |
| `sms-otp-form` | [forms](audit/forms.md) | n/a | 0 | n/a. |
| `accordion` | [ui-components](audit/ui-components.md) | adopt with changes | 1 | make the 10 `Accordion` sites render `<details>` only if the controlled-open case can stay simple; otherwise keep `Accordion` and drop… |
| `app-menus` | [ui-components](audit/ui-components.md) | n/a | 0 | n/a |
| `breadcrumbs` | [ui-components](audit/ui-components.md) | adopt with changes | 1 | landmark, list and `aria-current` only. |
| `card` | [ui-components](audit/ui-components.md) | n/a | 0 | n/a |
| `carousel` | [ui-components](audit/ui-components.md) | n/a | 0 | n/a |
| `checkbox` | [ui-components](audit/ui-components.md) | adopt | 2 | fix the two sites. |
| `copy-button` | [ui-components](audit/ui-components.md) | adopt with changes | 2 | fix feedback announcement and failure labels only; reject Invoker Commands. |
| `dark-mode-toggle` | [ui-components](audit/ui-components.md) | n/a | 0 | n/a |
| `dialog` | [ui-components](audit/ui-components.md) | adopt with changes | 4 | add the overscroll rule, name or convert the 2 badge popups, migrate the PlacePill overlay and the 2 Chrome-only sites; skip `closedby`. |
| `hovercard` | [ui-components](audit/ui-components.md) | n/a | 0 | n/a |
| `menu` | [ui-components](audit/ui-components.md) | adopt with changes | 2 | take only the keyboard model (script roving, Home/End), reject focusgroup, invoker commands and anchor positioning. |
| `navbar` | [ui-components](audit/ui-components.md) | adopt with changes | 1 | fold into the Dropdown decision: either arrow keys for true menus, or no menu role for link lists. |
| `navigation-drawer` | [ui-components](audit/ui-components.md) | n/a | 0 | n/a |
| `persistent-app-tours` | [ui-components](audit/ui-components.md) | n/a | 0 | n/a |
| `persistent-toast-notifications` | [ui-components](audit/ui-components.md) | adopt with changes | 1 | container label and modal-aware display only; keep `role="alert"`. |
| `progress` | [ui-components](audit/ui-components.md) | adopt with changes | 2 | ChatAttachments only. |
| `progress-ring` | [ui-components](audit/ui-components.md) | n/a | 0 | n/a |
| `scrollspy` | [ui-components](audit/ui-components.md) | n/a | 0 | n/a |
| `spinner` | [ui-components](audit/ui-components.md) | reject | 1 | reject the guide's `<progress>` spinner; adopt the reduced-motion point only. |
| `stack-drill-down` | [ui-components](audit/ui-components.md) | n/a | 0 | n/a |
| `tabs` | [ui-components](audit/ui-components.md) | adopt with changes | 4 | re-role the 4 panel-less sites; leave `TabBar` keyboard code; drop `font-medium` shift if it is visible. |
| `toolbar` | [ui-components](audit/ui-components.md) | n/a | 0 | n/a |
| `2d-panning` | [ui-behaviors](audit/ui-behaviors.md) | adopt with changes | 1 | one-line, optional; low value (spreadsheet cards are rare). |
| `anchor-positioning-tab-underline` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `animate-element-entry-exit` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `animate-to-from-top-layer` | [ui-behaviors](audit/ui-behaviors.md) | reject | 0 | new polish, not a defect; floor lacks `@starting-style`. |
| `carousel-snap-highlights` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `consistent-cross-document-transitions` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `cross-document-transitions` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `custom-button-actions` | [ui-behaviors](audit/ui-behaviors.md) | reject | 0 | reject for beebox (floor); workstreams-app could use it only after QuickOpen becomes a `<dialog>` (see… |
| `declarative-dialog-popover-control` | [ui-behaviors](audit/ui-behaviors.md) | adopt with changes | 3 | workstreams-app now (Chrome only); beebox only the `popover`/`<dialog>` part, never `commandfor`. |
| `directional-navigation-transitions` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `drag-and-drop` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `drag` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `dynamic-sibling-animations` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `dynamic-sort` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `group-element-transitions` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `highlight-text-ranges` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | already adopted. |
| `interactive-content-reveal` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `interest-triggered-action-previews` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `interest-triggered-tooltips` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `light-dismiss-a-dialog` | [ui-behaviors](audit/ui-behaviors.md) | reject | — | duplicate handler path and the fallback must remain. |
| `motion` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | already followed. |
| `move-dom-element-without-losing-state` | [ui-behaviors](audit/ui-behaviors.md) | reject | — | working focus repair exists and Safari lacks the API. |
| `parallax-scroll-effects` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `persistent-top-layer-ui` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `physics-based-easing` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `platform-controls-dismiss-dialog` | [ui-behaviors](audit/ui-behaviors.md) | adopt with changes | — | try `closedby="none"` when `onCancel` is absent; delete the hack only if Chrome stops closing. |
| `prevent-page-scroll-under-modal-dialog` | [ui-behaviors](audit/ui-behaviors.md) | adopt | 3 | cheapest finding in the slice. |
| `same-document-transitions` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `scoped-component-transitions` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `scroll-completion-effects` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | no site waits on a smooth scroll. |
| `scroll-entry-exit-effects` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `scroll-snap-realtime-feedback` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `scroll-snap-state-sync` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `scroll-target-on-load` | [ui-behaviors](audit/ui-behaviors.md) | reject | 0 | every site needs JS anyway. |
| `scrollytelling` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `search-hidden-content` | [ui-behaviors](audit/ui-behaviors.md) | reject | — | value is small for an internal app, and the secrets and form accordions should not expose hidden text to Ctrl+F. |
| `sortable-table` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | would apply if a table gained user sorting. |
| `spatial-navigation` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `swipe-to-remove` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `swipe-to-reveal` | [ui-behaviors](audit/ui-behaviors.md) | n/a | 0 | n/a |
| `animate-to-intrinsic-sizes` | [css-atoms](audit/css-atoms.md) | n/a | 0 | no animate-to-auto pattern exists. Worth reconsidering for workstreams-app (Chrome only) if it gains an expand/collapse animation. |
| `atrule-support-conditionals` | [css-atoms](audit/css-atoms.md) | n/a | 0 | no use. Also would not work on Safari at all, so no use for iOS. |
| `calculate-with-intrinsic-sizes` | [css-atoms](audit/css-atoms.md) | n/a | 0 | no use case. |
| `child-state-based-styling` | [css-atoms](audit/css-atoms.md) | n/a | 0 | already in use; nothing left to convert. |
| `content-based-styling` | [css-atoms](audit/css-atoms.md) | n/a | 0 | no legacy modifier-class pattern left. |
| `css-layout` | [css-atoms](audit/css-atoms.md) | n/a | 0 | general reference, no concrete defect found. |
| `css` | [css-atoms](audit/css-atoms.md) | reject | — | broad architecture advice; the `@layer` migration is a theme-wide rewrite with no failing behavior to justify it. Keep as reference for… |
| `design-token-reactivity` | [css-atoms](audit/css-atoms.md) | reject | 0 | iOS floor lacks it and attribute selectors already do the job. |
| `dynamic-sibling-styling` | [css-atoms](audit/css-atoms.md) | n/a | 0 | no pattern. |
| `fluid-scaling` | [css-atoms](audit/css-atoms.md) | n/a | 0 | the pattern is already in use where it is useful. |
| `individual-transform-properties` | [css-atoms](audit/css-atoms.md) | reject | — | no site where it fixes a bug or removes code; keep for new keyframes. |
| `overflow-clipping-control` | [css-atoms](audit/css-atoms.md) | n/a | 0 | optional tool for the sticky-in-hidden bug class; nothing to convert today. |
| `reduce-style-repetition` | [css-atoms](audit/css-atoms.md) | reject | 0 | no Safari. The guide itself suggests a precompiler for static logic; a custom property holding the formula would remove the duplication… |
| `responsive-design` | [css-atoms](audit/css-atoms.md) | adopt with changes | 3 | swap the 3 page-level `min-h-screen`, optionally ban `h-screen` going forward; leave proportional `vh` caps. |
| `selector-atrule-combinations` | [css-atoms](audit/css-atoms.md) | reject | 0 | no need; iOS floor lacks style queries. |
| `size-aware-styling` | [css-atoms](audit/css-atoms.md) | n/a | 0 | usable per component when a pane-width layout bug appears; no existing defect. |
| `style-parent-with-has` | [css-atoms](audit/css-atoms.md) | reject | 0 | errors do not originate from native validity; swapping would lose app-supplied messages. |
| `usage-aware-component-variations` | [css-atoms](audit/css-atoms.md) | reject | 0 | iOS floor lacks it. |
| `carousel-slide-effects` | [css-atoms](audit/css-atoms.md) | n/a | 0 | no carousel in the app. |
| `component-specific-light-dark-theme` | [css-atoms](audit/css-atoms.md) | adopt with changes | — | audit the dark themes for missing `color-scheme: dark` on bars and menus; do not adopt `light-dark()` (Safari 17.5 and unnecessary). |
| `icons` | [css-atoms](audit/css-atoms.md) | n/a | 0 | current approach matches; no conversion to the CSS icon engine (large refactor, no gain). |
| `position-aware-tooltips` | [css-atoms](audit/css-atoms.md) | n/a | 0 | n/a |
| `pull-to-reveal` | [css-atoms](audit/css-atoms.md) | n/a | 0 | n/a (Chrome 133 only anyway) |
| `responsive-table` | [css-atoms](audit/css-atoms.md) | adopt with changes | 1 | only the missing `overflow-x-auto` wrappers if a phone-width check shows overflow; do not adopt stacked layout. |
| `scroll-position-aware-elements` | [css-atoms](audit/css-atoms.md) | reject | — | Chrome-only; JS covers all clients. |
| `scroll-progress-indicator` | [css-atoms](audit/css-atoms.md) | n/a | 0 | n/a |
| `scrollability-affordance-hints` | [css-atoms](audit/css-atoms.md) | reject | 1 | reject for beebox (iOS floor lacks it; we already have a working JS version). Adopt for workstreams-app only if a hint is wanted. |
| `shrinking-header-on-scroll` | [css-atoms](audit/css-atoms.md) | n/a | 0 | n/a |
| `single-line-overflow` | [css-atoms](audit/css-atoms.md) | n/a | 0 | we already follow the base technique; the advanced reveal/fade parts need Safari 26. |
| `state-aware-sticky-headers` | [css-atoms](audit/css-atoms.md) | n/a | 0 | no stuck-state styling exists. |
| `viewport-aware-dropdowns` | [css-atoms](audit/css-atoms.md) | reject | 1 | iOS floor lacks anchor positioning, and the JS version handles the on-screen keyboard case. Revisit when the iOS deployment target… |
| `adapt-scrollbar-to-contrast-preferences` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `apply-webgl-shaders` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `browser-ui-theming` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | nothing to change; the colour-scheme point is covered under dark-mode. |
| `color` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | no concrete site found. |
| `complex-shapes` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `contrast-color` | [visual-js-pwa](audit/visual-js-pwa.md) | reject | — | the iOS floor lacks it, and symbols already carry a foreground default. |
| `custom-text-decorations` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | nothing to change. |
| `customize-scrollbar-color-and-thickness` | [visual-js-pwa](audit/visual-js-pwa.md) | reject | 0 | no site needs it. |
| `dark-mode` | [visual-js-pwa](audit/visual-js-pwa.md) | adopt with changes | 2 | add `color-scheme: dark` on dark chrome roots only; skip OS-following `prefers-color-scheme` and `light-dark()`, which conflict with the… |
| `equal-width-text-lines` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `export-html-media-from-canvas` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `expose-canvas-content-to-browser-features` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `improve-text-layout-and-legibility` | [visual-js-pwa](audit/visual-js-pwa.md) | adopt with changes | — | `balance` on `Heading`; judge `pretty` after a visual check. |
| `interactive-content-in-3d-scenes` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `precise-text-alignment` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `shaped-cutouts` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `soft-edge-content-fade` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | already adopted. |
| `typography` | [visual-js-pwa](audit/visual-js-pwa.md) | adopt with changes | — | only if the boxholder wants browser font-size honoured; the app is internal and `frontend.md` says not to optimize without measurement.… |
| `visual-effects` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | stylistic guidance, no failure to fix. |
| `visually-stable-font-fallbacks` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `visually-stable-mixed-fonts` | [visual-js-pwa](audit/visual-js-pwa.md) | adopt with changes | — | try `font-size-adjust: from-font` on `.prose`; keep only if it visibly evens out inline code. |
| `visually-texture-content` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `calculate-event-differentials` | [visual-js-pwa](audit/visual-js-pwa.md) | reject | 0 | fixed-length units need no zone logic, and a polyfill adds weight for no behaviour change. |
| `capture-location-agnostic-data` | [visual-js-pwa](audit/visual-js-pwa.md) | reject | — | revisit when Safari ships Temporal. Possible small win without Temporal: put the `.toISOString().slice(0, 10)` pattern (3 sites) behind… |
| `coordinate-global-events` | [visual-js-pwa](audit/visual-js-pwa.md) | reject | 0 | no zone-converting scheduler in the frontend; box-timezone logic lives on the server. |
| `sort-high-precision-timestamps` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `support-global-calendar-systems` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `install-web-app` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | a product decision about an install button, not a code finding. |
| `migrate-web-app-origin` | [visual-js-pwa](audit/visual-js-pwa.md) | n/a | 0 | n/a |
| `privacy` | [visual-js-pwa](audit/visual-js-pwa.md) | adopt with changes | 3 | add the two headers after checking the security report; skip PEPC `<permission>` (Chrome-only), FedCM, CHIPS, and Clear-Site-Data (no… |
| `batch-analytics-events` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `break-up-long-tasks` | [performance](audit/performance.md) | reject | — | no measured long task; revisit if `perf:load` reports one. |
| `calculate-total-foreground-time` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `conditional-async-dependencies` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `defer-rendering-heavy-content` | [performance](audit/performance.md) | reject | 0 | for chat (explicitly deferred) and for lists until a measured large directory is slow. If a large-directory slowdown is reported, adopt… |
| `defer-work-until-scroll-ends` | [performance](audit/performance.md) | reject | 0 | the one debounce runs a cosmetic flag, and iOS needs the old path. |
| `deliver-optimized-decorative-images` | [performance](audit/performance.md) | reject | 0 | no measured theme-art load cost. |
| `deprioritize-background-fetches` | [performance](audit/performance.md) | reject | 0 | same-origin polls of tiny payloads do not compete in a way anyone measured. |
| `detect-initial-visibility-state` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `efficient-background-processing` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `faster-spa-view-transitions` | [performance](audit/performance.md) | reject | — | no reported slow tab switch and iOS cannot use it. Candidate if card switching is measured slow on desktop. |
| `flicker-free-client-side-ab-testing` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `full-session-analytics` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `identify-heavy-scripts` | [performance](audit/performance.md) | adopt with changes | — | dev harness only, and only when a long task needs attribution. |
| `identify-inp-causes` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `improve-next-page-load-performance` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `interaction-paint-timing` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `interactions-in-complex-layouts` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `lazy-load-video-and-audio` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `optimize-image-priority` | [performance](audit/performance.md) | adopt with changes | 3 | `loading="lazy"` on card-body images and in the box-docs line; `fetchpriority="low"` on lightbox peers; leave chat images eager. |
| `optimize-preload-priority` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `optimize-script-priority` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `out-of-order-html-streaming` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `performance` | [performance](audit/performance.md) | reject | — | reject as a policy document; its concrete items are covered by the guides above. Do not copy into `frontend.md`. |
| `resolution-optimized-pseudo-elements` | [performance](audit/performance.md) | n/a | 0 | n/a |
| `schedule-tasks-by-priority` | [performance](audit/performance.md) | reject | — | would add a CDN script load and fight the CSP for no measured gain. |
| `security` | [security-misc](audit/security-misc.md) | adopt with changes | 4 | add enforced `frame-ancestors`+`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (camera/mic needed for capture: allow self),… |
| `sanitize-untrusted-html` | [security-misc](audit/security-misc.md) | reject | 0 | no untrusted-HTML sink exists, and Safari lacks the API. |
| `trusted-types` | [security-misc](audit/security-misc.md) | adopt with changes | — | add it to Report-Only only, as a cheap measurement. Do not enforce yet. |
| `validate-origins` | [security-misc](audit/security-misc.md) | reject | 0 | no gain over current checks, and not available on the iOS floor. |
| `secure-external-subresources` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a for SRI; adopt the one attribute under `security`. |
| `restrict-outbound-connections` | [security-misc](audit/security-misc.md) | reject | — | wait until CSP enforces and the header reaches Safari. |
| `local-network-access` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. |
| `passkeys` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. |
| `passkey-registration` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. |
| `passkey-authentication` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. |
| `passkey-management` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. |
| `passkey-reauthentication` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. |
| `passkey-conditional-create` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. |
| `quick-sign-ins` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. |
| `verify-email-ownership` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. |
| `client-side-encryption` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. |
| `digital-signatures` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. |
| `language-detection, language-model, prompt-api, summarizer, translator` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. (prompt-api.md and language-model.md are the same file content.) |
| `cpp-on-the-web` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. |
| `webmcp, agentic-forms, agentic-javascript-tools` | [security-misc](audit/security-misc.md) | n/a | 0 | n/a. |
