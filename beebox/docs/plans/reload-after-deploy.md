---
title: "Reload a stale tab after a deploy"
status: active
workstream: reload-after-deploy
issues:
  - ../../../issues/features/2026-08-03-detect-server-update-prompt-client-reload.md
---
# Reload a stale tab after a deploy

A tab or the iOS web view that stays open across a deploy keeps running the old
frontend against the new server. This plan gives the built frontend an
identity, has the server report the identity it would serve now, and has the
client reload itself when it is shown again and nothing would be lost. When a
reload would lose something, the client shows a quiet banner.

**Issues addressed:** `issues/features/2026-08-03-detect-server-update-prompt-client-reload.md`
(it already absorbed `issues/closed/features/2026-08-12-stale-web-bundle-detection.md`).
A queue search for `stale.*tab`, `reload.*deploy`, `version skew`, and
`new version` found no other open item.
`issues/closed/bugs/2026-08-15-long-lived-processes-never-reload-the-rebuilt-bundle.md`
is the server-process twin and is already closed.

## Design

### Situations

- When I come back to a box tab I left open yesterday and a deploy landed
  overnight, I want the tab to be current without my doing anything, so I can
  stop meeting half-broken behavior that a refresh would fix.
- When I open the iOS app days after its last use, I want the chat to run the
  code that is deployed, so I do not report a deployed fix as "still broken".
- When I return to a tab with a half-written message, or a reply still
  streaming, I do not want the page to reload under me; I want to be told that
  a newer version exists and to choose when to reload.
- When I am using the tab and a deploy lands, I do not want the page to move;
  a small notice is enough.
- When a deploy changed only docs or the server, I do not want any reload or
  notice at all.

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| Tab shown again, newer build, nothing at risk | Act: reload | the page itself | none: it happens as the tab appears |
| Tab shown again, newer build, something at risk | Show | banner under the app bar | waits to be found |
| Newer build learned while the person uses the tab | Show | banner under the app bar | waits to be found |
| Newer build learned while the tab is hidden | Quiet until shown | — | — |
| Deploy did not change the frontend | Quiet | — | — |
| A reload did not deliver the newer build | Show, never act again for that build | banner | waits to be found |

The moment to act is the return to the tab: the person has not started
anything yet, so a reload costs a second and loses nothing. Acting earlier
(while hidden) is possible but is not what the boxholder chose; acting later
(mid-use) moves the page under the person.

### Spirit

- **Serves:** the box should not make the person debug it. A stale bundle looks
  the same as a failed fix.
- **Risks:** a page that reloads itself can lose work. The guard is a list of
  real "something would be lost" probes (Tracks C), and a banner in every other
  case.

### Trust

The box takes one action, a page reload. It starts at "automatic when safe",
which the boxholder chose. Every case the probes do not clear falls back to
"show only". Nothing is learned or recorded.

### When it goes wrong or does nothing

- A reload that still serves the old bundle (a cache, a half-finished deploy):
  the tab does not reload again for that build; the banner shows instead.
