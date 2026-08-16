# Plan Engineering Review — expose-dev-router

Cross-model (Codex, high reasoning) adversarial review of
`expose-dev-router.md`, 2026-07-21. **Verdict: unsafe as written — do not
implement.** The findings are fundamental (surface + trust-model), not
patchable in place; the plan needs a reshape around fail-closed router
authentication. Findings below with my disposition.

## Findings (Codex), ranked, with disposition

### 1. The origin test fails open for tagged devices and Funnel — CONFIRMED, fatal to Track B as designed
`Tailscale-User-Login` is **absent** for tagged-device traffic (and Funnel) —
the plan even says so at its own §Prior-art, then relies on presence=remote
anyway. A tagged node calling `POST /__router/stop/main` through Serve carries
no header → classified "local" → bypasses the gate. Header-absence ⇒ trusted is
the core defect. **Disposition: accept. The gate cannot key on header presence.**

### 2. Track C's two-probe verification never actually tests Serve — CONFIRMED
The synthetic-header probe hits `127.0.0.1/__router/status` directly; it proves
only that the router *branches on a header*, not that Serve injects/strips it,
and it's point-in-time (Serve/Funnel/TCP config drift reopens the hole). The
post-config `/auth/me` probe also doesn't exist on the router root (→ 404).
**Disposition: accept. "Verify the gate" as specified is not a real proof.**

### 3. Most of the "whole router" is unauthenticated surface the plan ignored — CONFIRMED, the big miss
Beyond `/__router/*`, the router itself serves, with no auth: `/` (every
worktree + running/failed state, `bin/router.ts:512`), `/<worktree>/dev/`
(router-owned, bypasses box auth — markdown/issues/artifacts across worktrees,
`router-docs.ts:251,603,662`), pre-auth worktree cold-start (`bin/router.ts:868`),
captured Vite/Fastify output on failed starts (`:605`), and a pre-auth DoS
(unguarded `decodeURIComponent`, `router-docs.ts:690`, crashing the shared
router). **The plan's claim "only control routes need a router gate; box paths
already enforce the password" is false.** Disposition: accept — this alone
sinks the "gate `/__router/*` only" design.

### 4. "All worktrees already enforce the password" is not an invariant — CONFIRMED, deepest finding
Each router path runs *that worktree's own checkout code* (`bin/router-core.ts:368`).
An old, half-built, or deliberately-modified branch need not contain the
always-on auth. Exposing the shared router auto-exposes every present and future
worktree's arbitrary code. A downstream per-worktree wall cannot protect a shared
front door. **Disposition: accept. The router must authenticate before it
proxies or serves anything — it can't delegate the wall downstream.**

### 5. Revoked sessions + non-owner members get global control — CONFIRMED
`verifySession` checks HMAC + expiry but **not** session generation; revocation
lives in the private `classifyLocalRecord` gen-check (`auth.ts:454`). A stale
cookie stays valid at the router gate. And the gate as written accepts `member`
role, so one member with one box would get global stop/retry/start.
**Disposition: accept. Use a gen-aware resolver; require `role === "owner"`.**

### 6. Cookie-only auth ⇒ same-origin CSRF — CONFIRMED
Session cookie is host-wide `Path=/ SameSite=Lax` (`auth.ts:209`). Every box,
Vite page, and **agent-authored `/dev` artifact** shares the exposed origin, so a
malicious/compromised page can POST `/__router/stop/*` with the browser
supplying the cookie. **Disposition: accept. Control plane needs owner-auth plus
CSRF/Origin defense.**

### 7. Track A rests on a false path premise — CONFIRMED
Vite **strips** `VITE_BASE` before proxying `/api`/`/auth` to the backend
(`vite.config.ts:39`), so `request.url` at the backend does **not** retain the
`/<worktree>/` prefix — the plan's "derive the prefix from request.url" cannot
work; the prefix must come from injected config. Login-SPA asset serving is also
harder than "reuse Vite base," and **Google OAuth's callback is prefix/origin
broken too** (`auth-google.ts:38`). **Disposition: accept. Track A needs a
config-sourced prefix and a real asset story, and must cover OAuth.**

