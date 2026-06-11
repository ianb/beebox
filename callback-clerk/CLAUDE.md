# callback-clerk

Chrome (MV3) extension companion for callback-box. Clerk is a **surface, not
an engine**: it routes content (memos, saved pages, tab snapshots) into a
box's clerk API (`callback-box/src/webapp/routes/clerk.ts`); the box does the
thinking. Active refresh plan: `callback-box/docs/plans/refresh-clerk.md`.

**Status:** Tracks A–C of the plan are implemented: WXT re-platform, in-situ
box association (detect → enable → switch in the popup), and save actions
(save/do page, memo, tab sync, context menu) against the clerk API. The
server path is verified end-to-end; loading the built extension in Chrome
and exercising the popup flows is manual dogfooding still to be done.

## Layout

- `wxt.config.ts` — WXT config; the manifest is **generated** from here (no
  hand-written manifest.json).
- `src/entrypoints/` — WXT entrypoints, kept thin: `background.ts`,
  `extract.content.ts` (Readability+Turndown extraction shim),
  `popup/`, `sidepanel/`.
- `src/platform/` — browser-API and DOM code (`extract-page.ts`, `tabs.ts`).
- `src/domain/` — pure logic (config schema, URL building) with tap tests.
- `src/ui/` — React components.
- `public/` — static assets copied into the build (icons).

This layering follows the readntalk precedent: domain code never imports
React, WXT, or chrome.*.

## Commands

- `pnpm dev` — WXT dev mode (opens a Chrome profile with the extension
  loaded, HMR).
- `pnpm build` — production build to `.output/chrome-mv3/`; load that
  directory unpacked via chrome://extensions.
- `pnpm test` / `pnpm typecheck` / `pnpm lint` — tap, tsc, eslint. All must
  stay green; the root pre-commit hook runs lint-staged + typecheck.
- `wxt prepare` (runs on install) generates `.wxt/` types; `tsconfig.json`
  extends `.wxt/tsconfig.json`.

## Conventions

Lint/style comes from `@ianbicking/personal-vibe-check` (workspace package) —
the eslint config is `vibeCheck({ react: true })` with **no overrides**; fix
code, never weaken rules (see monorepo CLAUDE.md). Monorepo root owns git
hooks; this package has no husky setup.

## Auth model (for Tracks B/C)

No credentials are stored in the extension. The user's browser session with
the box (`cb_session` cookie) is the authentication; fetches use
`credentials: "include"` plus a per-origin host permission granted when the
user enables a box. Enabling happens in-situ: the box's frontend emits a
`callback-box` identity meta tag, the popup detects it on the active tab and
offers to enable.