- A dev server (Vite): the page has no build identity, so the feature does
  nothing. Vite's own client already reloads stale dev tabs
  (`beebox/src/frontend/vite.config.ts:64`: *"That makes stale tabs
  self-healing"*).
- Every mismatch writes one `[build]` warning to the client debug log, which is
  forwarded to the server log even with the debug panel off.

### Walkthrough

1. The person leaves the chat tab in the background. A deploy restarts the box
   server; the WebSocket closes.
2. tRPC's `wsLink` reconnects in the background and restarts every
   subscription, including the new `build.watch`. The server yields
   `{ frontend: "9f3c…" }`; the page's own identity is `41ab…`. The client
   stores the mismatch and logs `[build] skew client=41ab… server=9f3c… action=wait (hidden)`.
3. The person switches back. `visibilitychange` fires. No composer text, no
   streaming reply, no upload, no recording, no unsaved Compose edits. The
   client writes `{ target: "9f3c…" }` to `sessionStorage` and calls
   `location.reload()`.
4. The new page boots with identity `9f3c…`; `build.watch` agrees, and the
   client clears the `sessionStorage` record.
5. Alternative at step 3: the composer holds a draft. The client shows "A new
   version of Bee Box is available." with **Reload** and a close button. The
   person finishes, sends, switches away and back: step 3 now applies.

## Smallest fix and budget

The smallest fix is a banner only: report the identity, compare, show "Reload".
That fixes the reported problem only when the person reads the banner. The
boxholder chose auto-reload when safe, which needs the safety probes and the
loop guard.

Chosen design, estimated changed lines (additions plus deletions):

| Track | Source | Tests |
|---|---|---|
| A. Build identity (Vite plugin + server read + `build.watch`) | ~80 | ~60 |
| B. Client decision + loop guard + banner + wiring in app shell | ~200 | ~150 |
| C. Reload blockers (registry + six probes) | ~90 | ~40 |
| Total | ~370 | ~250 |

Docs: a paragraph in `beebox/frontend.md` or the deploy README (~15 lines). Not
a BIG CHANGE.

## Stated preferences this plan trades against

- Boxholder brief (handoff): learn the identity on a channel the client
  already holds, no new polling loop. Met: the identity rides the per-box tRPC
  WebSocket the app keeps open for `events.subscribe`.
- Memory, *minimize invented concepts; prefer primitives*: the platform has
  `beforeunload` as "would leaving lose something?". It is not used as the
  probe, because registering it for the composer would make every tab close with
  a draft show a browser "Leave site?" prompt, though the draft already survives
  reloads (`beebox/src/frontend/src/input/emission-persist.ts:4`: *"The
  composition survives reloads AND session switches"*), and it disables bfcache.
  So the plan adds one small registry with one shape (Track C).
- *Bias toward strict*: fail closed. No client identity, no `sessionStorage`, or
  an unknown server identity: never auto-reload.
- `beebox/AGENTS.md` "no features beyond the task": no native iOS change, no
  dev-router work, no server push on change (a deploy restarts the server,
  which reconnects every socket).

## What already exists

- Vite build plugins that edit `index.html` at `transformIndexHtml` `post`:
  `beebox/src/frontend/src/dev/boot-preload-plugin/plugin.ts:34` (*"order:
  "post""*). Reuse the pattern for the identity meta tag.
- Hashed asset names, so the built bundle's file list is a content identity:
  `beebox/src/webapp/static-cache.ts:4` (*"Vite emits everything under
  `dist/assets/` with a content hash in the filename"*). Verified 2026-11-16: two
  `vite build` runs of the same tree produced identical `index.html` and the
  same 201 asset names, so a rebuild of unchanged frontend source keeps the
  identity. The deploy always rebuilds from a clean checkout
  (`beebox/deploy/deploy.sh:463`: `(cd "$CHECKOUT/beebox/src/frontend" && pnpm --silent build)`).
- `index.html` is never cached long: `static-cache.ts:9` (*"Nothing else is:
  `index.html` is the un-hashed document…"*). `public/sw.js` has no `fetch`
  handler (its only `fetch` is the push resubscribe), so the service worker
  cannot serve an old document.
- The page document comes from the box server's SPA fallback
  (`beebox/src/webapp/server-root/root-routes.ts:347`:
  `fs.readFileSync(path.join(opts.frontendPath, "index.html"), "utf-8")`). The
  same process serves the WebSocket. So the identity read from that
  `frontendPath` is exactly what a reload would get.
- The always-open subscription: `NotificationBanner` mounts in `ProductLayout`
  (`beebox/src/frontend/src/main/app-shell.tsx:138`) and subscribes to
  `events.subscribe`, so the lazy WebSocket stays open. `wsLink` resubscribes on
  reconnect (`useBusSubscription.ts:9`: *"`onConnect` fires when the
  subscription (re)starts"*). A subscription that yields once on start is
  therefore an "on connect and reconnect" hello.
- Warnings always reach the server log:
  `beebox/src/frontend/src/components/DebugLog.tsx:4`: *"Console errors and
  warnings are always captured and forwarded to the server"*.
- Reload-unsafe state, found by survey (no global probe exists for any of them):
  - Composer: per-instance emission store from `useEmissionStoreInstance`
    (`components/chat/input-store.ts:81`), mounted once in
    `BoxConversationShell/view.tsx:45`. Chat file uploads are tracked inside it
    (`input/emission-store.ts:68`: `{ status: "uploading"; … }`).
  - Streaming: `chatMachine` states `loading → idle ⇄ streaming → refreshing`
    (`machines/chatMachine/machine.ts:4`); queued sends in
    `context.pendingMessages`. One actor per conversation in
    `ConversationControllerPool` (`components/chat/conversation/controller-pool/pool.ts:59`),
    one pool per page (`use-conversation-machine.ts:46`).
  - Uploads outside the composer: `uploadBinary` (`lib/binary-upload.ts:80`,
    used by the voice staging queue and the capture page), and the browser-task
    `SubmissionForm.tsx:202` XHR.
  - Recording: `claimMicAcrossTabs` (`lib/audio/mic-tab-lock.ts:59`) is held
    while live transcription records; the capture page keeps
    `recording` in hook state (`pages/capture/useCaptureSession/hook.ts:60`).
  - Compose (card "composition" editing): `ComposeEditor.tsx:143`:
    `if (created.sync.hasUnsaved() || (!ended && openConflictCount(created.view.state) > 0)) event.preventDefault();`.
- iOS shell already survives a web-initiated reload:
  `ios-app/BeeBox/Views/ChatWebView.swift:509` resets `pageLoaded` and
  `composerBindingNegotiated` on `didStartProvisionalNavigation`, and `:501`
  redelivers `pendingEmissions` on `didFinish`. The native composer's text lives
  in Swift, not in the page. The shell fires `visibilitychange` on background
  and foreground (`lib/call/page-exit.ts` listens to it "in the native shell").

## Prior art (external)

- Vite has no built-in "new deploy" detection; the common pattern is a version
  file or a hashed entry compared on focus (evaluated-only; this plan uses the
  existing WebSocket instead of a fetch on focus, per the brief).
- No decision depends on another external premise.

## Ontology

- **Frontend build identity** — a short hex string naming one built frontend
  bundle. New. Written by the Vite plugin into `dist/index.html` as
  `<meta name="bbx-frontend-build" content="…">`. It is NOT the deploy commit:
  a docs-only or server-only deploy keeps it. Absent in the Vite dev server.
- **Client build** — the identity in the running page's own document
  (`document.querySelector('meta[name="bbx-frontend-build"]')`). Null in dev.
- **Server build** — the identity in the `dist/index.html` the box server
  would serve now, reported by `build.watch`. Null when the server has no
  built frontend or the file has no meta tag.
- **Build skew** — client build and server build both non-null and different.
- **Reload blocker** — a named probe `() => boolean` registered by a module
  that holds state a reload would lose. New. Reasons: `composer`, `streaming`,
  `upload`, `recording`, `compose-edits`.
- **Reload attempt** — `sessionStorage["bbx-build-reload"] = { target }`, the
  server build a reload was issued for. New. Used only by the loop guard.
- **Fresh show** — the period after the tab becomes visible (or the page
  loads), before the first `pointerdown` or `keydown` and at most 30 s.

## Tracks / scope

### A. Build identity

- **What:** the build writes an identity into `index.html`; the server reports
  it over the WebSocket.
- **Why:** nothing names the frontend bundle today (searched `beebox/src` for
  a build id, version handshake: none).
- **Direction:**
  - `src/frontend/src/dev/build-identity-plugin/plugin.ts`: `apply: "build"`,
    `transformIndexHtml` `post`, hashes `html` plus the sorted `fileName` of
    every bundle item with SHA-256, takes 16 hex chars, injects the meta tag.
  - `readFrontendBuild(frontendPath: string): string | null` (in
    `src/webapp/trpc/routers/build.ts`) reads `index.html` and extracts the
    meta.
  - `TrpcContext` gains `frontendBuild: string | null`, computed once per box
    registration in `server-box-scope.ts` (a deploy restarts the server, so
    the value cannot go stale in a running process).
  - `src/webapp/trpc/routers/build.ts`: `build.watch` subscription. Yields
    `{ frontend: ctx.frontendBuild }` once, then waits for `signal` abort.
    Public procedure: the identity is a hash of public asset names.
- **Vocabulary lock-ins:** meta name `bbx-frontend-build`; procedure
  `build.watch`; frame `{ frontend: string | null }`.
- **First chunk:** plugin + `readFrontendBuild` + router + context field, with
  tests. No open questions.

### C. Reload blockers (before B, which reads it)

- **What:** `src/frontend/src/lib/reload-blockers.ts` with
  `registerReloadBlocker(reason: ReloadBlockReason, isBlocking: () => boolean): () => void`
  and `activeReloadBlockers(): ReloadBlockReason[]`.
- **Why:** each unsafe state lives in a hook or closure; the decision needs to
  read all of them at one moment.
- **Direction (one registration each):**
  - `composer`: in `useEmissionStoreInstance`, blocking when the draft has
    any text, an image still encoding (`pendingImages`), or any image, file,
    or selection.
  - `streaming`: in `useConversationMachine`, via a new
    `ConversationControllerPool.busy()`: a pinned send being delivered,
    `streaming`, a start awaiting its session, unechoed `pendingMessages`, or
    `refreshing` while it still holds stream text, tools, or a lost reply. A
    plain `refreshing` resync does not block: every reconnect and every return
    to the tab starts one (found in the browser walk), and a reload refetches
    the same history.
  - `upload`: `uploadBinary` registers for the request's lifetime. The
    browser-task `SubmissionForm` registers from the first picked file until
    the submission is accepted or the files are removed. Composer file uploads
    are covered by `composer`.
  - `recording`: `claimMicAcrossTabs` registers for the claim's lifetime; the
    capture page registers while a capture session is open.
  - `compose-edits`: `ComposeEditor` registers the same predicate as its
    `beforeunload` handler.
- **First chunk:** the registry with tests, then the six registrations.

### B. Client decision, loop guard, banner

- **What:** the client compares builds and acts.
- **Direction:**
  - `src/frontend/src/lib/build-skew/decide.ts` (pure):
    `decideBuildAction(input: { client: string | null; server: string | null; visible: boolean; freshShow: boolean; blockers: readonly string[]; attemptTarget: string | null | "unavailable" }): "none" | "wait" | "reload" | "banner"`.
    Rules in order: no skew → `none`; hidden → `wait`; `attemptTarget` equals
    the server build or storage unavailable → `banner`; not a fresh show →
    `banner`; any blocker → `banner`; else `reload`.
  - `src/frontend/src/lib/build-skew/store.ts`: holds the server build, the
    fresh-show window, banner dismissal (per server build), and runs the
    decision on two triggers: a `build.watch` frame, and the page being shown
    (`visibilitychange`, persisted `pageshow`, and in the iOS app the
    `beebox:shell-shown` event when the native box screen uncovers the page,
    as `AppNav/PresenceHeads.tsx` already reads it). Before
    `location.reload()` it writes the attempt record `<client>><server>`; when
    client equals server it logs `[build] reloaded client=<old> server=<new>`
    and clears the record. The new page writes that line because a warning
    logged just before the reload can be lost in the debug log's 500 ms send
    buffer (`DebugLog.tsx`). Logs one
    `console.warn("[build] skew …")` per (server build, action).
  - `src/frontend/src/components/BuildSkewBanner.tsx`: subscribes to
    `build.watch` and renders the banner, mounted beside `NotificationBanner`
    in `ProductLayout`. Text: "A new version of Bee Box is available." Buttons:
    **Reload** (`location.reload()`) and a close button.
- **First chunk:** `decide.ts` with its table test. No open questions.

## Could this be simpler?

- Banner only: drops Tracks C and most of B. Fails the main situation: the
  person returning to a stale tab still meets broken behavior until they notice
  the banner, which the boxholder rejected.
- Reload on every show with skew, no probes: loses a half-written message's
  focus and an in-flight stream or recording. Drafts survive a reload, but
  uploads, streams, and recordings do not.
- Whole-deploy commit as identity: simpler server side (`deploy-info.json`),
  but reloads on docs-only and server-only deploys, which the brief excludes,
  and it does not exist on local or docker installs.
- Fetch on focus instead of a subscription: one fewer moving part for the iOS
  resume race, but a new request path, against the brief. The fresh-show window
  covers the race instead: on resume the socket reconnects within seconds and the
  first frame arrives before the person has touched the page.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Reload serves old bundle again (cache, half-deployed) → loop | decide table test | attempt record → banner | clear: banner + log |
| `sessionStorage` throws (private mode) | decide test (`"unavailable"`) | banner, never reload | clear |
| Dev server page has no meta | decide test (client null) | `none` | silent by design |
| Server has no `dist` (unbuilt) → server null | decide test; `readFrontendBuild` test | `none` | silent by design |
| A new blocker source is added later and not registered | none (cannot test absence) | — | silent: documented in `reload-blockers.ts` header and `frontend.md` |
| Socket reconnects after the person starts typing (slow iOS resume) | decide test (`freshShow: false`) | banner | clear |
| Probe throws | registry test | treated as blocking | clear (logged) |
| Two tabs both reload | n/a | each tab decides alone; harmless | — |
| Vite plugin order: meta missing from built HTML | plugin test on a build fixture | build fails if absent | clear |

No critical gap. The unregistered-future-source risk is accepted: the
registry header names the rule, and the banner path still covers anything the
person sees as busy.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: ADDRESSED — one meta name, one frame field.
- Stale ref: ADDRESSED — a reconnect yields a fresh frame; the client keeps the
  latest only.
- Two agents / concurrent writers: no box data written.
- Hand-edit drift: not applicable; no agent-facing surface.
- Fabricated value: not applicable.
- Validation error UX: a malformed frame is ignored and logged.
- Transition state: the first deploy of this change. Old pages have no
  `build.watch` code, so they need one manual reload; every later deploy is
  covered. An old page calling nothing is harmless.

## NOT in scope

- Native iOS reload on foreground or page age: the web fix covers the web
  view; the shell already fires `visibilitychange` and survives reloads.
- Dev router: Vite already reloads stale dev tabs; dev pages have no identity.
- Server push of a new identity without restart: a deploy restarts the box
  server, which reconnects every socket.
- Forced reload when skew breaks a specific call: the open question in the
  issue; not chosen.
- Restoring scroll position or the open route after reload: the URL keeps the
  route; scroll restoration is the browser's.
- The precompress plugin fails when `vite build --outDir` is absolute (found
  while verifying determinism): filed separately if confirmed.

## Plan review (codex gpt-6-sol, 2026-11-16)

Accepted and folded into Tracks B and C: a send pinned in the pool before the
actor sees it; a photo still encoding; files picked in the browser-task form
before submit; the iOS native box screen covering the page
(`beebox:shell-shown`); the mismatch line lost to the reload. Kept: the 30 s
fresh-show bound. The reviewer asked to cut it to "until first input"; without
a bound, a person reading a tab untouched for minutes would have it reload
under them, which is the "page moves while I use it" case the design rules
out. Past the bound the tab falls back to the banner, which the brief allows.

## Open design questions

none. The fresh-show bound (30 s, first `pointerdown`/`keydown`) is settled in
Direction.

## Knowledge audits

Skipped: no agent-facing concept. The `[build]` log line is described in
`frontend.md` for field probes.

## What will hold this after it ships

- `decide.ts` is pure, so a table test covers every rule, including the loop
  guard and fail-closed cases.
- `reload-blockers.ts` unit test: register, unregister, throw-as-blocking.
- `ConversationControllerPool.busy()` unit test with a stub actor snapshot, if
  the pool's test seam allows; otherwise covered by the browser walk.
- `readFrontendBuild` and `build.watch` tests on the server (tRPC caller
  test helper).
- Plugin test: run the plugin's hook on a fake bundle and check the meta.
- Browser walk (exhibit): load the page, change the served identity, hide/show,
  see the reload; repeat with composer text, see the banner.

## Implementation order

1. Track A (server + plugin) with tests. Commit.
2. Track C registry with tests, then the six registrations. Commit.
3. Track B `decide.ts` + test, store, banner, mounting. Commit.
4. Docs paragraph; browser walk and exhibit; package checks; cross-model
   branch review.

## Rollout shape

Done when the decide table test, the blocker test, the `readFrontendBuild` and
`build.watch` tests pass, `pnpm typecheck` and `pnpm layout-check` pass, and
the browser walk shows both the reload and the banner. No migration: no data
changes shape. No knowledge audit.