### 8. Symmetric-secret claim is wrong — CONFIRMED, and an independent hole
`script-env.ts` strips `CB_HUB_SECRET`/`CB_DIAG_API_KEY` but **not**
`CB_SESSION_SECRET`; under `CB_DEV_NO_HUB=1` the router passes full env to the
backend. So box agents *can* inherit the session signing secret (verify==forge ⇒
forge any user's cookie). The plan's "we don't hand this to children" is untrue.
(Caveat: a same-user agent can read the 0600 `~/.cb-session-secret` file anyway —
so env-stripping is partial, and true containment is an agent-sandboxing
question beyond this plan.) **Disposition: accept; strip `CB_SESSION_SECRET` in
script-env regardless (cheap, consistent with the hub-secret strip), and record
the file-readability limit.**

Minor: plan cites `bin/router.ts:406` for `proxy.web`; actual is `:411`. Gate the
whole `/__router/` prefix centrally so a future control route can't be added
ungated.

## What this means (my synthesis)

The single correct fix Codex names: **the router becomes a fail-closed
authenticating reverse proxy** — every tailnet-origin request requires a valid
**owner** session (gen-aware) before *any* serving, proxying, or cold-start, with
local unauthenticated ergonomics preserved through a **non-network channel** (a
Unix socket), not header-absence. That is a materially bigger, security-critical
build than this plan scoped, and it inherits the CSRF and OAuth-prefix problems.
It also does not escape finding 4's deeper point: even behind a perfect owner
wall, you are exposing arbitrary historical worktree code, so one auth slip is
high-blast-radius.

**Recommendation: do not proceed on this plan's shape. Take the decision back to
the boxholder** — either commit to the fail-closed authenticating-proxy design
(a real project), or narrow the target away from "the whole shared dev router."
The independent `CB_SESSION_SECRET` strip (finding 8) should land regardless.

## Things checked and found clean (Codex)
- Loopback bind is real (`bin/router.ts:1053` → `listenLoopback`,
  `router-core.ts:178`); normal-HTTP Serve does strip client-supplied identity
  headers (so *spoofing presence* isn't the hole — *legitimate absence* is).
- No alternate dispatch path reaches the four control operations (all precede
  `parseWorktreeName`).
- `bin/`→`callback-box/src` import is precedented.

---

# Second review (post-reshape, Codex gpt-5.5, 2026-07-21)

The reshape (authenticating reverse proxy) cleared the first review's fatal
flaws — **no critical/fail-open findings this round**. Remaining are one design
decision and implementable refinements; all folded into the plan.

### 2.1 (High) — CSRF plan doesn't close finding 6: same-origin `/dev` content
`/dev/` serves agent-authored pages on the SAME authenticated origin as the
control routes (`bin/router.ts:855`, `router-docs.ts:673`); a malicious `/dev`
page passes `Origin`/`Sec-Fetch` and can POST the existing stop/retry forms
(`bin/router.ts:526,650`), and a CSRF token is readable by same-origin JS.
**Disposition: accept — the KEY decision.** Resolution in-plan: serve all
router-served agent content (`/dev`, dev artifacts) with a locked-down CSP
(`sandbox`, no `allow-scripts`, no `allow-same-origin`) so it cannot originate
requests, keeping owner-session + CSRF/Origin on mutating controls; **fallback**
if sandboxing proves incomplete: make `/__router/{stop,retry}` UDS/CLI-only
(loses remote worktree *mutation*, keeps remote read + box access). Flagged as
the top open question for the boxholder.

### 2.2 (High) — mobile `cb_mobile` cookie Path breaks under the prefix
Issued `Path=/${boxSlug}` (`mobile-cookie.ts:37`), but behind the router the
path is `/<worktree>/<box>/…`, so reloads/WS in the webview lose the cookie
(initial load sends Bearer, reloads depend on the cookie). **Disposition:
accept.** The router-side mobile auth (or `mobile-cookie.ts`) must issue a
prefix-correct Path. Added to Track B + failure modes.

### 2.3 (High) — browser HMR can't move to the UDS
Only CLI (`bin/workstreams`) can use `curl --unix-socket`; browser HMR/WS must stay
on TCP (`vite.config.ts:48`, `bin/router.ts:896`) and authenticate with the
local browser session. **Disposition: accept — corrected** (B.1: HMR stays TCP +
logged-in; only CLI → UDS).

### 2.4 (Medium) — slug→box resolution must be one source of truth
Router builds the slug map at startup, duplicate slugs overwrite
(`bin/router.ts:184`), slug derivation tolerates missing markers
(`bin/box-entry.ts:66`). Auth must resolve the target box via the SAME map the
proxy routes by, or reject duplicate slugs fail-closed — else auth verifies a
token for one box while the proxy routes elsewhere. **Disposition: accept.**

### 2.5 (Medium) — `classifyLocalRecord` is private
Not exported (`auth.ts:468`). Use the exported `resolveRequestIdentity`
(`auth.ts:411`) + compare to `getOwnerEmail()` (`auth.ts:328`). **Disposition:
accept — citation corrected in the plan.**

### 2.6 (Medium) — missing root-worktree API class (`/<w>/api/boxes`)
Vite proxies root `/<base>/api` + `/<base>/auth` after stripping the prefix
(`vite.config.ts:105`); `/api/boxes` (box listing, own mobile/session semantics,
`hub-server.ts:330`) isn't in B's route classes. **Disposition: accept — add a
root-worktree API class.**

### 2.7 (Medium) — Track C proves one route at one instant
The anon-`/__router/status`→401 probe over Serve fixes the old flaw, but only
implies the whole surface is gated if B installs ONE central chokepoint before
all dispatch AND the `upgrade` handler. Serve targets TCP (not UDS), so the probe
hits the TCP listener — correct. **Disposition: accept — B must be a single
pre-dispatch gate incl. WS upgrade; emphasized.**

### 2.8 (Low) — Track A still open (login SPA verbatim, OAuth no prefix)
Already marked open in the plan. No change.

**Most important before implementation:** decide the control-plane isolation
(2.1) — CSP-sandbox `/dev` vs. UDS-only mutations. Everything else is a
folded-in refinement.

---

# Third review — the WIRED gate (Track B.2a, Codex gpt-5.5, 2026-07-21)

Adversarial review of the live enforcement (bin/router-auth.ts, router-auth-deps.ts,
the router.ts chokepoint/listeners/upgrade). **All critical properties CONFIRMED;
no critical/high findings.** Three medium/low, all addressable.

### CONFIRMED (Codex verified against source)
- `trustedLocal` is listener-derived ONLY (TCP=false, UDS=true, captured in the
  handler closure; never a header/Origin/remoteAddress). UDS is chmod 0600.
- HTTP + WS chokepoints complete: the gate runs before status/dev/control/
  cold-start/proxy AND before `proxy.ws`; resolver exceptions fail closed.
- Owner session is gen-aware + store-unavailable-fail-closed + owner-only.
- Per-box mobile isolation holds; duplicate slugs deny; target root == the map
  the proxy routes by.
- No open redirect / header injection in the deny path (`returnTo` encoded,
  Location is a path).

### 3.1 (Medium) — unauth `/<w>/auth/*` cold-starts arbitrary worktrees
The allowlist permits `/<w>/auth/*` pre-auth, and the router then
`ensureRunning(<w>)` to proxy it — so an unauthenticated tailnet device can wake
any known worktree (and unknown names fail differently → a name oracle). Not an
auth bypass (the box still needs auth), but not "no unauth cold-start." **Disposition:
DECISION** — on a private tailnet (only invited devices) this is low severity and
serving the login page inherently needs the worktree's Vite up; options are
(accept+document) vs (centralize login via /main / a router-served shell so unauth
can't wake arbitrary worktrees). Boxholder's call.

### 3.2 (Medium) — CSRF fallback too permissive when Sec-Fetch-Site AND Origin absent
`isCsrfSafe({})` returns safe (router-auth-deps.ts:146). Modern browsers +
SameSite=Lax largely cover it, but an older client with the owner cookie could hit
the GET `/__router/dashboard/<name>` cold-start. **Disposition: harden in B.2c** —
`{}` (no provenance) ⇒ UNSAFE for TCP control (local tooling uses the UDS, which
bypasses CSRF anyway); reach the dashboard via a same-origin link, not direct nav.

### 3.3 (Low) — router relies on CB_HUB_SECRET being absent from its env
If it weren't, `resolveRequestIdentity` would take hub mode; but the router deps
require `source==="cookie"`, so it fails closed (DoS, not escalation).
**Disposition: cheap hardening in B.2c** — the router resolver should explicitly
ignore hub mode (or assert CB_HUB_SECRET unset).

**Most important before exposure:** decide 3.1 (unauth cold-start / name oracle).

---

# Fourth review — capstone over the complete feature (Track C + assembly, Codex gpt-5.5, 2026-07-21)

Final adversarial pass over the completed A+B+C. **One Medium finding; everything
else CONFIRMED sound** — the whole assembly, cross-cutting interactions, and
prod-safety.

### CONFIRMED
- The success path cannot be tricked into exposing an ungated router: a
  pre-Track-B router's 200 status JSON → `ungated` refuse; current `/__router/status`
  only 200s past the auth chokepoint; the `x-cb-router-guarded` marker is emitted
  ONLY on denied `/__router/*`.
- Cross-cutting A/B/C sound: base-prefix is single-segment/no-traversal; the
  router strips all client `x-cb-*` before injecting its own; prod login serves
  byte-identical HTML when the header is absent (no prod regression); the cookie
  rewrite is narrowly scoped (named cookies + exact `Path=/<slug>`).

### 4.1 (Medium) — failed exposure proof + failed teardown could orphan a live mapping — FIXED
On a failed served proof, `settleRouterExposure` tore down best-effort but never
verified removal; if teardown also failed, a live Serve mapping fronting an
unproven router remained, unrecorded. **Fixed (`tailscale-setup.ts`):** read the
serve config back after teardown; if the mapping can't be proven gone, record
the exposure intent (so `stop`/`status` track + remove it) and return a loud
failure — fail closed. Test added (`offCode:1` → mapping survives → intent
recorded + loud message).

**Go/no-go: GO for a private tailnet** once 4.1 landed (it has). The feature is
verified sound across four adversarial passes; remaining before ship is docs +
the live Mac/phone proof (which exercises the real daemon).
