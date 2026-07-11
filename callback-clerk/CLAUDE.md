# callback-clerk

Chrome (MV3) extension companion for callback-box. Clerk is a **surface, not
an engine**: it routes content (memos, saved pages, tab snapshots) into a
box's clerk API (the `clerk` tRPC router,
`callback-box/src/webapp/trpc/routers/clerk.ts`); the box does the
thinking. Design record of the 2026 refresh:
`callback-box/docs/implemented-plans/refresh-clerk.md`.

## How association works

The box frontend advertises itself via a `<meta name="callback-box">` tag
(`useBoxIdentityMeta`); the popup reads it from the active tab, validates it
(same-origin spoof guard), and offers to enable the box. Enabling requests a
per-origin host permission — that prompt is the consent. Enabled boxes can
span servers; one is *active* and receives all actions (save/do page, memo,
tab sync, context-menu save).

## Layout

- `wxt.config.ts` — WXT config; the manifest is **generated** from here (no
  hand-written manifest.json).
- `src/entrypoints/` — WXT entrypoints, kept thin: `background.ts`,
  `commentary-capture.content.ts` (Defuddle+DOMPurify+Turndown extraction
  shim, plus the page-freeze capture), `popup/`, `sidepanel/`.
- `src/platform/` — browser-API and DOM code: `clerk-api.ts` (clerk tRPC
  HTTP client), `config-storage.ts` (chrome.storage config load/save, clears
  legacy Dropbox-relay keys), `detect-box.ts` (reads the box-identity meta
  from the active tab), `enable-box.ts` (requests the per-origin host
  permission and persists the box), `extract-readable.ts` (Defuddle isolates
  content, DOMPurify sanitizes, Turndown converts to markdown), and
  `freeze-page.ts` (single-file-core page freeze into self-contained HTML).
- `src/domain/` — pure logic (config schema, URL building) with tap tests.
- `src/ui/` — React components.
- `public/` — static assets copied into the build (icons).

This layering follows the readntalk precedent: domain code never imports
React, WXT, or chrome.*.

## Commands

- `pnpm dev` — WXT dev mode (opens a Chrome profile with the extension
  loaded, HMR).
- `pnpm build` — production build to `dist/chrome-mv3/`; load that
  directory unpacked via chrome://extensions.
- `pnpm test` / `pnpm typecheck` / `pnpm lint` — tap, tsc, eslint. All must
  stay green; the root pre-commit hook runs lint-staged + typecheck.
- `wxt prepare` (runs on install) generates `.wxt/` types; `tsconfig.json`
  extends `.wxt/tsconfig.json`.

**Auto-build on main.** When a commit/merge lands clerk source changes on
`main`, the root post-commit/post-merge hooks run `build/auto-build.sh`,
which rebuilds `dist/chrome-mv3/` in the background (log:
`.last-build.log`). It's gated on `callback-clerk/` actually changing, so
box-only commits don't trigger it. Chrome picks up the refreshed unpacked
build automatically the next time the extension reloads.

## Conventions

Lint/style comes from `@ianbicking/personal-vibe-check` (workspace package) —
the eslint config is `vibeCheck({ react: true })` with **no overrides**; fix
code, never weaken rules (see monorepo CLAUDE.md). Monorepo root owns git
hooks; this package has no husky setup.

## Box relay (Track C — silent captureVisibleTab)

An enabled box's frontend can ask for a real screenshot (no picker) via a
page↔extension relay. Wiring:

- `src/entrypoints/box-relay.content.ts` — dynamically-registered content
  script (`registration: "runtime"`, injected via
  `chrome.scripting.registerContentScripts`, NOT in the manifest). It holds no
  authority: it verifies the page is an enabled box page, announces
  `relay-ready`, answers a `relay-ping`, and forwards `capture-request` to the
  background.
- `src/platform/relay-registration.ts` — `syncRelayRegistration(config)`
  registers/updates/unregisters the script with match patterns derived from
  each enabled box's full boxUrl. Called on enable, disable, and background
  startup (drift reconciliation); `persistAcrossSessions: true`.
- `src/domain/relay-auth.ts` — `boxUrlToMatchPatterns` /`isUrlUnderBoxUrl` /
  `captureErrorReason` (pure, unit-tested).
- `src/domain/relay-messages.ts` — the postMessage + runtime message shapes and
  guards (pure, unit-tested).
- `background.ts` `handleRelayCapture(sender)` — the real gate. Uses `sender`
  only to identify the tab id, then **re-queries the live tab**
  (`chrome.tabs.get`) and authorizes on its CURRENT url (under an enabled boxUrl,
  full origin incl. port) — never the send-time `sender.tab.url` snapshot, which
  a same-document navigation can move off the box (TOCTOU). Before AND after
  `captureVisibleTab` it re-checks that the tab is still active and still under
  the SAME box; quota→`busy`. Stateless across messages (MV3 workers die
  unpredictably).

**Match-pattern semantics (important):** Chrome match patterns cannot express a
port — a pattern's host is portless and matches ALL ports. On the dev router
many boxes share `localhost:3210` and are distinguished only by path, so the
content script is path-scoped (`http://localhost/main/test1/*`) and the
background's port-aware `isUrlUnderBoxUrl` prefix check is the real
authorization boundary. See the module comments.

**Manual verification (no MV3 test harness exists — the chrome.* paths are
verified by hand):**

1. `pnpm build`, then load `dist/chrome-mv3/` unpacked at `chrome://extensions`
   (or run a headed `BROWSE_CLERK=1 bin/browse` session).
2. Open a worktree box page (e.g.
   `http://localhost:3210/<worktree>/test1/`) and enable it from the popup
   (grants the per-origin host permission).
3. At `chrome://extensions` → the clerk's service worker → confirm a registered
   content script (`chrome.scripting.getRegisteredContentScripts()` in the
   worker console shows `callback-clerk-box-relay` with the box's match
   patterns).
4. In the box page's devtools console, probe the relay:
   ```js
   addEventListener("message", (e) => e.data?.source === "callback-clerk-relay" && console.log("relay:", e.data));
   postMessage({ source: "callback-box-app", type: "relay-ping" }, location.origin);      // → relay-ready
   postMessage({ source: "callback-box-app", type: "capture-request", correlationId: "1" }, location.origin); // → capture-response {ok:true,dataUrl}
   ```
5. Switch to another tab immediately after sending a capture-request → expect
   `{ ok: false, reason: "not-capturable" }`. Fire >2 requests/sec → expect
   `{ ok: false, reason: "busy" }`. Try the same postMessage on a non-box page
   (relay not injected there) → no `relay-ready`, no response.
6. Disable the box → the registration disappears (`getRegisteredContentScripts`
   empty).

## Auth model (for Tracks B/C)

No credentials are stored in the extension. The user's browser session with
the box (`cb_session` cookie) is the authentication; fetches use
`credentials: "include"` plus a per-origin host permission granted when the
user enables a box. Enabling happens in-situ: the box's frontend emits a
`callback-box` identity meta tag, the popup detects it on the active tab and
offers to enable.
