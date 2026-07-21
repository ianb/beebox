# Security TODOs

Known security gaps and future hardening work.

## Auth posture: structurally always-on (2026-07)

Authentication is now **structurally always-on** (see
`docs/implemented-plans/local-password-auth.md`). A box always requires a
logged-in identity — the `CB_ALLOW_UNAUTHENTICATED` operator opt-out was removed
(2026-07). The only unauthenticated servers that can exist are test-constructed
ones, via an in-process `openAccess` construction option that no CLI flag, env
var, or config field exposes. Two login methods: local password (scrypt in
`~/.cb-auth.json`, 0600)
and Google OAuth (optional). Sessions are HMAC cookies revocable via a per-user
`gen` claim (bumped on password change / user removal); a corrupt credential
store fails **closed** (503), never open. Login is throttled (per-IP + per-account
backoff, a global scrypt-concurrency cap, a bounded map). The `CB_DIAG_API_KEY`
bearer and the `CB_HUB_SECRET` header-trust boundary are unchanged.

Residual, accepted for now:
- **Setup-token window.** First-run setup is reachable unauthenticated until an
  account exists; mitigated by a 15-minute token TTL and a self-disabling route,
  but a box left with zero users and an exposed port during that window is
  claimable. Provision the owner account promptly (`cb auth create-user`).
- **No true socket-level WS-auth integration test.** The `gen`/identity resolver
  the WS `createContext` depends on is unit-tested, but no test drives a real
  tRPC subscription upgrade end to end. Covered by manual verification.
- **No MFA / password reset.** Recovery is `cb auth set-password` on the host;
  MFA/passkeys are deferred (see the plan's NOT-in-scope).
- **Cross-process lock lease-steal.** `src/lib/file-lock.ts` is backed by
  `proper-lockfile` (atomic guard-dir `mkdir` + a 5-min staleness lease). Like
  every lease-based lock, a holder suspended past the lease (>5 min) can have
  its lock stolen and then, on resume, delete the new holder's guard — a silent
  double-acquire. Not reachable by ordinary contention or request flooding; it
  needs a >5-min process suspension mid-critical-section, and the
  security-relevant critical section (the mobile device-store read-modify-write)
  is synchronous and sub-millisecond, so the window is effectively unreachable
  on the server deploy path. Accepted rather than adding fencing-token CAS or a
  native `flock` addon (2026-07-21).

## Google OAuth: shared token with broad scopes

**Status:** Known limitation, accepted for now (single-owner system).

**Problem:** All boxes share a single Google OAuth token that has all scopes (calendar, gmail, drive). Per-box `googleServices` policy in `box.json` controls which services each box is *allowed* to call, but this is a soft boundary enforced in application code, not a hard security boundary.

**Risks:**
- A compromised or buggy connector in one box could access Google APIs not intended for that box (e.g., a calendar-only box could theoretically read Gmail if the code bypasses the policy check).
- The token is stored in a single centralized file (`CB_GOOGLE_TOKENS_FILE`). Compromise of that file grants access to all authorized Google services.
- Revoking Google access (via Google Account settings) affects ALL boxes simultaneously.

**Mitigations (future):**
- **Separate OAuth clients per scope tier:** Register multiple Google OAuth apps (e.g., "callback-calendar" with only calendar scopes, "callback-full" with all scopes). Boxes reference a specific client. This provides hard scope isolation at Google's level.
- **Incremental auth:** Use Google's incremental authorization to request only the scopes each box needs, rather than all scopes upfront.
- **Audit logging:** Log which box accessed which Google API, so unauthorized cross-box access is detectable.
- **Per-user tokens:** When multi-user support is added, tokens should be keyed by user email. Each user authorizes separately, and boxes use the token of the user who connected them.

## File permissions

The centralized token file (`CB_GOOGLE_TOKENS_FILE`) and any legacy `google.secret.json` files must be readable only by the `callback` user (`chmod 600`). The deploy scripts should enforce this.
