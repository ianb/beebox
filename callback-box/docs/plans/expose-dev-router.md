# Make the shared dev router safely exposable over Tailscale

Let the whole `pnpm dev` router (all worktrees, all boxes) be reached from the
tailnet — phone, other machines — as one server, protected by the always-on
admin password. This deliberately reverses the current "the dev router is never
a valid Tailscale target" stance, and pays for that reversal with two
protections it lacks today: an authenticated control plane and an auth entry
point that actually works behind the router's `/<worktree>/` path prefix.

Supersedes the "expose a dev checkout" issue
(`issues/features/2026-07-21-expose-dev-checkout-over-tailscale.md`), whose
Option 1 this is, with the whole-router + authenticated-control-plane decisions
made (boxholder, 2026-07-21: "Exposing the whole router might be nice, for
remote poking … since I can control these sessions remotely too"; control routes
chosen to sit "behind the password too").

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` — **fail-closed /
  resilient-not-silent** is the spine: the network layer must never become the
  auth layer (the exact failure OpenClaw shipped, per the prior tailscale plan),
  so every new reachable path either requires the password or is refused;
  **validate-at-boundaries** (parse the Cookie header + verify HMAC at the router
  boundary); **exhaustiveness** (the new `TargetPosture` member and the
  control-route gate enumerate their cases).
- `callback-box/CLAUDE.md:106`: *"Read before writing… This project has specific
  conventions that differ from defaults."* — and the "don't add features beyond
  what the task requires" rule bounds this to exposure + its protections, not a
  tailnet-identity SSO (explicitly out of scope).
- `callback-box/code-style.md` — no default params, max 2 positional, no `any`,
  blessed cast helpers; the router's defensive budget (`bin/router.ts` is the
  model, per code-style's "process-supervision code keeps the biggest defensive
  budget").
- **Precedent — the just-shipped `tailscale-expose-and-protect` plan**
  (`docs/implemented-plans/`): its auth-posture guard, `TargetPosture` union, and
  "Tailscale membership is never authentication" principle are the direct base
  this extends.

## What already exists

- **The router's unauthenticated control plane.** `bin/router.ts:696`
  (`/__router/status` → full worktree/PID/port JSON), `:741` (`/__router/retry/`),
  `:763` (`/__router/stop/` — `await core.stopWorktree(name)`, destructive),
  `:789` (`/__router/dashboard/` — cold-starts a worktree). All dispatch by plain
  `req.url` string match with no header/cookie/token check, ahead of
  `parseWorktreeName` (`:842`). **Rebuilt**: these gain an auth gate (Track B).
- **The router is already loopback-bound.** `bin/router.ts:1053`
  `listenLoopback(server, ROUTER_PORT, …)` → `bin/router-core.ts:178`
  `server.listen(port, "127.0.0.1", …)`. **Reused** — load-bearing: the only
  off-machine path into the router is Tailscale Serve, which is what makes the
  header-based origin test (below) sound.
- **The proxy forwards raw headers.** `bin/router.ts:406`
  (`proxy.web(req, res, options, …)` with the raw `req`) — so the router can read
  `req.headers["tailscale-user-login"]` at dispatch and it still flows to the
  box. **Reused.**
- **Session verification the router can reuse.** `callback-box/src/webapp/auth.ts:236`
  `verifySession(cookie)`, `:299` `getSessionUserFromCookieHeader(header)` (takes
  a raw Cookie header — exactly what `bin/router.ts`'s `http.IncomingMessage`
  has, no Fastify `.cookies` needed), `:30` `getSessionSecret()` reading the
  **stable** `~/.cb-session-secret` (env `CB_SESSION_SECRET` or a persisted
  0600 file — machine-wide, so a separate process verifies cookies the hub
  minted). Local users: `local-users.ts:87` (`~/.cb-auth.json`), `:201`
  `getLocalOwnerEmail()`, `:215` `getLocalUser()`. **Reused** — the router
  imports these, following the existing `bin/`→`callback-box/src` precedent
  (`bin/doctor.ts:61`, `bin/snapshot-clerk-contract.ts:30`). See the qualitative
  caveat in Failure modes.
- **Per-worktree Vite base (already prefix-correct).** `bin/router-core.ts:347`
  (`const baseUrl = \`/${name}/\``), `:355` (`VITE_BASE`), consumed at
  `callback-box/src/frontend/vite.config.ts:25,58`. So the *running SPA* under
  `/<worktree>/` already loads its assets and does its client-side 401 redirect
  base-aware (`src/frontend/src/api-core.ts:49` `withBase`, `src/frontend/src/lib/trpc/index.ts:36`).
  **Reused** — Track A only fixes the *entry* paths that bypass this.
