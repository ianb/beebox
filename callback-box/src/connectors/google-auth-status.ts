/**
 * Is the stored Google grant alive? — classification, the read side of the
 * `needsReauth` state, and the periodic probe that keeps the answer fresh.
 *
 * A BYO operator whose OAuth consent screen sits in Testing mode gets refresh
 * tokens that expire every 7 days, and even an unverified Production app can
 * have its grant revoked. Google says so with `invalid_grant` on refresh, which
 * is the ONLY signal we treat as auth-dead: access tokens live an hour, so a
 * dead refresh token surfaces here within the hour no matter which connector
 * runs first. An API 401 while holding a freshly-minted access token means
 * something else (revoked scope, wrong account, API not enabled) and must not
 * produce a "click here to re-authorize" call to action that can't fix it.
 *
 * See docs/plans/google-auth-reauth-health.md.
 */

import type { OAuth2Client } from "google-auth-library";
import { isRecord } from "../lib/is-record.js";
import { errorMessage } from "../lib/error-guards.js";
import { getGoogleAuth, getGoogleClientCreds } from "./google-auth.js";
import {
  loadGoogleTokens,
  markGoogleAuthDead,
  saveGoogleTokens,
  type GoogleTokens,
} from "./google-token-store.js";

/** How stale the last verification may get before the probe re-checks. */
const PROBE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Thrown in place of the raw refresh error once we've classified it as a dead
 * grant, so callers up the stack can tell "you need to re-authorize" apart from
 * a network blip without re-parsing Google's error shape.
 */
export class GoogleAuthExpiredError extends Error {
  constructor(reason: string) {
    super(`Google authorization expired or revoked: ${reason}`);
    this.name = "GoogleAuthExpiredError";
  }
}

/**
 * Does this error mean the refresh token itself is dead?
 *
 * google-auth-library v10 throws a GaxiosError whose `response.data.error` is
 * `invalid_grant`; in the ReAuth variant it replaces `message` with the JSON of
 * that same payload. We check the structured field first and fall back to the
 * message. Anything unrecognized is NOT classified — a transient failure must
 * never flip a state that tells the boxholder to go re-authorize.
 */
export function isInvalidGrantError(e: unknown): boolean {
  if (!isRecord(e)) return false;
  const response = e["response"];
  if (isRecord(response) && isRecord(response["data"])) {
    if (response["data"]["error"] === "invalid_grant") return true;
  }
  return /invalid_grant/.test(errorMessage(e));
}

/**
 * Classify a token-refresh failure. On `invalid_grant`, persist the dead-grant
 * state and return a typed error for the caller to throw; otherwise return null
 * so the caller rethrows the original (transient) failure untouched.
 */
export async function classifyRefreshFailure(
  e: unknown,
  opts: { boxRoot?: string | undefined },
): Promise<GoogleAuthExpiredError | null> {
  if (!isInvalidGrantError(e)) return null;
  const reason = errorMessage(e);
  await markGoogleAuthDead({ boxRoot: opts.boxRoot, reason });
  console.error(
    "[google-auth] refresh token rejected (invalid_grant) — Google features are paused until the boxholder re-authorizes:",
    reason,
  );
  return new GoogleAuthExpiredError(reason);
}

/** The read side of the credential's health, for health checks and alerts. */
export interface GoogleAuthStatus {
  /** Are GOOGLE_OAUTH_CLIENT_ID/SECRET set at all? */
  configured: boolean;
  /** Is there a stored refresh token? */
  connected: boolean;
  /** When the grant was found dead, or null while it's healthy. */
  needsReauthSince: string | null;
  /** Google's reason for the dead grant, when known. */
  reauthReason: string | null;
  /** Last time the grant was known good, or null if never verified. */
  authCheckedAt: string | null;
}

export async function readGoogleAuthStatus(boxRoot?: string): Promise<GoogleAuthStatus> {
  const configured = (await getGoogleClientCreds(boxRoot)) !== null;
  const tokens = await loadGoogleTokens(boxRoot);
  return {
    configured,
    connected: !!tokens?.refreshToken,
    needsReauthSince: tokens?.needsReauthSince ?? null,
    reauthReason: tokens?.reauthReason ?? null,
    authCheckedAt: tokens?.authCheckedAt ?? null,
  };
}

function isStale(status: GoogleAuthStatus, now: Date): boolean {
  if (!status.authCheckedAt) return true;
  const checked = new Date(status.authCheckedAt).getTime();
  if (Number.isNaN(checked)) return true;
  return now.getTime() - checked >= PROBE_INTERVAL_MS;
}

export interface ProbeResult {
  /** Whether a refresh was actually attempted (false = skipped as fresh). */
  probed: boolean;
  /** The grant's state after the call. */
  status: GoogleAuthStatus;
}

/**
 * Force a token refresh when the last verification has gone stale (~daily),
 * so an idle box still learns its grant died instead of finding out the next
 * time someone happens to sync.
 *
 * A dead grant is recorded by `classifyRefreshFailure`. A successful refresh is
 * saved HERE rather than left to the client's `tokens` listener: that listener
 * is detached (a void IIFE), so the status re-read below could otherwise race
 * ahead of the clear and report a grant as still-broken microseconds after it
 * was repaired — which is what the caller turns into a notification. Both
 * writers produce the same values and the token-file RMW is locked, so the
 * duplicate save is harmless.
 *
 * The stamp lives in the shared token record, so under `cb hub` the first box
 * to run this each day probes and the rest see a fresh stamp and skip — one
 * network call per credential per day, not per box.
 *
 * Never throws: a probe is a diagnostic, and a transient network failure must
 * not take down the caller's tick.
 */
export async function probeGoogleAuthIfStale(
  boxRoot: string,
  { now, client }: { now: Date; client?: OAuth2Client | undefined },
): Promise<ProbeResult> {
  const status = await readGoogleAuthStatus(boxRoot);
  if (!status.configured || !status.connected || !isStale(status, now)) {
    return { probed: false, status };
  }

  const auth = client ?? (await getGoogleAuth(boxRoot));
  if (!auth) return { probed: false, status };

  try {
    const { credentials } = await auth.refreshAccessToken();
    const updates: Partial<GoogleTokens> = {};
    if (credentials.access_token) updates.accessToken = credentials.access_token;
    if (credentials.refresh_token) updates.refreshToken = credentials.refresh_token;
    if (credentials.expiry_date) {
      updates.tokenExpiry = new Date(credentials.expiry_date).toISOString();
    }
    if (updates.accessToken || updates.refreshToken) {
      await saveGoogleTokens(updates, { boxRoot });
    }
  } catch (e) {
    const expired = await classifyRefreshFailure(e, { boxRoot });
    if (!expired) {
      // Transient (network, 5xx, rate limit). Leave the state alone — the
      // stamp stays stale so the next tick tries again.
      console.warn("[google-auth] token probe failed transiently:", errorMessage(e));
    }
  }

  return { probed: true, status: await readGoogleAuthStatus(boxRoot) };
}
