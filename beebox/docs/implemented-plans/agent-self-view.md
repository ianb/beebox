---
title: "Agent self-view: the box agent opens, looks at, and uses its own box's pages"
status: implemented
workstream: agent-self-view
issues:
  - ../../../issues/closed/features/2026-10-29-box-agent-cannot-see-its-own-visual-work.md
  - ../../../issues/features/2026-11-06-narrow-chat-screenshot-to-users-view.md
---
# Agent self-view

The box agent builds cards and views but cannot see them. The box browser (`bbx browser`) runs a real Chrome but holds no box credential, so it cannot open the box's own pages. This plan gives that browser a short-lived, box-scoped credential so the agent can open its box's pages with the agent's own authority, through the same `bbx browser` commands it already uses: a path starting with `/` names a page of its box, and `screenshot --card` captures the open card whole and says whether it fit. It narrows `bbx chat screenshot` to "what the person is looking at right now".

**Issues addressed:**

- `issues/features/2026-10-29-box-agent-cannot-see-its-own-visual-work.md` (owned): resolved by Tracks A–C.
- `issues/features/2026-11-06-narrow-chat-screenshot-to-users-view.md` (owned): resolved by Track D. Its item 3 (keep or drop the command) is answered with a count, not a removal (Open design questions).
- `issues/features/2026-06-12-agent-browser-scoped-to-box.md` (workstream `shared-browser`): its "still open" half, the agent loading its own box's pages, is closed by Track A. Not in `issues:` because its other half (identity at the boxholder's level) is deliberately not done (NOT in scope); a status note is added to it.
- Related, not resolved: `issues/features/2026-10-05-box-agent-interface-screenshots.md` (annotated interface screenshots) is a later consumer of box paths in `bbx browser`.

Searched the queue for `screenshot`, `self-check`, `view render`, `agent-browser`, `box credential`, `see its own`: no other duplicate.

**As built (2026-11-08):** Tracks A–E are implemented. Where the text below names a module under `src/core/browser/`, `box-path.ts`, `pass-install.ts` and the exec-route glue (`run.ts`) live in `src/core/browser/agent-command/`; the pass itself is `src/core/browser/pass.ts`, the capture is `src/core/browser/card-shot/`. Not done and left to the boxholder: the Cloudflare check after deploy (Open design questions), keeping or dropping `bbx chat screenshot`, review of the security-report amendment (landed marked DRAFT, unreviewed), and the shared dev router restart that activates the router changes. The residual risks are listed under NOT in scope.

## Design

### Situations

- When Priya asks the agent to make her recipe cards show a scaling control and the agent has written the view, the agent wants to see the card at phone width and at desktop width, so it can tell her it works, or fix the overflow it sees, before she finds it in the kitchen.
- When the agent built a habit-tracker view with tabs and a "mark done" button, it wants to click the second tab and press the button, then read the page and see it, so it can say the interaction works, not only that the view compiled.
- When Tomas says "this table is cut off on my phone", the agent wants to reproduce it at phone width on the same card without asking for his screen, so it can fix it while he is away from the computer.
- When Noor says "what's that red badge here?" about the screen she is looking at, the agent wants her actual screen, so it answers about what she sees. This is where `bbx chat screenshot` stays.
- When a scheduled job edits a view at night, nobody is there to share a screen, and the agent still wants to check the result, so the morning starts with a working card.
- The person does not want this: when the agent is checking its work, the person does not want it to pop up a screen-share request, steal focus, or change what the person's own browser shows. Self-checks happen in the box's browser, not in the person's tab.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Agent checks a view it wrote | Act, quietly | The box browser; nothing in the person's tab | Background |
| Agent tests an interaction | Act, quietly | Same tab, driven by `bbx browser` | Background |
| Person reports a phone-only bug | Act, then say what it saw | Box browser at phone width; the reply in chat may include the image | Waits to be found (in the reply) |
| Person asks about their own screen | Ask for their screen | `bbx chat screenshot` (unchanged mechanism) | Interrupts: needs the person's consent, as today |
| Scheduled run | Act, quietly | Box browser; result in the run summary | Background |

### Spirit

- **Serves:** "People aren't broken versions of their better selves": the person is not asked to be the agent's QA. The agent checks its own work before handing it over.
- **Serves:** "You should be able to see the gears": the agent can show the person the exact image it checked ("here is the card at phone width").
- **Risks:** "It should feel like a place": an agent that clicks around in the box could change things the person did not ask for (it clicks "mark done" on a real card). Guard: interaction acts with the agent's own authority, which can already change those files, and the browser skill's existing rule applies: say what you will change before acting on real data (Trust).

### Trust

- Looking (open, capture, read text and the accessibility tree) is automatic: it changes nothing.
- An interaction that changes box data (a "mark done" press, a form submit) is the same action as the agent editing the card file, and follows the rules the agent already has for changing the box. The browser skill gets one line: an interaction that saves data is a real change; prefer a throwaway card or say what you will press.
- Owner-only surfaces (Settings, pairing a phone, Secrets, Admin) are not reachable: the credential acts as the agent, not the owner. No rung moves this.

### When it goes wrong or does nothing

- The box has no browser installed: `bbx browser` prints the existing reason ("This box has no browser installed"); the guidance says to check with `bbx view check`, typecheck, and the source.
- The box has no address the browser can reach (no public URL, no dev router): it says so by name and stops; no guess.
- The card is taller than the capture limit: the output says "the image shows the top N px of M px" so a partial image is never mistaken for the whole.
- The view throws: the output names the error the page shows and the console errors, and still gives the image.
- The page needs the owner (a Settings link the view opens): the page shows the app's own refusal; the agent reports that it cannot see owner pages.

### Walkthrough

