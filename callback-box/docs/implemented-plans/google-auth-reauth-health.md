# Dead Google auth as a first-class health + notify condition

**Status:** implemented 2026-07 — code, health checks, alerting, and docs are
in place; the tracking issue stays open with `needs: [manual-testing]` because
no run has yet exercised a real revoked Google grant end to end.

Google OAuth grants die silently. A BYO operator whose consent screen sits in
**Testing** mode gets refresh tokens that expire every 7 days; even an
unverified **Production** app can have its grant revoked. Today the only signal
is a generic connector sync failure in the logs — no health condition, no
proactive message, no call to action.

This plan makes "the Google grant is dead" a durable, typed state with one
detection point, one storage location, a health check on every surface, and one
notification per breakage carrying a re-authorize link.

Tracking issue:
[google-auth-expiry-health-and-notify](../../../issues/features/2026-07-28-google-auth-expiry-health-and-notify.md).
Context: [byo-google-oauth-self-host-story](../../../issues/decisions/2026-07-28-byo-google-oauth-self-host-story.md).

## What the existing code already gives us

- **One chokepoint.** `createGoogleAuthService(client).getAccessToken()`
  (`src/services/google-auth.ts`) is where every Google API call in the tree gets
  its bearer token — gmail, drive/sheets/docs and calendar each build a `ky`
  instance whose `beforeRequest` hook calls it. All construction sites do
  `getGoogleAuth(boxRoot)` → `createGoogleAuthService(...)`.
  google-auth-library refreshes lazily inside `getAccessToken()`, so a dead
  refresh token throws exactly there.
- **One credential.** `CB_GOOGLE_TOKENS_FILE` holds a single refresh token shared
  by all three Google connectors across **every box on the server** (the per-box
  `config/connectors/google.secret.json` is a legacy fallback). "Google auth is
  dead" is therefore a property of that credential, not of a box or a connector.
- **One repair path.** A new refresh token only ever reaches disk through
  `saveGoogleTokens()`.
- **An alert pattern to copy.** `checkHealthAndAlert`
  (`src/core/schedule/health-alert.ts`) already runs per box per scheduler tick,
  checks `notifyChannels`, notifies via `notifyBoxholder`, and latches one alert
  per unhealthy episode.

## Decisions

**Detection: refresh `invalid_grant` only.** Access tokens live an hour, so if
the refresh token is dead every code path funnels through a failed refresh
within the hour — the refresh is a sufficient chokepoint on its own. A 401 from
a Google API while holding a *freshly minted* access token means something else
(revoked scope, wrong account, API not enabled); rendering that as "click here
to re-authorize" would send the boxholder down a path that cannot fix it. API
401s stay out of this verdict.

google-auth-library v10 throws a `GaxiosError` whose `response.data.error` is
`"invalid_grant"` (and whose `message` is either `"invalid_grant"` or, in the
ReAuth case, the JSON of `response.data`). The classifier checks the structured
field first and falls back to a message match. Anything unrecognized stays a
transient error and does **not** flip the state.

**State lives in the token record.** `GoogleTokens` gains `needsReauthSince`,
`reauthReason`, and `authCheckedAt`. Rationale: the state describes the
credential, so it belongs with the credential — it inherits the existing
central/legacy path resolution, it survives restarts, `googleDisconnect`'s
unlink correctly takes it with it, and it is cleared atomically by the same
write that repairs it. Per-connector transient state would have three connectors
× N boxes independently rediscovering the same fact with no shared clear.

**Clearing is structural, not remembered.** `saveGoogleTokens()` drops the
`needsReauth*` fields and stamps `authCheckedAt` whenever the update carries a
fresh `accessToken` or `refreshToken`. Both the OAuth callback and the
auto-refresh `tokens` listener go through it, so no future call path can forget
to clear.

**Writes take a cross-process lock.** `saveGoogleTokens` currently holds only
`withCardLock` (in-process). Under `cb hub` each box is its own process, so a
clear racing a flag could resurrect a stale `needsReauthSince`. The RMW gains
the `file-lock.ts` cross-process lock on a sibling `<tokens>.lock` path, layered
inside the existing card lock exactly as `transient-state.ts` documents.

**Probe daily, from the scheduler; health surfaces are pure readers.** Forcing a
refresh is a network round-trip, so it must not run on every health query.
`probeGoogleAuthIfStale()` runs in the scheduler's per-box tick and no-ops
unless `authCheckedAt` is older than 24h — and because the stamp lives in the
shared token record, the first box to tick each day probes and the rest see a
fresh stamp. Real Google usage refreshes the stamp passively for free. Health
checks and `cb health` only read the stored verdict, so they stay fast and can
report honestly how stale the answer is.

**One notification per breakage, no re-nag.** Keyed on the `needsReauthSince`
timestamp, latched per box in transient state, cleared when the flag clears (so
a relapse alerts again). This matches the existing scheduled-task alert
contract, and the condition also carries a permanent dashboard warning and a
`cb health` line — a re-nag would add pressure without adding information.

**Link to `/<slug>/admin?reconnect=google`, not one-click reconnect.**
`googleSetup` is an `ownerProcedure` that mints a one-time nonce; a static link
in a push or Telegram message cannot carry a valid one, and pre-minting a nonce
into an outbound message is precisely the token-fixation surface
`google-oauth-state.ts` exists to close. The link lands on the admin page with
the Google Services section highlighted; the boxholder clicks **Re-authorize**
there.

**Out of scope: login-with-Google.** A different credential with a different
failure mode — it fails in front of a human who is actively trying to log in.

## Work

1. **`src/connectors/google-auth.ts`** — add the three status fields to
   `GoogleTokens`; clear them in `saveGoogleTokens` on a token-bearing update;
   add the cross-process lock to that RMW.
2. **`src/connectors/google-auth-status.ts`** (new) — `isInvalidGrantError()`,
   `markGoogleAuthDead()`, `readGoogleAuthStatus()`, `probeGoogleAuth()`. Kept
   out of `google-auth.ts` to avoid an import cycle with the clear path (which
   stays inline) and to respect the file line cap.
3. **`src/services/google-auth.ts`** — `createGoogleAuthService(client, opts)`
   catches a refresh failure, classifies it, marks the credential dead on
   `invalid_grant`, and rethrows a typed `GoogleAuthExpiredError`.
4. **`src/webapp/trpc/routers/health-google.ts`** (new) — the `google-auth`
   health check, spread into `runHealthChecks` (`health.ts` is already at its
   line cap). Three states: skip when Google is unconfigured or unconnected;
   `warning` when dead, with the reconnect link and the duration; ok otherwise,
   noting when the answer was last verified.
5. **`src/core/schedule/google-auth-alert.ts`** (new) — probe-if-stale, then
   notify once per episode with the latch; called from the scheduler loop
   beside `checkHealthAndAlert`.
6. **`src/cli/commands/health.ts`** — a box-health section printing
   `runHealthChecks()` alongside the scheduled-task table, in both text and
   `--json`. Error-severity failures join the exit-code-1 condition; warnings
   (including this one) do not.
7. **Docs** — `docs/google-setup.md` troubleshooting, `docs/health-checks.md`.
8. **Tests** — doctests for the classifier, the flag lifecycle
   (mark → health check → clear on new grant), the health check's states, and
   the alert latch.

## Copy

> **Google connection needs re-authorization**
> Your Google connection stopped working — the authorization expired or was
> revoked. Gmail, Calendar and Drive sync are paused until you reconnect.
> Reconnect: `<url>`
