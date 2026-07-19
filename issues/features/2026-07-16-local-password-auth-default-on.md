---
title: "Username/password login + forced account creation (even in dev) so a box is never accidentally open"
needs: [manual-testing]
design: ../../callback-box/docs/plans/local-password-auth.md
filed-by: agent
discovered-in: main session — boxholder asked for a local-first, default-secure auth path
area: callback-box
---

## Implemented (2026-07-19) — needs manual testing

Built end-to-end on `worktree-local-password-auth` per the design plan (Tracks
A–H). Full doctest suite green (4365/4365). Automated tests can't exercise the
real login/setup flow, a live WebSocket auth upgrade, or a browser tour against
an authenticated box, so this carries `needs: [manual-testing]` until the
boxholder confirms — **do not close on green tests alone.** What to try, and what
should happen:

1. **Fresh dev box forces setup.** Start a dev serve with no `~/.cb-auth.json`
   and no `CB_ALLOW_UNAUTHENTICATED`; open it. → Redirected to a login wall; the
   server console prints a `First-run setup: …/auth/setup?token=…` line; visiting
   it shows the account-creation page with the "why" copy. Create the owner →
   redirected in, logged in.
2. **Password login.** Log out, log in with the created credentials. → Success
   redirects to `returnTo`. Wrong password → inline "Invalid credentials".
   Hammer it → 429 with a retry countdown.
3. **Setup self-disables.** After an account exists, revisit `/auth/setup?token=…`
   → 410 Gone. Restart the server, wait 15+ min, use the old token → 410 (expired).
4. **`gen` revocation.** Log in on two browsers; run `cb auth set-password` →
   both sessions are logged out on next request.
5. **Open-mode opt-out.** Start with `CB_ALLOW_UNAUTHENTICATED=1` → loud boot
   warning + persistent non-dismissible banner on every page, no login required.
   Try `=1` with a non-loopback bind → startup refuses; `=network` → serves open
   with the warning.
6. **Browse/tour tooling.** With auth on, `bin/browse open /<box>/…` against the
   running authed dev box → reaches the page (agent-token header injected), not
   the login wall. A non-worktree host must NOT receive the token.
7. **WebSocket auth.** Open a box page that uses live chat/subscriptions while
   logged in via cookie on a standalone (non-hub) serve → the WS connects and
   streams (this is the raw-`IncomingMessage` cookie path Track D fixed).
8. **Prod hardening.** After merge/deploy: create the prod owner account
   (`cb auth create-user`), confirm Google login still works alongside it, and
   confirm existing Google sessions weren't invalidated.

Commits: credential store, always-on gate, login/setup/throttle, `gen`
revocation + fail-closed 503 + WS fix, browse token injection, `cb auth` CLI,
frontend pages + banner, docs. Plan + cross-model review:
`../../callback-box/docs/plans/local-password-auth.md` (+ `.review.md`).

---

Auth today is **Google-OAuth-only, and off by default**. `isAuthEnabled()` is
literally `!!process.env.GOOGLE_OAUTH_CLIENT_ID` (`src/webapp/auth.ts:51`); the
login surface is Google OAuth (`src/webapp/routes/auth.ts` — `/auth/login` →
Google consent → `/auth/callback`). When `GOOGLE_OAUTH_CLIENT_ID` is unset (the
local-dev default), `isAuthEnabled()` is false and the server registers a **stub
`/auth/me` that always returns `null`** — i.e. the box is simply unauthenticated,
open to anyone who can reach the port.

Two problems fall out of that single gate:

1. **An unauthenticated box is the *easy* state.** The protection switch is "did
   you configure Google OAuth," not "is this box protected." Forget to set it (or
   just run locally) and you're serving an open box — no speed bump, no warning.
   Someone can trivially stand up an unauthenticated instance.
2. **The only real login depends on a remote service.** To have *any* auth you
   must register a Google OAuth client. So local development can't be both
   authenticated *and* self-contained — it either runs wide open or takes on a
   remote dependency. That cuts against wanting local dev to lean on as few
   remote services as possible.

**Proposal:** add a **username/password (local credential) auth method**, and make
account creation **mandatory on first run — including in dev** (with a screen that
*explains why*, so the friction reads as intentional, not a papercut). Net effect:

- **Default-secure.** There's no "auth happens to be off" state to fall into; a
  fresh box/dev instance is authenticated out of the box. You have to go out of
  your way (an explicit, loud opt-out) to run an open box, not out of your way to
  secure one.
- **Local-first.** The credential is self-contained (hashed on disk, no third
  party), so a dev box is fully authenticated with zero remote services. Google
  OAuth stays available but becomes *a* method, not *the* method.

The session half already works locally — `cb_session` is an HMAC-signed cookie with
no server-side store, and `CB_SESSION_SECRET` auto-generates to a `0600` file if
unset (`auth.ts:44`). What's missing is the **identity/login** half that doesn't
route through Google.

### Design questions (why this needs a design pass)

- **Credential storage.** Where does the local credential live (per-box
  `config/` vs `.callback-box/`) and how is it hashed (argon2id / scrypt /
  bcrypt — pick one, salted, tuned)? Never plaintext; treat the file like the
  session secret (`0600`).
- **Relationship to OAuth.** Is local password an *additional* method alongside
  Google (prod keeps OAuth, dev uses password), or does password become the
  universal baseline with OAuth layered on? Decide how `isAuthEnabled()` changes —
  it should stop meaning "is Google configured."
- **"Forced even in dev" mechanics.** Does auth become *always-on*, dropping the
  `!isAuthEnabled() ⇒ open` branch entirely, with first-run bootstrapping a local
  account? Keep the existing gated bypasses intact and documented: the
  `CB_DIAG_API_KEY` bearer (`auth.ts:62`) and hub-mode header trust behind
  `CB_HUB_SECRET` (`auth.ts:114`) are secret-gated, not open doors.
- **The explicit escape hatch.** "Default secure" must not wedge legitimate
  headless/CI/throwaway use. Provide a single loud opt-out (e.g.
  `CB_ALLOW_UNAUTHENTICATED=1`) that logs a prominent warning on every boot —
  fail-closed by default, opt-out by intent, never silent.
- **Single boxholder vs multiple accounts.** Likely one boxholder credential per
  box (matches the single-user model); confirm before building a user table.
- **The explanation UX.** The forced-account-creation screen should state the two
  reasons in-flow (this box would otherwise be open to anyone on the network;
  local auth keeps dev free of remote dependencies), so a developer hitting it
  understands the intent rather than reaching for a bypass.
- **Hub/prod boundary.** In hub mode the supervisor injects
  `x-cb-authenticated-email` (secret-gated); local password login is for direct
  `cb serve` / dev, not the hub path. Keep the two clearly separated.

Aligns with the fail-closed/strict-by-default posture and the local-first dev goal.
Touches the same surface as `docs/todo-security.md` (accepted security gaps) and
the OAuth/session model in `src/webapp/auth.ts` + `src/webapp/routes/auth.ts`.
