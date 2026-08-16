---
title: "Username/password login + forced account creation (even in dev) so a box is never accidentally open"
workstream: unknown
design: ../../../callback-box/docs/implemented-plans/local-password-auth.md
resolution: implemented
filed-by: agent
discovered-in: main session — boxholder asked for a local-first, default-secure auth path
area: callback-box
---

## Implemented (2026-07-19)

Built end-to-end on `worktree-local-password-auth` per the design plan (Tracks
A–H): scrypt credential store, always-on gate with the `CB_ALLOW_UNAUTHENTICATED`
opt-out, password login + first-run setup + throttle, `gen` session revocation +
fail-closed auth-store + WS cookie fallback, browse agent-token injection,
`cb auth` CLI, frontend login/setup pages + open-mode banner, docs. Cross-model
(Codex) reviewed at plan and implementation stages; the implementation review
found (and fixed) hub-side gen-revocation and hub login body-parse breaks. Full
doctest suite green. Plan + review:
`../../callback-box/docs/implemented-plans/local-password-auth.md` (+ `.review.md`).

The human-only verification (real login/setup/WS/browse flows + prod hardening)
lives in its own tracker:
[manually-verify-local-password-auth](../docs-and-chores/2026-07-19-manually-verify-local-password-auth.md).

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
