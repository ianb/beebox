---
title: "Nango as the Google auth broker: built, evaluated, rejected"
area: beebox
workstream: google-connect-options
filed-by: agent
discovered-in: worktree-nango-google-auth — built Level A, then re-checked the premises
resolution: wontfix
---

**Closed wontfix (boxholder, 2026-07-28).** Nango "Level A" (Nango as the Google
token source) was fully built and tested on the abandoned branch
`worktree-nango-google-auth`, then rejected on review of what it actually bought.
No code merged; nothing was deployed. This item is the record so the same
evaluation isn't redone from scratch.

Supersedes the earlier direction — recorded in
[byo-google-oauth-self-host-story](../../decisions/2026-07-28-byo-google-oauth-self-host-story.md)
and [google-auth-policy-proxy](../../features/2026-07-28-google-auth-policy-proxy.md)
— that self-hosted Nango was the chosen broker. **No broker is adopted.**

## Why it was rejected: the benefit list collapsed under checking

Every motivation for the broker turned out to be already-solved, unaffected, or
not applicable:

| Claimed benefit | Reality |
|---|---|
| Fixes the 7-day refresh-token expiry | **Never applied.** That's a *Testing*-status policy; this OAuth app is already External · In production · Unverified. Diagnosed in [google-oauth-pairing-broken](../../bugs/2026-07-28-google-oauth-pairing-broken.md) *before* the Nango work began — the premise was stale and checkable in this tracker the whole time. |
| Removes the "unverified app" consent screen | **Unchanged.** Nango has no shared Google app; you register your own OAuth client and users see the same click-through. |
| Stops Google revoking an unverified app's tokens | **Unchanged**, same reason. |
| Ends per-box re-auth (one grant, many boxes) | **Already true** via the shared `BBX_GOOGLE_TOKENS_FILE`. One grant already serves every box. |
| Avoids the Google Cloud Console setup | **Unchanged** — you paste the client id/secret into Nango instead of the box. |
| Keeps tokens on our own infra | **Made worse.** The boxholder's target was Nango *Cloud*, so a third party would hold the Google refresh token — the exact posture Composio was rejected for. |

What genuinely remained: the Google client secret and refresh token wouldn't sit
on the box's disk (they'd sit on Nango's), plus multi-provider runway if
Microsoft/Notion/GitHub integrations ever arrive. That is a thin return for a new
external dependency, a second always-live code path, and third-party token
custody.

Setup cost also went the wrong way. Nango mode is a strict **superset** of direct
mode's setup: everything direct mode needs, plus running or subscribing to Nango,
creating an integration, re-entering the scope list, and connecting the account.
The first implementation required five env vars where direct mode needs two; that
was trimmed to one required var (`NANGO_SECRET_KEY`, with Cloud/`google`/discovered-connection
defaults) before the whole thing was dropped.

## What would change the answer

- **A second or third non-Google provider.** The multi-provider runway is the one
  benefit that grows rather than staying flat, and it's the only line above that a
  second integration would move.
- **Wanting credentials off the box's disk as a hard requirement** — e.g. running
  boxes on infrastructure that isn't trusted with a Google client secret. Note
  this needs *self-hosted* Nango to be coherent; Cloud just relocates custody.
- **Nango growing a shared, pre-verified Google app** (they explicitly don't have
  one today), which would be the thing that actually removes the consent-screen
  and verification friction.

Absent one of those, revisiting this is redoing rejected work.

## Where the real remaining friction is

The original pain was the unverified-app click-through and occasional token
revocation. Per
[google-oauth-pairing-broken](../../bugs/2026-07-28-google-oauth-pairing-broken.md),
the tractable levers are both broker-free, and one is already done:

1. **A clear "reconnect Google" prompt** when the refresh token dies — **landed**
   (`7fbeb287`, plan in `beebox/docs/implemented-plans/google-auth-reauth-health.md`).
2. **Least-privilege scopes** — `drive.file` instead of full `drive`, etc. Shrinks
   the restricted-scope footprint, softens the warning, and reduces Google's
   revocation appetite. Still open; collides with
   [boxes-cant-create-new-google-drive-docs](../../features/2026-07-27-boxes-cant-create-new-google-drive-docs.md).

Verification (CASA, $500–$4,500/yr, annual) remains not worth it for a
personal-scale tool, and a Workspace Internal app remains blocked by having no
Workspace org.

## Reusable findings (independent of Nango)

Worth keeping even though the code went away:

- **The `GoogleAuthService` seam works, but construction was duplicated 7×.**
  `getGoogleAuth()` + `createGoogleAuthService()` appeared at seven call sites
  (three connectors, two tRPC routers, two CLI commands), so *any* alternate token
  source is a seven-site change rather than a one-line switch. Collapsing them
  into one `resolveGoogleAuthService(boxRoot)` is a worthwhile refactor on its own
  merits; the branch that held it is gone, so it would be redone from `main`.
- **The hub's env allowlist silently downgrades unlisted config.** `bbx serve`
  children only inherit `CHILD_ENV_ALLOWLIST` (`beebox/src/hub/supervisor/child-env.ts`), so a new
  box-read env var that isn't listed is simply absent in production while working
  fine in local dev (the dev router doesn't filter). Combined with *inferring* a
  mode from an env var's presence, that produced a silent fallback to the old
  behavior instead of an error — the worst failure shape, and invisible outside a
  deployed hub. Lesson for any future feature gated on a new env var: add it to
  the allowlist in the same change, and prefer failing loudly over inferring
  absence as "off".
- **Nango API notes**, in case a future evaluation starts here: token read is
  `GET /connection/{id}?provider_config_key=…` (auto-refreshes; HTTP 424 means the
  refresh token is spent), listing is `GET /connections` (plural, no server-side
  integration filter, no credentials in the payload), connect is `POST
  /connect/sessions` returning a hosted `connect_link` — so no frontend SDK embed
  is needed, but the resulting connection id only arrives via an auth webhook to a
  public URL or the Connect UI callback. Cloud's free tier: 10 connections, 100k
  proxy requests/month, 2 environments. All of this was taken from documentation
  and **never confirmed against a live instance** — treat as a starting point, not
  fact.

## Process note

The value question ("does this fix anything we actually have?") was answered
*after* the implementation rather than in the plan, and the answer was available
in this tracker from the start. A stale premise inherited from a briefing was
carried into a design, an implementation, and documentation before being checked.

> **Recovery note (2026-10-24, google-connect-options):** this record was
> committed on the branch `nango-wontfix-record` on 2026-07-28 and never
> merged, so the tracker had no trace of the evaluation; the September Composio
> issue and the October alternatives note were written without it. Restored
> here with the product's current names (`beebox`, `bbx`, `BBX_`). The
> abandoned code branch `worktree-nango-google-auth` is gone; the seven
> `getGoogleAuth()` + `createGoogleAuthService()` call sites still exist on
> `main`.