- **The broken auth entry behind the prefix.** The *built* login SPA is served
  base=`/` (`src/webapp/routes/auth.ts:195` `serveLoginSpa`, `:234`
  `/auth/login`; `src/hub/hub-server.ts:332` comment + `:343`), and every
  server-side unauth redirect is root-absolute: `hub-server.ts:409,468`,
  `box-picker.ts:87`, `server-box-scope.ts:129`, `server-root.ts:320` (all
  `reply.redirect(\`/auth/login?returnTo=…\`)`, no `/<worktree>/` prefix). Filed
  as `issues/bugs/2026-07-20-dev-router-login-page-broken.md`. **Rebuilt** in
  Track A — it's the prerequisite: you cannot obtain a `cb_session` over the
  tailnet until login works behind the prefix.
- **The router-target guard.** `callback-box/src/services/tailscale-target.ts:77`
  `looksLikeRouter(probe)` (matches `routerPort` + `worktrees` in
  `/__router/status` JSON), `:106` invoked first in `classifyTargetPosture`,
  `:149` refusal, union at `:85`. **Rebuilt** in Track C — the unconditional
  `"router"` refusal becomes conditional on the control plane being gated.
- **`Tailscale-User-Login` is read nowhere yet** (grep: zero source hits). New
  code.

## Prior art (external)

Searched during the prior tailscale plan and re-confirmed here:

- **Tailscale Serve injects and strips `Tailscale-User-Login`.**
  <https://tailscale.com/kb/1242/tailscale-serve> (and the identity-header demo
  <https://github.com/tailscale-dev/id-headers-demo>): Serve injects the header
  and strips any client-supplied copy, so its *presence* on a loopback-bound
  backend reliably means "arrived via Serve" — the basis for Track B's origin
  test. Absent for tagged-device and Funnel traffic (we don't Funnel).
- **OpenClaw's fail-open incidents** (GHSA-hff7-ccv5-52f8; issue #50630, CVSS
  9.3) — the cautionary base: network membership silently became auth, and a
  header-auth path leaked from a WebSocket scope to all routes. This plan's gate
  keeps the password as the wall and uses the header only as an origin signal,
  never as identity — the anti-#50630 shape.
- **Reverse proxies gating on trusted injected headers** (Tailscale's own
  `proxy-to-grafana`, `X-Webauth-User` + `whitelist=127.0.0.1`): the pattern of
  "trust the header only because the backend is unreachable except through the
  proxy" is exactly our loopback-bound-router + Serve situation.
- No prior art *within the repo* for `bin/` performing auth — this is the first
  behavioral-security code in the router (flagged in Failure modes).

## Tracks / scope

Ordered by dependency: A (auth entry) unblocks any authenticated tailnet access;
B (control-plane gate) is the core protection; C (guard relax + expose) can only
be proven safe once A and B hold.

### Track A — prefix-safe auth entry

**What.** Make the login page and every server-side `→ /auth/login` redirect
work behind the router's `/<worktree>/` prefix, so a tailnet visitor with no
cookie can actually reach a login form and get a `cb_session`.

**Why this needs to change.** Today the built login SPA references `/assets/…`
(base=`/`) which the router reads as a worktree name → 404 blank page
(`hub-server.ts:332` comment), and the server redirects drop the prefix
(`server-box-scope.ts:129` et al.) → the router 404s "worktree `auth` not
found." Auth is structurally always-on, so *every* first tailnet hit lands here.
Without this, the exposed router is unreachable-when-logged-out, i.e. unusable.

**Direction.** Two coordinated fixes:
1. **Prefix-aware login redirects.** The five server-side redirect sites build
   `returnTo` from `request.url` (which *includes* the `/<worktree>/` prefix as
   the router proxied it) but hardcode the destination `/auth/login`. Derive the
   prefix from the incoming request's base and emit
   `<prefix>/auth/login?returnTo=…`. In hub mode the hub knows the box slug; under
   the dev router the prefix is the first path segment. Centralize in one helper
   (`loginRedirect(request)`), replacing the five ad-hoc `reply.redirect` calls —
   consolidation per code-style, one way to build the redirect.
