---
title: "Google OAuth: unverified-app screen + Testing-mode token expiry (not a code bug)"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder hit it
needs: [decision]
---

**Update 3 — RESOLVED as not-a-code-bug (2026-07-28).** Boxholder traced the full
flow. The authorize URL carried the **canonical, registered** redirect_uri
(`.../auth/google-services/callback`), so redirect_uri_mismatch is out. The
actual block was Google's **"Google hasn't verified this app"** interstitial
(restricted scopes: gmail.readonly, gmail.compose, drive, spreadsheets, calendar,
documents.readonly). Clicking **Advanced → continue (unsafe) → consent** connected
successfully. So the connect flow *works*; the friction (and likely the recurring
"it broke again") is Google OAuth **publishing/verification state**, not
callback-box code. Details + fix below; the remaining work is a decision (verify
the app vs. stay unverified) plus optional code follow-ups.

Boxholder reports *"pairing with Google seems to be broken, and oauth pairs are
broken."* Not yet reproduced to a single root cause — this issue records the
diagnosis so far and the one artifact needed to pin it.

## Actual OAuth app state (from the console) + the real options

The app is **External · In production · Unverified**, 7/100 OAuth user cap,
"Make internal" greyed out (personal `@gmail.com`, no Workspace org). So:

- It is **already in production** — the Testing-mode **7-day refresh-token
  expiry does not apply** (an earlier theory here; corrected). The "unverified
  app" screen appears purely because it's unverified while requesting restricted
  scopes; it's click-through and (being production) tokens persist. Any recurring
  breakage is NOT testing-mode expiry — most likely occasional Google revocation
  of an unverified app's tokens, or a one-off re-consent.
- **Verification is possible but heavy.** Restricted scopes (gmail read/compose,
  full drive) require the **CASA annual security assessment** ($500–$4,500/yr, no
  free self-scan tier anymore) plus privacy policy, domain verification, a demo
  video, and per-scope justification — redone every 12 months. Overkill for a
  personal/family tool.
- **The clean "no warning, no verification, no cap" path is a Workspace Internal
  app** — but `Make internal` is disabled because there's no Workspace/Cloud
  Identity org. It would require standing up Google Workspace for the domain and
  using `@<domain>` accounts (not `@gmail.com`).
- **Least-privilege scopes** (`drive.file` instead of full `drive`, etc.) reduce
  the restricted footprint and Google's revocation appetite even without
  verifying — the tractable code-side lever.

**Recommendation:** don't pursue verification. Stay External/Production/Unverified
(works via the one-time click-through, well under the 100-user cap); optionally
trim scopes. Revisit a Workspace Internal app only if the warning/robustness
becomes a real ongoing problem.

### Optional code-side follow-ups (reduce the pain, not required)

- **Least-privilege scopes.** The connector requests several *restricted* scopes
  (`drive` full, `gmail.readonly`, `gmail.compose`). Narrowing where possible
  (e.g. `drive.file` instead of full `drive`) shrinks the restricted-scope
  footprint, softens the warnings, and eases any future verification. Trade-off:
  `drive.file` only sees app-created/opened files — interacts with the
  "boxes can't create new Google Drive docs" item.
- **Surface token expiry clearly.** If/while in Testing mode, the 7-day expiry
  makes the connection look "broken." The connector could detect an expired/
  revoked refresh token and show a clear "reconnect Google" prompt rather than
  failing quietly.

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

## Update (2026-07-28): reproduced on a prod box — failed on Google's end

Boxholder retried on one of the prod boxes; it **failed on Google's own page** (not
callback-box, not a Cloudflare Access page). The `callback-hub` journal logged
nothing for the attempt — consistent with Google rejecting at the *authorize*
step, before any redirect back to `/auth/…/callback`. That rules out Cloudflare
Access (it shows its own page) and app-side token exchange. It's a **Google-side
rejection**, overwhelmingly likely **`redirect_uri_mismatch`**.

