# Audit: category `performance` (26 guides)

## Slice summary

- Weighed against `beebox/frontend.md:5`: "Do not optimize before a measurement shows something is slow." Most of this category is analytics, field measurement, or public-site load tuning. None of that has a footprint here (no analytics, no web-vitals, one `<script type="module">` in `index.html`, no web fonts, no `@import`, no preload hints beyond one `as="fetch"`).
- No `content-visibility`, `contain-intrinsic-size`, `fetchpriority`, `scrollend`, `scheduler.*`, `fetchLater`, `sendBeacon`, or speculation rules anywhere in `beebox/src/frontend/src`, `schemas`, `plugins`, `workstreams-app`, or `beebox-clerk`.
- Guides with a real site: `defer-rendering-heavy-content` / `interactions-in-complex-layouts` (chat transcript, deliberately deferred in `chat-scroll-redesign.md:262`; browse lists have no measurement), `faster-spa-view-transitions` (1 real site: `WorkspaceCanvas` hides cached cards with `display:none`), `optimize-image-priority` (3 small real sites), `identify-heavy-scripts` / `identify-inp-causes` (dev harness only).
- Most valuable fixes, all small and none urgent:
  1. Add `loading="lazy"` to the card-body images in `components/Markdown/body.tsx:96` and add one line to `box-docs/views.md:231` telling box agents to put `loading="lazy"` on grid images. Free, Baseline. Keep chat images eager.
  2. Add `fetchpriority="low"` to the lightbox swipe peers (`ImageLightbox.tsx:288`). Free; ignored on Safari 17.0 to 17.1.
  3. Swap `display:none` for `content-visibility:hidden` on cached workspace cards only after `bin/perf`-style evidence of a slow tab switch. Safari 26 only, so iOS gets no change.
- Everything else: n/a or reject. Eight guides need a browser API that is Chrome-only or Chrome-very-new (Chrome 135 to 151) and have no consumer here.

---

### batch-analytics-events
- Asks: Batch analytics events with `fetchLater()` and `activateAfter`.
- Applies here: no — the frontend sends no analytics or telemetry (`grep analytics|web-vitals|gtag` finds only an admin settings label in `components/admin/AgentEngineSection/view.tsx`).
- Lean: n/a

### break-up-long-tasks
- Asks: Yield with `scheduler.yield()` (setTimeout fallback) in loops longer than 50 ms.
- Applies here: partly — only if a long task exists; none is documented.
- Findings: 0 candidate sites found. No loop over a large array runs on the main thread in a user path that anyone has measured. React rendering is not yieldable this way.
- Our guidance: agrees — `frontend.md:5` says measure first. `beebox/src/dev/perf/load/page-metrics.ts` already records `longtask` entries in `bin`-driven runs (`perf:load`), so a site would show up there.
- Fix size: none until a long task is measured.
- Lint-able: no (no static footprint).
- Browser: Limited availability; Chrome 129, Firefox 142, not Safari. The `setTimeout` fallback is what iOS would run.
- Lean: reject — no measured long task; revisit if `perf:load` reports one.

### calculate-total-foreground-time
- Asks: Compute foreground time from `visibility-state` performance entries.
- Applies here: no — engagement metrics are not collected.
- Lean: n/a

### conditional-async-dependencies
- Asks: Use top-level `await` in a module to load a polyfill only when the feature is missing.
- Applies here: no — we ship no runtime polyfills. `types/text-fragments-polyfill.d.ts` and `lib/selection/quote-anchor.ts` match "polyfill" only in naming. `main/app.tsx:65` already uses `await import("../file-types/builtins.js")` inside a function, and `bootPreloadPlugin` preloads that chunk.
- Browser: top-level await is Baseline 2026-09-14, Safari 27 only. Safari 17.0 cannot use it unbundled; Vite would down-level or reject it depending on `build.target`.
- Lean: n/a

