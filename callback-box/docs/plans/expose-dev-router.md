# Make the shared dev router safely exposable over Tailscale

Turn the `pnpm dev` router into an **authenticating reverse proxy** — the same
front-door model the prod `cb hub` already runs — so the whole dev environment
(all worktrees, all boxes) can be reached from the tailnet by a browser *or* the
paired iOS app, with the router validating credentials (using current code)
before it proxies or serves anything. Then let `cb tailscale setup` expose it.

This is the reshape of the first-draft plan, which its Codex review found unsafe
(`expose-dev-router.review.md`): gating only `/__router/*` left the router's own
`/`, `/<worktree>/dev/`, cold-start, and output-leak surface unauthenticated,
and "downstream per-worktree auth is enough" is false because each worktree runs
its own (possibly old, auth-less) checkout code. The fix both findings force is
the same: **the shared front door must authenticate, not delegate.**

Boxholder decisions folded in: whole-router exposure; control routes behind the
password (owner); and the paired **iOS app must work** through it.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — **fail-closed / resilient-not-silent** is
  the spine: the front door denies by default and the network layer never
  becomes the identity layer; **validate-at-boundaries** (auth resolved at the
  router edge with current code); **don't-be-resilient-to-the-impossible**
  (the local channel is a real capability, not a spoofable header).
- `callback-box/CLAUDE.md` — "Read before writing"; the "don't add features
  beyond the task" rule bounds this to exposure + its auth, not tailnet-identity
  SSO.
- `code-style.md` — no default params, max-2-positional, no `any`, blessed cast
  helpers; the router's large defensive budget (code-style: "process-supervision
  code keeps the biggest defensive budget").
- **Precedent (the spine): the prod hub's front-door auth**, `src/hub/hub-server.ts`
  — `decideHubAuth`/`hasMobileAuth`/`stripHubHeaders`/`verifyMobileRequest` +
  lazy cold-start. The router adopts this; reuse over reinvention.
- **Precedent: the box preHandler** `src/webapp/server-box-scope.ts:62`
  (`addBoxAuthHook`) — the exact credential-precedence ladder the router mirrors.

## What already exists

- **The hub is already an authenticating proxy.** `src/hub/hub-server.ts`:
  `hasMobileAuth`/`verifyMobileRequest` fully verify mobile bearer/cookie before
  proxying or cold-starting (closed risk S1, per mobile-contract); `decideHubAuth`
  (228) gates; `stripHubHeaders` (206) removes client-supplied `x-cb-*`;
  `isMobilePairingRedeem` (457) allows the unauth bootstrap; the session redirect
  at :409/:468. **Reused as the template** — the router grows the equivalent.
- **One mobile auth resolver, per-box, reusable.** `src/core/mobile/request-auth.ts:54`
  `resolveMobileRequestAuth(boxRoot, headers)` — `cb_mobile` cookie then
  `Authorization: Bearer <deviceToken>`, validated (timing-safe) against that
  box's `.callback-box/mobile-devices.secret.json` (`pairing.ts:288`). Gives
  `authed:true, isOwner:false`, bypasses `canAccessBox` (the per-box token *is*
  the authorization). **Reused** — the router calls it for the target box.
- **Session verification the router can run.** The exported, **gen-aware**
  `resolveRequestIdentity` (`auth.ts:411`) is the reusable entry (the gen-check
  `classifyLocalRecord` at `:468` is private — 2nd-review 2.5); owner test via
  `getOwnerEmail()` (`auth.ts:328`). Stable secret `auth.ts:30`; box access
  `box-access.ts` `canAccessBox`. **Reused** — the router calls the exported
  resolver, never the private internals.
- **Agent + diag bearers, pairing-redeem, the full precedence ladder** —
  `server-box-scope.ts:79-134`: diag bypass → pairing-redeem URL allow → agent
  bearer → mobile auth → session identity → `canAccessBox`. **Reused** as the
  router's per-box gate spec.
- **`bin/`→`callback-box/src` import is precedented** (`bin/doctor.ts:61`,
  `bin/snapshot-clerk-contract.ts:30`). The router importing these current-code
  resolvers is the finding-4 fix: it authenticates with main's code even when
  proxying an old worktree's box.
- **The router's unauthenticated surface (all to be gated).** `bin/router.ts:696/741/763/789`
  (`/__router/*`), `:512` (`/` worktree list), `:855` (`/<worktree>/dev/` via
  `router-docs.ts` — cross-worktree markdown/issues/artifacts), `:868` (pre-auth
  cold-start), `:605` (leaked build output). `router-docs.ts:690` unguarded
  `decodeURIComponent` (pre-auth DoS). **Rebuilt behind the gate.**
