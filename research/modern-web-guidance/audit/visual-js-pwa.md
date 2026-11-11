# Audit: visual-design, js, pwa, privacy

## Slice summary
- 27 guides read. Real findings in 5: dark-mode (partly), typography (partly), improve-text-layout-and-legibility, privacy (partly), and the Temporal date guides (code works today; see below).
- Static scan hit `beebox/src/frontend/index.html:91` (`@media (prefers-color-scheme: dark)`). It is only the boot fallback ("Starting your box..."), not app dark mode. The app is light by default; dark comes from user-chosen system themes (`appearance: "dark"` in `beebox/src/shared/card-theme/catalog.ts`), not from the OS setting.
- Most valuable fix: dark system themes (deck, night-atlas, tempest, gilt, phosphor, ...) set `color-scheme: dark` only on cards and the composer, not on `.bbx-box-presentation[data-chrome-theme=...]`. Desk scrollbars and unstyled controls in chrome likely stay light. Needs a browser check.
- Second: `text-wrap: balance` on `Heading.tsx` (one primitive, 52 other raw `<h*>` sites). Safari 17.0 ignores it harmlessly.
- Third: privacy headers. No global `Referrer-Policy` or `Permissions-Policy` found; only per-route (`invite.ts:34`, `password-reset.ts:35`).
- Temporal guides: Safari has no Temporal; a 15 KB polyfill would be needed. Existing `Date` workarounds are correct and tested in place. Lean reject for now.
- PWA guides: no install button, no origin move. n/a.
- Scrollbar, canvas/HTML-in-canvas, masking, texture, shapes, font-fallback guides: no real sites.

### adapt-scrollbar-to-contrast-preferences
- Asks: add a `prefers-contrast: more` block with stark `scrollbar-color` when scrollbars are customized.
- Applies here: no — the app never sets `scrollbar-color` (grep of `frontend/src` finds only `scrollbar-width: none` at `themes/interface.css:16` for a hidden tab-strip bar). `index.css:23` records a deliberate choice to avoid `::-webkit-scrollbar`.
- Lean: n/a

### apply-webgl-shaders
- Asks: apply WebGL shaders to HTML via the HTML-in-Canvas API.
- Applies here: no — no WebGL; the API is Chrome-only and experimental (`'content' in HTMLCanvasElement.prototype`).
- Lean: n/a

### browser-ui-theming
- Asks: theme native UI (selection, scrollbars, form controls) with CSS before rebuilding it; do not set `user-select: none` on content text.
- Applies here: partly — themes already use `--bbx-selection` and `::selection` style variables; `select-none` appears at 6 sites.
- Findings: 6 candidate sites (`select-none` / `user-select: none`); 0 checked as real. Not read one by one; they are expected on chrome (tabs, handles). A reviewer should spot-check with `grep -rn "select-none" beebox/src/frontend/src`.
- Our guidance: silent
- Fix size: none unless a content site is found.
- Lint-able: baselined scan (needs judgment on chrome vs content)
- Browser: Baseline widely available for the properties used.
- Lean: n/a — nothing to change; the colour-scheme point is covered under dark-mode.

### color
- Asks: never mark state by colour alone; use icon or text (WCAG 1.4.1). Also covers contrast and `forced-colors`.
- Applies here: partly — `ErrorText.tsx` exists as the error primitive; `prefers-contrast` and `forced-colors` appear nowhere in `frontend/src`.
- Findings: 0 verified real. Colour-only state sites cannot be found by grep; needs a visual pass.
- Our guidance: agrees — `beebox/frontend.md` and the jsx-a11y preset cover naming, not colour-only state.
- Fix size: n/a
- Lint-able: no (no static footprint)
- Browser: n/a
- Lean: n/a — no concrete site found.

### complex-shapes
- Asks: use `mask-image` for free-form clips.
- Applies here: no — `mask-image` already used (`index.css:28`, `.bbx-scroll-fade-bottom`; themes use SVG cutouts). Nothing to migrate.
- Lean: n/a