### defer-rendering-heavy-content
- Asks: Put `content-visibility: auto` plus `contain-intrinsic-size` on large below-the-fold blocks; `content-visibility: hidden` on cached hidden views.
- Applies here: partly — we have three long-list surfaces and one hidden-view cache. None has a measurement showing slowness.
- Findings: 4 candidate surfaces; 0 real without measurement.
  - Chat transcript, `components/chat/ChatMessages/view.tsx` — not real. `components/chat/AGENTS.md` ("The message list is not virtualized") and `docs/implemented-plans/chat-scroll-redesign.md:262` ("`content-visibility:auto` is DEFERRED … introduces scrollbar-estimate wobble. Revisit only if profiling on a fully-loaded thread shows jank"). The scroll controller measures `scrollHeight`, anchors a text character, and runs a `ResizeObserver` on content; estimated placeholder heights would feed it wrong geometry. Window is bounded by `HISTORY_TAIL = 200` (`machines/chat-types.ts:66`) plus 40 per page.
  - `directory-listing.tsx:162` `{cards.map((card) => (<CardAccordion` and `pages/browse/components/BrowseSidebarBody/BrowseSidebarList.tsx:261-263` — not shown real. Rows are small and every entry renders. A directory of thousands of cards could be slow, but no issue or measurement says so. Would need `contain-intrinsic-size` per row type (accordion rows change height when opened).
  - `pages/AdminPage.tsx:120` `hidden={tab !== open}` tab panels — not real. Panels are small and rendered once.
  - `WorkspaceCanvas/view.tsx:52` hidden cards — see `faster-spa-view-transitions`.
- Our guidance: conflicts for the chat (explicit deferral); silent elsewhere. `frontend.md:5` says measure first.
- Fix size: for browse lists, one CSS class on the row wrapper, intrinsic size from row height (2 files). Risk: scrollbar wobble, find-in-page and keyboard focus into skipped rows. Verify with `bin/browse` at phone width on a synthetic 2000-card directory, with a `perf:load`-style long-task measure before and after.
- Lint-able: no.
- Browser: Baseline 2025-09-15 (newly available); Safari 26. Safari 17.0 ignores it, so iOS keeps today's behavior (no regression, no gain). The guide's `hidden` fallback needs `@supports`.
- Lean: reject — for chat (explicitly deferred) and for lists until a measured large directory is slow. If a large-directory slowdown is reported, adopt on `BrowseSidebarList` and `DirectoryListing` rows first.

### defer-work-until-scroll-ends
- Asks: Use `scrollend` instead of debounced `scroll` for heavy follow-up work.
- Applies here: no real site.
- Findings: 8 scroll listeners; 1 debounce; 0 real.
  - `components/CardContents/CardContentsMenu.tsx:158` `restTimer.current = window.setTimeout(() => element.removeAttribute("data-scrolling"), REST_AFTER_MS)` — not real. It clears a cosmetic `data-scrolling` flag, not heavy work, and it also handles flings with its own input-intent window. `scrollend` would remove one timer but not the surrounding input tracking.
  - `components/SelectionCapture.tsx:239`, `components/ui/Dropdown.tsx:251`, `components/AppNav/PlacePill-landmarks.tsx:92`, `components/chat/workspace/SidecarTabStrip/view.tsx:116` — not real. They reposition or measure per event, in `requestAnimationFrame` or passive handlers. `scrollend` would make popups lag.
- Our guidance: silent.
- Fix size: n/a.
- Lint-able: no.
- Browser: Baseline 2025-12-12; Safari 26.2. Safari 17.0 lacks it, so a fallback would be needed anyway.
- Lean: reject — the one debounce runs a cosmetic flag, and iOS needs the old path.

### deliver-optimized-decorative-images
- Asks: Use `image-set()` with AVIF/WebP and 1x/2x for CSS background art.
- Applies here: partly.
- Findings: 6 CSS image URLs; 0 real.
  - `themes/tempest.css:8` `--tempest-art: url("./tempest-surge.webp")` and similar in `themes/*` / `pages/dev/theme-studio-*.css` — not real. Already WebP. Files are 430 to 720 KB (`themes/gilt-leaf.webp` 721 KB), fetched only when the theme is selected. The cost is per theme choice, not per page. No 2x set exists to choose from.
  - `themes/stock-textures.css:6` inline `data:image/svg+xml` grain — not real (SVG, resolution independent).
- Our guidance: silent.
- Fix size: re-encoding theme art is a design task (bbx-theme); `image-set()` gains only AVIF.
- Lint-able: no.
- Browser: Baseline widely available (2023-09-18); Safari 17. AVIF in WKWebView 17.0 works on iOS 16+.
- Lean: reject — no measured theme-art load cost.

### deprioritize-background-fetches
- Asks: `priority: 'low'` on `fetch()` for analytics and prefetch.
- Applies here: partly.
- Findings: 3 candidate sources; 0 real.
  - `components/chat/everywhere/InteractiveChat/processing-status-display.ts:118` `setInterval(poll, 5000)` and `hooks.ts:131` — poll calls go through tRPC's batch link, which does not take per-call `fetch` options; a global `priority: 'low'` would also demote user queries.
  - `hooks/useIdlePrefetch.ts` warms queries in `requestIdleCallback`; same tRPC limitation.
  - `lib/trpc/client.ts:97` `fetch(.../keepalive, { method: "HEAD" ... })` — dev-only wake call, not contention.