- **iOS is already prefix-aware.** `PairedBox.baseURL` includes the slug
  (`ios-app/.../Models/PairedBox.swift:47`; local test box pairs to
  `http://127.0.0.1:3210/main/test1`, `PairedBoxStore.swift:100`). **No app
  change** for a `/<worktree>/<box>/` mount. The per-box lock is device-local UI
  only (`BoxLockManager.swift`), no server effect.
- **Router is loopback-bound** (`bin/router.ts:1053` `listenLoopback`). Reused —
  Serve is the only off-machine path, but per Codex we do NOT lean on that for
  the local/remote split (below).

## Prior art (external)

- **Tailscale Serve identity headers are unreliable as an origin signal** —
  absent for tagged devices and Funnel (<https://tailscale.com/kb/1242/tailscale-serve>).
  This is *why* the redesign abandons header-presence gating (first-draft's fatal
  flaw) for a fail-closed "authenticate all network traffic; local unauth via a
  non-network channel."
- **Unix-domain-socket as the local trust boundary** — the standard pattern for
  "local tools bypass, network must auth" (Docker's socket, tailscaled's LocalAPI
  socket). A browser cannot originate a UDS request, so it's a real capability
  boundary, not a spoofable marker. Node `net`/`http` `server.listen(path)`
  supports it.
- **OpenClaw fail-open incidents** (GHSA-hff7-ccv5-52f8, #50630) — the standing
  cautionary base; the password/mobile-token stays the identity, never the
  network.
- Searched, none found: a Node reverse proxy that authenticates per-downstream
  with pluggable cookie+bearer+per-target-token schemes — this is bespoke, but
  it's the hub's existing shape generalized.

## Tracks / scope

Ordered by dependency: A unblocks any authenticated *use*; B is the front door
itself; C exposes only once A+B verify.

### Track A — prefix-safe auth entry (also fixes local dev today)

**What.** Make login (SPA + every server redirect + Google OAuth callback) work
behind the router's `/<worktree>/` prefix, so a browser with no cookie can reach
a login form and return to where it was.

**Why.** Auth is always-on; the built login SPA is base=`/` (assets 404 behind
the prefix) and the five server redirects drop the prefix
(`server-box-scope.ts:129` et al.), so login behind the router is a dead end
(`issues/bugs/2026-07-20-dev-router-login-page-broken.md`) — today's local dev is
already broken by this, not just the tailnet case.

**Direction — mechanism now pinned** (Codex finding 7 + the Vite-proxy trace:
`vite.config.ts:41` `stripBase` removes `/<worktree>` before the backend sees the
request, so the prefix must be injected by whatever fronts the box — the dev
router in dev, the hub in prod; the backend never derives it from `request.url`).
1. **A trusted `X-CB-Base-Prefix` header, injected by the fronting proxy.** The
   dev router (which alone knows `/<worktree>`, `bin/router.ts` `name`) and the
   prod hub (which knows the box slug) each inject `X-CB-Base-Prefix: <prefix>` on
   every proxied request, after stripping any client-supplied copy (the hub
   already strips client `x-cb-*`, `stripHubHeaders`; the router gains the same
   for this header). Empty when there is no prefix (bare `cb serve`).
2. **`loginRedirect(request)` helper** replacing the five ad-hoc redirects
   (`hub-server.ts:409,468`, `box-picker.ts:87`, `server-box-scope.ts:129`,
   `server-root.ts:320`): emits
   `<prefix>/auth/login?returnTo=<prefix><request.url>` — reconstructing the full
   browser path the proxy stripped.
3. **Prefix-correct login SPA — asset rewrite is necessary but NOT sufficient
   (browser-check finding, `c4c29053`).** `serveLoginSpa` now rewrites the served
   HTML's absolute `/assets/`,`/icons/`,`/manifest.webmanifest` refs to
   `<prefix>/…` from the header (prod-safe: empty prefix ⇒ verbatim bytes). BUT
   the built bundle is compiled `base="/"`, so `import.meta.env.BASE_URL` is baked
   to `/`; every client-side `withBase()` (`api-core.ts:49`) drops the prefix, so
   the login page still client-redirects to root `/auth/login` → router 404 →
   blank. **Rewriting HTML cannot fix a build-time-baked base.** The dev login
   navigation must be served by a *base-aware* bundle. **DECIDED: option (A)**
   (Fable's call, low-risk/localized; boxholder may redirect to B):
   - **(A) Vite serves the login HTML in dev** — a `bypass` on Vite's `/auth`
     proxy so `GET /<w>/auth/{login,setup}` returns Vite's own base-aware
     index.html (`BASE_URL=/<w>/`), while the auth *API* (POST login, `/auth/me`,
     logout, callback) still proxies to the backend. Dev-only; prod hub unchanged
     (serves the built bundle at root, where `base=/` is correct via runtime slug
     derivation). This is the "Vite HTML-serving special case" the plan wrongly
     ruled out — it's actually required. Localized, low-risk. The committed asset
     rewrite stays as the prod-safe path for any built bundle served behind a
     prefix.
   - **(B) Runtime base derivation** — replace the baked `import.meta.env.BASE_URL`
     with a base derived from `window.location` across the frontend, so the one
     built bundle works behind any prefix everywhere (no Vite special case, no
     asset rewrite). Uniform and arguably the "right" fix, but a broad frontend
     change touching every `withBase`/BASE_URL site, with prod-regression risk on
     the existing runtime-slug-derivation.
4. **Google OAuth behind the prefix.** The callback URI is built from the hub
   base (`auth-google.ts:38`, `hub.ts:87`) — extend it to carry the prefix, or
   document local-password-only for prefixed origins in the transition (open
   sub-question 4; local-password already works once 1–3 land).

**First chunk.** The `X-CB-Base-Prefix` injection (router + hub, with client-copy
strip) + `loginRedirect(request)` + migrate the 5 sites + a route doctest
asserting the emitted `Location`/`returnTo` carry the prefix from the header (and
stay bare when the header is empty). SPA-asset rewrite + OAuth are chunk 2.
**DONE (`8698f41c`)** — `src/webapp/base-prefix.ts` (validate fails safe to "";
explicit `..` reject; single-segment regex so no origin-escape), injected at
`bin/router.ts` `proxyWithRetry` (`/<name>`) and the prod hub (`/<slug>`), 5
sites migrated, 11 route-doctest + 3 bin-test assertions green.

**Chunk-1 correction (implementation-confirmed):** the **prod hub serves login at
its own root and forwards the slug un-stripped**, so `request.url` there already
carries `/<slug>` — the hub must NOT prefix its own redirect (would double it).
It strips the client `x-cb-base-prefix` and reads empty for its own redirects,
injecting `/<slug>` only onto the child. So the prefixed redirect is exercised by
a box behind the **dev router** (which doesn't strip `x-cb-*`), not by the hub's
own redirect.

**Chunk-2 design note (the worktree-prefix-through-hub problem, now pinned):** the
dev browser prefix is two segments — `/<worktree>` for root-level `/auth`/`/api`,
`/<worktree>/<slug>` for box paths — but the single-segment header holds one, and
the worktree hub's `stripHubHeaders` deletes the router-injected `/<worktree>`
before it reaches the child. This is fine because **login is served and
redirected by the layer that has `/<worktree>`, not the child**: root-level
`/<worktree>/auth/login` is served by the worktree hub (which receives
`x-cb-base-prefix: /<worktree>` from the router via Vite, and reads it *before*
`stripHubHeaders` runs for child-proxying); the child never redirects to login in
hub mode (`server-root.ts:320` 401s instead). So chunk 2's SPA-asset rewrite +
`loginRedirect` for the dev case live at the **worktree hub's own login-serving
path** (read the header, rewrite `/assets/`→`/<worktree>/assets/`, prefix its own
redirects), while it keeps stripping the header when proxying to children. Prod
is unaffected (no router ⇒ no header ⇒ base=`/`, which already works via runtime
slug derivation, `hub-server.ts:333`).

### Track B — the router as a fail-closed authenticating proxy

**What.** Every request on the TCP listener (which Serve fronts, and which local
browsers also use) must pass an auth gate — run with current code — before the
router proxies, serves infra, or cold-starts. Local, non-browser tooling keeps
unauthenticated access via a **separate Unix-domain-socket listener** that Serve
never touches.

**Why.** Codex findings 1–4: header-presence is fail-open (tagged/Funnel);
`/`, `/<worktree>/dev/`, cold-start and output-leak are unauth surface; and each
worktree runs its own code so the wall must be at the shared front door.

**Direction.**
- **Two listeners, one handler, one central gate.** Keep the TCP loopback
  listener (Serve-fronted, browsers) and add a UDS listener (e.g.
  `~/.cache/callback-box/router.sock`, 0600). Requests on the **UDS are
  trusted-local, unauthenticated** — but only *non-browser* local tooling can use
  it: `bin/worktrees` and other CLI move to `curl --unix-socket`. **Browser HMR
  and the tRPC WebSocket stay on TCP** (a browser can't originate a UDS
  connection; HMR rides the page origin through the router, `vite.config.ts:48`,
  `bin/router.ts:896`) and authenticate with the local browser session
  (2nd-review 2.3). Requests on **TCP are untrusted and must authenticate**,
  regardless of any header — a real capability boundary replacing the spoofable
  header test. No `Tailscale-User-Login` logic anywhere. The gate is **one
  chokepoint before all dispatch, including the `upgrade` (WebSocket) handler**
  (2nd-review 2.7), so Track C's single anonymous probe is representative of the
  whole surface.
- **The TCP gate (per route class), fail-closed default = 401/redirect:**
  - **Unauth allowlist (bootstrap):** `/<w>/auth/login`, `/<w>/auth/*` (login,
    logout, setup, OAuth callback), the login SPA assets, and **the pre-auth iOS
    pairing endpoint** — `POST …/api/pairing/redeem`, matched by REUSING the
    exported `isPairingRedeemUrl` (`routes/pairing.ts:11`, prefix-agnostic
    `endsWith`, the same matcher the hub `hub-server.ts:459` and box
    `server-box-scope.ts:83` already use — do not hand-roll a path). This is the
    QR-scan bootstrap: the app has no token yet, redeems the ticket
    (`pairing.ts:20`) for a device token. Nothing else is unauth. (NOTE:
    `POST …/api/pairing/session`, `pairing.ts:55`, is NOT here — it carries the
    device-token bearer and goes through the box-routes mobile-auth path below;
    it's the webview's cookie-remint recovery path, so it depends on the
    cookie-Path rewrite.)
  - **`/__router/*` control routes + router infra (`/`, `/<w>/dev/`,
    `/__router/dashboard`, and any cold-start):** a valid **owner** session —
    resolved with the exported `resolveRequestIdentity` (`auth.ts:411`, which is
    gen-aware) compared to `getOwnerEmail()` (`auth.ts:328`); *not* the private
    `classifyLocalRecord` (2nd-review 2.5). **Control-plane CSRF isolation
    (2nd-review 2.1 — the top decision):** an `Origin`/CSRF-token check is
    *insufficient by itself* because `/<w>/dev/` serves agent-authored pages on
    the same authenticated origin (`bin/router.ts:855`), which pass any Origin
    check and can read a same-origin token. Resolution: serve all router-owned
    agent content (`/dev`, dev artifacts) with a locked-down CSP (`sandbox`, no
    `allow-scripts`/`allow-same-origin`) so it cannot originate requests, *and*
    keep an Origin/`Sec-Fetch-Site` check on mutating `/__router/{stop,retry}`.
    Fallback if sandboxing can't be made airtight: make the mutating control
    routes **UDS/CLI-only** (remote read stays, remote worktree *mutation* drops)
    — see Open questions. Read routes (`/__router/status`, `/`) need the owner
    cookie, no token.
  - **Box routes `/<w>/<box>/...` AND root-worktree API `/<w>/api/*`,
    `/<w>/api/boxes`** (2nd-review 2.6 — Vite proxies root `/<base>/api` after
    stripping the prefix, `vite.config.ts:105`; box listing has its own
    mobile/session semantics): the box precedence ladder, run at the router with
    current code for the *target* box: agent bearer → per-box mobile auth
    (`resolveMobileRequestAuth(targetBoxRoot, headers)`) → session identity whose
    user `canAccessBox(targetBoxRoot)`. Any hit ⇒ proxy through (and the router
    strips client-supplied `x-cb-*`, like `stripHubHeaders`). None ⇒
    401 (API) / `loginRedirect` (navigation).
    - **Target-box resolution must be the single source of truth** (2nd-review
      2.4): the auth resolver derives `targetBoxRoot` from the *same* slug→box map
      the proxy routes by (`bin/router.ts:184`), and **duplicate slugs fail
      closed** — never auth against one box while the proxy routes the slug to
      another.
    - **Prefix-correct mobile cookie — the iOS load-bearing detail** (2nd-review
      2.2): the `cb_mobile` cookie is issued `Path=/${boxSlug}` (`mobile-cookie.ts:37`)
      = `/test1`, but behind the router the browser path is `/main/test1/…`, so the
      webview drops it on reloads + the tRPC WebSocket (initial load sends Bearer;
      everything after depends on the cookie). The box child **only knows its
      slug**, not `/main`, so it cannot fix its own Path — **the router rewrites the
      `Set-Cookie` Path** on `cb_mobile` (and `cb_session`) to the full
      `/<worktree>/<slug>` on responses it proxies. This is a hard requirement, not
      a nice-to-have: without it the paired app works for one request and then
      silently loses its session.

**iOS pairing over the exposed router — end-to-end requirement (a primary goal
of this whole plan).** All four legs must hold, verified in the live proof:
  1. *Ticket URL* — already correct: `boxBaseUrl()` (`CompanionPairingSection.tsx:18`)
     builds `https://<node>.ts.net/<worktree>/<box>` from `getApiBase()`
     (`api-core.ts:64`), so minting from the tailnet settings page gives the app
     the full prefixed URL. No app change.
  2. *Redeem (the pre-auth QR bootstrap)* — `POST …/api/pairing/redeem`, matched
     by the reused `isPairingRedeemUrl` (`pairing.ts:11`), is in the router's
     unauth allowlist (the ticket is the credential), routed to the target box
     which mints the device token (`pairing.ts:20`).
  3. *Per-request auth* — the router validates `Authorization: Bearer <deviceToken>`
     (and `cb_mobile`) via `resolveMobileRequestAuth(targetBoxRoot, headers)` with
     current code before proxying; a token for box A is rejected for box B. This
     also covers `POST …/api/pairing/session` (`pairing.ts:55`), the bearer-gated
     cookie-remint endpoint.
  4. *Session continuity* — the router rewrites the `cb_mobile`/`cb_session`
     `Set-Cookie` Path to the full `/<worktree>/<slug>` (the box child only knows
     its slug), so the webview reload → `/api/pairing/session` re-mint → cookie
     loop actually holds and the WebSocket keeps the session.
  - **Cold-start happens only after the gate passes** (fixes finding 3's
    pre-auth start).
- **DoS guard:** wrap the `/<w>/dev/` path decode (`router-docs.ts:690`) and the
  request handler in a rejection boundary so a malformed request can't crash the
  shared router (finding 3).
- **Identity, not network, is the wall.** The password (session) or the per-box
  device token authorizes; nothing is trusted for being "on the tailnet."

**Vocabulary lock-ins.** UDS path `router.sock`; `authorizeRouterRequest(req, {targetBox})`
returning a discriminated `{allow}|{deny, reason}`; `TRUSTED_LOCAL` = arrived-on-UDS.

**First chunk.** The UDS listener + the TCP/UDS origin tag + a pure
`authorizeRouterRequest` over injected (headers, method, url, targetBoxRoot,
trustedLocal) with the full truth table as `bin/*.test.ts` node:test cases:
UDS→allow; TCP owner-cookie→control allow; TCP member/no-cookie→control 401; TCP
revoked-gen→401; TCP valid mobile bearer for box→box allow; TCP mobile-for-other-box→401;
TCP pairing-redeem→allow; TCP `/`/`dev` without owner→401; CSRF-less POST
`/__router/stop`→reject. Wiring into the live dispatch is chunk 2.

### Track C — verify the gate, then expose

**What.** `cb tailscale setup` accepts the router as a target only after
positively proving the TCP gate denies anonymous access; then serves the router.

**Why.** Never expose a router build lacking Track B (finding 2 — the old
two-probe check proved nothing).

**Direction.**
- **Proof by anonymous denial, over Serve.** After configuring Serve, the setup
  verification probes the **served** `https://<node>.ts.net/__router/status`
  (real Serve path, not a synthetic-header loopback probe) with **no credentials**
  and requires **401**. A 200 (ungated router, or Serve not injecting/isolating
  as expected) ⇒ refuse and tear down. This tests the actual end-to-end path a
  tagged device would use. Add a `TargetPosture` member (`tailscale-target.ts:85`)
  `{ kind: "router-guarded" }`; the existing `/auth/me` probe is replaced for the
  router case by this anonymous-`/__router/status`-must-401 probe (the router has
  no `/auth/me`).
- **Serve the whole router root** (`--set-path=/ → 127.0.0.1:<ROUTER_PORT>`);
  existing no-Funnel + exposure-intent + stop guards apply. Because the gate is
  fail-closed, whole-router exposure is now safe (findings 3/4 addressed by B).

**First chunk.** The `router-guarded` posture + anonymous-denial probe + tests
(gated→exposed, ungated→refused+torndown, non-router unchanged).

## Subplans

None. Track A subsumes the login-prefix bug (its direction is settled here). The
UDS local-channel is a design *decision* inside B, not a separate research plan.

## Failure modes

**Critical gap (resolved):** the whole-router unauth surface + per-worktree-code
exposure (findings 3/4) — resolved by B making the shared front door authenticate
every TCP request with current code before proxying/serving/cold-starting.
Verified by C's anonymous-denial probe over Serve.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Tagged-device / Funnel request (no identity header) hits `/__router/stop` | planned (B truth table: TCP+no-cookie→401) | UDS-vs-TCP capability boundary, not header | clear |
| Revoked/stale session used at the router | planned | gen-aware `classifyLocalRecord`, not bare verify | clear |
| Non-owner member reaches control routes | planned | owner-only check | clear |
| Same-origin CSRF POST to `/__router/stop` from an agent-authored `/dev` page | planned | CSP-sandbox `/dev` content (can't script) + Origin check — OR mutating controls UDS-only (2nd-review 2.1, decision pending) | clear |
| Webview mobile cookie lost on reload/WS under the `/<w>/<box>/` prefix (paired iOS app silently loses session after one request) | planned | router rewrites `Set-Cookie` Path for `cb_mobile`/`cb_session` to `/<w>/<slug>` (2nd-review 2.2 — hard requirement) | clear |
| Paired iOS device token for box A replayed against box B over the router | planned | router validates per-box via `resolveMobileRequestAuth(targetBoxRoot,…)` | clear |
| Router auths a token for box A while the proxy routes the slug to box B | planned | single slug→box source of truth; duplicate slugs fail closed (2nd-review 2.4) | clear |
| Malformed `%`-encoding under `/<w>/dev/` crashes the shared router | planned | decode guard + handler rejection boundary | clear |
| Router proxies an old worktree whose box lacks auth | n/a (that's the point) | router front-auth uses current code before proxying | clear |
| Per-box mobile token replayed against a *different* box | planned (mobile-for-other-box→401) | `resolveMobileRequestAuth` keyed to target box store | clear |
| Pairing-redeem abused (anon POST) | n/a | ticket single-use/10-min/owner-minted; invalid ⇒ rejected by box | clear (accepted, ticket is the credential) |
| UDS file world-accessible / stale | planned | 0600, unlink-on-start; a same-user process reaching UDS is already trusted | clear |
| Local browser dev now needs login (ergonomic change) | n/a | intended (auth always-on); 30-day cookie; documented | clear (accepted) |
| Serve stops injecting isolation and TCP becomes publicly reachable via Funnel | planned (C anon-denial) + setup no-Funnel invariant | gate is fail-closed regardless | clear |
| Google OAuth callback breaks behind prefix | planned (A.3) | callback carries prefix, or local-password-only documented | clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / stale ref / two agents on a card / fabricated value** — N/A: no
  card vocabulary; router/auth/CLI infrastructure. The concurrency motivation
  (two servers on one box) is *why* we expose the one router, not a parallel serve.
- **Hand-edit drift** — a raw `tailscale serve` of an ungated router bypasses C's
  check. ADDRESSED (visible): `cb tailscale status` reports the router's
  guarded/ungated posture. DEFERRED: not prevented (documented, like all raw-CLI
  escape hatches).
- **Validation error UX** — ADDRESSED: 401 bodies name the cause + login URL; the
  setup refusal names Track B.
- **Partial migration / transition** — ADDRESSED: C refuses any router where B's
  gate isn't live (anonymous probe returns 401), so a half-rollout fails closed.

## NOT in scope

- **Tailnet identity as login (SSO).** Password/device-token stay the identity;
  no `Tailscale-User-Login` mapping (deferred OpenClaw disposition).
- **Unifying mobile-device identity with user accounts.** Mobile stays
  `authed:true,isOwner:false` per box (mobile-contract's structural gap) — not
  this plan's job.
- **Keychain storage for the iOS device token / token expiry** (mobile-contract
  I6/lifecycle) — separate mobile hardening.
- **Exposing prod's `cb hub`** — already has its tailnet path; prod is a single
  checkout, not the multi-worktree router.
- **Rate-limit/lockout on the 401 path** — scrypt cost + tailnet boundary are the
  current defense; brute-force lockout is separate hardening.
- **Remote-controlling Claude Code sessions** — served by Claude Code's own
  remote features; this exposes the dev apps + worktree supervision.

## Open design questions

- ~~**Control-plane isolation (2nd-review 2.1).**~~ **DECIDED (boxholder,
  2026-07-21): option (a)** — CSP-sandbox all router-owned agent content (`/dev`,
  artifacts: `sandbox`, no `allow-scripts`/`allow-same-origin`) so it can't
  originate requests, and keep mutating `/__router/{stop,retry}` behind
  owner-session + `Origin`/`Sec-Fetch-Site`. Remote worktree control is
  preserved. B.2 must treat the sandbox CSP as load-bearing security (covering
  every artifact content-type the `/dev` browser can serve), with a test that a
  sandboxed `/dev` response cannot script a control POST; if any artifact type
  can't be sandboxed airtight, that route falls back to UDS-only for mutations.
- **Google OAuth behind the prefix (A.3).** Lean: fix the callback to carry the
  prefix (remote family may want Google). Fallback: local-password-only on
  prefixed origins, documented. Sits in A's later chunk; the requirement (some
  login method works behind the prefix) is fixed — local-password already does
  once A.1/A.2 land.
- **CSRF mechanism (B): `Sec-Fetch-Site`/`Origin` check vs a minted token.** Lean:
  `Origin`/`Sec-Fetch-Site` same-origin assertion on mutating `/__router/*` (no
  token plumbing, and these are same-origin form POSTs today) — decided inside B
  before code; only the mechanism is open, the requirement (mutations aren't
  CSRF-able) is fixed.
- **Do local browsers use TCP (login) or can they use the UDS?** Browsers can't
  originate UDS, so local browser dev logs in (accepted). Recorded as considered.

## Knowledge audits

Skip, with rationale: no box-agent-facing concept (no card tag/schema/rule an
agent must recall). New surface is operator/CLI + dev-infra, documented in
`bin/CLAUDE.md` (the "Dev auth is always-on / login broken behind prefix" section
gets rewritten: login works behind the prefix; the router authenticates and is
exposable; local CLI uses the socket) and the tailscale docs.

## Implementation order

1. **A.1 — DONE** (`8698f41c`) `X-CB-Base-Prefix` header + `loginRedirect` + 5
   sites + tests.
2. **A.2 — DONE** (`c4c29053` SPA asset rewrite, prod-safe; `cf9e879e` Vite
   serves base-aware login HTML in dev). **Browser-verified**: login form renders
   behind `/<worktree>/`, path + `returnTo` prefixed, all API calls prefixed, no
   404s. **Closes the login-behind-prefix bug** (a standalone fix, independent of
   exposure). Vite 5.4 proxy `bypass` returning `VITE_BASE` diverts `GET
   /auth/{login,setup}` HTML to Vite's base-injected bundle; auth API still
   proxies.
3. **A.3 — DEFERRED (non-blocking)** OAuth-behind-prefix. Local-password login now
   works behind the prefix (verified), which covers the goal; Google-login behind
   the prefix (`auth-google.ts:38` callback URI) is a follow-up — family can use
   local password meanwhile.
4. **B.1 — DONE (pure core)** `bin/router-auth.ts` + `bin/router-auth.test.ts`:
   `classifyRouterRoute` + `authorizeRouterRequest` (injected `RouterAuthDeps`) +
   19-case truth table. Verified fail-closed (owner-before-CSRF, unknown/dup-slug
   deny, unknown→404). **Carry-forward to B.2 (flagged, must handle):**
   (a) the **box picker** (`/<w>/`, `/<w>/api/boxes`) is per-USER (lists boxes by
   `canAccessBox`), not per-box — B.2's `resolveTargetBoxRoot`/ladder must gate it
   on an owner/member SESSION, not a per-box mobile token against a "default box";
   (b) `isCsrfSafe` must ALLOW a legitimate top-level navigation to the
   dashboard-cold-start (`Sec-Fetch-Site: none`/`same-origin`), or reclassify that
   GET — don't block real nav; (c) importing `isPairingRedeemUrl` drags
   `mobile-cookie.ts` into `bin`'s tsconfig (needed a `@fastify/cookie` types
   entry) — consider extracting the pure matcher to a dep-free module instead.
5. **B.2a — DONE (`bb35c63c`), the live enforcement core.** UDS listener
   (`router.sock`, 0600) + TCP; `trustedLocal` = a compile-time constant per
   listener closure (never a header/peer — invariant holds); real
   `RouterAuthDeps` (`bin/router-auth-deps.ts`) — gen-aware owner via
   `resolveRequestIdentity` cookie shim + `getOwnerEmail`, single slug→box map
   (dup slug → null → 401), per-box `resolveMobileRequestAuth` (+ agent bearer
   folded in), `canAccessBox` session, `Sec-Fetch-Site`/Origin CSRF; single
   chokepoint before all dispatch + the WS `upgrade` (try/catch fail-closed);
   deny → 302 login / JSON 401·403·404; `bin/worktrees` CLI → UDS. Verified live
   (curl+browser+WS): the full table passes.
   **Two carry-forwards to B.2b/iOS:** (1) *sound deviation, confirmed* — a
   non-box worktree segment (`/<w>/@vite/`, `/src/`) maps to a session-gated
   worktree-root sentinel (NOT 401), else the logged-in owner's own dev SPA would
   break; a *duplicate* slug still → 401 (the real fail-closed case). (2)
   *iOS-over-dev requirement* — those worktree-root dev assets are currently
   session-only, so an iOS webview holding only a per-box mobile token can't load
   the dev SPA shell; **B.2b must let any valid box credential fetch non-sensitive
   worktree-root dev assets** (`@vite`/`src`/`node_modules`/HMR) while keeping
   `/<w>/api/boxes` + the picker session-only. This is required for the paired-iOS
   goal, alongside the cookie-Path rewrite.
6. **B.2b — DONE (`ec3a0369`), iOS session continuity.** Router rewrites the
   `cb_mobile` `Set-Cookie` Path `/<slug>`→`/<worktree>/<slug>` via the
   `proxyRes` hook (`bin/router-cookie.ts`, surgically scoped: only that
   cookie/attr/exact-value; `cb_session` host-wide `Path=/` untouched); a new
   `worktree-asset` route class lets any box credential (mobile-for-any-box or
   session) fetch the Vite dev shell (`@vite`/`@fs`/`@id`/`@react-refresh`/
   `node_modules`/`src`), while `/<w>/api/*` + bare `/<w>/` stay session-only.
   Verified live (rewritten Set-Cookie, asset-vs-api, cross-worktree denied
   pre-cold-start). 136 bin tests pass. **Note:** HMR live-reload for a
   *mobile-only* webview needs a session (its WS rides bare `/<w>/`, which stays
   session-only) — an accepted dev-nicety limit; the app itself loads + works on
   a mobile token. Future: classify the `vite-hmr` WS upgrade as a dev asset.
7. **B.2c — DONE (`dd3cc9ee`), security hardening.** CSP-sandbox `/dev`
   (`Content-Security-Policy: sandbox`, browser-proven to stop inline script →
   closes same-origin control-plane CSRF); DoS boundary (guarded decode → 400 +
   a top-level `requestListener().catch` → 500, so no path crashes the shared
   router — proven `/dev/%zz`→400 with the router staying up); strip ALL client
   `x-cb-*` at the edge (HTTP + WS upgrade) leaving only the router-injected
   `x-cb-base-prefix`; finding 3.2 (no-provenance `{}`→CSRF-unsafe, dashboard
   same-origin link still works); finding 3.3 (`delete process.env.CB_HUB_SECRET`
   at router start — verified hubs mint their own). 136 bin tests pass.
   **Finding 3.1 (unauth cold-start / worktree-name oracle) — ACCEPTED +
   documented:** on a private tailnet (only invited devices) an unauth
   `/<w>/auth/*` request cold-starting a worktree is low severity and serving a
   worktree's login page inherently needs its Vite up; the box still demands
   auth. Revisit (centralize login through `/main`) only if the tailnet widens
   beyond trusted devices.
8. **C — DONE (`0e0f226f`).** Router emits a benign `x-cb-router-guarded: 1`
   header on any denied `/__router/*` (self-identification, leaks nothing);
   `tailscale-target.ts` classifies 401+header → `router-guarded` (allow),
   200+routerPort → `router` (refuse "update the router"), else the `/auth/me`
   flow; `tailscale-setup.ts` configures Serve then requires an anonymous served
   `/__router/status` → 401+header before recording exposure (else tears down +
   refuses); status reports `guarded:true`. 73 tailscale doctests + 140 bin tests
   pass. (Deviations, both justified: the router records exposure *after* the
   served proof — its record is teardown-bookkeeping, not a startup guard, so
   record-only-proven is correct; a hand-rolled *ungated* served router falls to
   fail-closed `posture-ambiguous`.)
9. **Docs** `bin/CLAUDE.md`, tailscale docs, admin `TailscaleSection`
   ("on a dev machine, `cb tailscale setup` exposes the whole authenticated
   router"). Close the login-prefix bug + the expose-dev-checkout issue.

Dependencies: C requires B (anon probe needs the gate live). Authenticated *use*
over the tailnet requires A (login entry). B needs A.1 for its navigation-deny
redirect. A and B.1 can proceed in parallel.

## Rollout shape

- **Tests first.** A: route doctest on prefixed `Location`/`returnTo` + a browser
  check the login page renders behind `/<w>/`. B: `bin/` node:test truth table
  over `authorizeRouterRequest` (the security done-when — every Failure-modes
  "planned" row is an assertion), plus a UDS-vs-TCP integration test. C: fake-deps
  classifier + an anonymous-`/__router/status`→401 assertion.
- **Live proof (human + tailnet, already available: `banjo-parrotfish.ts.net`,
  phone paired).** `pnpm dev` → `cb tailscale setup` exposes the router → from the
  phone browser: hit `/<w>/<box>/`, get login, log in, reach the box; from the
  **paired iOS app (a primary goal)**: mint a ticket from the tailnet settings
  page, redeem it in the app, confirm the app reaches the box AND survives a
  reload / keeps its WebSocket (proving the cookie-Path rewrite — all four
  pairing legs); confirm anonymous `/__router/stop/<w>` over the tailnet is 401
  and works logged-in; confirm `cb tailscale setup` refuses a pre-Track-B router.
- **Knowledge audits:** none.
- **Migration:** none (no on-disk shape change). Behavior changes — router
  authenticates TCP requests; local CLI moves to the UDS; local browser dev now
  logs in — all additive/documented, none touching box data.

## Codex cross-review

Mandatory again before implementation — the reshape is larger and more
security-critical than the draft. Targets: the UDS/TCP boundary (can any network
path present as UDS-local?), the per-box mobile gate at the router (target-box
resolution + `x-cb-*` stripping), CSRF coverage of every mutating route, the
anonymous-denial probe's soundness over real Serve, and OAuth-behind-prefix.