### contrast-color
- Asks: use `contrast-color(var(--bg))` for text on variable backgrounds.
- Applies here: partly — card `symbol:` takes author `background:`/`foreground:` colours (`beebox/docs/box/card-themes.md`), so text on a variable background exists. The guide's function applies only if foreground is omitted.
- Findings: 1 candidate (symbol rendering with author background and no foreground); not traced to code.
- Our guidance: silent
- Fix size: one component plus CSS; low risk; verify with `bin/theme-check` and `browse`.
- Lint-able: no
- Browser: Baseline newly available (2026-04-10); Chrome 147, Firefox 146, Safari 26. Not in Safari 17.0; the fallback is the current explicit colour.
- Lean: reject — the iOS floor lacks it, and symbols already carry a foreground default.

### custom-text-decorations
- Asks: use native `text-decoration` properties (offset, thickness, skip-ink) instead of borders/gradients; use real `<a href>`.
- Applies here: partly — 28 sites use `decoration-` / `underline-offset` or `text-decoration-*` utilities; no `href="javascript:"` or `href="#"` sites found.
- Findings: 0 faked underlines found with `border-b` on text in the 28-site sample.
- Our guidance: silent
- Fix size: none found.
- Lint-able: baselined scan
- Browser: `text-decoration-skip-ink: all` Baseline newly available 2026-05-07; Safari 15.4+. Other properties in the guide are Chrome-only.
- Lean: n/a — nothing to change.

### customize-scrollbar-color-and-thickness
- Asks: use `scrollbar-color` and `scrollbar-width` on scroll containers; thumb needs 3:1 contrast.
- Applies here: partly — the app has 31 `overflow-auto/y-auto` sites on the default scrollbar; dark chrome themes may show light scrollbars (see dark-mode).
- Findings: 0 real; theme fix is `color-scheme`, not `scrollbar-color`.
- Our guidance: agrees — `index.css:23` rejects webkit scrollbar styling because it disables macOS overlay scrollbars.
- Fix size: n/a
- Lint-able: eslint/stylelint could flag `::-webkit-scrollbar` (1 hit, `themes/interface.css:21`, paired with `scrollbar-width: none`; fine).
- Browser: `scrollbar-width` Baseline since 2024-12 (Safari 18.2); `scrollbar-color` Baseline since 2025-12 (Safari 26.2). Neither works on Safari 17.0.
- Lean: reject — no site needs it.

### dark-mode
- Asks: declare `color-scheme` (meta tag and CSS) so the browser themes native UI; use `light-dark()` and `prefers-color-scheme`.
- Applies here: partly — the app does not follow the OS setting by design; users choose system themes, six of which are dark (`catalog.ts`, `appearance: "dark"`).
- Findings: 3 candidates; 2 real.
  - `beebox/src/frontend/index.html:91` `@media (prefers-color-scheme: dark) {` — not real for app dark mode. It styles only `#root .app-boot`, which React replaces on mount. Adequate for a boot message.
  - `beebox/src/frontend/index.html:1-12` no `<meta name="color-scheme">` and no `html { color-scheme }` in `index.css` — real but minor: the app is light-only at the root, which is the browser default.
  - `themes/deck.css:191` `color-scheme: dark;` scoped to `.bbx-card-theme[data-card-theme="deck"]`, and `deck.css:257` to `.bbx-composer-material` — real gap: no `color-scheme: dark` on `.bbx-box-presentation[data-chrome-theme="deck"]` (`deck.css:2`, `--bbx-desk-background: #242925`). Same shape in `night-atlas.css:2`, `tempest.css:10`, `gilt.css:15`, `phosphor.css:2` (`background:...#020b05`). Desk-level scrollbars, autofill, and unstyled form controls in those themes keep light styling. Not confirmed in a browser.
  - `src/components/ui/fields/shell.tsx:10` `[color-scheme:light]` on inputs — correct (inputs sit on white).
