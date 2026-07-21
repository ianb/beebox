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