- Our guidance: silent.
- Fix size: would need a per-call opt-in through the tRPC link context. Not free.
- Lint-able: no.
- Browser: Baseline 2024-10-29; Safari 17.2. Safari 17.0 and 17.1 ignore it (harmless).
- Lean: reject — same-origin polls of tiny payloads do not compete in a way anyone measured.

### detect-initial-visibility-state
- Asks: Use `visibility-state` entries to detect background-loaded pages for metrics filtering.
- Applies here: no — no field metrics. Existing `document.visibilityState` uses (`catch-up.ts:124`, `processing-status-display.ts:170`, `AmbientReplies/view.tsx:55`) are behavior, not metrics, and the Chrome-only entry API has no Safari equivalent.
- Lean: n/a

### efficient-background-processing
- Asks: Pause heavy work (canvas, WebGL, polling) on `contentvisibilityautostatechange`.
- Applies here: no — we do not use `content-visibility: auto`. The equivalent need (pause work in a hidden cached card) is already served by `CardVisibilityProvider visible={visible}` in `WorkspaceCanvas/view.tsx`.
- Browser: Safari 26 (content-visibility); event availability not stated for Safari.
- Lean: n/a

### faster-spa-view-transitions
- Asks: Keep inactive SPA views mounted and hide them with `content-visibility: hidden` instead of `display: none`/unmounting; add `inert`; evict old views.
- Applies here: partly — we already keep inactive views mounted, add `inert`, and cap the count; we use `display: none`.
- Findings: 3 candidate sites; 1 plausible, 0 shown necessary.
  - `components/chat/workspace/WorkspaceCanvas/view.tsx:52` `<div ref={material} hidden={!visible} {...(!visible ? { inert: "" } : {})} ... className={visible ? "bbx-companion-desk relative flex flex-col min-h-0 min-w-0" : "hidden"}>` — plausible. Switching cards reruns layout for the whole card. Eviction exists: `evictWorkspaceToCap` / `MAX_UNPINNED_TABS` in `components/chat/workspace/state-model.ts:121`, which meets the guide's RAM-bound requirement. Switching the class would also keep each card's inner scroll position.
  - `view.tsx:115` hidden transcript `hidden={!workspace.transcriptVisible}` — not real. Transcript has `ResizeObserver` and scroll anchoring in `chat-scroll/`; `content-visibility: hidden` applies size containment and could trigger the controller's resize branches. Needs its own test.
  - `components/chat/everywhere/BoxConversationShell/view.tsx:102` `<div hidden={transcriptVisible}>` ambient region — not real (small).
- Our guidance: silent on this exact swap. `components/chat/AGENTS.md` ("Workspace card roots survive presentation changes") says card roots must not change React parent; a class change keeps that.
- Fix size: 1 file, a class and an `@supports not` fallback; risk is card scroll and `ResizeObserver` behavior (the card pane has `onScroll` activity reporting at `view.tsx:60`). Verify with `bin/browse` at phone width opening three cards, plus a before/after switch timing.
- Lint-able: no.
- Browser: Baseline 2025-09-15; Safari 26. Safari 17.0 needs the `display: none` fallback, so iOS (where tab switching is most likely to feel slow) gets no gain.
- Lean: reject for now — no reported slow tab switch and iOS cannot use it. Candidate if card switching is measured slow on desktop.

### flicker-free-client-side-ab-testing
- Asks: `blocking="render"` on head scripts for experiment tools.
- Applies here: no — no A/B testing.
- Lean: n/a

### full-session-analytics
- Asks: `fetchLater()` for session analytics.
- Applies here: no — no analytics.
- Lean: n/a

### identify-heavy-scripts
- Asks: Observe `long-animation-frame` entries and sum `scripts` by `sourceURL` to find heavy scripts.
- Applies here: partly — as a dev measurement only. `beebox/src/dev/perf/load/page-metrics.ts` (`OBSERVER_SCRIPT`) observes `longtask` and `largest-contentful-paint`, runs in Chrome over CDP, and reports `blockingMs`.
- Findings: 1 candidate site (`page-metrics.ts:29-33`, `observe({ type: "longtask", buffered: true })`); real as an optional addition: LoAF entries name the script URL and forced-layout time, which `longtask` does not.
- Our guidance: silent; fits `frontend.md:5` (it is a measuring tool).
- Fix size: 1 file (`page-metrics.ts` plus its zod schema, `src/dev/perf/load/`); low risk; verify with `pnpm perf:load` on one page.
- Lint-able: no.
- Browser: Chrome 123 only; the harness runs in Chrome. Not shipped to users.
- Lean: adopt with changes — dev harness only, and only when a long task needs attribution.