Priya asks for a scaling control on recipes. The agent edits `src/views/recipe.tsx` and runs `bbx view check` (passes). It runs `bbx browser set viewport 390 844`, `bbx browser open /views/_content/recipes/Classic_Beef_Stew.recipe.card`, and `bbx browser screenshot --card`. The engine has already put a fresh pass in the browser. The output gives the image path, "whole card (366×2027)" and one finding: the "Scale" row is 25 px wider than its box. The agent reads the image, sees "3x" cut off, makes the row wrap, and captures again: no overflow. It sets the viewport to 1280 and captures again. It runs `bbx browser snapshot -i`, clicks "2x", runs `get text` on the card, and reads the doubled quantities. It tells Priya the control works on phone and desktop and attaches the phone image. The images stay under `_tmp/browser/`.

## Smallest fix and budget

**Smallest fix:** give the box browser the credential (Track A, about 350 source and test lines) and a paragraph of guidance: "open `<box url>/views/<path>` with `bbx browser`, set the viewport, screenshot". It fails the issue's stated needs: an element screenshot inside the app is clipped by the card panel's inner scroll container (spike, 2026-11-08: the recipe card is 2027 px tall in a 671 px panel; the plain element capture painted only the visible part, and the rest came out blank). Nothing tells the agent the image is partial. An agent would also need to know the panel id encoding and run measuring JavaScript by hand.

**Chosen:** Tracks A–E. Estimate, additions plus deletions:

| Track | Source | Tests |
|---|---|---|
| A. Browser pass and the gates | 260 | 330 |
| B. Install the pass in the box browser | 120 | 120 |
| C. Box paths and `screenshot --card` | 300 | 250 |
| D. Guidance and audits | — | 80 (audit YAML) |
| E. Security report | — | — |

