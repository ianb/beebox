# Refresh callback-clerk

> **Implemented June 2026** (worktree-refresh-clerk). Frozen as the design
> record. One deviation: the extraction fallback sends a `[title](url)`
> markdown link rather than empty markdown — the server's savePageSchema
> requires non-empty markdown. Current docs: `callback-clerk/CLAUDE.md`.

Revive the dormant callback-clerk Chrome extension as a thin surface over
callback-box: re-platform it on WXT, bring it into the monorepo workspace with
the same lint/test discipline as callback-box, replace the dead
callback-dropbox relay with direct calls to the box-hosted clerk API, and add
the core "associate one or more boxes, pick the active one" flow. Clerk routes
content into a box; the box does the thinking.

## Stated preferences this plan trades against

- Monorepo `CLAUDE.md` — **"NEVER disable or weaken a lint rule to make code
  pass"**; "Treat noisy command output as a bug." Both are directly implicated:
  clerk's current eslint config is a pile of rule-offs, and its broken `file:`
  dep makes `pnpm install` noisy enough that it was exiled from the workspace.
- `callback-box/CLAUDE.md` — "don't add features beyond what the task
  requires"; read-before-write; validation contract.
- `callback-box/code-style.md` — no optional chaining, no default params, max
  2 positional params, no `any`.
- Shipped precedent: `callback-box/eslint.config.mjs` is the densest statement
  of what a subproject's lint config should look like — `vibeCheck(...)` plus
  at most a couple of *tightening* overrides:

  > `callback-box/eslint.config.mjs`: `...vibeCheck({ react: false, ignores:
  > [...] })` then `"max-params": ["error", 2]` and one targeted off with a
  > reason.
- Shipped precedent: `callback-box/src/webapp/routes/clerk.ts:1-6` — *"Clerk
  API routes - endpoints for the browser extension. Replaces the old relay by
  letting the extension call box-hosted HTTP APIs directly once the user is
  authenticated."* The server already decided the architecture; this plan
  implements the client half of that decision.

## What already exists

**Server side (reuse all of it — the server half of this plan is done):**

- `callback-box/src/webapp/routes/clerk.ts:61-85` — `POST /api/clerk/memo`
  creates a memo card in `box/inbox/`, commits with trailer
  `Created-By: clerk-api`.
- `clerk.ts:87-128` — `POST /api/clerk/save-page` with
  `intent: "save"|"do"`, full metadata (url, title, siteName, byline, excerpt,
  markdown, selectedText), lands in `box/inbox/pages-saved/` or
  `box/inbox/pages-todo/`.
- `clerk.ts:130-149` — `POST /api/clerk/tabs` stores a tab snapshot in
  `.callback-box/clerk-tabs.json`.
- `clerk.ts:151-161` — `GET /api/clerk/actions` + dismiss: **placeholders**
  (empty array / no-op). Client-side actions polling is therefore deferred,
  not rewired (see NOT in scope).
- `callback-box/src/webapp/server-root.ts:23-46` —
  `registerChromeExtensionCors()` reflects `chrome-extension://` origins with
  `Access-Control-Allow-Credentials: true`; preflight handled for
  `/api/boxes`.
- `callback-box/src/webapp/server-root.ts:104-113` — `GET /api/boxes` returns
  the boxes the authenticated user may see (owner sees all; others filtered by
  `allowedEmails`). **Not used by the association flow** — in-situ enabling
  (Track B) supersedes it; it stays available for a later "other boxes on this
  server" discovery feature (see NOT in scope).
- `callback-box/src/frontend/src/app-shell.tsx:44-55` — the SPA validates the
  URL's box slug against the known-boxes list. This is the spot that will emit
  the box-identity meta tag (Track B); the page currently carries no
  machine-readable box identity.
- `callback-box/src/webapp/auth.ts` — signed `cb_session` cookie (30-day,
  HMAC), Google OAuth when `GOOGLE_OAUTH_CLIENT_ID` is set, auth disabled
  otherwise (`auth.ts:72-74` returns `200 null` from `/auth/me`). The
  extension reuses this wholesale: no pairing codes, no tokens.