### identify-inp-causes
- Asks: Split INP into input delay / processing / presentation delay with Event Timing and LoAF in the field.
- Applies here: no — requires field collection and analytics. The same data can come from the `perf:load` harness (see `identify-heavy-scripts`).
- Browser: Event Timing Baseline 2025-12-12; LoAF Chrome only.
- Lean: n/a

### improve-next-page-load-performance
- Asks: Add Speculation Rules (prefetch/prerender) for likely next navigations.
- Applies here: no — the app is a client-routed SPA behind login; route changes do not load documents. The one real document hint is `index.html` `<link rel="preload" href="/api/boxes" as="fetch" crossorigin />`, already present.
- Browser: Chrome 109 only; not Safari.
- Lean: n/a

### interaction-paint-timing
- Asks: Observe `interaction-contentful-paint` and `soft-navigation` entries.
- Applies here: no — field metrics; Chrome 151 only.
- Lean: n/a

### interactions-in-complex-layouts
- Asks: Put `content-visibility: auto` on kanban columns/grid regions so a drag or edit reflows only one column.
- Applies here: no — we have no drag-and-drop board or editable data grid (`grep draggable|onDrag|dnd-kit` finds no UI use). The nearest case is the chat during streaming, where the controller depends on exact geometry (see `defer-rendering-heavy-content`).
- Browser: Baseline 2025-09-15; Safari 26.
- Lean: n/a

### lazy-load-video-and-audio
- Asks: `loading="lazy"` on offscreen `<video>`/`<audio>`.
- Applies here: no — the only media elements are `<audio controls>` in `components/history/HistoryViewCard/CommitDetail-tabs.tsx:46` (one element, a blob URL, no network cost) and a camera `<video>` in `CameraViewport.tsx:27`. No page renders many players.
- Browser: Chrome 150 only; not Safari.
- Lean: n/a

### optimize-image-priority
- Asks: `fetchpriority="high"` on the LCP image, `fetchpriority="low"` on hidden images, `loading="lazy"` on below-the-fold images; never combine high with lazy.
- Applies here: partly — LCP is not a goal here (SPA, image fetched after JS), but lazy and low priority apply to long image lists and offscreen neighbors.
- Findings: 17 `<img>`/`<Image>` sites in app and stock views; 3 real, 14 not.
  - Already lazy (agrees): `components/chat/user-message/user-entry-content.tsx:34`, `components/PdfCardView/PdfPageStrip.tsx:53`, `components/DoclingView/DoclingPageSection.tsx:91,123`, `schemas/image/list-entry.tsx:44` `loading="lazy"`.
  - `components/Markdown/body.tsx:96` `<Image src={displaySrc} lightboxSrc={resolved} ... size="chat" lightbox` — real. A long card body with many images fetches every image at open. Check first that `body.tsx` is not also the chat renderer: the chat uses its own `components/chat/markdown-rendering.tsx:40,64`, which is the path the chat-scroll open-hold depends on. `body.tsx` is used by `renderers/markdown.tsx`, `CommentaryView`, `BrowserTaskView`, `AttachedCommentary`, `WebpageView`. Verify whether any of those render in chat before adding the attribute, because a lazy off-screen image reserves no height (`issues/closed/bugs/2026-08-27-chat-images-load-without-reserved-size.md`).
  - `components/ImageLightbox.tsx:288` `<img src={image.src} alt="" ... onLoad={(event) => setFitWidth(...)}` (swipe peer parked a viewport away) — real. Add `fetchpriority="low"` so the neighbors do not compete with the visible image. Do not add `loading="lazy"`: the peer exists to be decoded before the swipe.
  - `components/ImageLightbox.tsx:194` current image — not real (visible, default priority is right; do not mark `high`).
  - `components/chat/markdown-rendering.tsx:40,64` — not real. Eager on purpose. `components/chat/AGENTS.md`: the open-thread hold waits for transcript images to load; a lazy image far above never loads, and one near the viewport is the case the docs already note ("lazy ones only when near the viewport"). Changing this reopens the chat-scroll images issue.
  - `components/ui/Avatar.tsx:51`, `CardMark.tsx:58`, `CapturePhotoStrip.tsx:78`, `ChatAttachments.tsx:102`, `ScreenshotIndicatorStrip.tsx:52` — not real (small, in chrome or blob URLs).
  - `renderers/image.tsx:111,139,213` — not real (the single visible image in a card; default is right).