About 1,460 source and test lines. Authored docs and guidance text: about 300 lines (Track D, the security report rows, this plan's status notes). Generated output (help snapshots, box docs regenerated by `pnpm docs-gen`): reported separately at the end. Under the 2,000-line BIG CHANGE mark.

What the fuller design buys over the smallest fix: a capture that is whole or says it is not (the issue's "report what the image does not contain"); both widths in one call; the overflow finding, which the spike showed catches a real bug a person would hit; text and accessibility tree from the same state; and a page left open in a known tab, so interaction follows with the ordinary `bbx browser` commands.

## Stated preferences this plan trades against

- **Cross-box isolation is zero-exception.** `docs/security-report.md:546`: *"must be **zero** exceptions"*. The credential is a cookie that a browser may send to a sibling box's path on the same production origin. Track A strips it at the hub for every box but its own.
- **No widening of the agent's authority.** The brief and the agent-browser issue (`issues/features/2026-06-12-agent-browser-scoped-to-box.md`: *"Must NOT become a privilege-escalation path"*). The pass resolves to actor `agent`, the same context the agent bearer gets (`src/webapp/server-box-scope.ts:286-303`). It does not resolve to the owner, which is what the browse key does on an opted-in box (`src/webapp/box-identity.ts:21-23`). Trade: owner-only pages are not checkable by the agent.
- **Principle 8, one way to do each thing.** Everything stays in `bbx browser` (boxholder, 2026-11-08: no more interface surface area). The only additions are a box-relative address and one opt-in flag for what the agent cannot do reliably by hand: a whole-card capture with a fit statement.
- **Minimize invented concepts** (boxholder memory, "prefer primitives"). The pass reuses the mobile cookie's signing and key derivation (`src/core/mobile/session.ts:85-99`) under its own HKDF label. The target element is found with the existing panel id (`workspacePanelId`, `src/frontend/src/components/chat/workspace/address.ts:21-23`), not a new attribute. The target is named with the existing view-URL form (`src/frontend/src/lib/view-url.ts:1-8`).
- **Prefer reusing agent-browser and the existing browser host** (brief). Everything runs as agent-browser commands through the host's command socket (`src/core/browser/command-socket.ts`); no second browser stack.
- **Bias toward strict** (boxholder memory). Fail closed on every credential path; a missing app URL is an error, not a guess.

## What already exists

- **Box browser and its exec route.** `src/webapp/routes/browser/exec-route.ts:47-70` posts arguments through `checkExecArgs`, then `ensureHost` and `sendBrowserCommand(host.paths.cliSocket, args)`. Reuse: Track B mints the pass before each command; Track C rewrites box paths and handles `screenshot --card` in the same route.
- **Agent bearer.** `src/core/agent/token.ts:11`: *"`.beebox/agent-token` (mode 0600, gitignored)"*; never rotated. Header-only. Not reusable as a cookie: `src/core/browse-key.ts:5-9` explains why a file secret should not become a browser credential, and it has no expiry.
- **Mobile session cookie: the model for the pass.** `src/core/mobile/session.ts:20-35`: pure-HMAC verification, *"Verification is pure HMAC with no filesystem access"*; on a unit host the key is HKDF over the box's hub secret, so the hub verifies the same cookie the box does (`:27-35`, `deriveMobileSessionKey` `:85-91`); elsewhere a per-box 0600 secret file (`:56`, `SECRET_RELATIVE_PATH`). The hub's check is `mobileAuthed` (`src/hub/server/box-credentials.ts:42-48`). Reuse: the key source (`readSecret`/`getOrCreateSecret`), with a second HKDF step under the label `beebox box browser pass v1` so a mobile cookie can never verify as a pass or the reverse.
- **Mobile cookie attributes.** `src/webapp/mobile-cookie.ts:33-49`: `path: /<slug>`, `httpOnly`, `secure` from the public URL, `sameSite: "lax"`. The pass cannot use `/<slug>`: the app shell fetches the hub's listing at `withBase("/api/boxes")` (`src/frontend/src/lib/boxes.ts:29`), outside the box path, and renders "Box not found" without it (`app-shell.tsx:97-108`, found by the research agent, 2026-11-08).
- **The three gates.**
  - Box: `addBoxAuthHook` (`src/webapp/server-box-scope.ts:68-152`) and the tRPC context (`:240-320`), where `bearerOk` makes `actor: "agent"`, `authed: true`, `user: null`.
  - Hub: `hasBearerAuth` (`src/hub/server/core.ts:135-148`) passes the agent bearer for plain HTTP; the upgrade handler does not call it (`:541-552`); `/api/boxes` refuses it (`respondHubBoxes`, `:161-186`).
  - Dev router: `resolveMobileForBox` and `resolveWorktreeAsset` (`workstreams-app/src/router/server/auth-deps.ts:128-180`) accept the agent bearer and browse key; the gate runs on upgrades too (`auth.ts:13`); the box list is the `worktree-box-list` class (`auth.ts:81-90`).
- **Rendering as "authenticated, nobody" works.** Spike, 2026-11-08: with `agentBrowsing` removed from the worktree test box's `box.json`, the browse key is `authed` with `user: null`, and the recipe card page rendered fully at 1280 px. So actor `agent` renders cards once the box list and live-update socket accept it.
- **Element capture.** agent-browser 0.39.2 `screenshot [selector] [path]` (`agent-browser screenshot --help`). Spike: a capture of the card `article` inside the scrolling panel kept the full element size (366×2027) but painted only the visible part. After `set viewport 390 2300` it painted the whole card. `set viewport`, `eval`, `get text`, `snapshot -s`, `tab new --label`, `cookies set --url --path --httpOnly --secure --sameSite --expires` all exist in the pinned version (`agent-browser <cmd> --help`).
- **Overflow measurement.** Spike: comparing each descendant's `scrollWidth` with its `clientWidth`, and its right edge with the card's, found the recipe "Scale" row (`scrollWidth 309 > clientWidth 284`) and one false positive, the rotated "Properties" tab (`overflow: hidden`, a 1 px box). Elements with `overflow` hidden or clip are skipped.
- **Card target.** `/<slug>/card/<path>` redirects to `/<slug>/views/<path>` (`src/frontend/src/main/router.tsx:216-233`); the card's panel has id `workspacePanelId(path)` (`address.ts:21-23`, `controlAddress` in `src/shared/ui-scan/control-address.ts:86`, importable on the server). At phone width the app moves the card to `/chat?card=<path>`; the panel id is the same.
- **App URL.** Production: the operator's `BBX_PUBLIC_URL` through `getPublicUrl` (`src/lib/public-url.ts:28-30`); not `resolveBoxPublicUrl` (`:50-58`), which lets `_config/box.json` win. Dev: no box process knows the router URL. The router sets `VITE_BASE: /<name>/` but no URL (`workstreams-app/src/router/core/worktree-start.ts:67-85`); `BBX_SERVER_URL` in dev is the box's own TCP port (`src/webapp/server/serve-publish.ts:21-22`), which serves no frontend (Vite does, behind the router).
- **`bbx view`** has `check`, `typecheck`, `lint` and the hidden `render-one` (`src/cli/commands/view/command.ts:378-383`). Unchanged; the first draft's `bbx view look` was dropped (Track C).
- **Screenshot guidance today:** `src/core/chat/session/prompts.ts:145` (*"When appearance is the question … `bbx chat screenshot` returns … a real capture of the user's screen right now"*), `src/core/box/guidance-sync/skills/content.ts:226` (views skill: *"When the user says a view "looks wrong" … run `bbx chat screenshot`"*), `src/core/docs-gen/package-docs/bbx-commands-scheduling.ts:180-190` (*"Reach for it on visual/layout questions — how a card or custom view actually renders"*), `src/core/views/doc/core.ts:317-318` (*"look at the view in the app to confirm"*), `src/core/agent-guide/ledger.yaml:504-509`, and the audit `chat-screenshot-when` (`src/dev/knowledge-audits.yaml:6134-6150`), which currently rewards the self-check use.
- Searched `src/` for an existing server-side page renderer or a headless capture helper other than agent-browser: none.

## Prior art (external)

- **agent-browser 0.39.2** — adopted already (shared-browser plan). New premises verified locally on 2026-11-08: element screenshots keep the element's full box but paint only what is inside the scroll container; growing the viewport fixes it; cookies can be set with URL, path, HttpOnly, Secure, SameSite and expiry before navigation.
- **Playwright/Puppeteer full-page capture of scroll containers** — evaluated only. The known pattern is to resize the viewport to the content height or to expand the container with injected CSS. We resize: it needs no change to the page's CSS, and the page lays out as it would on a tall screen.
- **SameSite=Strict on navigations from automation** — evaluated: a CDP `Page.navigate` is a browser-initiated navigation (`Sec-Fetch-Site: none`), so Strict cookies are sent. Verified in Track B's dev walk; not relied on before.
- No acknowledgement entry: nothing new is adopted.

## Ontology

- **Box browser** (existing, `docs/plans/shared-browser.md` Ontology): the one agent-browser session `box` per box. Unchanged.
- **Browser pass** (new): a signed cookie value `<base64url payload>.<hmac>`, payload `{ exp }` (strict schema). Cookie name `bbx_browser_pass`. Proves "the box browser of this box, until `exp`": the signing key is per box in every mode (the per-box secret file, or on a unit host the per-box hub secret), so the signature binds the box and the payload names none (changed during implementation, 2026-11-08: a slug in the payload was redundant and kept the identity resolver, which has no slug, from checking the pass). Acts as actor `agent`. It is NOT a session, NOT a person, and NOT the agent bearer: no route that checks `verifyAgentBearer` accepts it. Lives only in the box browser's profile.
- **Pass key** (new, derived): HKDF-SHA256 over the box's mobile-session key with info `beebox box browser pass v1`. Not stored.
- **App URL** (new name for an existing value): the base URL a person opens the box's app at, without the slug. Production: `BBX_PUBLIC_URL`/`PUBLIC_URL`. Dev: `BBX_DEV_APP_URL`, set by the router to `http://localhost:<port>/<worktree>`. Not `BBX_SERVER_URL` (the agent's API base, which in dev is a port with no frontend).
- **Box path** (new): an address given to `bbx browser open`/`goto`/`navigate`/`tab new` that starts with one `/`; it names `<app URL>/<slug><path>`. Not a protocol: the URLs the browser prints back are the real ones, and the agent can pass those too.
- **Card capture** (new): `bbx browser screenshot --card [path]` on a box card page. The capture element is `#<workspacePanelId(path)> > article`; the card path comes from the page URL (`/views/<path>` or `/chat?card=<path>`).
- **Fit** (new): `whole` (the painted area is the whole card) or `partial`, which names what is missing: "the image shows the top P px of M px" and/or "the card is W px wide; the image shows the left V px". The image is cropped to the painted area. The viewport height is capped at 8,000 px.
- **Painted area** (new): the part of the card that Chrome actually painted in a capture, from the measures: the intersection of the card's rectangle with its scroll container's and the viewport's, in both dimensions. Fit is `whole` only when it covers the card's full width and height.
- **Overflow finding** (new): a descendant of the target whose content is wider than its box (`scrollWidth > clientWidth + 1`, `overflow-x` not hidden or clip), or whose right edge passes the target's; reported with its tag, a 40-character text excerpt and the excess in px.

## Tracks / scope

### Track A. Browser pass and the gates

- **What:** the pass module, and acceptance of the pass at the box, the hub and the dev router.
- **Why:** the box browser has no credential (`issues/features/2026-06-12-agent-browser-scoped-to-box.md`, status 2026-10-30), and the agent bearer is a header that a browser cannot attach to subresources or the WebSocket.
- **Direction:**
  - `src/core/browser/pass.ts`:
    - `BROWSER_PASS_COOKIE = "bbx_browser_pass"`, `BROWSER_PASS_TTL_MS = 60 * 60 * 1000`.
    - `signBrowserPass(boxRoot, { slug, ttlMs, now }): { value, exp }`. Uses `getOrCreateSecret` from `core/mobile/session.ts` (exported for this as `mobileSessionKeyForSigning(boxRoot)`; on a unit host it returns the derived key, as `readSecret` already does).
    - `verifyBrowserPassWithKey(key: string | null, slug: string, cookieHeader: string | undefined, now): boolean`. Tries every `bbx_browser_pass` value (`parseCookieHeaderAll`, as the mobile check does). `exp > now`; a bad signature, a bad schema or a missing key returns false.
    - `passSiteOk(headers, appOrigin: string): boolean`, pure, checked before the signature at every gate. A pass counts only on a request the box's own pages or the agent's typed navigation made: `Sec-Fetch-Site` is `same-origin` or `none`; any other value (`same-site`, `cross-site`) refuses. A request with no `Sec-Fetch-Site` counts only when it is a WebSocket upgrade whose `Origin` equals `appOrigin`, because Chrome sends no fetch metadata on the handshake (`src/webapp/routes/browser/proxy/person-gate.ts:54-60`, the same rule for the person's browser proxy). Anything else with no fetch metadata refuses: the pass exists only inside Chrome, which always sends it. This is what stops a page on a sibling subdomain (same-site, so a `Strict` cookie still rides its requests) from using the pass; `SameSite=Strict` alone does not (cross-model review, 2026-11-08). `appOrigin` comes from the same environment value as the app URL (Track B) at the box and dev router, and from the hub's own public URL at the hub.
    - `verifyBrowserPass(boxRoot, slug, headers)`: the box and dev-router form, with the key from `readSecret`.
    - `stripForeignBrowserPasses(cookieHeader, keep: (value) => boolean): string | undefined`: removes every pass value that `keep` refuses; used by the hub.
  - Box (`src/webapp/server-box-scope.ts`): in `addBoxAuthHook`, after the agent bearer: `if (verifyBrowserPass(box.boxRoot, box.slug, request.headers)) return;`. In the tRPC context: `const passOk = verifyBrowserPass(...)`; `bearerOk || passOk` feeds `actorFor` and `authed`, and the store-outage fail-closed check (`:257`) treats `passOk` like `bearerOk`.
  - **A verified pass wins over every person credential on the same request.** The box browser's profile can also hold a person's login (the person may sign in to the box in the shared browser), a mobile cookie, or, in dev, nothing else; without this rule `user` and `isOwner` would come from that login (`server-box-scope.ts:281-320`; `ownerProcedure` checks `isOwner`, `src/webapp/trpc/procedures.ts:58`). With `passOk`, the context sets `user: null`, `isOwner: false`, `isAuthenticatedOwner: false`, `mobileDeviceId: null`, and the preHandler returns before identity resolution. At the hub, a request whose pass verifies takes the pass-through branch and gets no identity headers, even when it also carries a session cookie. Box-scoped readers of identity outside tRPC (capture ownership, chat send, the browser question routes) call `resolveBoxIdentity` (`src/webapp/box-identity.ts`), which returns nobody for a request with a verified pass, before any other credential. Root routes (`/auth/me`, password change) are not box-scoped and do not see the pass: a person who signs in to the box inside the shared browser has given that browser their session, as for any site, and box pages in it can use the session on root routes. That is a property of the shared browser today, not of the pass; a test sends pass plus owner session and expects agent-level results on one tRPC owner procedure, `/auth/me`, and the hub's identity headers.
  - Hub (`src/hub/server/box-credentials.ts`): `browserPassAuthed(box: { boxRoot, slug, hubSecret }, headers)`: on a unit host the key is `deriveMobileSessionKey(hubSecret)` then the pass HKDF; else `verifyBrowserPass`. Used in `hasBearerAuth` (HTTP), in the upgrade handler beside `hasMobileAuth`, and in `respondHubBoxes`, which lists only the boxes whose pass verifies (as `listMobileAuthorizedBoxes` does). The standalone server's own `/api/boxes` (`src/webapp/server-root/root-routes.ts:292`) gets the same pass-filtered listing. The proxy (HTTP and upgrade) removes from the forwarded `Cookie` header every pass value that does not verify for the target box.
  - Dev router (`workstreams-app/src/router/server/auth-deps.ts`): `resolveMobileForBox` and the per-box loop of `resolveWorktreeAsset` accept `verifyBrowserPass(entry.contentDir, entry.slug, headers)`; the `worktree-box-list` class accepts it for that worktree. No stripping in dev (one Unix user owns every worktree box; NOT in scope).
  - Routes that stay closed to the pass, because they check `verifyAgentBearer` on the header or a person credential: browser exec, page and ask (`exec-route.ts`), the person-facing browser proxy (`routes/browser/proxy/person-gate.ts`, which also gets the pass in its explicit refused list with the same message as the agent bearer), secrets (`routes/secrets.ts`), chat UI and screenshot routes (`routes/chat/ui-routes.ts`, `routes/chat/screenshot-routes.ts`). A test pins each.
- **Vocabulary lock-ins:** cookie `bbx_browser_pass`; HKDF info `beebox box browser pass v1`; payload `{ exp }`.
- **First implementation chunk:** `pass.ts` with unit tests (sign/verify, wrong slug, expired at exactly `exp`, tampered, a mobile cookie value presented as a pass and the reverse, several values with one good, strip). No gate changes.

### Track B. Install the pass in the box browser

- **What:** before any command reaches the box browser, make sure the browser holds a pass that has at least 30 minutes left, for the box's app URL.
- **Why:** the pass is short-lived; the agent must never handle it.
- **Direction:**
  - `src/core/browser/app-url.ts`: `resolveBoxAppUrl(): { ok: true, base: URL } | { ok: false, reason }`: `getPublicUrl("")` (the operator's `BBX_PUBLIC_URL`/`PUBLIC_URL`, `src/lib/public-url.ts:28-30`), else `BBX_DEV_APP_URL`, else `{ ok: false, reason: "this box has no public URL, so its browser cannot open the box's pages" }`. Deliberately not `_config/box.json#publicUrl` (`resolveBoxPublicUrl`, `:50-58`): the agent can edit that file, and the pass must go only to an address the operator configured (cross-model review, 2026-11-08). The scheme must be https, or http on `localhost`, `127.0.0.1` or `[::1]`: Chrome sends no fetch metadata to a plain-http remote origin (W3C Fetch Metadata §3), so `passSiteOk` could never admit a request there; such a URL is refused before any pass is minted (cross-model review round 2).
  - Router: `worktree-start.ts` adds `BBX_DEV_APP_URL: http://localhost:<routerPort>/<name>` to `childEnv`; `script-env/allowlist.ts` does not pass it to agent subprocesses (the engine reads it, the agent does not need it).
  - `src/core/browser/pass-install.ts`: `ensureBrowserPass(host, { boxRoot, slug, now })`: keeps `{ exp }` of the last install in the host handle; when absent or under 30 minutes left, signs a pass and sends `cookies set bbx_browser_pass <value> --url <base> --path <basePath>/ --httpOnly --sameSite Strict --expires <exp>` (plus `--secure` when the base is https) through `sendBrowserCommand`. A failure is returned, not thrown past the route: the exec still runs, and the route appends `note: could not refresh the box browser's pass: <reason>` to stderr, because a pass failure must not break the agent's use of other sites.
  - The exec route calls `ensureBrowserPass` after `ensureHost`. The engine's command server logs no arguments (`src/core/browser/host-process/command-server.ts:165,219` log only socket errors), so the value reaches no box log. The agent-browser daemon may show the command in the dashboard's activity feed; only the person (the boxholder) opens the dashboard, and the value lives one hour. Accepted, and stated in the security report row.
  - Path: `<basePath>/` (`/` in production, `/<worktree>/` in dev). Needed because the app shell reads `<basePath>/api/boxes` and, in dev, Vite modules under `/<worktree>/`. The hub's stripping (Track A) is what keeps it from a sibling box in production.
- **First implementation chunk:** `app-url.ts` and `pass-install.ts` with tests against a stub command sender (installs once, refreshes under 30 minutes, `--secure` only for https, no value in any log line, failure becomes a note).

### Track C. Box pages in `bbx browser`

Revised 2026-11-08 at the boxholder's direction: no new command. The first draft added `bbx view look`; the boxholder asked to keep `bbx browser` as the one interface ("keep the browser stuff the same, so there's not more interface surface area, but make it work"), not to invent a pseudo-protocol for box addresses ("the urls will leak through, so maybe it shouldn't be a protocol"), and to keep the full-card capture as an option that may be removed later ("we can keep the screenshot stuff, but I suspect we might get rid of it in the future").

- **What:** two additions to `bbx browser`, both handled in the engine's exec route:
  1. **Box paths.** An address that starts with one `/`, given to `open` (aliases `goto`, `navigate`) or `tab new`, is a page of this box: `bbx browser open /views/_content/recipes/Stew.recipe.card` opens `<app URL>/<slug>/views/_content/recipes/Stew.recipe.card`. It is an ordinary relative URL resolved against the box, the form `bin/browse` already uses for dev agents (`.claude/skills/browse/SKILL.md`: *"`/chats` becomes `http://localhost:3210/<worktree>/<box>/chats`"*). Full URLs pass unchanged, so a URL the browser printed (`get url`, a link in a snapshot) can be given back as is.
  2. **`screenshot --card [path]`.** On one of this box's own pages, captures the open card's whole element, not the viewport, and says whether the image holds all of it. Every other `screenshot` form is upstream's, unchanged.
- **Why:** the agent needs its box's pages (Tracks A and B make them reachable) and a capture that is whole or says it is not: inside the app a plain element screenshot is clipped by the card panel's scroll container (spike, 2026-11-08).
- **Direction:**
  - `src/core/browser/box-path.ts`, pure: `resolveBoxPaths(args, { base: URL | null, slug }): { ok: true, args } | { ok: false, message }`. Finds the subcommand with the same scan as `execSubcommand` (`src/core/browser/exec-args.ts`). For `open`/`goto`/`navigate`, the first positional after it; for `tab new`, the first positional after `new`. A positional that starts with `/` and not `//` becomes `${base.origin}${appBasePath(base)}${slug}${path}`. `//host` is refused (a protocol-relative URL is another site, not a box path). With no app URL, a box path is refused with the app-URL reason (`resolveAppUrl`). Upstream has no meaning for a bare `/path` here: without a scheme it prepends `https://` (`agent-browser open --help`), so nothing is shadowed.
  - `src/core/browser/card-shot/`, the capture:
    - `measure.ts`: the measuring script, one exported string run with `eval`, and `parseMeasure` (Zod). It finds the card element `#<workspacePanelId(path)> > article`, sets its scroll container's `scrollTop` to 0, and returns the element's full size, its painted rectangle (intersection with the scroll container and the viewport), the device pixel ratio, up to 10 overflow findings, and the view error boundary's text when shown.
    - `run.ts`: `captureCard(send, { pageUrl, appBase, slug, outPath, maxHeight })`, where `send` is the command-socket sender (injected for tests). The card path comes from the page URL in either form the app uses: `/<slug>/views/<path>` or `/<slug>/chat?card=<path>` (`src/frontend/src/components/chat/workspace/WorkspaceProvider/provider.tsx:178,225`), parsed with the view-URL rules. A page that is not this box's, or shows no card, is refused: "`--card` works on this box's card pages; open one with `bbx browser open /views/<card path>`". Steps: read `get viewport`-equivalent size by `eval`, measure; if the card is taller than its painted part, `set viewport W min(H + missing + 40, maxHeight)` and measure again; `screenshot <selector> <outPath>`; crop the PNG to the painted rectangle with `sharp` (device pixels) when it is smaller than the element; `set viewport W H` back (in `finally`).
    - `format.ts`: pure. The output, after upstream's own `✓ Screenshot saved to <path>` line: `card: <path> at <W>px wide — whole card (<w>×<h>)` or `— partial: the image shows the top <P>px of <M>px` and/or `the left <V>px of <N>px`; then `overflow: <tag> "<text>" is <n>px wider than its box` lines; then `view error: <text>` when shown.
    - Default path: `<boxRoot>/_tmp/browser/card-<file stem, 60 chars>-<W>px.png`; a given path is passed through upstream's own path rules.
  - Exec route: after the refused-flag check, `resolveBoxPaths`; a `screenshot` whose arguments include `--card` goes to `captureCard` instead of upstream; `--card` with any other screenshot flag (`--full`, `--annotate`, a selector) is refused with the reason.
  - Phone and desktop widths are the agent's own `bbx browser set viewport 390 844` and `set viewport 1280 900`; text and structure are `get text` and `snapshot -i`. No new mechanism.
- **Vocabulary lock-ins:** box paths start with one `/`; flag `--card` on `screenshot`; image name `card-<stem>-<W>px.png`.
- **First implementation chunk:** `box-path.ts` and `format.ts` with tests (pure), then `run.ts` against a fake sender.

### Track D. Guidance

- **What:** narrow `bbx chat screenshot`; teach the box-page loop in `bbx browser` for self-checks.
- **Why:** issue `2026-11-06-narrow-chat-screenshot-to-users-view.md`.
- **Direction:**
  - `prompts.ts:145`: the screenshot paragraph becomes: it shows what the person is looking at right now, for when they refer to their own screen ("this", "here", "what I'm seeing") and the `open-card` snapshot does not say enough. It is not a way to look at a card, a view, or your own work: for that, open the card in the box browser (`bbx browser open /views/<card path>`, then `screenshot --card`).
  - Views skill (`content.ts:226`): replace the screenshot paragraph with: after `bbx view check`, check a card this view renders with the loop `bbx browser set viewport 390 844`, `bbx browser open /views/<card path>`, `bbx browser screenshot --card`, then `set viewport 1280 900` and capture again, then `snapshot -i` and `click`/`fill` on the controls and capture or `get text` again. Keep the `bbx chat ui` sentence.
  - Views doc testing section (`views/doc/core.ts:317-318`): "look at the view in the app" becomes the same loop, with what the fit line and overflow line mean.
  - Command reference: the `bbx chat screenshot` entry gets the narrow purpose; the `bbx browser` section adds box paths, `screenshot --card`, and one sentence: the box browser opens this box's pages as the agent, not the owner.
  - Browser skill (`content-browser.ts`): a short "Your own box's pages" section: box paths, `screenshot --card` and what its lines mean, the two widths; pressing a control that saves data is a real change.
  - Ledger `commands.chat-family` rule text: screenshot "only for the person's own screen". A new ledger entry for checking the box's own pages in the box browser (bin `indirect`, mechanics in the browser and views skills).
  - Audits (`src/dev/knowledge-audits.yaml`): rewrite `chat-screenshot-when` so the expected answer for "I want to see how the view I built renders" is the box browser (`bbx browser open /views/...`, `screenshot --card`), and add `chat-screenshot-person-screen` ("the person asks what the red badge on their screen is": `bbx chat screenshot`) and `box-page-interaction` ("check that the tab switch in your view works": open the card, `snapshot -i`, `click`, capture again).
- **First implementation chunk:** the text changes, `pnpm docs-gen`, the audit entries.

### Track E. Security report

- `docs/security-report.md`: a row for the browser pass (what it proves, where each gate accepts it, which routes refuse it, the cookie attributes, the hub stripping, the 1-hour life, rotation with the hub secret on a unit host and with the mobile secret file elsewhere). Run the `security-report` skill over the change.

## Could this be simpler?

- **Simplest version:** Track A plus guidance that tells the agent to drive `bbx browser` by hand. It fails the issue's first and third directions: the spike shows a hand-made element capture of a card is partial and looks whole (principle 4: never silent). An agent would also need the panel id encoding, which is base32 of the path and cannot be guessed.
- **Simpler credential: put the agent bearer in a cookie.** It has no expiry, and it would make a 0600 file secret a browser credential, against `src/core/browse-key.ts:5-9`. It also cannot be told apart from a bearer at the routes that must refuse a browser.
- **Simpler credential: let the box browser act as the owner** (the browse key's `agentBrowsing: "owner"` path). It would let the agent reach pairing, Secrets and Admin through the browser, which the agent cannot reach today. That widens authority, against the brief.
- **Simpler transport: a relay from the box browser to the box's own socket, skipping the hub.** No hub or router changes, but in dev the box process serves no frontend (Vite does), and the page origin would differ from the one the person uses. That is two code paths, and the agent would not see what the person sees. Rejected.
- **A dedicated server-side render page** (`bbx view render` on a chrome-free route): no such route exists (research, 2026-11-08). It would show a card outside the app the person uses, it needs the same credential, and it adds a second page type to keep true. Rejected; `look` renders the real page.
- **What each remaining piece buys:** hub stripping keeps zero cross-box exposure with the `/`-path cookie; the pass refresh threshold means the agent never sees an expired-pass failure mid-task; `--card` exists because a hand-made element capture of a card is partial and looks whole.

## Subplans

none

## Failure modes

> **Critical gap (resolved in Track A):** the pass cookie, at path `/` in production, would ride to a sibling box's path if the box browser opened it. The hub strips every pass value that does not verify for the target box; `hub` tests pin it.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A page on a sibling subdomain (same-site) sends a request or opens a WebSocket that carries the pass | `pass.test.ts` `passSiteOk` cases: `same-site`, `cross-site`, absent with a foreign `Origin` | `passSiteOk` at every gate | Clear (401) |
| The box browser also holds an owner login, so a pass request acts as the owner | Box context test with pass plus owner session; hub identity-header test | Pass wins: `user: null`, owner flags false | Clear |
| An agent edits `box.json#publicUrl` to send the pass elsewhere | `app-url` test | Only operator environment values are used | Clear |
| Another command resizes or clicks during a `--card` capture's few steps | None | Not guarded (the first draft's guard was dropped with `bbx view look`); the fit line comes from measures taken right before the capture | Rare: two agents driving one browser at once; accepted |
| A sibling box receives this box's pass and replays it | `hub` proxy test: foreign pass stripped on HTTP and upgrade | Hub stripping; payload slug check at every verifier | Clear (401 at the sibling) |
| A mobile cookie presented as a pass, or a pass as a mobile cookie | `pass.test.ts` | Separate HKDF key; strict payload schemas differ | Clear |
| An arbitrary site in the box browser makes a request to the box | `pass-install` test pins `SameSite=Strict`, `HttpOnly` | Strict cookie is not sent cross-site; HttpOnly hides it from page script | Clear (401) |
| The pass expires mid-task | `pass-install` refresh test | Refresh under 30 minutes left, before every command | Silent by design: the agent never sees it |
| The hub secret rotates at reboot (unit host) | `box-credentials` test with a new secret | The box browser holds a dead pass; the engine restarted too, so its handle has no `exp` and installs a new one on the first command | Clear |
| The box has no app URL | `app-url` test | A box path or `--card` fails with the reason; other commands stay quiet | Clear |
| Cloudflare challenges headless Chrome from the server's IP | None (needs production) | `--card` reports the page's URL when no card is found, so a challenge page is visible | Clear; unverified in production: Rollout |
| The card is taller than the capture limit, or the panel was scrolled | `run` test with a fake 12,000 px measure; e2e fixture | Scroll to top; crop to painted height; fit `partial` with both heights | Clear |
| The selector never appears (card missing, view crashed before mount, wrong path) | `run` test | "the card did not appear within 10 s; the page shows: <title>, <first 300 chars of text>" | Clear |
| The view throws inside its error boundary | `run` test with `errorText` | Reported above the images | Clear |
| The person is using the shared browser while the agent checks a card | None | The agent can open a tab (`tab new /views/...`); the guidance says so | Visible in the dashboard, as any agent use |
| A page in the box browser calls an agent-or-owner procedure (`notifications.send`, `wakeup`) | Not tested | Same authority as the agent's bearer; no widening | Clear in the notification record |
| The cookie value reaches an engine log | `pass-install` test asserts no line contains it | The command server logs no arguments | Silent if it regressed; the test is the guard |
| The person sees the value in the dashboard's activity feed | None | Accepted: the person is the boxholder; one-hour life | Visible |

## Agent-flow / user-flow edge cases

- **Wrong tool:** the agent uses `bbx chat screenshot` to check its own view. ADDRESSED: Track D rewrites all five places and the audits test both directions.
- **Stale target:** the card path was renamed between edit and capture. ADDRESSED: the app shows its own "not found"; `--card` says no card is on the page.
- **Two agents at once:** a chat agent and a scheduled run both drive the box browser. DEFERRED: as before this plan, they share one session; a `--card` capture's few steps can interleave with the other's command. Accepted as rare.
- **Hand-edit drift:** not applicable: nothing is written by hand.
- **Fabricated values:** the output quotes only what the page showed; the guidance keeps the browser skill's "quote the text you read".
- **Validation error UX:** `--card` on a page that is not a box card page prints how to open one (`bbx browser open /views/<card path>`); a `//host` address says it is another site.
- **Transition state:** a box whose engine predates the hub change: the hub and box ship together in one deploy; the dev router restarts on merge. A box browser that holds a pass for an engine that cannot verify it gets 401 and the agent sees the app's login redirect. ADDRESSED by shipping as one piece.

## NOT in scope

- **Acting as the owner in the box browser.** Considered (browse-key precedent); not now: it widens the agent's authority. Owner pages stay uncheckable by the agent.
- **Element-scoped capture in the person's tab** (issue direction 2). Not now: the box browser covers self-checks, and the person's screen keeps its one purpose.
- **Removing `bbx chat screenshot`.** Not now: Open design questions.
- **Dev-router stripping of foreign passes, and other localhost ports in dev.** Cookies are not port-scoped (RFC 6265 §8.5), so in dev the box browser would also send its pass to another server on `localhost` under the same path if the agent opened it. Accepted: the pass is for a worktree's test box, the other servers are the developer's own, and it lives one hour (cross-model review raised it; adjudicated 2026-11-08).
- **Ending an open WebSocket when its pass expires.** A pass is checked when the connection opens; an open subscription outlives it, so whoever holds a pass can open a socket within the hour that lasts beyond it. The pass reaches only the box browser's profile (readable by the box's own agent, which holds the never-expiring bearer anyway) and the dashboard's activity feed (the boxholder). Not adding connection-expiry machinery; listed as a residual risk for the boxholder.
- **Isolation from a sibling box's page on the same origin.** A sibling box's authored view can run in the box browser only if a person session for that box is also in the profile, and that session already gives the page more than the pass does. Cross-box browser isolation on one origin is a documented non-goal for a single operator (`src/webapp/auth.ts`, comment on `resolveRequestIdentity`).
- **A person signed in to this box inside the shared browser.** The pass wins on this box's requests, so the person sees agent-level rights there while the pass is installed. Accepted: people use their own browser for the box; the shared browser is for other sites. Listed for the boxholder.
- **Annotated interface screenshots** (`2026-10-05-box-agent-interface-screenshots.md`): a later consumer.
- **A second browser session for looks.** Considered to keep looks fully apart from the person's view of the shared browser; not now: a second Chrome per box doubles memory on the production host, which the shared-browser plan has not yet measured.
- **Visual diffs between looks.** agent-browser has `diff screenshot`; the agent can use it through `bbx browser` if needed.

## Open design questions

- **Keep `bbx chat screenshot`?** Lean: keep it, narrowed. Measure first: count its uses in the local boxes' chat transcripts (counts only, no content leaves the box) and sort them by reason; record the count in the closing note of the issue and leave the decision to the boxholder.
- **Production Cloudflare path.** Lean: works, since box subprocesses already call the public URL through it. Headless Chrome may meet a bot check that `fetch` does not. Verified only after deploy (a gate this workstream does not hold); the failure is visible (Failure modes).

## Knowledge audits

New agent-facing concept: checking the box's own pages in the box browser (box paths, `screenshot --card`), and the narrowed screenshot. Audits `chat-screenshot-when` (rewritten), `chat-screenshot-person-screen` and `box-page-interaction` (new), all `knows_directly`, run with `pnpm knowledge-audit run --box ~/src/box-worktrees/agent-self-view/test1 --filter <id>` and their status recorded.

## What will hold this after it ships

- Unit tests (`t.check`) for the pure pieces: `pass.ts`, `target.ts`, `format.ts`, `measure.ts` parsing, `app-url.ts`.
- Gate tests in the existing suites: `server-box-scope` auth tests (pass accepted, actor `agent`, `user` null, pass plus owner session still nobody), hub `core` tests (HTTP, upgrade, `/api/boxes`, stripping), the standalone root `/api/boxes`, dev-router `auth-deps` tests, and refusal tests for each closed route.
- `run.ts` against a fake sender replaying recorded agent-browser output: no new tier.
- One e2e in the existing `test/core/browser/host/start.e2e.test.ts` style, skipped only when Chrome is not installed: a static fixture page with a 2,500 px card element (with the panel id the app uses) inside a 600 px `overflow: auto` panel and a distinct coloured block at the card's bottom. It runs `captureCard` through real agent-browser and checks the bottom block's colour is in the image at 390 and 1280 px, and that a 1,500 px cap gives fit `partial`, an image cropped to the painted height, and both heights in the output. The full-app check is the dev walk.

## Implementation order

1. Track A, `pass.ts` and tests. Commit.
2. Track A gates: box, hub, dev router, refusals, tests. Commit.
3. Track B: `app-url.ts`, router env, `pass-install.ts`, exec and page routes. Dev walk: `bbx browser open <box card URL>` from the test box shows the card. Commit.
4. Track C: `box-path.ts`, `card-shot/`, exec route, tests, the real-Chrome e2e. Dev walk: open and capture the recipe card. Commit.
5. Track D: guidance, docs-gen, audits; run the audits. Commit.
6. Track E: security report. Commit.
7. Real agent run on the test box: the agent edits a view and checks it in the box browser, rendering and an interaction. Exhibit. Cross-model branch review; fix; report.

## Rollout shape

- Done when: the tests named above pass; `pnpm typecheck`, `pnpm layout-check` and lint are clean; change-selected tests pass; the three audits pass; a real chat agent on the worktree test box edits a view, opens and captures its card in the box browser, clicks a control, and captures again, and the exhibit shows each step.
- No data migration. The engine, hub and dev router change together; deploy is one piece and is not done by this workstream.
- After deploy (boxholder's gate): one `bbx browser open /views/...` and `screenshot --card` on a production box confirms the Cloudflare path.