The redirect_uri that box sends (connector flow, `admin-google.ts:48-51`):

```
https://<host>/auth/google-services/callback
```

built as `` `${baseServerUrl(publicUrl)}/auth/google-services/callback` ``, where
`publicUrl` = **`input.origin` (the live browser origin) first**, then box.json
(`https://<host>/<box>`), then env. `baseServerUrl()` strips the box-slug
segment → server root. Login flow sends `https://<host>/auth/callback`.

**Design smell (root of the fragility):** deriving the redirect_uri from the
*browser origin* means **any origin the box is reached through — the canonical
host, the dev router, a Tailscale URL, an alternate subdomain — produces a
different redirect_uri**, and Google rejects every one that isn't registered.
The redirect_uri should be derived from a single canonical configured URL, not
whatever origin the request happened to arrive on.

**Fix is almost certainly console-side:** confirm both exact URIs
(`https://<host>/auth/google-services/callback` and `https://<host>/auth/callback`)
are in the OAuth client's *Authorized redirect URIs* in the Google Cloud console.
Google's `redirect_uri_mismatch` page names the exact rejected URI — that string
confirms it in one step. Secondary Google-end causes if it's *not* a mismatch:
OAuth consent screen in "Testing" without the user as a test user, an unverified
app, or a deleted/rotated OAuth client.

## Update 2 (2026-07-28): redirect_uri_mismatch RULED OUT — look at consent/verification

Checked the Google Cloud console (boxholder screenshot) + traced the real code
path. `redirect_uri_mismatch` is **not** it:

- Both canonical URIs **are registered**: `https://<host>/auth/callback` (login)
  and `https://<host>/auth/google-services/callback` (connector).
- `CB_PUBLIC_URL=https://<host>` (canonical, no slug) is present in **both** the
  hub and every per-box `cb serve` child — so the login redirect_uri is
  canonical for every box (the one registered `/<slug>/auth/callback` URI in the
  console is legacy cruft, not something the current code emits).
- The frontend calls `googleSetup.mutate({})` with **no `origin`**
  (`useGoogleServices.ts:87`), so `input.origin` is always `undefined`. The
  connector redirect_uri therefore comes from box.json publicUrl →
  `baseServerUrl()` strips the slug → **canonical** `.../auth/google-services/callback`
  for every box, regardless of access origin.

So the redirect_uri we send is the registered one. The "failed on Google's end"
is almost certainly **not** the redirect URI. Most likely, given the connector
requests **restricted scopes** (Gmail/Calendar/Drive):

1. **OAuth consent screen / app-verification wall** — an unverified app
   requesting restricted scopes, or a consent screen in **Testing** mode where
   the account isn't an added **test user** → Google blocks with "Access
   blocked: … hasn't completed verification" / "app is being tested."
2. **`invalid_client`** — the OAuth client ID/secret rotated or the client was
   deleted/disabled in the console.
3. **Project / OAuth client mismatch** — the creds in prod env belong to a
   different project than the one whose consent screen is configured.

**Need the exact text of Google's error page** (the error code / blue box / "error
details") to pick between these — the fix differs per case. It is NOT a
callback-box code bug in the redirect_uri path.

## Latent smell (still worth fixing, but NOT the cause here)

The connector redirect_uri *can* be derived from `input.origin` (a browser-
supplied value) if a caller passes one; today no caller does, so it's dormant.
Deriving an OAuth redirect_uri from a client-supplied origin is a smell worth
removing (always use the canonical configured server URL), but it is not
responsible for this failure.

## Suspects (ranked, given "no server-side error" + heavy recent auth churn)

1. **Cloudflare Access intercepting the callback.** Google's redirect back to
   `/auth/callback` or `/auth/google-services/callback` may hit the Access wall
   instead of the app — no app log, exactly the observed signature. Ties to
   [cloudflare-access-walling-prod-box](../closed/bugs/2026-07-21-cloudflare-access-walling-prod-box.md).
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
