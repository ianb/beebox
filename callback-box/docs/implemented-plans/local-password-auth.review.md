# Cross-model review — local-password-auth (Codex, 2026-07-19)

Adversarial review of `local-password-auth.md` by OpenAI Codex
(`codex exec`, read-only, high reasoning effort), prompted to hunt fail-open
holes and verify the plan's citations against source. Twelve findings; each
listed with its disposition. The plan text has been revised in place — this
file is the record of what changed and why, plus what was rejected.

## Findings and dispositions

1. **`/auth/agent-login` escalates a per-box token into a fleet-wide owner
   session** (bearer grants `authed` not `isOwner`,
   `server-box-scope.ts:197`; cookie is `Path=/`; token lands in URL
   history; unreachable behind the hub anyway). — **ACCEPTED, route
   deleted.** Verification also surfaced that the preHandler *already*
   accepts the bearer for all in-box requests (`server-box-scope.ts:86-88`),
   so Track E collapsed to browse-tooling header injection with no server
   change.
2. **Diag-bypass whitelist is a substring match** — a tRPC batch URL
   (`health.check,history.list`) passes `auth.ts:88`'s `url.includes(...)`
   and reaches `publicProcedure`s like `history.list`
   (`trpc/routers/history.ts:65`). — **ACCEPTED; verified against source.**
   Pre-existing privilege-widening for diag-key holders (not
   unauthenticated access — the key must still verify). Fix added to
   Track B: parse the procedure list, require every batched procedure
   whitelisted.
3. **`gen` algorithm self-contradictory** (removed-user cookies survive;
   Google/password coexistence breaks). — **ACCEPTED.** Track D rewritten:
   record exists → cookie must carry matching `gen` (Google callback stamps
   it too); no record → cookie must carry no `gen`; removal therefore
   revokes.
4. **Setup token indefinitely valid; login-page "pointer at the setup URL"
   contradicts the secrecy model.** — **ACCEPTED.** 15-minute TTL from
   boot (restart re-arms); the pointer is text-only, the token never
   appears in any served page.
5. **Root-route inventory incomplete** (`/api/build-info`,
   `/api/push/resubscribe` unauthenticated POST, hub `/healthz`, the
   `/share` SPA carve-out with no share feature in the tree). —
   **ACCEPTED.** Track B now classifies every root route; `/share`
   carve-out removed; resubscribe moves behind the wall (open question
   records the service-worker check).
6. **Throttle bypassable + memory bound false** (email-varying attacker;
   128MB scrypt per attempt; unbounded map). — **ACCEPTED.** Per-IP bucket,
   global scrypt concurrency cap (2, excess 429 pre-hash), hard map cap
   with logged eviction.
7. **Standalone authed WS breaks** — tRPC WS `createContext` gets a raw
   `IncomingMessage`; `resolveRequestIdentity` reads decorated
   `request.cookies` (`auth.ts:194`). — **ACCEPTED.** Resolver falls back
   to `getSessionUserFromCookieHeader` (`auth.ts:204`); new
   `ws-auth.doctest.md`.
8. **Corrupt-auth-file behavior undefined at the request boundary** —
   "no record" interpretation would fail *open* for revoked sessions. —
   **ACCEPTED.** Dedicated `auth-store-unavailable` resolver outcome → 503
   everywhere; doctested.
9. **Opt-out can still be operationally silent** (API/WS users see no
   banner). — **ACCEPTED in strengthened form.** Tiered opt-out:
   `=1` is loopback-only, non-loopback binds require `=network` or startup
   fails; `open` flag exposed in `/healthz` and `/api/build-info`.
10. **0600-on-write isn't crash-safe or permission-repairing.** —
    **ACCEPTED.** Track A: write-temp+fsync+rename, chmod check on load,
    symlink refusal.
11. **First owner can mismatch `CB_OWNER_EMAIL` (value or case) → created
    but 403 everywhere.** — **ACCEPTED.** Emails canonicalized at every
    boundary; setup refuses a first owner differing from a configured
    `CB_OWNER_EMAIL`.
12. **Over-scoped; minimal version is CLI-only setup, no web setup, no
    members, no browse credentials.** — **REJECTED as a scope judgment the
    boxholder already made:** the issue explicitly asks for a forced
    account-creation *screen* that explains itself (the friction must read
    as intentional), and browse/tour survival is required for forced-in-dev
    to hold (the plan's own bypass-pressure argument). Member support
    remains file-format + CLI only, which is the thin end Codex asked for.

## Verification notes

Findings 1, 2, 5, 7 were re-verified against source in this session before
adoption (they contradicted plan claims — the plan's original Track E
"owner-equivalent" characterization and "narrow whitelist" claim were
wrong). Finding 12 is judgment, not fact, and is recorded as rejected with
rationale rather than silently dropped.