- Card templates: `createDropboxMemoTemplate` (used at `clerk.ts:75`) and
  `createRecordTemplate` (`clerk.ts:108`) — card shape is server-owned; the
  extension never constructs card XML.

**Extension side (reuse with rewiring):**

- `callback-clerk/src/content/extract.ts` — Readability + turndown page
  extraction. Reuse nearly as-is; it has no dropbox dependency.
- `callback-clerk/src/lib/tabs.ts` + `test/tabs.test.ts` — tab snapshot with a
  pure, tested core. Reuse.
- `callback-clerk/src/lib/storage.ts` + `test/storage.test.ts` — the
  chrome.storage wrapper pattern survives; the *schema* (workerUrl, apiKey,
  channelKey) is dropbox-era and is replaced (see Track B).
- `callback-clerk/src/popup/*`, `src/sidepanel/*` — React popup/sidepanel
  shells. PairingView dies with the relay; StatusView's layout (status,
  message box, save/do buttons) carries over conceptually.
- **Rebuild, not reuse:** `src/lib/dropbox.ts`, `src/popup/PairingView.tsx`,
  and the polling half of `src/background/index.ts` — all exist only to talk
  to the deleted Cloudflare Worker (`callback-clerk/CLAUDE.md:1-16` documents
  the dormancy).

**Template for the new shape:**

- `~/src/readntalk` — WXT project with the layering worth copying:
  `entrypoints/` thin, `src/domain/` browser-independent,
  `src/platform/` browser APIs, `src/ui/` React components
  (`readntalk/AGENTS.md:58-65`). Framework decision rationale in
  `readntalk/docs/technology-findings.md:59-91`.
- `pnpm-workspace.yaml:9-11` — the comment explaining clerk's exclusion; this
  plan deletes that comment and the exclusion.

## Prior art (external)

Searched June 2026:

- **WXT status** — actively maintained, `wxt@0.20.26` (2026-05-11); no 1.0
  yet but the 0.20 line is the declared v1.0 release candidate with no further
  breaking changes planned. `@wxt-dev/module-react` is React-version-agnostic
  (no React peer dep), so the workspace's react 18.3.1 pin is fine.
  https://github.com/wxt-dev/wxt/issues/920
