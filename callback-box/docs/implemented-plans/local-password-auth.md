# Local password auth, default-on

**Status:** implemented 2026-07 — local username/password login shipped
alongside always-on auth (Google OAuth is now layered on top, not the gate);
cross-model (Codex) reviewed at both the plan and implementation stages, with
findings fixed and re-reviewed. Not yet manually exercised in a live app —
see `issues/docs-and-chores/2026-07-19-manually-verify-local-password-auth.md`.
Three pre-existing security findings surfaced by the implementation review; the
OAuth-callback one is now fixed
(`issues/closed/bugs/2026-07-19-google-oauth-callback-unauthenticated.md`), while
`issues/bugs/2026-07-19-csp-report-endpoint-memory-exhaustion.md` and
`issues/code-quality/2026-07-19-browse-agent-token-argv-env-exposure.md` remain
open.

Add a local username/password login method and make authentication the
always-on default — including in dev — so an unauthenticated box requires a
loud, deliberate opt-out instead of being the accidental easy state. Google
OAuth becomes *a* method layered on top; the local credential is
self-contained (hashed on disk, zero remote services), completing the
local-first story. Origin: `issues/closed/features/2026-07-16-local-password-auth-default-on.md`.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — principally:
  - **#3 Validate at boundaries** (the credential file is a hand-editable
    input boundary; parse with a Zod schema, fail loud),
  - **#4 Resilient AND never silent** (every degraded state — opt-out mode,
    corrupt auth file, throttled login — warns visibly; nothing fails open
    silently),
  - **#6 Right-sized defensiveness** (fail-closed at the auth boundary;
    interior code trusts the resolved identity),
  - **#8 One way to do each thing** (kill the scattered
    `!isAuthEnabled() ⇒ open` recomputation; one identity resolver owns
    openness),
  - **#10 Testability is architectural** (pure credential/throttle cores,
    injected clock, test-only affordances gated by explicit flags).
- `callback-box/CLAUDE.md` — "Read before writing", tRPC-by-default for new
  endpoints (login/setup are deliberate exceptions, argued below), doctest
  tiers, generic-not-personal naming in shared text.
- `code-style.md` — custom error classes, no default params, named-params
  objects, the `as` ban, logging-level policy (`console.warn` = degraded but
  recovered — exactly the opt-out boot warning).
- Precedents: the hub-mode identity work (Track D chunk D2,
  `resolveRequestIdentity`) is the densest precedent — this plan extends its
  "one resolver, fail closed" shape rather than adding a second gate. The
  mobile pairing store (`src/core/mobile/pairing.ts`) is the precedent for a
  0600 hashed-credential JSON file.

## What already exists

Reused (cited); nothing here is rebuilt:

- **Session model** — `src/webapp/auth.ts:138` `signSession` /
  `auth.ts:155` `verifySession`: HMAC-SHA256 signed `cb_session` cookie, no
  server-side store; secret auto-generates to `~/.cb-session-secret` mode
  0600 (`auth.ts:34-46`). Password login mints the same cookie; no new
  session mechanism.
- **The single identity resolver** — `auth.ts:278` `resolveRequestIdentity`,
  consumed by the box auth preHandler and tRPC context "so the two can never
  diverge" (`auth.ts:243-247`). This plan extends it (standalone-open becomes
  a `source: "open"` it returns, and it gains the session-generation check);
  it does not add a parallel resolver.
- **The gate being replaced** — `auth.ts:52` `isAuthEnabled(): boolean {
  return !!process.env.GOOGLE_OAUTH_CLIENT_ID; }` and its call sites:
  `src/webapp/server-box-scope.ts:136` (`if (isAuthEnabled() || isHubMode())
  addBoxAuthHook`), `server-box-scope.ts:186` (`openAccess = isHubMode() ?
  identity.source === "open" : !isAuthEnabled()`),
  `src/webapp/server-root.ts:238,281`, `src/webapp/capture-request-owner.ts:32,38`,
  `src/hub/hub-server.ts` `decideHubAuth` (`if (!isAuthEnabled()) …
  [HUB_AUTH_OFF_HEADER]: "off"`), `src/hub/box-picker.ts:76-77`,
  `src/webapp/routes/auth.ts:63` (registers a stub `/auth/me` → `null` when
  disabled).
- **Shared login surface, hub-compatible** — `routes/auth.ts:62`
  `registerAuthSurface`, called by both the standalone server
  (`src/webapp/server.ts:123`) and the hub (`src/hub/hub-server.ts:258`).
  Password routes register here and inherit the correct hub/box split: only
  the process holding the session secret ever verifies credentials.
- **Hub boundary (unchanged)** — `auth.ts:115` `isHubMode()`, `auth.ts:126`
  `verifyHubSecret` (timing-safe), header trust documented at
  `auth.ts:252-276`. Deliberately untouched.
- **Diag bearer (kept, but tightened)** — `auth.ts:63` `verifyDiagBearerKey`,
  `auth.ts:85` `isDiagnosticBypassRequest`. The key mechanism stays, but the
  "whitelist" is a substring match (`auth.ts:88`
  `url.includes("/api/trpc/health.check")`), which a tRPC **batch** URL
  (`/api/trpc/health.check,history.list?batch=1`) satisfies while carrying
  non-whitelisted procedures — and procedures like `history.list` are
  `publicProcedure` (`trpc/routers/history.ts:65`), gated only by the outer
  wall. A diag-key holder can therefore read well beyond the two whitelisted
  endpoints. Pre-existing bug (found in cross-model review); Track B fixes
  it by parsing the exact procedure list and requiring every batched
  procedure to be whitelisted.
