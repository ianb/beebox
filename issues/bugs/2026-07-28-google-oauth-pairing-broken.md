---
title: "Google OAuth pairing / login appears broken"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder hit it
needs: [manual-testing]
---

Boxholder reports *"pairing with Google seems to be broken, and oauth pairs are
broken."* Not yet reproduced to a single root cause — this issue records the
diagnosis so far and the one artifact needed to pin it.

## Two distinct Google OAuth flows (which one is broken matters)

1. **Login with Google** — `GET /auth/google` → `GET /auth/callback`
   (`src/webapp/routes/auth-google.ts`). Authenticates the box owner, mints the
   session cookie.
2. **Connector pairing** — `GET /auth/google-services/callback`
   (`src/webapp/routes/admin.ts` + `trpc/routers/admin-google.ts`). Links a
   Google account (Gmail/Calendar/Drive) to the box.

"Pairing" most likely means (2); "oauth" could be either. The exact flow + error
the boxholder saw is the missing piece.

## What was checked on prod (points away from the obvious causes)

- **`CB_PUBLIC_URL` is clean** (`https://<host>`, no trailing slash, no box-slug
  segment) → the login redirect_uri resolves to `https://<host>/auth/callback`
  correctly. So this is **not** the earlier double-slash redirect_uri bug
  ([closed: google-oauth-callback-unauthenticated](../closed/bugs/2026-07-19-google-oauth-callback-unauthenticated.md)).
- **No `[auth]` / `redirect_uri` / token-exchange errors in the `callback-hub`
  journal in the last 24h.** The app isn't logging a failure — so the break may
  happen *before* the request reaches the app, or logs to the box-local
  `client-debug.log` instead.

## Suspects (ranked, given "no server-side error" + heavy recent auth churn)

1. **Cloudflare Access intercepting the callback.** Google's redirect back to
   `/auth/callback` or `/auth/google-services/callback` may hit the Access wall
   instead of the app — no app log, exactly the observed signature. Ties to
   [cloudflare-access-walling-prod-box](2026-07-21-cloudflare-access-walling-prod-box.md).
2. **Google Cloud console redirect-URI registration mismatch.** If the app now
   sends a redirect_uri the console's Authorized Redirect URIs list doesn't
   contain, Google rejects at its own screen (again, no app log).
3. **The new authenticated-owner nonce requirement on the callback** (recent
   hardening: `9d4568a0` "require authenticated-owner state nonce on Google OAuth
   callback", `1528c761` "owner-bind the nonce"). If the browser hitting the
   callback lacks the owner session/nonce (SameSite=lax on a cross-site redirect
   from Google, or Access stripping cookies), it fails closed.
4. **Today's router / mobile-auth changes** (`fadc6958`…`65273519`) regressing
   auth routing — lower likelihood (they targeted mobile/dev-router), but they
   touched `bin/router-auth.ts`.

## Latent bug found regardless (worth fixing either way)

`auth-google.ts:41` builds the login redirect_uri as `` `${publicUrl}/auth/callback` ``
with **raw `publicUrl`** — it does NOT go through `baseServerUrl()`
(`src/webapp/base-server-url.ts`) the way the connector path
(`admin-google.ts`) does. `baseServerUrl()` strips a trailing box-slug segment
*and* a trailing slash. So the login flow is fragile: a `CB_PUBLIC_URL` with a
trailing slash or a box-slug segment produces a malformed redirect_uri
(`host//auth/callback` or `host/<slug>/auth/callback`) and breaks login. It's
fine on *this* prod (clean `CB_PUBLIC_URL`) but is a footgun for other
deployments and should be normalized to match the connector path.

## What's needed to pin it (the manual-testing artifact)

- **Which flow** — logging into the box with Google, or connecting a Google
  account to a box?
- **The exact error** — the screen/text (Google's `redirect_uri_mismatch`? a
  Cloudflare Access page? a callback-box 400/401/500? a blank redirect?).
- The box's `.callback-box/client-debug.log` around the attempt.

With the error signature this collapses to one of the suspects above quickly.
