---
title: "Detect dead Google auth in health + notify the user with a clear re-authorize CTA"
area: callback-box
filed-by: agent
needs: [design]
discovered-in: main session — boxholder, after the Google OAuth thread
---

Google auth can stop working silently: BYO operators whose consent screen is in
**Testing** mode get **refresh tokens that expire every 7 days**, and even
unverified **Production** apps can have tokens revoked. Today that surfaces as a
generic connector sync failure buried in logs — the box doesn't proactively tell
the boxholder, and there's no clear "here's exactly what to do." Make it a
first-class **health + notification** condition with a direct re-authorize CTA.

Context: this is the operational tail of the BYO model
([byo-google-oauth-self-host-story](../decisions/2026-07-28-byo-google-oauth-self-host-story.md),
[google-oauth-pairing-broken](../bugs/2026-07-28-google-oauth-pairing-broken.md)).
The 7-day expiry is a real BYO condition across the ecosystem, not our defect —
but *handling it gracefully* is where we can be better than the field.

## The pieces already exist (this is wiring, not greenfield)

- **Token refresh:** `src/connectors/google-auth.ts` refreshes the access token
  from the stored refresh token — the natural place to catch a dead credential
  (Google returns `invalid_grant` when the refresh token is expired/revoked).
- **Health:** `src/webapp/trpc/routers/health-engine.ts` + `cb health`
  (`src/cli/commands/health.ts`) — the surface a "Google needs re-auth"
  condition should appear in.
- **Proactive notify:** `src/core/notify-boxholder.ts` `notifyBoxholder()`
  already reaches the boxholder over telegram + web-push (dropping
  `box/output/*.web-push.card`).
- **The fix action already has UI:** the admin Google Services "Re-authorize"
  button + the OAuth initiate route. We just need to detect, surface, and
  deep-link to it.

## Proposed design

1. **Detect + persist.** In `google-auth.ts`, when a token refresh fails with
   `invalid_grant` (vs. a transient network/5xx error), record a durable
   **`needsReauth`** state in the connector state (with a timestamp + which
   Google account), distinct from a one-off sync error. Only auth-dead flips it;
   transient failures don't.
2. **Health condition.** Add a Google-auth check to the health engine so
   `cb health` and the admin health surface report a clear, typed condition —
   e.g. `google-auth: needs re-authorization (since <date>)` — not a generic
   connector-failed line.
3. **Notify once per transition.** On the flip to `needsReauth`, call
   `notifyBoxholder()` with plain copy and a **direct link to the re-authorize
   page** (`/<box>/admin` → Google Services, or straight to the OAuth initiate).
   Re-notify on a throttle (e.g. daily) while still broken; clear the state +
   optionally send a "reconnected" note when a new grant lands.
4. **Clear CTA copy.** "Your Google connection stopped working (the
   authorization expired or was revoked). Reconnect here: <link>. Until then,
   Gmail/Calendar/Drive features are paused." Exact, actionable, no jargon.

## Open design questions

- **Detection reliability** — is `invalid_grant` on refresh the only signal, or
  do connector API calls also need to classify 401/`UNAUTHENTICATED` as
  auth-dead? Where's the single chokepoint so every Google call funnels the
  verdict to one place?
- **State location** — connector state file vs a box-level health/status record;
  it must survive restarts and be readable by both the health engine and the
  reactor/notify path.
- **Throttle + dedupe** — one notification per breakage, not per failed sync;
  pick the re-nag cadence.
- **Scope** — connector auth (Gmail/Cal/Drive) is the main case; does the box
  *login*-with-Google path want the same treatment, or is that out of scope
  (login failure is self-evident to the user in the moment)?
- **Deep link** — can we link straight into the re-authorize action, or only to
  the admin page? A one-click reconnect from the notification is the ideal.