2. **Prefix-correct login SPA assets.** Serve the login SPA such that its asset
   references resolve under the prefix. Two candidate mechanisms, settled in the
   first chunk: (a) serve login through the same Vite-base machinery the app
   already uses (so `VITE_BASE` prefixes its assets), or (b) a router-level
   rewrite that maps `/<worktree>/assets/*` → the shared dist assets. Lean (a):
   it reuses the working path rather than adding a rewrite layer.

**First implementation chunk.** The `loginRedirect(request)` helper + migrate the
five call sites + a route doctest asserting the emitted Location carries the
prefix for a prefixed request and stays bare for an unprefixed one. (SPA-asset
mechanism is the second chunk — it needs the browser-level check.)

### Track B — authenticated router control plane

**What.** Gate `/__router/status|retry|stop|dashboard` so a request arriving via
Tailscale Serve must carry a valid `cb_session` for a known local user;
unauthenticated Serve requests get 401; local-direct requests (no Serve header)
are unchanged.

**Why this needs to change.** These routes stop/restart/inspect every worktree
with zero auth (`bin/router.ts:763` calls `core.stopWorktree`). Exposing the
router without gating them hands every tailnet client a worktree kill switch —
the precise "network presence ≠ authorization" failure this project refuses.

**Direction.**
- **Origin test.** At `/__router/*` dispatch (`bin/router.ts:679`), read
  `req.headers["tailscale-user-login"]`. Present ⇒ the request arrived via Serve
  (Serve injects it and strips client copies, and the router is loopback-bound so
  Serve is the *only* off-machine path) ⇒ **remote**. Absent ⇒ local-direct.
  Explicitly NOT `req.socket.remoteAddress`: Serve re-dials loopback, so a
  tailnet request also presents `127.0.0.1` — peer IP cannot distinguish them
  (correcting the investigation's suggestion).
- **Gate.** For a remote `/__router/*` request, parse `req.headers.cookie` and
  call `getSessionUserFromCookieHeader` (`auth.ts:299`); require a non-null
  session whose email resolves via `getLocalUser` (`local-users.ts:215`). Fail →
  401 (JSON for status, an HTML "log in first" nudge for the POST forms).
  Local-direct requests skip the gate (preserves current dev ergonomics — the
  chosen "localhost still direct").
- **The password is the wall; the tailnet header is only the origin signal.** We
  do not derive identity from `Tailscale-User-Login` (defense-in-depth, not SSO —
  scope boundary). The router reading the symmetric session secret is acceptable
  for the same reason the hub does: it's the trusted front-most process. (The
  verify=forge property of the symmetric secret, `auth.ts:381`, is why we don't
  hand this capability to box *children* — the router is not a child.)

**Vocabulary lock-ins.** Header name `Tailscale-User-Login` (vendor-fixed);
helper `routerRequestIsRemote(req)` and `authorizeRouterControl(req)`.