- Our guidance: silent on page-level `color-scheme`; `beebox/docs/box/card-themes.md` defines themes but not native-UI scheme.
- Fix size: 5-6 theme CSS files, one declaration each (or one rule keyed off the appearance in `BoxPresentationProvider.tsx`); low risk; verify with `browse` on each dark theme (scroll a long list, open a select) and `bin/theme-check`.
- Lint-able: baselined scan (a check that every dark system theme's chrome root sets `color-scheme: dark`; could use the `appearance` field in `catalog.ts`).
- Browser: `color-scheme` Baseline widely available (Safari 13). `light-dark()` Baseline since 2024-05 (Safari 17.5; not 17.0).
- Lean: adopt with changes — add `color-scheme: dark` on dark chrome roots only; skip OS-following `prefers-color-scheme` and `light-dark()`, which conflict with the themes system.

### equal-width-text-lines
- Asks: use `text-fit` for poster-style lines that fill the container width.
- Applies here: no — no such typography; `text-fit` is Chrome 133+ and Safari 18.2 for the base form.
- Lean: n/a

### export-html-media-from-canvas
- Asks: capture HTML to image/video with the HTML-in-Canvas API instead of third-party libraries.
- Applies here: no — `components/chat/screenshot-capture.ts` uses `getDisplayMedia` with current-tab hints, not DOM-to-canvas libraries. The API is experimental.
- Lean: n/a

### expose-canvas-content-to-browser-features
- Asks: use `content="drawable"` so canvas content is accessible/findable.
- Applies here: no — canvases (`lib/camera.ts`, `lib/image-paste.ts`, `copy-file-to-clipboard.ts`) are image processing, not visible UI.
- Lean: n/a

### improve-text-layout-and-legibility
- Asks: `text-wrap: balance` on short headings; `text-wrap: pretty` on body text.
- Applies here: yes — no `text-wrap`, `text-balance`, or `text-pretty` anywhere in `frontend/src` (Tailwind 3.4 ships both utilities).
- Findings: 2 sites to change, both real.
  - `components/ui/Heading.tsx:19` `cn("text-lg font-semibold", color, className)` — add `text-balance` for the `h2`/`h3` primitive.
  - 52 raw `<h1>`-`<h6>` elements outside `Heading` (not checked individually).
  - Prose body: `.prose` / `.bbx-paragraph` (`index.css:44`) could take `text-wrap: pretty`.
- Our guidance: silent
- Fix size: 1 primitive file, 1 CSS rule; low risk. Pretty changes line breaks in prose, so verify with `browse` at phone width and `bin/theme-check` for layout shifts.
- Lint-able: baselined scan (raw `<h2>` outside `Heading`).
- Browser: `balance` Baseline newly available (Safari 17.5; Safari 17.0 ignores it, no breakage). `pretty` Chrome 117, Safari 26; Firefox none. Both degrade silently.
- Lean: adopt with changes — `balance` on `Heading`; judge `pretty` after a visual check.

### interactive-content-in-3d-scenes
- Asks: HTML-in-Canvas inside WebGL/WebGPU scenes.
- Applies here: no — no 3D.
- Lean: n/a

### precise-text-alignment
- Asks: use `text-box-trim` / `text-box-edge` to remove ghost space for icon/text alignment.
- Applies here: no — no `text-box` use; alignment is handled with flex.
- Browser: Chrome 133, Safari 18.2; Firefox none; not Safari 17.0.
- Lean: n/a

### shaped-cutouts
- Asks: mask a notch out of a card with adjacent-element SVG masking so text stays readable.
- Applies here: no — themes already ship SVG cutouts (`themes/bloom-cutouts.svg`, `deck-panels.svg`); nothing to change.
- Lean: n/a

### soft-edge-content-fade
- Asks: fade container edges with `mask-image` gradients.
- Applies here: yes, already done — `index.css:28` `-webkit-mask-image: linear-gradient(to bottom, black calc(100% - 16px), transparent);` in `.bbx-scroll-fade-bottom`.
- Our guidance: agrees — the comment at `index.css:21` states the same reasoning.
- Lean: n/a — already adopted.

### typography
- Asks: no `px` font sizes (use `rem`); no fixed `height` on text containers; unitless `line-height`; cap line length; `overflow-wrap` for URLs.
- Applies here: partly — `px` font sizes are used heavily; Tailwind's `text-xs/sm/base` are `rem`, so only arbitrary values are the issue.
- Findings: 66 candidates; ~66 literal, real impact unclear.
  - 40 sites `text-[Npx]`, e.g. `components/DebugLog.tsx:241` `text-[11px] leading-tight`, `components/ui/JsonView.tsx:19` `font-mono text-[11px] leading-snug`, `components/ui/Avatar.tsx:7` `w-6 h-6 text-[10px]`, `components/SourceViewOverlay.tsx:277` `text-[10px]`.
  - 26 sites `font-size: Npx` in CSS, e.g. `index.css:193` `font-size: 15px;`, `index.css:213` `14px`, `index.css:233` `28px`, `index.css:265` `20px`.
  - Fixed heights with text: `Avatar.tsx:7-9` `w-6 h-6` (initials inside) — likely real clip risk under increased text size; `ExternalIconLink.tsx:23`, `CloseButton.tsx:36` `w-7 h-7` hold icons only (not real).
- Our guidance: silent — `beebox/frontend.md` does not state a font-size unit rule.
- Fix size: mechanical conversion `text-[11px]` -> `text-[0.6875rem]` across ~66 sites; low risk but many files; verify with `browse` and the iOS app (Dynamic Type is not applied in WKWebView by `rem` alone, so benefit is on desktop browsers with a changed default size).
- Lint-able: eslint (a Tailwind-class rule flagging `text-\[\d+(\.\d+)?px\]`) plus stylelint for CSS `font-size: Npx`.
- Browser: Baseline widely available.
- Lean: adopt with changes — only if the boxholder wants browser font-size honoured; the app is internal and `frontend.md` says not to optimize without measurement. Fix the `Avatar` fixed height if it ever clips.

### visual-effects
- Asks: layered shadows, `drop-shadow()` for non-rectangular shapes, blend modes with `isolation: isolate`.
- Applies here: partly — blend modes and `drop-shadow` appear in `themes/posy.css`, `themes/chrome.css`, `themes/phosphor.css`; no check of `isolation: isolate` was made.
- Findings: 0 real found; not traced.
- Lean: n/a — stylistic guidance, no failure to fix.

### visually-stable-font-fallbacks
- Asks: use `font-size-adjust: from-font` to match fallback and web-font x-height.
- Applies here: no — no `@font-face` or web font loading in `frontend/src` or `index.html`; themes name system/local stacks (e.g. phosphor `"IBM Plex Mono","SFMono-Regular",Consolas,monospace`).
- Browser: Baseline newly available (2024-07); Safari 17 supports it.
- Lean: n/a

### visually-stable-mixed-fonts
- Asks: use `font-size-adjust` when mixing font families (inline code, themes with different fonts).
- Applies here: partly — themes swap font families per theme (phosphor sets a monospace stack on the whole chrome; `.prose code` mixes monospace into body text). No `font-size-adjust` anywhere.
- Findings: 2 candidates: `.prose` inline `code` and `[data-chrome-theme="phosphor"]` (`themes/phosphor.css:5`). Real effect unverified.
- Our guidance: silent
- Fix size: one CSS rule on `.prose` (and perhaps `bbx-card-theme`); low risk; verify with `bin/theme-check` and `browse`.
- Lint-able: no
- Browser: Baseline newly available (Safari 17.0 supports it).
- Lean: adopt with changes — try `font-size-adjust: from-font` on `.prose`; keep only if it visibly evens out inline code.

### visually-texture-content
- Asks: texture an element with `mask-image` and a repeating image.
- Applies here: no — themes use background images (`.webp` textures, `stock-textures.css`) on paper, not masks over content, by design.
- Lean: n/a

### calculate-event-differentials
- Asks: use `Temporal.ZonedDateTime.since/until`, `Temporal.Duration`, and `Intl.DurationFormat` for elapsed/remaining time.
- Applies here: partly — hand-rolled helpers exist: `formatAgoMs`, `formatAgo`, `formatDuration` in `beebox/src/shared/relative-time.ts` ("3m ago", "2h ago", "1h 5m"), used by `lib/relative-time.ts` and `chat/everywhere/InteractiveChat/dispatch.ts:64`.
- Findings: 4 sites; 0 real. The helpers are English, compact, whole-unit, and shared with the CLI and health checks (Node). Switching changes output text; `Intl.DurationFormat` and Temporal change locale behaviour. Also `InteractiveChat-controls.tsx:25` `new Date(schedule.firesAt).getTime() - boxNow()` is a plain ms difference, correct.
- Our guidance: agrees — `relative-time.ts` header says one style for web, CLI, and health checks.
- Fix size: n/a
- Lint-able: no
- Browser: Temporal limited availability — Chrome 144, Firefox 139, no Safari. `Intl.DurationFormat` is not in Safari 17.0 either. Needs a ~15 KB polyfill.
- Lean: reject — fixed-length units need no zone logic, and a polyfill adds weight for no behaviour change.

### capture-location-agnostic-data
- Asks: use `Temporal.PlainDate`/`PlainTime` for dates that do not depend on a zone (due dates, birthdays).
- Applies here: yes — todo `due`/`start`/`recheck` are plain dates (`YYYY-MM-DD`), and the code works around `Date`'s UTC parse in several places.
- Findings: 7 sites; 0 are bugs, all are workarounds that are correct today.
  - `components/ui/FriendlyDate.tsx:24` `if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { dateStyle: "medium", timeZone: "UTC" };`
  - `components/todo/item-logic.ts:90` `new Date(epoch).toLocaleDateString(locale, {... timeZone: "UTC"})`
  - `components/todo/item-logic.ts:159` `new Date(best.epoch).toISOString().slice(0, 10)` (also `:184`)
  - `components/todo-view-card-logic.ts:284` `new Date(epoch).toISOString().slice(0, 10)`
  - `components/todo/item-logic.ts:127` `localIsoDate` builds `YYYY-MM-DD` from getters.
  - `components/CalendarView/view.tsx:64` `return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);` for all-day events.
- Our guidance: agrees — `FriendlyDate.tsx` comment documents the UTC rule and the bug it prevents.
- Fix size: ~6 files if replaced; moderate risk; unit tests for these helpers exist in package. Verify with unit tests in a non-UTC `TZ`.
- Lint-able: baselined scan (`.toISOString().slice(0, 10)` pattern).
- Browser: Temporal limited availability; Safari none; polyfill ~15 KB.
- Lean: reject for now — revisit when Safari ships Temporal. Possible small win without Temporal: put the `.toISOString().slice(0, 10)` pattern (3 sites) behind one named helper.

### coordinate-global-events
- Asks: build a `ZonedDateTime` with an explicit `disambiguation` option for DST gaps and overlaps.
- Applies here: partly — `CalendarView/view.tsx:32-35` `from.setHours(0, 0, 0, 0); to.setDate(to.getDate() + DAYS_SHOWN);` computes day windows in the viewer's zone. `setDate` is DST-safe for day arithmetic.
- Findings: 1 site; 0 real. Event times come as ISO instants from the server and display with `toLocale*String`.
- Our guidance: silent
- Fix size: n/a
- Lint-able: no
- Browser: as above; no Safari.
- Lean: reject — no zone-converting scheduler in the frontend; box-timezone logic lives on the server.

### sort-high-precision-timestamps
- Asks: parse nanosecond ISO timestamps with `Temporal.Instant` so sub-millisecond order survives.
- Applies here: no — timestamps are produced by `new Date().toISOString()` (millisecond precision) in the frontend and `Date.parse` for reading (`lib/relative-time.ts`, `RecentActivity.tsx:130`). No source with nanosecond stamps was found in the frontend.
- Our guidance: silent
- Lint-able: no
- Browser: no Safari.
- Lean: n/a

### support-global-calendar-systems
- Asks: use Temporal calendars (`withCalendar`, `monthCode`) for Hebrew/Islamic/Chinese calendar UI.
- Applies here: no — no non-Gregorian calendar UI; `toLocale*String(undefined, ...)` already honours the browser locale's calendar.
- Lean: n/a

### install-web-app
- Asks: offer an in-page install button through `<install>` / `navigator.install()` or `beforeinstallprompt`, hidden where unsupported.
- Applies here: no — no install affordance exists (`grep beforeinstallprompt` finds nothing). The manifest (`frontend/public/manifest.webmanifest`: `display: standalone`, 192/512 icons, `start_url: "./"`) and per-box manifest (`webapp/routes/box-identity-assets.ts:86`) exist; the iOS app is the native route. `public/sw.js` is push-only (95 lines, no fetch handler), which is the guide's supported-install path through Chromium only if a fetch handler were required (not now).
- Browser: `<install>` is not natively supported by any major browser yet. `beforeinstallprompt` is Chromium only.
- Lean: n/a — a product decision about an install button, not a code finding.

### migrate-web-app-origin
- Asks: move an installed PWA to a new origin with predecessor/successor claims in the manifest.
- Applies here: no — per-box manifests live under one origin (`/<slug>` prefixes). No planned origin change was found in `issues/` (doc mentions in `beebox/docs/publishing.md` and `plans/publish-shared-host-per-box.md` concern publishing hosts, not the app origin; not read in detail).
- Browser: Chrome 149 and Edge 149 only; no Safari.
- Lean: n/a

### privacy
- Asks: minimize data, no secrets in `localStorage`, `HttpOnly` cookies, `Clear-Site-Data` on logout, strict `Referrer-Policy`, restrictive `Permissions-Policy`, feature detection over UA sniffing, façade pattern for embeds, `youtube-nocookie.com`.
- Applies here: partly — auth, embeds, and headers all exist.
- Findings: 8 candidates; 3 real.
  - Cookies: `webapp/routes/auth/password-post.ts:161` `httpOnly: true`, `:163` `sameSite: "lax"`; `webapp/routes/auth/google.ts:124`, `webapp/mobile-cookie.ts:44` — not real (already follow the guide).
  - Embeds: `lib/video-url.ts:70` `https://www.youtube-nocookie.com/embed/${id}`; `components/ui/VideoEmbed.tsx` uses `loading="lazy"`; `lib/csp.ts:40` `frame-src ... youtube-nocookie.com` — not real. Façade (thumbnail first, load iframe on click) is absent; lazy loading still fetches YouTube when scrolled near. Real, minor.
  - `frontend/src/lib/mobile-auth.ts:5` `window.localStorage.getItem(MOBILE_AUTH_TOKEN_STORAGE_KEY)` — a bearer token in `localStorage` (WKWebView only, set by `ios-app/BeeBox/Views/ChatWebView.swift`). Real by the guide's rule; the web app's own cookies are `httpOnly`. The token lives in an in-app WebView of a native app; a change is an iOS contract question (`bbx-ios-overlap`), not a web fix.
  - Headers: `Referrer-Policy` is set only at `webapp/routes/auth/invite.ts:34`, `password-reset.ts:35`, `routes/browser/proxy/route.ts:242`; `Permissions-Policy` and `Clear-Site-Data` appear nowhere in `beebox/src`. Real gap: no global `Referrer-Policy`. The CSP is already global (`webapp/server/app.ts:152` area). Camera and microphone are used by capture, so a policy would need `camera=(self), microphone=(self)`.
  - UA sniffing: `frontend/src/lib/push-support.ts:21` `/iP(ad|hone|od)/.test(navigator.userAgent)` — a platform check for push support, with a display-mode check beside it; acceptable. `hooks/useBrowserPush.ts:76` `ua: navigator.userAgent` sends the UA string to the server with a push subscription — a data-minimization candidate (what is it used for?), not checked server-side.
  - `Avatar.tsx:55` `referrerPolicy="no-referrer"` — not real (already strict).
  - `enumerateDevices` at `lib/camera.ts:17`, `lib/audio/recorder.ts:40`, `useCaptureDevices.ts:28` — device pickers, not fingerprinting; not real.
- Our guidance: silent; `beebox/docs/` has a security report (skill `security-report`) that likely covers headers; not read.
- Fix size: global `Referrer-Policy: strict-origin-when-cross-origin` and `Permissions-Policy` in the same hook as the CSP (`webapp/server/`), 1-2 files; low-moderate risk (Permissions-Policy can break capture or the iOS WebView if wrong); verify with a header test plus `bin/tour`/`browse` through capture.
- Lint-able: baselined scan (header presence) — no static footprint in client code.
- Browser: headers are server-side; `Permissions-Policy` and `Referrer-Policy` work on Safari 17.0.
- Lean: adopt with changes — add the two headers after checking the security report; skip PEPC `<permission>` (Chrome-only), FedCM, CHIPS, and Clear-Site-Data (no third-party embedding of the app; cookie and token flow is already handled elsewhere).
