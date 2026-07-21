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

**Direction.** (Corrected per Codex finding 7 — Vite strips `VITE_BASE` before
proxying, so the backend can't derive the prefix from `request.url`; it must come
from injected config.)
1. **Prefix from config, not URL.** The prefix is already injected as `VITE_BASE`
   (`router-core.ts:355`) and known to the hub as the box slug. Thread it to a
   single `loginRedirect(request, base)` helper replacing the five ad-hoc
   redirects; `returnTo` is prefixed with the same base.
2. **Prefix-correct login SPA assets.** Serve the login HTML through the
   base-aware path (Vite serves/transforms the login GET while `/api`/`/auth`
   POST stay proxied), or a per-base asset rewrite — mechanism settled in chunk 2
   against a browser check. `serveLoginSpa` (`routes/auth.ts:195`) currently
   ships `dist/index.html` verbatim; that changes.
3. **Google OAuth behind the prefix.** The callback URI is built from the hub
   base (`auth-google.ts:38`, `hub.ts:87`) — extend it to carry the prefix, or
   document local-password-only for prefixed origins in the transition. (Open
   question — lean: fix the callback, since remote family login may want Google.)

**First chunk.** `loginRedirect(request, base)` + thread `base` + migrate 5 sites
+ a route doctest asserting the emitted Location and `returnTo` carry the base.

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
    logout, setup, OAuth callback), the login SPA assets, and
    `POST /<w>/<box>/api/pairing/redeem` (ticket-gated — mirrors
    `hub-server.ts:457`). Nothing else.
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
    - **Prefix-correct mobile cookie** (2nd-review 2.2): the `cb_mobile` cookie is
      issued `Path=/${boxSlug}` (`mobile-cookie.ts:37`), which the webview loses
      under the `/<w>/<box>/` mount (initial load sends Bearer; reloads/WS need the
      cookie). The router-side mobile auth issues a prefix-correct-Path cookie (or
      `mobile-cookie.ts` grows a base arg). So the iOS *app* needs no change, but
      the server cookie Path does.
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
| Webview mobile cookie lost on reload/WS under the `/<w>/<box>/` prefix | planned | router issues a prefix-correct `cb_mobile` Path (2nd-review 2.2) | clear |
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

- **Control-plane isolation (2nd-review 2.1 — the top decision, boxholder's
  call).** Same-origin `/dev` agent content defeats an Origin/CSRF-token check on
  mutating `/__router/{stop,retry}`. Two ways to keep them safe: **(a)** CSP-
  sandbox all router-owned agent content so it can't script, keeping remote
  worktree control behind owner+Origin (lean — preserves the "remote poking"
  goal); **(b)** make mutating control routes UDS/CLI-only (airtight, but drops
  remote worktree *mutation* — remote read + box access remain). This is the one
  finding that trades against the boxholder's stated want (remote control), so
  it's decided before B.2, not assumed.
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

1. **A.1** `loginRedirect(request, base)` + 5 sites + route doctest.
2. **A.2** prefix-correct login SPA assets + browser check (closes the login bug).
3. **A.3** OAuth-behind-prefix (or document local-password-only).
4. **B.1** UDS listener + origin tag + pure `authorizeRouterRequest` + truth-table
   unit tests.
5. **B.2** wire the gate into dispatch (allowlist, control/infra owner+CSRF, box
   ladder, strip `x-cb-*`, gate-before-cold-start) + DoS boundary; rewire
   `bin/worktrees`/HMR/dashboards to the UDS.
6. **C** `router-guarded` posture + anonymous-denial-over-Serve probe + setup
   serves the router; tests.
7. **Docs** `bin/CLAUDE.md`, tailscale docs, admin `TailscaleSection`
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
  **paired iOS app**: pair/redeem over the tailnet URL and confirm the app reaches
  the box; confirm anonymous `/__router/stop/<w>` over the tailnet is 401 and
  works logged-in; confirm `cb tailscale setup` refuses a pre-Track-B router.
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