**First implementation chunk.** `routerRequestIsRemote` + `authorizeRouterControl`
as pure-ish functions (inject the header/cookie strings, not the raw req, so
they're unit-testable in `bin/*.test.ts` node:test style like `router-core.test.ts`),
wired into the four control routes; tests: remote+no-cookie → 401, remote+valid
cookie → allowed, remote+expired/forged cookie → 401, local (no header) →
allowed. No open questions.

### Track C — relax the router-target guard and expose

**What.** Let `cb tailscale setup` accept the router as a target, but only after
positively verifying the control plane is gated; then `tailscale serve` the whole
router root.

**Why this needs to change.** `tailscale-target.ts:106` refuses any router
unconditionally. Once B ships, a gated router is safe to expose, and the tooling
must recognize that — but must *not* relax into exposing an *ungated* router
(e.g. an older build without Track B).

**Direction.**
- **Positive verification, not a flag.** Add a `TargetPosture` member (union at
  `tailscale-target.ts:85`), e.g. `{ kind: "router-guarded" }` vs the existing
  `"router"`. The classifier probes `/__router/status` **twice**: once plain
  (confirms it's a router) and once with a synthetic `Tailscale-User-Login:
  probe@local` header — a gated router returns 401 to the second, an ungated one
  returns 200 status JSON. 401-on-synthetic-header ⇒ `router-guarded` (allow);
  200 ⇒ `router` (refuse, with a message pointing at this plan/Track B). This
  makes "is it safe" an observed property, not an operator assertion — the
  anti-#50630 discipline.
- **Serve the whole router root** (`tailscale serve --bg --https=443 --set-path=/
  → 127.0.0.1:<ROUTER_PORT>`). Whole-router exposure (decided), so no path
  scoping. The existing setup guards (no-Funnel, exposure-intent transaction,
  stop teardown) apply unchanged.
- **The box-serving paths need no new router gate**: `/<worktree>/<box>/…` proxies
  to the box, which already enforces the password (once Track A lets login
  through). Only the router's *own* control routes needed B.

**First implementation chunk.** The `router-guarded` posture + the two-probe
classifier change + tests (gated router → allowed, ungated → refused, non-router
→ unchanged), using the existing fake-deps probe harness.

## Subplans

None. Track A overlaps the filed login-prefix bug, but it's not a separate design
question — the direction (prefix-aware redirects + base-correct login assets) is
settled here; the bug issue is its tracking record, closed when A lands.

## Failure modes

**Critical gap (resolved in-plan):** exposing an *ungated* router — if Track C
shipped without B, or against an old router build, the control plane would be
tailnet-reachable unauthenticated. Resolved by the two-probe positive
verification (C): setup refuses unless the synthetic-header probe proves the gate
is live. Tested both ways.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Remote `/__router/stop` with no/expired/forged cookie | planned (B) | 401 via `authorizeRouterControl` | clear |
| Serve omits/renames `Tailscale-User-Login` (version drift) → remote request looks local → gate skipped | planned | absence ⇒ treated as local ⇒ **fail-open risk**; see note | needs the mitigation below |
| A local process omits the header to reach `/__router/*` | n/a | allowed by design (local = trusted; already has machine access) | clear |
| Login redirect still drops prefix for some route | planned (A) | centralized `loginRedirect` covers all five sites | clear |
| Login SPA assets 404 behind prefix | planned (A, browser check) | base-correct serving | clear |
| Router imports `callback-box/src/webapp/auth` → build/coupling break, or the security import drifts | typecheck + B tests | precedented import path; **qualitative** escalation (first behavioral-security code in `bin/`) flagged for review | clear |
| `cb tailscale setup` exposes a router lacking Track B | planned (C, two-probe) | refuse unless synthetic-header probe returns 401 | clear |
| Session secret differs between router and hub (env `CB_SESSION_SECRET` set for one, not the other) → router can't verify valid cookies | planned | both read the same source; if divergent, verify fails → 401 (fail-closed, not open) | clear |

**The one real fail-open to close:** the origin test treats *absent*
`Tailscale-User-Login` as local. If a future Serve config didn't inject it, a
remote request would be treated as local and skip the gate. Mitigation, folded
into Track C's verification and setup: setup configures Serve itself and then
proves via the synthetic-header probe that the running config *does* surface the
header end-to-end before it will expose — and documents that the gate depends on
Serve's inject-and-strip contract. This converts a silent assumption into a
checked precondition. (An alternative stricter gate — require auth for
`/__router/*` unless the peer is proven local by a non-spoofable channel — is
rejected because loopback peer is exactly what Serve masks; there is no such
channel here.)

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field**, **Stale ref**, **Two agents on one card**,
  **Fabricated free-form value** — N/A: no card vocabulary; this is
  router/auth/CLI infrastructure. The analogous concurrency (two processes
  serving one box) is the *motivation* (single exposed server), addressed by
  exposing the router rather than a parallel `cb serve`.
- **Hand-edit drift** — a boxholder running raw `tailscale serve` against the
  router bypasses `cb tailscale setup`'s two-probe check. ADDRESSED partially:
  `cb tailscale status` reports the router as a target and its guarded/ungated
  posture, so drift is visible; DEFERRED: we don't prevent a hand-run serve of an
  ungated router (documented, like all raw-CLI escape hatches).
- **Validation error UX** — ADDRESSED: the 401 bodies name the cause ("log in at
  <prefix>/auth/login"); the setup refusal for an ungated router names Track B.
- **Partial migration / transition state** — ADDRESSED: the tracks are ordered so
  the guard (C) only opens after the gate (B) exists, and C's probe refuses any
  router where B isn't live — so a half-applied rollout fails closed, never open.

## NOT in scope

- **Tailnet identity as box login (SSO).** The password stays the identity;
  `Tailscale-User-Login` is only an origin signal. Mapping tailnet users to
  `~/.cb-auth.json` accounts is the deferred idea recorded in the OpenClaw
  dispositions — a separate plan. (Rejecting it here keeps the anti-#50630
  boundary crisp.)
- **Per-worktree scoped exposure.** Whole-router was chosen; path-scoping the
  Serve mapping to one worktree is not built (and would reintroduce prefix-asset
  complexity).
- **Exposing prod's `cb hub` this way.** Prod is a different topology (single hub,
  no router); its tailnet story is the already-shipped hub-target path.
- **Remote control of Claude Code sessions.** "control these sessions remotely"
  is served by Claude Code's own remote features, not the callback-box router;
  this plan exposes the dev *apps* + worktree supervision, not the agent sessions.
- **Rate-limiting / lockout on the router 401 path.** The password's scrypt
  cost + the tailnet boundary are the current defense; a brute-force lockout is a
  separate hardening item.

## Open design questions

- **Login-SPA asset mechanism (A.2): Vite-base reuse vs router rewrite.** Lean
  Vite-base reuse (fewer moving parts). Settled in A's second chunk before code —
  the *requirement* (assets resolve under the prefix, verified in a browser) is
  fixed; only the mechanism is open, and it sits in chunk 2, not chunk 1.
- **Should `/__router/status` (read-only) use a softer gate than the mutating
  routes?** The chosen answer is uniform (all four gated the same) per the
  boxholder's "behind the password too"; recording the considered alternative
  (status readable, mutations gated) as explicitly declined.

## Knowledge audits

Skip, with rationale: this introduces no *box-agent-facing* concept — no card
tag, schema, or rule a box agent must recall. The new surface is operator/CLI
(`cb tailscale` accepting the router) and dev-infra (router auth), documented in
`bin/CLAUDE.md` (the "Dev auth is always-on" section gets updated: login behind
the prefix now works, and the router is exposable) and the tailscale docs. No
`knows_directly` entry applies.

## Implementation order

1. **Track A chunk 1** — `loginRedirect` helper + 5 call sites + route doctest.
2. **Track A chunk 2** — prefix-correct login SPA assets + a browser check
   (closes the login-prefix bug).
3. **Track B** — origin test + control-plane auth gate + `bin/` unit tests.
4. **Track C** — `router-guarded` posture + two-probe classifier + setup serves
   the router root; tests.
5. **Docs** — `bin/CLAUDE.md` (login works behind prefix; router exposable),
   `docs/docker-install.md`/tailscale docs (dev-router exposure), admin
   `TailscaleSection` note that on a dev machine the whole router is what gets
   exposed. Close the login-prefix bug issue and the expose-dev-checkout issue.

Dependencies: C requires B (the two-probe check needs the gate to exist);
authenticated tailnet *use* requires A (no login entry otherwise). B and A are
independent and could land in either order, but both precede C.

## Rollout shape

- **Test posture (tests first).** Track A: a route doctest pinning the prefixed
  vs bare `Location` from `loginRedirect`, plus a browser/tour check that the
  login page renders (not a blank `#root`) behind `/<worktree>/`. Track B: `bin/`
  node:test unit tests over `routerRequestIsRemote`/`authorizeRouterControl`
  (the four-cell truth table: {remote,local} × {valid,invalid cookie}) — the
  security behavior is the done-when. Track C: fake-deps classifier tests (gated
  → allowed, ungated → refused, non-router unchanged) extending the existing
  `tailscale-target` doctest. The Failure-modes "planned" rows enumerate the
  required assertions.
- **Live proof (needs a human + real tailnet).** After the unit/route tests:
  `pnpm dev`, `tailscale serve` the router via `cb tailscale setup`, then from the
  phone (a) load `/<worktree>/<box>/`, get the login page (Track A), log in,
  reach the box; (b) confirm `/__router/stop/<wt>` over the tailnet is 401 when
  logged out and works when logged in (Track B); (c) confirm `cb tailscale setup`
  refuses a router built without Track B (Track C). This is the first end-to-end
  exercise; the tailnet + phone are already available (`banjo-parrotfish.ts.net`).
- **Knowledge audits:** none (see above).
- **Migration:** none — no on-disk data shape changes. Behavior change: the dev
  router becomes a valid `cb tailscale` target and its control routes require
  auth over the tailnet; both are additive (local dev unchanged).

## Codex cross-review

Mandatory before implementation — this reverses a security stance and puts the
first auth code in `bin/`. The review targets: the origin-test fail-open
(header-absence), the symmetric-secret exposure to the router process, the
two-probe verification's completeness, and Track A's redirect/asset coverage of
every entry path.
