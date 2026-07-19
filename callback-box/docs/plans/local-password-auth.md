# Local password auth, default-on

Add a local username/password login method and make authentication the
always-on default — including in dev — so an unauthenticated box requires a
loud, deliberate opt-out instead of being the accidental easy state. Google
OAuth becomes *a* method layered on top; the local credential is
self-contained (hashed on disk, zero remote services), completing the
local-first story. Origin: `issues/features/2026-07-16-local-password-auth-default-on.md`.

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
- **Diag bearer (unchanged)** — `auth.ts:63` `verifyDiagBearerKey`,
  `auth.ts:85` `isDiagnosticBypassRequest` (GET + whitelist + timing-safe
  key). Deliberately untouched.
- **Per-box agent token** — `src/core/agent/token.ts:26`
  `.callback-box/agent-token` (0600, gitignored), injected as
  `CB_AGENT_TOKEN` into spawned scripts, verified by
  `token.ts:55` `verifyAgentBearer`, already granting `authed: true` in the
  tRPC context (`server-box-scope.ts:188,196`). Reused as the local-tooling
  credential for page access (Track E) — no new dev credential is invented.
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
`CB_AUTH_FILE` for prod/tests. Written mode 0600; created with `wx`
(O_EXCL) so two racing first-run setups can't both win. Zod-validated on
every load (principle #3); an unparseable file is a **hard failure of
login** (typed `AuthFileCorruptError`, `console.error`, all logins refused —
never fail open) while non-auth traffic is unaffected.

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
- **The loud opt-out.** Warning emitted at `startServer`/hub listen time (not
  `createServer`): every real boot of an open server prints a multi-line
  `console.warn` naming the flag and the risk; test servers using
  `server.inject()` never listen, so hundreds of route tests stay quiet
  (noise-is-a-bug, root CLAUDE.md) while any actually-listening dev server
  warns on every boot. The frontend shows a persistent (non-dismissible)
  banner: `/auth/me` in open mode returns `{ "open": true }` instead of
  `null` (the stub at `routes/auth.ts:66-72` becomes this), and
  `useCurrentUser` surfaces it.
- `makeTestServer`/`createTestServer` sets `CB_ALLOW_UNAUTHENTICATED=1`
  (around `test-server.ts:128-131`) — honest: test servers *are*
  deliberately open. Tests exercising auth itself unset it locally, exactly
  as they toggle `GOOGLE_OAUTH_CLIENT_ID` today
  (e.g. `test/hub/hub-server-auth.doctest.md:25`).

**Vocabulary lock-ins.** `authRequired()`, `CB_ALLOW_UNAUTHENTICATED` (value
`"1"` exactly; anything else is off — fail closed).

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
  `GET /auth/setup` serves the SPA; `POST /auth/setup` requires the token
  and creates the owner account (O_EXCL — first writer wins), then mints a
  session. The route answers `410 Gone` the moment a user exists. The token
  closes the network race (Prior art #3/#4) at zero cost for the legitimate
  installer, who is watching the console they just started the server from.
  Headless twin: `cb auth create-user` (Track F) needs no token — it runs as
  the file owner, which *is* the authority.
  With Google configured and zero users (prod's migration state), nothing
  redirects to setup — the login page simply offers Google plus a "create
  local account" pointer at the setup URL; Google login keeps working
  throughout.
- **Throttle** — `src/webapp/login-throttle.ts`: pure core
  (`Map<key, {failures, nextAllowedAt}>`, key = `ip|email`, delay
  `min(1s · 2^(failures-1), 60s)`, cleared on success, entries expire after
  1h; injected clock per principle #10). Applied to `POST /auth/login` and
  `POST /auth/setup`. Every throttled attempt logs `console.warn` with ip +
  email. In-memory is correct: single process holds the login surface
  (standalone or hub), and restart-resets are acceptable for a backoff.

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
`resolveRequestIdentity`'s cookie path (`auth.ts:290-292`): after
`verifySession`, if the email has a local user record, require
`payload.gen === user.gen` (missing or stale → unauthenticated). Emails with
no local record (Google-only identities) skip the check — and creating a
local credential for an email therefore invalidates that email's older
Google-minted cookies, which is the strict direction. Auth-file reads on the
request path are cached with an mtime guard (the file changes only on
credential operations). Hub mode needs no change: the hub is the only cookie
verifier and the only auth-file reader; children keep trusting headers.

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

**Direction.** Two small pieces, both riding `verifyAgentBearer`
(`token.ts:55`):
1. The box auth preHandler (`server-box-scope.ts:100-114`) accepts
   `Authorization: Bearer <agent-token>` for any in-box request, page or
   API — the token already grants `authed: true` in the tRPC context
   (`server-box-scope.ts:188,196`), so this widens *where* the same trust
   applies, not *what* is trusted. Serves curl-style probes.
2. `GET /auth/agent-login?token=<agent-token>&returnTo=<path>` (per-box
   scope): verifies via `verifyAgentBearer`, mints a short-lived session
   cookie (owner identity, 12h), redirects. This is what a real browser can
   actually use: `bin/browse`'s wrapper rewrites `/`-leading paths and can
   open this URL first, reading the token from the worktree box's
   `.callback-box/agent-token`. The token appears in a URL — acceptable for a
   local dev token that already sits world-readable-to-owner on the same
   machine and already grants API access; the route logs each use
   (`console.warn`, "agent-login used") so it's never invisible.

Identity for both: the owner email (from Track A's file / `CB_OWNER_EMAIL`),
matching the token's existing owner-equivalent API power.

**Vocabulary lock-ins.** Route `/auth/agent-login`.

**First implementation chunk.** Both pieces + doctest
(`test/webapp/agent-login.doctest.md`); the `bin/browse` wiring (read token,
prime the session before first navigation) is a follow-on commit in `bin/`.

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
| Auth file corrupt / fails Zod parse | Track A doctest | `AuthFileCorruptError`; all password logins refuse; server keeps serving | Clear — `console.error` with path; login page shows "local login unavailable" |
| Auth file missing on a box that had users (deleted/moved) | Track A doctest | Zero-users state → setup flow re-arms, but existing cookies carry `gen` and the resolver finds no record → Google-only emails still work, password sessions die | Clear — boot prints setup line again |
| scrypt throws (maxmem, bad params from hand-edited file) | Track A doctest (bad-params case) | Verify path catches typed error → login fails closed, `console.error` | Clear |
| Two first-run setups race (two browsers, or setup page vs `cb auth create-user`) | Track A doctest (O_EXCL) | `wx` create: second writer gets `UserExistsError` → setup POST answers 409 | Clear |
| Setup token leaks via console scrollback | — | Token is single-use and dies once a user exists; route 410s after | Clear-enough; accepted (matches Jupyter posture) |
| Brute-force against `POST /auth/login` | Throttle doctest | Exponential backoff per (ip,email); uniform 401 body | Clear — each throttled attempt `console.warn`s |
| Throttle map growth (spray of ips/emails) | Throttle doctest (expiry) | 1h entry expiry; map bounded by attack window | Clear enough; memory-only |
| `CB_ALLOW_UNAUTHENTICATED` set in prod by mistake | — | Cannot be silent: boot warning every start + non-dismissible UI banner | Clear by construction |
| Test-helper env leaks `CB_ALLOW_UNAUTHENTICATED=1` into an auth-testing doctest | Existing auth doctests re-run under Track B | Auth doctests explicitly unset it (same discipline as `GOOGLE_OAUTH_CLIENT_ID` today, e.g. `hub-server-auth.doctest.md:25`) | Clear — those tests fail if the gate is open |
| Stale `gen` cache (mtime guard misses a same-ms write) | session-gen doctest | Worst case: a revoked cookie lives until next mtime tick (<1s); credential ops are rare and human-paced | Accepted risk, documented in module comment |
| `/auth/agent-login` token in a shared/pasted URL | agent-login doctest (bad token → 401) | Token is per-box, local-file-gated, already API-omnipotent; every use logged | Clear — logged on use |
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
- **Should `POST /auth/setup` also require the token when the request comes
  from localhost?** Lean: yes, no localhost carve-out — carve-outs are how
  fail-open comes back (principle: strict bias). The token is already in the
  console the localhost user is watching.
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
5. **Track E** — agent-token page access + `/auth/agent-login` + `bin/browse`
   wiring. (Needs B; independent of C/D.)
6. **Track F** — `cb auth` CLI. (Needs A.)
7. **Track G** — frontend login/setup/banner + `/auth/methods`. (Needs C.)
8. **Track H** — docs/deploy/migration notes + issue closure. (Last.)

Each track is one or a few commits; the plan ships as one unit when all
land. No main merge without the boxholder's explicit signal.

## Rollout shape

- **Test posture (tests as design tool, `docs/testing.md`).** Named up
  front: `local-users.doctest.md` (pure tier), `login-throttle.doctest.md`
  (pure, injected clock), `password-login.doctest.md`,
  `session-gen.doctest.md`, `agent-login.doctest.md` (route tier via
  `makeTestServer` with the opt-out unset), `auth-command.doctest.md` (CLI,
  tmp `CB_AUTH_FILE`); plus updates to the five existing auth/hub doctests
  that today toggle `GOOGLE_OAUTH_CLIENT_ID`. Done-when: all of the above
  green, `pnpm test` green, and a manual pass — fresh dev serve forces
  setup → login works → `bin/browse` tours an authed box → `cb serve` with
  `CB_ALLOW_UNAUTHENTICATED=1` warns and banners.
- **Knowledge audits.** None (rationale above).
- **Migration.** No data migrates. Prod upgrades in place (Track H);
  `needs: [manual-testing]` goes on the issue for the prod hardening step
  (create the local owner account on prod, verify Google + password
  coexist) since only the boxholder can exercise real-Google login.
