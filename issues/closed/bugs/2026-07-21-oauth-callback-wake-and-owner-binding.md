---
title: "OAuth callback: wakes/enumerates boxes before auth, and doesn't bind to the initiating owner"
workstream: open-source-readiness
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — Codex review of the overnight security fixes
labels: [soft-launch]
resolution: implemented
---

**RESOLVED (implemented).** Both gaps fixed with the strict option.

**(a)** `src/hub/hub-server.ts` — the Google callback now runs `decideHubAuth`
FIRST, before any `resolveEndpoint`. An unauthenticated request redirects to
login regardless of slug (no `resolveEndpoint`, so no lazy cold-start and no
configured-slug oracle). The access check uses the wake-free `boxRootBySlug`
map, and when hub auth is on an unknown slug and a forbidden box return the SAME
403 (message no longer echoes the slug), so neither existence nor access is
enumerable. `resolveEndpoint` (the legitimate idle-collected cold-start) runs
only after the caller is authorized and access-checked.

**(b)** `src/webapp/routes/admin.ts` — after consuming the nonce, the callback
compares `consumed.createdBy` to `resolveRequestIdentity(request).email` and
rejects a mismatch (403). An owner-bound nonce (any authed mint) can only be
completed by that same identity; a nonce minted in standalone open mode
(`createdBy: null`) falls through, since possession of the 256-bit nonce is the
secret there.

Tests: `test/hub/hub-router.doctest.md` (unauthenticated known vs unknown slug
both 302→login with `ensureCalls === 0`) and
`test/webapp/routes/routes-google-oauth-callback.doctest.md` (owner-bound nonce:
anon→403, stranger→403, initiating owner→302; no tokens written on rejection).

DECISIONS TAKEN (were `needs: [decision]`): (a) resolve-first was a deliberate
lazy-box convenience — replaced with auth-first + wake-free config lookup, which
preserves the idle-collected recovery case; (b) enforce owner binding only when
`createdBy` is set (open mode stays possession-based). RESIDUAL NOT ADDRESSED
(out of scope, low stakes): the nonce single-use in `google-oauth-state.ts` is
in-process synchronous, not cross-process atomic — matters only if
multi-server-per-box is ever supported; left as-is.

---

**MED. Two residual gaps in the landed gate-1 OAuth fix
([google-oauth-callback-unauthenticated](2026-07-19-google-oauth-callback-unauthenticated.md)).**
Found by Codex (2026-07-21), both verified against source. The credential-swap
hole the gate closed (nonce required before token persist) is genuinely
closed; these are the next layer.

**(a) Box-wake + slug enumeration before auth (hub path).** In
`src/hub/hub-server.ts`, the Google callback pulls an attacker-controlled slug
from `state` and calls `resolveEndpoint(boxSlug, ...)` at `:388` — which
cold-starts a lazy box — *before* the auth check at `:397`. So an
unauthenticated `GET /auth/google-services/callback?state=<guessed-slug>:x`
wakes a real box; a nonexistent slug returns `400 unknown_box` without the
wake. That difference is a configured-slug oracle plus an unauthenticated
box-wake (DoS-ish). The generic mobile wall is ordered correctly (invalid
bearer on real vs nonexistent slug both 401 before resolution); this specific
callback resolves first. (`src/hub/hub-server.ts:381-400` even carries a
comment explaining the resolve-first ordering as a deliberate lazy-box
convenience — that's the tension to resolve.)

**(b) Nonce is not owner-bound.** The callback stores `createdBy`
(`src/connectors/google-oauth-state.ts:131,171`) but never checks it: the box
callback at `src/webapp/routes/admin.ts:48` consumes the nonce without
comparing `consumed.createdBy` to the completing session's identity. In hub
mode only `canAccessBox` is checked, not that the session is the initiator. So
a leaked/stolen state can be completed by any session with access to that box
(standalone: by anyone holding the nonce). Minting is behind `ownerProcedure`
and the nonce is a 256-bit secret, so this needs nonce disclosure first —
hence MED not HIGH.

Also noted (same family, lower stakes): single-use is only in-process
synchronous, not cross-process atomic — two servers sharing one box could both
read a state before either rewrite (`google-oauth-state.ts:161-169`). Matters
only if multi-server-per-box is ever supported; relates to the shared
[file-lock empty-window race](2026-07-21-file-lock-empty-window-race.md).

Fix directions: (a) check auth before `resolveEndpoint` on the callback, or
resolve without waking (config lookup vs cold-start) until authorized; (b)
compare the completing session identity to `createdBy` and reject a mismatch.
Both are small but touch the hub auth ordering and the OAuth session model —
worth the boxholder's eyes rather than an unattended edit.