- **Per-box agent token — already accepted for ALL in-box requests.** —
  `src/core/agent/token.ts:26` `.callback-box/agent-token` (0600,
  gitignored), injected as `CB_AGENT_TOKEN` into spawned scripts. The box
  auth preHandler already returns early on `verifyAgentBearer`
  (`server-box-scope.ts:86-88`: "The box's own agents … call back in with
  the per-box loopback token"), pages and API alike, and the tRPC context
  sets `authed: true` on it (`server-box-scope.ts:188,196`). Note the limit:
  the bearer grants `authed`, **not** `isOwner`
  (`server-box-scope.ts:197`). Track E therefore needs no server change at
  all — only browse-tooling header injection.
- **Hashed-credential file precedent** — `src/core/mobile/pairing.ts:56-58`
  stores mobile device tokens as SHA-256 hashes in a
  `*.secret.json` written `{ mode: 0o600 }` (`pairing.ts:77-80`). The users
  file follows the same shape discipline (Zod schema, 0600, hashes only) with
  scrypt instead of plain SHA-256 because passwords are low-entropy.
- **Access control by email (unchanged)** — `src/webapp/box-access.ts:19-31`
  `canAccessBox`: owner email passes, else `config.allowedEmails` must
  explicitly include the email; fail-closed. Password identities flow into
  this unchanged — auth method and authorization stay orthogonal.
- **Timing-safe compare pattern** — `auth.ts:63-71` (length check +
  `crypto.timingSafeEqual`). scrypt verification compares two fixed 32-byte
  derived keys, so the length-leak subtlety (see Prior art #7) doesn't arise.
- **CLI command pattern** — flat commander dispatch in
  `src/cli/index.ts:85-112` (`program.addCommand(serveCommand)` …); the
  subcommand-group precedent is `src/cli/commands/scheduler.ts` (one
  `Command("scheduler")` with chained `.command(...)`s). `cb auth` follows it.
- **Test server helper** — `test/helpers/test-server.ts:128-131` calls
  `createServer({...})` in one place; ~20 route-test files pass today because
  no `GOOGLE_OAUTH_CLIENT_ID` means open. This is the one seam where the
  explicit opt-out gets set for tests.
- **Frontend login surface** — `src/frontend/src/components/BoxSelectionTiles.tsx:16-23`
  `SignInLink` → `/auth/login?returnTo=…` ("Sign in with Google");
  `src/frontend/src/pages/BoxSelection.tsx:64-74` shows it when `/api/boxes`
  returns `authRequired: true` (`src/frontend/src/lib/boxes.ts:7-21`). The
  redirect targets already point at `/auth/login`
  (`server-box-scope.ts:113`, `server-root.ts:293`), which is why the login
  *page* takes over that URL and Google moves to `/auth/google`.

Net-new with no in-repo precedent (justified per-track): the scrypt
credential store, the login throttle (confirmed: no HTTP rate limiting exists
anywhere in `src/`), the first-run setup flow, and the `CB_ALLOW_UNAUTHENTICATED`
opt-out (confirmed absent from the repo).

## Prior art (external)

Searched during planning (2026-07-19):

1. **OWASP Password Storage Cheat Sheet** — scrypt N=2^17, r=8, p=1 is the
   recommended configuration when argon2id is unavailable; argon2id is the
   first choice for new applications, scrypt the acceptable alternative.
   We take scrypt anyway: it's in `node:crypto` (zero native deps —
   local-first), and the file format records parameters so a future argon2
   migration can rehash on next login.
   <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
2. **Node `crypto.scrypt` maxmem gotcha** — default `maxmem` is 32MB; N=2^17,
   r=8 needs 128·N·r ≈ 128MB, so the call throws unless `maxmem` is raised
   explicitly. The hash helper hardcodes `maxmem: 132 * N * r` next to the
   parameters. <https://github.com/nodejs/node/issues/28755>
3. **First-run setup endpoints are a known incident class** — Gitea's
   installer stays reachable unless `INSTALL_LOCK` is set; Grafana/Superset
   default-credential incidents are widespread. Mature mitigations: Jupyter
   prints a one-time token to the console; Portainer disables the admin-setup
   endpoint after 5 minutes idle.
   <https://docs.gitea.com/administration/config-cheat-sheet>,
   <https://jupyter-notebook.readthedocs.io/en/6.5.2/security.html>
4. **Portainer's timeout** — confirmed: no admin within 5 minutes → service
   stops itself; recovery is restart or pre-set password at startup. We adopt
   the Jupyter shape (boot-logged one-time setup token) rather than the
   timeout — a personal server that self-terminates would read as a crash.
   <https://docs.portainer.io/faqs/installing/your-portainer-instance-has-timed-out-for-security-purposes-error-fix>
5. **@fastify/rate-limit** — supports per-route config and in-memory store;
   per-IP keys require `trustProxy`. We hand-roll a ~60-line exponential
   backoff keyed on (ip, email) instead — no new dependency, pure decision
   core (principle #10), and OWASP's recommendation (next item) is backoff,
   which the plugin doesn't model. <https://github.com/fastify/fastify-rate-limit>
6. **OWASP Authentication Cheat Sheet** — hard account lockout is a
   self-inflicted DoS for single-user systems; throttling with increasing
   delay / exponential backoff is the recommended default. Adopted.
   <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
7. **`timingSafeEqual` length subtlety** — it throws on unequal lengths, and
   an early length-check leaks length timing. Not applicable to scrypt-vs-
   scrypt comparison (both sides are fixed 32-byte keys), noted so nobody
   "hardens" it wrong later. <https://github.com/nodejs/node/issues/17178>
8. **Invalidating HMAC-cookie sessions without a store** — established
   pattern: embed a per-user generation/epoch in the signed payload; bump it
   on password change and every prior cookie dies. Adopted as the `gen`
   field. <https://snicco.io/blog/how-wordpress-uses-authentication-cookies-and-sessions>
9. **Loud auth opt-out precedent** — code-server's `--auth none` with
   explicit never-expose warnings is the model; no major tool ships a silent
   auth kill switch. Grafana notably has *no* full kill switch (only
   anonymous-viewer mode). Confirms `CB_ALLOW_UNAUTHENTICATED=1` + boot
   warning + UI banner is in line with (or stricter than) field practice.
   <https://coder.com/docs/code-server/guide>

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track A — credential store (`src/webapp/local-users.ts`)

**What.** A module owning the local users file: load/validate, create-first-
user (atomic), add user, verify password, set password (bumps `gen`), list,
remove.

**Why.** No local identity storage exists; everything else depends on it.

**Direction.** File at `~/.cb-auth.json` (sibling of `~/.cb-session-secret`,
same home-level scope — identity is fleet-level: the hub logs users into many
boxes, and in dev one account serves every worktree). Env override
`CB_AUTH_FILE` for prod/tests. Created with `wx` (O_EXCL) so two racing
first-run setups can't both win; every subsequent write is
**write-temp + fsync + rename** (a crash mid-write must not truncate the
file that gates all logins — `mode: 0o600` on a plain `writeFileSync`, the
mobile-pairing precedent, is not crash-safe). Loads validate more than
shape: Zod parse (principle #3), plus a permissions check (not 0600 →
`console.warn` and chmod) and a refusal to follow a symlink. An unparseable
file is a **hard failure of login** (typed `AuthFileCorruptError`,
`console.error`, all logins refused — never fail open); how that state
answers at the request boundary is specified in Track D
(`auth-store-unavailable` → 503). Mutating operations (add/set/remove)
serialize through `src/lib/file-lock.ts` per the CLAUDE.md lock rule.
Emails are **canonicalized (trimmed, lowercased) at every boundary** —
store, login POST, setup, CLI — because `canAccessBox`
(`box-access.ts:19-31`) and `getOwnerEmail` compare exact strings, and a
case-differing first account would be a successfully created owner who gets
403 everywhere. For the same reason, when `CB_OWNER_EMAIL` is set, setup
refuses to create a first owner with a different (canonicalized) email —
matching, not shadowing, the configured owner.

Shape:

```jsonc
{
  "version": 1,
  "users": [
    {
      "email": "boxholder@example.com",
      "name": "Boxholder",
      "role": "owner",            // "owner" | "member"; exactly one owner
      "gen": 1,                   // session generation; bump = revoke cookies
      "scrypt": { "N": 131072, "r": 8, "p": 1, "salt": "<b64>", "hash": "<b64>" },
      "created": "2026-07-19T00:00:00Z"
    }
  ]
}
```

Hashing: `crypto.scrypt` (async, promisified — ~100ms of CPU shouldn't block
the event loop on a serving process), N=2^17/r=8/p=1, 16-byte random salt,
32-byte key, `maxmem: 132 * N * r` (Prior art #2). Verify recomputes and
compares via `timingSafeEqual` on the two fixed-length keys. Parameters live
in the record: a future rehash (argon2, retuned N) happens transparently on
next successful login.

Owner semantics: the first user is `role: "owner"`; `getOwnerEmail()`
(`auth.ts:220`) falls back to the auth file's owner when `CB_OWNER_EMAIL` is
unset, making the env var an override rather than a requirement.

**Vocabulary lock-ins.** `~/.cb-auth.json`, `CB_AUTH_FILE`, field names
`users[].{email,name,role,gen,scrypt,created}`, error classes
`AuthFileCorruptError`, `UserExistsError`, `NoSuchUserError`.

**First implementation chunk.** The module + `test/webapp/local-users.doctest.md`
(pure-function tier: create/verify/rehash/gen-bump/corrupt-file paths, tmp
`CB_AUTH_FILE`). No open questions inside it.

### Track B — always-on gate: `authRequired()` replaces `isAuthEnabled()`

**What.** Delete `isAuthEnabled()`. New in `auth.ts`:
`authRequired(): boolean` — `true` unless `process.env.CB_ALLOW_UNAUTHENTICATED === "1"`.
Google availability becomes a private concern of `routes/auth.ts` (it already
has `getGoogleClientCreds()`, `src/connectors/google-auth.ts:151-159`).

**Why.** "Is Google configured" must stop meaning "is this box protected" —
that conflation is the whole disease (issue, problems 1–2).

**Direction.**
- Every `!isAuthEnabled() ⇒ open` branch flips to `!authRequired()`:
  `server-box-scope.ts:136` (hook now installs whenever `authRequired() ||
  isHubMode()`), `server-root.ts:238,281`, `box-picker.ts:76-77`, hub
  `decideHubAuth` (sets `x-cb-hub-auth: off` only when the *hub* was started
  with the opt-out), `capture-request-owner.ts:32,38`.
- **Consolidation (principle #8):** `resolveRequestIdentity` returns
  `{ source: "open" }` in standalone opt-out mode (no cookie, `!authRequired()`),
  so the three call sites that today recompute openness
  (`server-box-scope.ts:186`, `capture-request-owner.ts:38`, `server-root.ts:283`)
  just read `identity.source`. The `IdentitySource` union doesn't change;
  "open" gains the standalone meaning its name already implies.
- **The loud opt-out, tiered by exposure.** `CB_ALLOW_UNAUTHENTICATED=1`
  permits open mode only when the server binds loopback; binding a
  non-loopback host in open mode requires the explicit value
  `CB_ALLOW_UNAUTHENTICATED=network` — otherwise startup fails with an error
  naming both spellings. (An open box on `0.0.0.0` is the catastrophic
  config; it gets its own, uglier opt-in.) Warning emitted at
  `startServer`/hub listen time (not `createServer`): every real boot of an
  open server prints a multi-line `console.warn` naming the flag and the
  risk; test servers using `server.inject()` never listen, so hundreds of
  route tests stay quiet (noise-is-a-bug, root CLAUDE.md) while any
  actually-listening dev server warns on every boot. Open state is also
  machine-visible: `/healthz` and `/api/build-info` include
  `"open": true`, so API/WS consumers who never see a banner can still
  detect it. The frontend shows a persistent (non-dismissible) banner:
  `/auth/me` in open mode returns `{ "open": true }` instead of `null` (the
  stub at `routes/auth.ts:66-72` becomes this), and `useCurrentUser`
  surfaces it.
- **Root-route classification (complete, not just the SPA fallback).** Every
  root-level route gets an explicit auth class in this track:
  `/api/boxes` (filtered by identity — existing behavior),
  `/api/build-info` (`server-root.ts:201`) stays public but minimal (build
  hash + `open` flag only), `/api/push/resubscribe` (`server-root.ts:217-234`,
  today an unauthenticated state-changing POST) moves behind the wall,
  hub `/healthz` stays public but is reviewed down to liveness + `open` (no
  per-box runtime detail), and the SPA fallback's `/share` carve-out
  (`server-root.ts:281`) is **removed** — no share feature exists in the
  tree to justify it, and an unused hole in the wall is exactly the kind of
  exception that outlives its rationale.
- **Diag-bypass tightening.** `isDiagnosticBypassRequest` (`auth.ts:85-90`)
  replaces its `url.includes(...)` substring test with parsing the tRPC path
  segment and requiring **every** comma-separated batched procedure to be in
  the whitelist. (See What-already-exists; this is a live pre-existing
  privilege-widening for diag-key holders.)
- `makeTestServer`/`createTestServer` sets `CB_ALLOW_UNAUTHENTICATED=1`
  (around `test-server.ts:128-131`) — honest: test servers *are*
  deliberately open. Tests exercising auth itself unset it locally, exactly
  as they toggle `GOOGLE_OAUTH_CLIENT_ID` today
  (e.g. `test/hub/hub-server-auth.doctest.md:25`).

**Vocabulary lock-ins.** `authRequired()`, `CB_ALLOW_UNAUTHENTICATED`
(value `"1"` = loopback-only open mode, `"network"` = open on any bind;
any other value is rejected at startup — fail closed, never coerced).

**First implementation chunk.** `authRequired()` + the mechanical call-site
flip + test-helper env + updating the existing auth doctests
(`hub-mode-auth`, `auth-hub-identity`, `hub-server-auth`, `box-picker`,
`capture-routes`) to the new gate. Commit is green but the server is not yet
usably loginable without Google — acceptable inside the worktree (plan ships
whole).

### Track C — login surface: password routes, setup flow, throttle

**What.** `registerAuthSurface` always registers the full surface: login
page + password POST + logout + `/auth/me` + setup; Google routes register
additionally when creds exist.

**Why.** The login half of local-first; today the only real login is Google
(`routes/auth.ts:1-8`).

**Direction.** Routes (raw Fastify, not tRPC — they set cookies and redirect,
the same reason `routes/auth.ts` is raw today; CLAUDE.md's tRPC-default
carve-out for "OAuth redirects" extends to the login surface):

- `GET /auth/login` — serves the SPA (the login page is a frontend route;
  bundles are public pre-auth by design — hub already serves them ungated,
  `hub-server.ts` "a client bundle is public and must load before the user
  can auth-navigate"). All existing redirect targets
  (`server-box-scope.ts:113`, `server-root.ts:293`) keep working unchanged.
- `POST /auth/login` — JSON `{ email, password }` → throttle check → verify
  via Track A → mint cookie (same `setCookie` shape as
  `routes/auth.ts:157-163`) → `204`. Failures: uniform `401
  { error: "Invalid credentials" }` for unknown-user and wrong-password
  alike (no user enumeration); `429` with `retryAfterMs` when throttled.
- `GET /auth/google` — the current `/auth/login` Google-consent redirect,
  renamed. `/auth/callback`, `/auth/logout`, `/auth/me` unchanged in place.
- **First-run setup.** When `authRequired()` and Track A reports zero users:
  boot (listen-time, same hook as the opt-out warning) generates a one-time
  in-memory setup token and prints
  `First-run setup: http://<host>/auth/setup?token=<…>` to the console.
  The token **expires 15 minutes after boot** (restart re-arms it — the
  Portainer lesson without the self-terminating service): an unattended
  exposed server with zero users is not claimable indefinitely, and a
  leaked old log line is worthless. `GET /auth/setup` serves the SPA;
  `POST /auth/setup` requires the live token and creates the owner account
  (O_EXCL — first writer wins), then mints a session. The route answers
  `410 Gone` the moment a user exists, and `410` with a "restart the server
  or run `cb auth create-user`" body after expiry. The **token never
  appears in any served page**: the login page's pointer to setup is text
  ("check the server console for the setup link, or run
  `cb auth create-user`"), because an unauthenticated endpoint that hands
  out the setup capability would defeat it. Headless twin:
  `cb auth create-user` (Track F) needs no token — it runs as the file
  owner, which *is* the authority.
  With Google configured and zero users (prod's migration state), nothing
  redirects to setup; Google login keeps working throughout.
- **Throttle** — `src/webapp/login-throttle.ts`: pure core with injected
  clock (principle #10), applied to `POST /auth/login` and
  `POST /auth/setup`. Three independent limits, because an attacker
  controls both key dimensions:
  1. per-`(ip,email)` exponential backoff (`min(1s · 2^(failures-1), 60s)`,
     cleared on success, entries expire after 1h);
  2. a per-IP bucket across all emails (so varying the email doesn't reset
     the clock);
  3. a **global scrypt concurrency cap** (2 in flight; excess requests
     answer `429` *before* hashing) — each verification costs ~128MB and
     ~100ms, so unthrottled parallel logins are a memory-DoS primitive
     regardless of backoff.
  The map is hard-capped (~4k entries, oldest-evicted, eviction logged) —
  "expires in 1h" alone is not a memory bound when the attacker mints keys.
  Every throttled attempt logs `console.warn` with ip + email. In-memory is
  correct: a single process holds the login surface (standalone or hub),
  and restart-resets are acceptable for a backoff.

**Vocabulary lock-ins.** Route paths `/auth/login` (GET page + POST),
`/auth/google`, `/auth/setup`; response shapes above; module name
`login-throttle.ts`.

**First implementation chunk.** `POST /auth/login` + throttle + their
doctests (`test/webapp/password-login.doctest.md`,
`test/webapp/login-throttle.doctest.md`), against a tmp `CB_AUTH_FILE`.

### Track D — session revocation: the `gen` claim

**What.** Password-derived sessions embed the user's `gen`; verification
rejects a cookie whose `gen` doesn't match the file.

**Why.** HMAC cookies are irrevocable today (`auth.ts:4` "no server-side
session store"); a password change must invalidate outstanding sessions or
changing a leaked password doesn't end the leak.

**Direction.** `signSession` payload gains optional `gen`; the check lives in
`resolveRequestIdentity`'s cookie path (`auth.ts:290-292`), with one
consistent rule set (this replaces an earlier draft the cross-model review
showed was self-contradictory):

- **Every** login for an email that has a local record mints `gen` — the
  password POST *and* the Google callback both stamp the record's current
  value. (Google-only emails, no record, mint no `gen`.)
- Verify: record exists → cookie must carry `gen === record.gen` (absent or
  stale → unauthenticated). No record → cookie must carry **no** `gen`
  (a `gen`-bearing cookie whose record vanished is dead — so removing a
  local user revokes its sessions). No record, no `gen` → valid
  (Google-only identity; `canAccessBox` still gates authorization).
- Consequences, stated: password change bumps `gen` → all prior sessions
  for that email die, Google-minted ones included (strict, intended);
  creating a local record for an email invalidates that email's older
  Google-minted (gen-less) cookies — one re-login, intended.

`verifySession` (`auth.ts:179-184`) currently discards unknown payload
fields; it gains `gen` passthrough. Auth-file reads on the request path are
cached with an mtime guard (the file changes only on credential
operations). **Corrupt auth file at the request boundary fails closed but
distinctly**: the resolver returns a dedicated `auth-store-unavailable`
outcome and every consumer answers `503` (not 401, not fall-through-to-
Google-only — treating corruption as "no record" would fail *open* for
exactly the sessions `gen` exists to revoke). **WS upgrades**: the tRPC WS
adapter hands `createContext` a raw `IncomingMessage`, not a
cookie-decorated Fastify request, so the resolver's cookie path falls back
to parsing the raw `Cookie` header via the existing
`getSessionUserFromCookieHeader` (`auth.ts:204` — built for "the paths
without `@fastify/cookie`'s decoration"); today the gap is masked because
standalone+auth is rare, but default-on makes it every dev box's WS path.
Hub mode needs no change: the hub is the only cookie verifier and the only
auth-file reader; children keep trusting headers.

**Vocabulary lock-ins.** Cookie payload field `gen`.

**First implementation chunk.** The whole track — `signSession`/`verifySession`
passthrough, resolver check, mtime cache — plus extending
`test/webapp/auth-hub-identity.doctest.md` and a
`test/webapp/session-gen.doctest.md` (login → change password → old cookie
dead).

### Track E — local tooling access (browse/tours) via the agent token

**What.** Page-level access for agent tooling using the existing per-box
agent token — no new credential, no product-CLI session minting.

**Why.** With auth forced on in dev, `bin/browse`/`bin/tour` (a real
Chromium — confirmed no header/cookie injection exists anywhere in
`bin/browse`, `browse/src/*`, or `test/tours/tour-lib/browse.ts`) would hit
the login wall, and forced-in-dev that tooling can't survive is forced-in-dev
that gets bypassed.

**Direction.** No server change at all. The box auth preHandler *already*
accepts `Authorization: Bearer <agent-token>` for every in-box request,
page or API (`server-box-scope.ts:86-88`) — the gap is purely that a real
Chromium can't attach the header. So the work is confined to the in-monorepo
browse tooling: the `browse` CLI (driven via `bin/browse`) gains an
extra-headers option (CDP `Network.setExtraHTTPHeaders` per page), and the
`bin/browse` wrapper — which already resolves the worktree — reads the box's
`.callback-box/agent-token` and injects
`Authorization: Bearer <token>` for requests to this worktree's origin.
Tours (`test/tours/tour-lib/browse.ts`) inherit it by spawning `bin/browse`.

An earlier draft had a `GET /auth/agent-login?token=…` route minting an
owner session cookie. Cross-model review killed it, correctly, on three
counts: the bearer grants `authed`, **not** owner
(`server-box-scope.ts:197`), so an owner cookie would be an escalation; the
session cookie is `Path=/` (`routes/auth.ts:157-158`), so a *per-box* token
would buy a *fleet-wide* session on a multi-box server; and the token would
land in browser history and logs. Header injection stays exactly inside the
trust the token already has — same requests, same `authed`-not-owner
identity, no cookie minted, no product surface added.

Limit, stated: browse-driven pages act as an authed non-owner, so
owner-gated UI (`ownerProcedure` admin surfaces) stays walled off from
tooling — correct, and previously false only because dev boxes were open.

**Vocabulary lock-ins.** None (no new routes, env vars, or credentials).

**First implementation chunk.** The browse-CLI header option + `bin/browse`
token wiring; verified by a tour against a `makeTestServer`-style authed
worktree serve rather than a new callback-box doctest (the change is in
`browse/`+`bin/`, not in the server).

### Track F — `cb auth` CLI

**What.** `src/cli/commands/auth.ts`, registered in `src/cli/index.ts`
(pattern: `scheduler.ts` subcommand group): `cb auth create-user` (first
user; interactive password prompt or `--password-file`; refuses when users
exist), `add-user`, `set-password` (bumps `gen`), `list`, `remove-user`
(refuses to remove the owner). All operate directly on the auth file via
Track A — no HTTP, so they work headless/CI and are inherently authorized by
file ownership.

**Why.** The headless twin of the setup page; also the only member-account
surface (no user-management UI — see NOT in scope).

**First implementation chunk.** The command group + doctest
(`test/cli/auth-command.doctest.md`, tmp `CB_AUTH_FILE`).

### Track G — frontend: login page, setup page, open-mode banner

**What.** `pages/login/LoginPage.tsx` (email+password form; "Sign in with
Google" button shown when the server advertises it), `pages/login/SetupPage.tsx`
(account form + the *why* copy: "this box would otherwise be open to anyone
who can reach this port; a local account keeps development free of remote
services"), and a persistent open-mode banner driven by `/auth/me` →
`{ open: true }`.

**Why.** The forced screen must explain itself (issue: "so the friction
reads as intentional, not a papercut"), and the opt-out must stay visible
(principle #4).

**Direction.** Server advertises available methods via
`GET /auth/methods` → `{ password: true, google: boolean, setupRequired: boolean }`
so the SPA renders the right form without probing. `SignInLink`
(`BoxSelectionTiles.tsx:16-23`) and the `authRequired` branch in
`BoxSelection.tsx:64-74` route to the login page instead of straight to the
Google redirect. Banner follows the `CaptureErrorBanner` structural
precedent but non-dismissible. Per cb-frontend conventions (frontend.md
primitives; pages own their landmarks).

**First implementation chunk.** LoginPage + `/auth/methods` + the
BoxSelection rewire; setup page and banner follow.

### Track H — docs, deploy, migration

**What.** `docs/developer-install.md` + `docs/docker-install.md` +
`docs/agent-install.md` gain the first-run account step;
`deploy/README.md:196-217` env template gains `CB_AUTH_FILE` (default is
fine — `/home/callback/.cb-auth.json`) and drops "Auth (optional…)" framing;
`docs/todo-security.md` records the new posture; the issue file moves to
closed on ship.

**Prod migration story.** Prod (hub + Google OAuth) upgrades in place with
zero downtime and zero required action: `authRequired()` is already
effectively true there (Google configured), Google login keeps working, and
existing sessions stay valid (no `gen` claim → no local record → check
skipped, Track D). The boot log prints the setup-token line (zero local
users); creating a local owner account is optional hardening the boxholder
can do whenever. Nothing about `CB_HUB_SECRET`, `CB_DIAG_API_KEY`, or the
header contract changes. The one behavior change: a prod box whose Google
env was *accidentally* dropped now fails closed (login page, no Google
button) instead of serving open — which is the point.

## Subplans

None. The one candidate — member/multi-user management — is explicitly
deferred (NOT in scope) rather than sub-planned: the file format already
accommodates it and no current decision is blocked by it.

## Failure modes

> **Critical gap (accepted, documented):** a session-secret *and* auth-file
> holder (i.e. someone with the boxholder's local file access) can mint
> arbitrary sessions — unchanged from today's trust model, where
> `~/.cb-session-secret` alone already grants this. Not new surface; noted
> so reviewers don't rediscover it.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Auth file corrupt / fails Zod parse | Track A + Track D doctests (login path AND cookie-verify path) | `AuthFileCorruptError`; logins refuse; cookie resolution returns `auth-store-unavailable` → 503 (never "no record", which would fail open for revoked sessions) | Clear — `console.error` with path; login page shows "local login unavailable" |
| Auth file missing on a box that had users (deleted/moved) | Track A doctest | Zero-users state → setup flow re-arms, but existing cookies carry `gen` and the resolver finds no record → Google-only emails still work, password sessions die | Clear — boot prints setup line again |
| scrypt throws (maxmem, bad params from hand-edited file) | Track A doctest (bad-params case) | Verify path catches typed error → login fails closed, `console.error` | Clear |
| Two first-run setups race (two browsers, or setup page vs `cb auth create-user`) | Track A doctest (O_EXCL) | `wx` create: second writer gets `UserExistsError` → setup POST answers 409 | Clear |
| Setup token leaks (console scrollback, shipped logs) | Setup doctest (expiry case) | 15-minute TTL from boot + dies once a user exists; never served in any page | Clear — 410 with recovery instructions |
| Brute-force against `POST /auth/login` | Throttle doctest | Per-(ip,email) backoff + per-IP bucket + uniform 401 body | Clear — each throttled attempt `console.warn`s |
| scrypt memory-DoS (parallel logins × 128MB each) | Throttle doctest (concurrency case) | Global cap of 2 in-flight verifications; excess 429 before hashing | Clear — 429 |
| Throttle map growth (spray of ips/emails) | Throttle doctest (eviction) | 1h expiry + hard cap (~4k, oldest-evicted) | Clear — eviction logged |
| `CB_ALLOW_UNAUTHENTICATED` set in prod by mistake | — | Cannot be silent: boot warning every start + non-dismissible UI banner | Clear by construction |
| Test-helper env leaks `CB_ALLOW_UNAUTHENTICATED=1` into an auth-testing doctest | Existing auth doctests re-run under Track B | Auth doctests explicitly unset it (same discipline as `GOOGLE_OAUTH_CLIENT_ID` today, e.g. `hub-server-auth.doctest.md:25`) | Clear — those tests fail if the gate is open |
| Stale `gen` cache (mtime guard misses a same-ms write) | session-gen doctest | Worst case: a revoked cookie lives until next mtime tick (<1s); credential ops are rare and human-paced | Accepted risk, documented in module comment |
| WS upgrade authed via cookie on standalone (raw `IncomingMessage`, no `@fastify/cookie` decoration) | New WS-auth doctest (Track D) | Resolver falls back to `getSessionUserFromCookieHeader` on raw headers | Clear — without it, WS dies at context creation once auth is default-on |
| Browse-injected bearer used against owner-gated UI | — | By design: bearer is `authed`, never `isOwner`; owner surfaces stay walled | Clear — 403 from `ownerProcedure` |
| Removed local user's outstanding sessions | session-gen doctest | `gen`-bearing cookie with no record → unauthenticated | Clear |
| Hub child receives password POST directly (bypassing hub) | Existing `hub-mode-auth` doctest extended | Children in hub mode don't register credential verification (no secret, no auth file read); box-scope routes stay header-gated | Clear — 401 with the existing hub-bypass detail message (`server-box-scope.ts:104-112`) |
| Login page unreachable because SPA bundle missing (fresh clone, no build) | — | Same failure as every page today (`frontendExists` guard, `server-box-scope.ts:222`); curl + `cb auth` still work | Clear enough |

## Agent-flow / user-flow edge cases

The template's card-centric scenarios, mapped honestly onto an auth surface:

- **Wrong method chosen** (Google vs password for the same email) —
  **ADDRESSED**: identities are emails; both methods resolve to the same
  `SessionUser`, and `canAccessBox` doesn't know which method minted the
  session (Track B/C).
- **Stale ref** (valid cookie for a since-removed user) — **ADDRESSED**:
  `gen` check fails a removed local user (record gone → no match); Google
  identities are governed by `allowedEmails` as today (Track D).
- **Two writers on the same file** (setup page vs CLI, concurrent
  `cb auth` ops) — **ADDRESSED** for creation (O_EXCL); **ADDRESSED** for
  mutation: all writes go through `src/lib/file-lock.ts` per the CLAUDE.md
  lock rule (Track A uses it for add/set/remove).
- **Hand-edit drift** (boxholder edits `~/.cb-auth.json` by hand) —
  **ADDRESSED**: Zod parse on every load, fail-closed with a clear error
  naming the file (principle #3).
- **Fabricated free-form value** — not applicable: no agent authors auth
  data; the only free-form field is a display name.
- **Validation error UX** — **ADDRESSED**: uniform 401 for credentials (no
  enumeration), 409 for setup race, 410 for dead setup, 429 with
  `retryAfterMs` for throttle — each a distinct, correct status the frontend
  renders in-form (Track C/G).
- **Partial migration / transition state** — **ADDRESSED**: the only
  transition state is "authRequired, zero users," which is a designed state
  (setup flow) not an accident; prod's version of it keeps Google working
  (Track H). No data migrates.

## NOT in scope

- **Multi-user management UI** — file format and CLI accommodate members;
  building UI now is speculative surface (CLAUDE.md: no features beyond the
  task).
- **Password reset via email** — requires outbound mail identity; the
  recovery path is `cb auth set-password` on the host, which matches the
  single-boxholder trust model.
- **MFA / TOTP / passkeys** — real hardening, real scope; a future plan can
  layer on the same session model. Passkeys in particular deserve their own
  design (origin binding vs the multi-URL dev router is nontrivial).
- **argon2id** — native dep vs `node:crypto`; parameters-in-file keeps the
  door open (Prior art #1).
- **A "disable password method" knob** — fewer modes is the point;
  throttling covers the online-guessing concern. Revisit only with evidence.
- **Server-side session store / revocation list** — `gen` covers the real
  need (revoke on password change) without abandoning the stateless design.
- **Changing the diag bearer, hub header contract, mobile pairing, or
  webhook posture** — explicitly untouched (issue requirement); webhooks
  stay outside the auth wall as documented in `hub-server.ts` `decideHubAuth`.
- **Renaming/relocating `~/.cb-session-secret`** — tempting consolidation,
  separate chore; not load-bearing here.

## Open design questions

- **Throttle keying behind NAT/proxies** — (ip,email) keying means a shared
  NAT can throttle a household. Lean: accept; single-user system, backoff
  caps at 60s. Not worth `trustProxy` complexity in standalone mode.
- **Does gating `/api/push/resubscribe` break service-worker resubscribes?**
  Lean: no — the SW fetches same-origin with credentials, so the session
  cookie rides along; verify in Track G's manual pass. If a push-triggered
  resubscribe can fire from a logged-out SW, it degrades to "resubscribe on
  next visit", which the route's own comment already calls best-effort
  (`server-root.ts:220`).
- **Banner copy and login-page "why" copy** — wording lands in Track G
  review with the boxholder; not structural.

## Knowledge audits

Skip, with rationale: this surface is operated by humans and dev tooling,
not by box agents — no box agent logs in, edits the auth file, or needs to
recall a convention here (the agent token is injected into script env
automatically, `token.ts:11-14`). No `knowledge-audits.yaml` entries.
If a future change makes agents interact with auth (e.g. an agent-facing
"pair a device" procedure), that change carries the audit.

## Implementation order

1. **Track A** — credential store + doctests. (Unblocks everything.)
2. **Track B** — `authRequired()` flip + opt-out + test-helper + existing
   doctest updates. (Depends on nothing in A but lands after so the "locked
   out" window inside the worktree is minimal.)
3. **Track C** — password login + setup + throttle + doctests. (Needs A;
   with B makes the system coherent again.)
4. **Track D** — `gen` revocation. (Needs A, C.)
5. **Track E** — browse-CLI header injection + `bin/browse` token wiring
   (no server change). (Needs B; independent of C/D.)
6. **Track F** — `cb auth` CLI. (Needs A.)
7. **Track G** — frontend login/setup/banner + `/auth/methods`. (Needs C.)
8. **Track H** — docs/deploy/migration notes + issue closure. (Last.)

Each track is one or a few commits; the plan ships as one unit when all
land. No main merge without the boxholder's explicit signal.

## Rollout shape

- **Test posture (tests as design tool, `docs/testing.md`).** Named up
  front: `local-users.doctest.md` (pure tier: create/verify/rehash/
  gen-bump/corrupt/atomic-write/canonicalization),
  `login-throttle.doctest.md` (pure, injected clock: backoff, per-IP
  bucket, concurrency cap, eviction), `password-login.doctest.md` (route
  tier: login, uniform 401, setup incl. token expiry and O_EXCL race),
  `session-gen.doctest.md` (password change kills sessions; removed user
  kills sessions; Google+local coexistence; corrupt file → 503),
  `ws-auth.doctest.md` (cookie-authed WS upgrade on standalone),
  `auth-command.doctest.md` (CLI, tmp `CB_AUTH_FILE`); a diag-bypass
  doctest asserting a batch URL no longer passes; plus updates to the five
  existing auth/hub doctests that today toggle `GOOGLE_OAUTH_CLIENT_ID`.
  Done-when: all of the above green, `pnpm test` green, and a manual pass —
  fresh dev serve forces setup → login works → `bin/browse` tours an authed
  box via injected bearer → `cb serve` with `CB_ALLOW_UNAUTHENTICATED=1`
  warns and banners, and with `=1` on a non-loopback bind refuses to start.
- **Knowledge audits.** None (rationale above).
- **Migration.** No data migrates. Prod upgrades in place (Track H);
  `needs: [manual-testing]` goes on the issue for the prod hardening step
  (create the local owner account on prod, verify Google + password
  coexist) since only the boxholder can exercise real-Google login.
