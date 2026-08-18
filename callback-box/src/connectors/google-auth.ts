/**
 * Shared Google OAuth2 client.
 *
 * Not a connector — just builds the OAuth2Client all Google connectors
 * (calendar, gmail API, drive) share. The token record it reads and writes
 * lives in `google-token-store.ts`; client credentials come from the machine
 * secret store, falling back to the GOOGLE_OAUTH_CLIENT_ID/SECRET env vars.
 */

import { OAuth2Client } from "google-auth-library";
import { refusalAllowsLegacyFallback } from "../core/secrets/legacy-fallback.js";
import { resolveSecret } from "../core/secrets/resolve.js";
import {
  loadGoogleTokens,
  saveGoogleTokens,
  type GoogleTokens,
} from "./google-token-store.js";

const DEFAULT_REDIRECT_URI = "http://localhost:8976/oauth/callback";

/** All scopes we request during auth */
export const GOOGLE_SCOPES = [
  // Narrow calendar scopes: events read/write + read-only calendar list.
  // We don't manage calendars themselves (create/delete/share), so we
  // avoid the full `calendar` scope which would request that.
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  // Full Drive scope: needed for two-way sync of user-owned files we
  // didn't create (existing Sheets and Docs added by URL). Supersedes
  // drive.readonly and drive.file.
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  // Docs API metadata: for lossy-content detection on synced Google Docs
  // (footnotes, inline objects, equations, suggestions). Push uses Drive
  // multipart upload — no Docs write scope needed.
  "https://www.googleapis.com/auth/documents.readonly",
];

/** The known Google service categories that can be toggled per box. */
export type GoogleServiceName = "calendar" | "gmail" | "drive";

/** Per-box policy: which Google services this box is allowed to use. */
export type GoogleServicesPolicy = Partial<Record<GoogleServiceName, boolean>>;

/** The store names the OAuth app's client credentials live under. */
export const GOOGLE_CLIENT_ID_SECRET_NAME = "google-oauth-client-id";
export const GOOGLE_CLIENT_SECRET_SECRET_NAME = "google-oauth-client-secret";

/**
 * Get Google OAuth client credentials: the machine store first (names
 * `google-oauth-client-id` / `google-oauth-client-secret`, `server` access),
 * then the `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` env vars
 * (`docs/plans/secret-custody.md`, Track 3). Never had a per-box file, so there
 * is no legacy-file arm.
 *
 * These are the OAuth *app's* identity, not a user's tokens — the token record
 * (`google-token-store.ts`, `CB_GOOGLE_TOKENS_FILE`) is untouched by this
 * migration and stays where it is.
 *
 * `boxRoot` is optional because two callers are box-less: the hub's
 * login-config surface asks "is Google login configured at all?" before any box
 * is in play. Those keep the env-only answer.
 *
 * Both halves must come from the SAME source: a store id paired with an env
 * secret would be a silent cross-app mismatch, so a partial store answer falls
 * through to env rather than mixing.
 */
export async function getGoogleClientCreds(
  boxRoot?: string,
): Promise<{ clientId: string; clientSecret: string } | null> {
  if (boxRoot !== undefined) {
    const [id, secret] = await Promise.all([
      resolveSecret({ boxRoot, name: GOOGLE_CLIENT_ID_SECRET_NAME, purpose: "google-oauth", access: "server" }),
      resolveSecret({ boxRoot, name: GOOGLE_CLIENT_SECRET_SECRET_NAME, purpose: "google-oauth", access: "server" }),
    ]);
    if (id.ok && secret.ok) return { clientId: id.value.value, clientSecret: secret.value.value };
    // Only "no such secret on this machine" degrades to the env vars — for
    // EITHER half, since a partial store answer must not mix sources. Any other
    // refusal (revoked, withheld, empty, unreadable store) is "not configured";
    // falling through would let a stale export outlive a revoked grant
    // (`core/secrets/legacy-fallback.ts`).
    const blocked = [id, secret].some(
      (result) => !result.ok && !refusalAllowsLegacyFallback({ reader: "google-auth", refusal: result.error }),
    );
    if (blocked) return null;
  }
  // TODO(env-migration): GOOGLE_OAUTH_* are validated + redacted at startup
  // (lib/env.ts server/hub schemas); reads stay direct — creds are read lazily
  // per-connector and may be unset (auth simply disabled).
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (clientId && clientSecret) return { clientId, clientSecret };
  return null;
}

/**
 * Get an authenticated OAuth2Client with auto-refresh.
 * Returns null if not configured or missing refresh token.
 *
 * Loads tokens from centralized storage (or legacy per-box fallback).
 * Client credentials come from the store, then env.
 */
export async function getGoogleAuth(
  boxRoot?: string,
): Promise<OAuth2Client | null> {
  const creds = await getGoogleClientCreds(boxRoot);
  if (!creds) return null;

  const tokens = await loadGoogleTokens(boxRoot);
  if (!tokens || !tokens.refreshToken) return null;

  const client = new OAuth2Client(
    creds.clientId,
    creds.clientSecret,
    DEFAULT_REDIRECT_URI,
  );

  client.setCredentials({
    refresh_token: tokens.refreshToken,
    access_token: tokens.accessToken ?? null,
    expiry_date: tokens.tokenExpiry
      ? new Date(tokens.tokenExpiry).getTime()
      : null,
  });

  // Auto-save refreshed tokens. EventEmitter listeners must be void-returning,
  // so the async save runs in a detached IIFE with its own catch -- a failed
  // save here would otherwise be an unhandled rejection. A successful refresh
  // is also what clears any `needsReauth` state (saveGoogleTokens does it).
  client.on("tokens", (newTokens) => {
    void (async () => {
      const tokenUpdates: Partial<GoogleTokens> = {};
      if (newTokens.access_token) {
        tokenUpdates.accessToken = newTokens.access_token;
      }
      if (newTokens.expiry_date) {
        tokenUpdates.tokenExpiry = new Date(newTokens.expiry_date).toISOString();
      }
      if (newTokens.refresh_token) {
        tokenUpdates.refreshToken = newTokens.refresh_token;
      }
      await saveGoogleTokens(tokenUpdates, boxRoot ? { boxRoot } : {});
    })().catch((err: unknown) => {
      console.error("Failed to save refreshed Google OAuth tokens:", err);
    });
  });

  return client;
}

/**
 * Create a new OAuth2Client for the auth flow (before we have tokens).
 */
export function createOAuth2Client(
  { clientId, clientSecret, redirectUri }: { clientId: string; clientSecret: string; redirectUri?: string },
): OAuth2Client {
  return new OAuth2Client(clientId, clientSecret, redirectUri || DEFAULT_REDIRECT_URI);
}