- Our guidance: agrees — `components/ui/Image/view.tsx:69` documents `loading` as opt-in "for offscreen images a page renders many of up front". `beebox/box-docs/views.md:231` tells agents to render `<img src={imageUrl(f.path, { width: 960, format: "auto" })} />` and does not mention `loading="lazy"` for grids.
- Fix size: 1 to 2 files of attribute changes (`body.tsx`, `ImageLightbox.tsx`) and one sentence in `box-docs/views.md`. React 18.3.1 (`beebox/package.json:187`): `fetchPriority` is a React 19 prop; in React 18 use lowercase `fetchpriority` and add a type augmentation (check `tsc`), or skip the lightbox change. Verify with `bin/browse` on a markdown card with 20 images at phone width (network panel shows deferred requests), and `pnpm typecheck`.
- Lint-able: baselined scan — `<img>` without `loading` in a list-producing component needs judgment (single images are correct eager).
- Browser: `fetchpriority` Baseline 2024-10-29, Safari 17.2 (ignored on 17.0 to 17.1; harmless). `loading="lazy"` on images is Baseline widely available (Safari 15.4).
- Lean: adopt with changes — `loading="lazy"` on card-body images and in the box-docs line; `fetchpriority="low"` on lightbox peers; leave chat images eager.

### optimize-preload-priority
- Asks: `fetchpriority` on `<link rel="preload">` images and fonts.
- Applies here: no — the only preload is `index.html` `<link rel="preload" href="/api/boxes" as="fetch" crossorigin />` (a fetch, already high priority) and the build-time `modulepreload` from `bootPreloadPlugin`. No font or image preloads.
- Lean: n/a

### optimize-script-priority
- Asks: `fetchpriority` on `<script>` tags.
- Applies here: no — `index.html` has one `<script type="module" src="/src/main/app.tsx">`; Vite adds the chunk graph. No third-party scripts.
- Lean: n/a

### out-of-order-html-streaming
- Asks: Stream placeholders and patch them with `<template for>`/`streamHTML()`.
- Applies here: no — React client rendering; not shipped in any browser (Chrome 150 flag-level).
- Lean: n/a

### performance
- Asks: The umbrella checklist: inline critical CSS, defer scripts, no `@import`, preload only what is needed, `fetchpriority`, `scheduler.yield`, `content-visibility`, `loading="lazy"`, responsive images with `srcset`/`sizes`, service worker caching, font preload.
- Applies here: partly — most items are already satisfied or are public-site tuning.
- Findings: 12 checklist items checked; 0 violated.
  - Critical CSS inline: `index.html` has an inline boot `<style>` and the module script; the app is empty without JS. Satisfied.
  - `@import` in CSS: none in `src/index.css` or `src/themes/`. Satisfied.
  - Tree-shaking and minification: Vite production build, `precompressPlugin`, `bundleAnalysisPlugin` (`pnpm analyze:bundle`). Satisfied. `vite.config.ts` sets `sourcemap: true` for production, which costs build size but not load time unless the map is requested.
  - Fonts: no `@font-face` in `src/` (system fonts). Nothing to preload.
  - `srcset`/`sizes`: used on `renderers/image.tsx:111,139,213` with 480w/960w variants. Satisfied.
  - Width/height on images: absent in chat by design (no dimension metadata; see `issues/closed/bugs/2026-08-27-...`). Not fixable cheaply.
  - Service worker: `public/sw.js` exists; policy not reviewed in this slice.
  - Recurring timers: 5 s polls at `processing-status-display.ts:118,165` and `hooks.ts:131`; not shown heavy.
- Our guidance: agrees — `frontend.md:5`; `docs`-side measurement tooling under `src/dev/perf/`.
- Fix size: none.
- Lint-able: no.
- Browser: n/a (checklist).
- Lean: reject as a policy document; its concrete items are covered by the guides above. Do not copy into `frontend.md`.

### resolution-optimized-pseudo-elements
- Asks: Use `image-set()` in `::before/::after` `content` or `background-image`.
- Applies here: no — `grep "content: *url|content: *image"` finds no CSS pseudo-element image content; icons are inline SVG/emoji.
- Lean: n/a

### schedule-tasks-by-priority
- Asks: `scheduler.postTask()` with `user-blocking`/`user-visible`/`background`, with a polyfill from unpkg.
- Applies here: no — `hooks/useIdlePrefetch.ts` already uses `requestIdleCallback` with a timeout fallback for the one background task. The guide's fallback loads a script from `unpkg.com`, which the app's CSP (`lib/csp.js`) would block.
- Browser: Chrome 129, Firefox 142; not Safari.
- Lean: reject — would add a CDN script load and fight the CSP for no measured gain.