- **CRXJS status — contradicts this plan's original premise.** CRXJS was
  rescued from near-archival in mid-2025: a maintainer team formed, 2.0.0
  stable shipped June 2025, and 2.6.1 was published 2026-06-11. Staying on
  CRXJS is no longer a maintenance liability. The plan still moves to WXT —
  for file-based entrypoints, generated manifest, cross-browser headroom, and
  alignment with readntalk (one mental model across the user's extensions) —
  but the move is now a preference, not a rescue.
  https://github.com/crxjs/chrome-extension-tools/discussions/974
- **MV3 cookie auth** — the planned pattern (service-worker `fetch` with
  `credentials: "include"` + host permission for the API origin) is the
  documented standard: Chrome treats extension requests as same-site when the
  extension holds host permissions, so `SameSite=Strict/Lax` cookies are sent;
  no `cookies` permission needed. Known gotchas: breaks if the user blocks
  third-party cookies; intermittent reports of MV3 service workers dropping
  session cookies (fallback: `chrome.cookies` + manual header, which *does*
  need the `cookies` permission — kept in reserve, not baseline).
  https://developer.chrome.com/docs/extensions/mv3/storage-and-cookies/
- **WXT popup + sidepanel** — both entrypoints coexist; WXT auto-generates
  manifest keys. Chrome-level gotcha: the action click opens popup *or* panel,
  not both; panel opens programmatically via `chrome.sidePanel.open()` which
  must run synchronously in a user-gesture handler.
  https://wxt.dev/guide/essentials/entrypoints.html

## Tracks / scope

Ordered by implementation dependency.

### Track A — Re-platform: WXT, workspace, lint parity, green build

**What.** Scaffold clerk as a WXT project inside the existing
`callback-clerk/` directory, port the live source (extract, tabs, storage
wrapper, popup/sidepanel shells, background skeleton), excise everything
dropbox, join the pnpm workspace, and align lint/TS config with callback-box.

**Why this needs to change.** `pnpm install` fails today
(`callback-clerk/CLAUDE.md:5`); the package is excluded from the workspace
(`pnpm-workspace.yaml:9-11`); and its eslint config turns off seven rules from
the shared preset (`callback-clerk/eslint.config.mjs:6-13` — optional
chaining, default params, max-lines, single-export, ddd/require-spec-file,
no-restricted-syntax all `"off"`), which is precisely the silent drift the
monorepo CLAUDE.md forbids.

**Direction.**

- `wxt@^0.20` + `@wxt-dev/module-react`; entrypoints
  `entrypoints/background.ts`, `entrypoints/extract.content.ts`,
  `entrypoints/popup/`, `entrypoints/sidepanel/`. Manifest is generated by
  `wxt.config.ts` (the hand-written `manifest.json` is deleted).
- Source layout copied from readntalk: `src/domain/` (pure logic: storage
  schema, URL building, payload shaping), `src/platform/` (chrome.* wrappers,
  fetch client), `src/ui/` (React components). Entrypoints stay thin.
- Manifest permissions shrink to what the kept features use: `tabs`,
  `storage`, `sidePanel`, `contextMenus`, `scripting`, `activeTab`, plus
  `optional_host_permissions: ["https://*/*", "http://*/*"]` (granted
  per-origin at server-add time, Track B). `alarms` and `notifications` are
  dropped with actions polling.
- `eslint.config.mjs` becomes the callback-box shape: `...vibeCheck({ react:
  true })` plus `"max-params": ["error", 2]` and nothing else. Every violation
  that surfaces is fixed in code. If a preset rule genuinely misfits the
  extension context (candidate: `ddd/require-spec-file` against entrypoint
  files), stop and raise it with the boxholder — do not re-disable it
  unilaterally.
- `package.json`: vibe-check becomes `workspace:*`; tap stays as the test
  runner (matches callback-box); scripts mirror callback-box (`test`,
  `typecheck`, `lint`); husky/lint-staged/prepare removed (monorepo root owns
  hooks — monorepo CLAUDE.md: subprojects `prepare: ":"`).
- `pnpm-workspace.yaml`: add `callback-clerk`, delete the exclusion comment.
- Tailwind stays at 3 in this track (one variable at a time); see Open
  questions for the 4 upgrade.
- Existing tap tests (storage round-trip, tabs filtering) ported and passing.

**First implementation chunk.** The whole track is the chunk: WXT scaffold +
ported source compiling, `pnpm install` clean at the monorepo root,
`pnpm -F callback-clerk lint|typecheck|test|build` all green, extension loads
unpacked in Chrome showing an "unconfigured" popup. No open questions inside
this chunk.

### Track B — Box association: in-situ detection, explicit enable

**What.** The "enable a box" flow happens *on the box*: the user visits a box
in a normal tab, opens the extension popup, the extension detects that the
page is a callback-box and offers to enable it. Enabled boxes accumulate in
extension storage and can span multiple servers; one enabled box is the
*active* box that actions route into.

**Why this needs to change.** Today there is no association at all — a
hardcoded Worker URL and a 6-digit pairing code
(`callback-clerk/src/popup/PairingView.tsx:5`). And typed-URL server entry
(the rejected alternative) would force the extension to guess where the path
prefix ends (`https://box.example.com/main` vs
`http://localhost:3210/<wt>/test1`); in-situ detection gets the exact box
root from the page itself.

**Direction.**

- **Box identity meta (the one callback-box change in this plan).** Once the
  SPA has validated its slug (`app-shell.tsx:44-55`), it sets a head tag:

  ```html
  <meta name="callback-box" content='{"slug":"test1","title":"test1","boxUrl":"http://localhost:3210/refresh-clerk/test1"}'>
  ```

  `boxUrl` is the absolute box root computed from the SPA's own base — the
  extension never parses path segments, so deployed (`/main`) and dev-router
  (`/<wt>/test1`) layouts work identically. Present on every SPA route, since
  detection shouldn't depend on which box page the user happens to be on.
- **Detection.** On popup open, `chrome.scripting.executeScript` against the
  active tab (covered by `activeTab` + the popup-open gesture) reads the meta
  from the DOM. Found and not yet enabled → the popup leads with "Enable
  *<title>*?". Found and enabled → normal status view for that box. Absent →
  status view for the current active box.
- **Spoof guard.** Any web page could emit this meta with a `boxUrl` pointing
  somewhere else, tricking the user into routing their saves to an attacker's
  server. The extension requires `new URL(boxUrl).origin === tab.origin` and
  rejects the offer otherwise. Domain-level validation with tests.
- **Enable click**: `chrome.permissions.request({origins: ["<origin>/*"]})`
  synchronously in the click handler → store the box → make it active if it's
  the first. Explicit, per-box, user-gesture-bound — nothing is ever enabled
  automatically.
- **Auth is implicit, and enabling-in-situ is what makes that safe**: the
  user can only see the box page if their browser session already works, so
  at enable time the `cb_session` cookie is known-good. Subsequent fetches
  send it via `credentials: "include"` + the granted host permission. On a
  later 401 (expired session), the popup shows "session expired — open
  *<boxUrl>* to sign in" and links the box; the extension itself has no auth
  flow and stores no credentials.
- **Storage schema** (chrome.storage.local, versioned — no server entity;
  multi-server support falls out of each box carrying its own absolute URL):

  ```ts
  interface ClerkConfig {
    version: 1;
    boxes: Array<{ boxUrl: string; slug: string; title: string }>;
    activeBoxUrl: string | null;
  }
  ```

  A box's API root is `${boxUrl}/api/clerk/...`. Old dropbox-era storage keys
  are cleared on first run (one-line migration, nothing worth preserving).
- **Selection**: popup header shows the active box with a switcher across all
  enabled boxes, plus per-box disable. Context-menu and toolbar actions
  always target the active box (per-action box pickers are out of scope).
- Vocabulary lock-ins: **box URL** (absolute box root, the identity key),
  **enabled box**, **active box**.
- Pure parts (config schema CRUD, meta-payload validation incl. spoof guard,
  URL building) live in `src/domain/` with tap tests.

**First implementation chunk.** The identity meta in `app-shell.tsx` + the
domain layer (config schema, meta validation, storage migration) with tests —
landable before any popup UI.

### Track C — Rewire actions to the clerk API

**What.** Point the kept user actions at the active box: send memo, save
page, do page, sync tabs, context-menu save.

**Why this needs to change.** Background and StatusView currently call
`createDropboxClient()` at 5 sites (`callback-clerk/CLAUDE.md:11`); none of it
runs.

**Direction.**

- One thin client in `src/platform/clerk-api.ts`:
  `postMemo(box, payload)`, `savePage(box, payload)`, `postTabs(box,
  snapshot)` — each a `fetch` with `credentials: "include"` against
  `${base}/${slug}/api/clerk/<route>`, payload shapes copied from
  `clerk.ts:61-149` (the server's zod/manual validation is the contract).
- Background message types survive (`sendMessage`, `saveToBrief`, `savePage`,
  `doPage`, `syncNow`); `paired`/`unpaired`/`dismissAction` die with the
  relay.
- Page save: content-script extraction (Readability + turndown) as today;
  when extraction fails or the page is unscriptable (chrome://, Web Store),
  fall back to a URL+title-only `save-page` payload with empty markdown and a
  note in `excerpt` — never silently drop the save.
- Every action surfaces success/failure in the popup (and via badge text for
  context-menu saves, since no popup is open) — a failed save must be loud.

**First implementation chunk.** `clerk-api.ts` + memo send end-to-end against
local dev (`~/src/box-worktrees/refresh-clerk/test1` via the router), with a
domain-level test for payload shaping.

### Track D — Docs and verification

**What.** Rewrite `callback-clerk/CLAUDE.md` (dormancy notice → living doc:
architecture, how to load unpacked, how auth works), delete
`conventions.md`/`THINKING_CLAUDE.md` if obsolete (they predate the monorepo
conventions), README with a quickstart, and a manual verification pass against
both local dev and the deployed instance.

**First implementation chunk.** The whole track; it's small and lands last.

## Subplans

None. The one candidate — "what should clerk's *new* functionality be once it
works" — is explicitly out of scope rather than a subplan; it has no decisions
this plan depends on.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Hostile page emits a `callback-box` meta with a foreign `boxUrl` (save-routing phish) | planned: domain test for the origin spoof guard | planned: offer rejected unless `boxUrl` origin === tab origin | silent rejection by design (no offer shown; nothing to act on) |
| Identity meta absent because the deployed box predates the frontend change (new extension, old server) | no | planned: no offer appears; popup help text names the symptom ("box not detected — server may need updating") | clear |
| Malformed meta JSON | planned: domain validation test | planned: treated as not-a-box | silent (same as absent) |
| `executeScript` fails on restricted pages (chrome://, Web Store) | no (needs real browser) | planned: detection skipped, normal status view | silent by design (nothing to enable there) |
| Save fetch returns 401 later (session expired since enabling) | planned: domain test for status mapping | planned: popup shows "session expired — open *box* to sign in" with link | clear |
| Cookie silently not sent (user blocks third-party cookies; known MV3 gotcha) | no (browser-setting dependent) | planned: 401-while-page-works case → popup explains the cookie setting; `chrome.cookies` fallback held in reserve | clear |
| `chrome.permissions.request` denied by user | no | planned: enable aborts with message; box not stored | clear |
| Active box deleted/renamed on server after enabling (stale association) | planned: domain test for 404 mapping | planned: save action surfaces "box not found — re-enable from the box page" | clear |
| Save-page on unscriptable page (chrome://, Web Store) | no (needs real browser) | planned: fallback to URL+title-only payload | clear |
| Readability returns null on a real page | planned: extraction fallback unit test | planned: same fallback | clear |
| MV3 service worker killed mid-save | no | accepted risk: each save is one fetch; a killed worker before fetch = no save, user sees no success state and retries; no dedup needed | clear (no success shown) |
| Old dropbox-era storage keys present on an upgraded install | planned: migration test | planned: cleared on first run | silent by design (nothing to tell the user) |

**Critical gap:** none unresolved. The closest was context-menu saves failing
with no popup open (silent by default); Track C addresses it with badge-text
error surfacing.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED by design: the extension never
  writes card XML; card shape is owned by server templates
  (`clerk.ts:75,108`).
- **Stale ref** — ADDRESSED: the analog is a stale box association; handled
  (Failure modes, "active box deleted/renamed" row).
- **Two agents touching the same card** — ADDRESSED by design: clerk only
  *creates* cards in `box/inbox/`; it never edits existing cards, so no
  concurrent-edit surface.
- **Hand-edit drift** — not applicable: no human edits extension-created
  payloads before the server templates them.
- **Fabricated free-form value** — ADDRESSED: extraction copies page metadata
  verbatim (Readability fields); the only free text is the user's own memo.
- **Validation error UX** — ADDRESSED in Track C: server 4xx bodies are
  surfaced verbatim in the popup/badge, and the server's clerk routes already
  return JSON errors.
- **Partial migration / transition state** — ADDRESSED: there is no
  transition window; the dropbox path is deleted in one chunk and old storage
  keys are wiped on first run. The deployed server already serves the clerk
  routes, so old and new extension versions never need to coexist.

## NOT in scope

- **Server-level box discovery (`GET /api/boxes`) in the extension** — "you
  enabled test1; this server also has main and hearth, enable those too?"
  is a nice later affordance, but visit-and-enable covers the need and keeps
  enabling explicit, which is the stated preference. The endpoint and its
  CORS support already exist when we want it.
- **Actions polling / outbound box→browser actions** — the server side is a
  placeholder (`clerk.ts:151-161`); building a client for an empty endpoint
  is speculative. The `alarms`/`notifications` permissions go with it.
  Revisit when the box has something to push.
- **New functionality beyond the existing memo/save-page/tabs surface** — the
  user explicitly staged this: first make it work, then add features.
- **Firefox build** — WXT makes it cheap later, but `sidePanel` and the
  current audience are Chrome; one browser until the surface stabilizes.
- **Chrome Web Store packaging/publishing** — loaded unpacked for now.
- **Per-action box pickers** — one global active box keeps the first version
  simple; a picker is additive later.
- **storage.sync (multi-machine config)** — local-only config; sync raises
  quota and conflict questions that aren't worth it for a single-user tool
  yet.
- **Retiring the sidepanel** — kept as a trivial port this round; whether it
  earns its place is a question for the functionality phase.

## Open design questions

- **Tailwind 3 → 4** — readntalk runs Tailwind 4 with WXT; clerk is on 3.
  Lean: upgrade during Track A only if the WXT scaffold makes 3 awkward;
  otherwise a follow-up. Not load-bearing.
- **Detect on any box page, or homepage only?** The meta rides the SPA shell
  on every route, so any-page detection is free; restricting the *offer* to
  the box homepage would add a rule without adding safety (the spoof guard is
  the safety mechanism, not the route). Lean: detect and offer on any box
  page. Flagged because the boxholder floated "maybe only box homepage."
- **Session-expiry UX beyond the link-out** — implicit auth means the
  extension can hit a 401 at save time with user-typed memo text in hand.
  Lean: keep the failed payload in storage and offer "retry" after
  re-sign-in, but only if it falls out cheaply; otherwise the link-out plus
  preserved popup state is enough for v1.
- **`ddd/require-spec-file` against WXT entrypoints** — if the preset demands
  spec files for entrypoint stubs, that's a raise-with-the-user moment, not a
  config edit. Flagged here so it isn't decided silently mid-implementation.

## Knowledge audits

Skip, with rationale: this plan introduces no agent-facing concepts. Cards
created via the clerk routes use existing, already-documented shapes (memo,
record) and existing inbox conventions; the extension itself is
infrastructure no box agent needs to recall. The one doc obligation is
human-facing: the Track D rewrite of `callback-clerk/CLAUDE.md` so the next
session doesn't read a stale dormancy notice.

## Implementation order

1. **A: Re-platform** — WXT scaffold, port source, workspace join, lint
   parity, tests/build green, dropbox excised. (Everything depends on this.)
2. **B1: Identity + domain layer** — box-identity meta in `app-shell.tsx`;
   extension-side config schema, meta validation (incl. spoof guard), storage
   migration; tap tests.
3. **B2: Association UI** — popup detection via `executeScript`, enable flow
   with permission request, active-box switcher, session-expired link-out.
4. **C: Actions** — clerk-api client, memo/save-page/tabs wired to the active
   box, extraction fallback, error surfacing, context menus.
5. **D: Docs + verification** — CLAUDE.md/README rewrite, stale doc cleanup,
   manual pass against local test1 and box.example.com.

Each numbered item is a commit boundary, not a ship boundary.

## Rollout shape

- Work happens on this worktree (`worktree-refresh-clerk`); merges to main
  only on the boxholder's explicit signal. The plan touches callback-box in
  exactly one place — the identity meta in `app-shell.tsx` — which auto-
  deploys on the merge to main, so the deployed instance becomes enableable
  at the same moment the extension ships. Until then, dogfooding runs against
  the worktree's dev box.
- **Test posture**: tap tests land *with* each chunk for the pure domain layer
  (config, URLs, payload shaping, extraction fallback) since those are
  regression-prone and cheap; browser-context behavior (permissions prompt,
  cookie flow, sidepanel) is verified manually via loaded-unpacked dogfooding,
  per the default "dogfooding precedes tests" posture.
- **Knowledge audits**: none (rationale above).
- **Migration**: one-shot, in-code — first run under the new version clears
  dropbox-era storage keys. No data migration; no transition window.
- Manual verification checklist at completion: visit the dev box → popup
  offers enable → enable (permission prompt) → memo lands in `box/inbox/` →
  save-page and do-page land in `pages-saved`/`pages-todo` → tabs snapshot
  appears in `.callback-box/clerk-tabs.json` → enable a second box and switch
  active between them → after merge, same flow against box.example.com
  including the signed-in-cookie path and a hostile-meta page spot check.
