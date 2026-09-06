/**
 * Shared Google OAuth2 client.
 *
 * Not a connector — just builds the OAuth2Client all Google connectors
 * (calendar, gmail API, drive) share. The token record it reads and writes
 * lives in `google-token-store.ts`; a box's client credentials come from the
 * machine secret store (see `getBoxGoogleClientCreds`).
 */

import { OAuth2Client } from "google-auth-library";
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
const GOOGLE_CLIENT_ID_SECRET_NAME = "google-oauth-client-id";
const GOOGLE_CLIENT_SECRET_SECRET_NAME = "google-oauth-client-secret";

/**
 * A BOX's Google OAuth client credentials: the machine store's
 * `google-oauth-client-id` / `google-oauth-client-secret` entries at `server`
 * access (`docs/implemented-plans/secret-custody.md`). `null` when the box has
 * no grant — the connector is simply not configured for it.
 *
 * These are the OAuth *app's* identity, not a user's tokens — the token record
 * (`google-token-store.ts`, `BBX_GOOGLE_TOKENS_FILE`) is a separate thing and
 * stays where it is.
 *
 * Both halves must come from the SAME source, so a half-granted box is `null`
 * rather than a mixed pair.
 *
 * The LOGIN surface has its own reader (`getLoginGoogleClientCreds`): grants
 * are per-box, and fleet login runs before any box is in play, so the two
 * cannot share one resolution path.
 */
export async function getBoxGoogleClientCreds(
  boxRoot: string,
): Promise<{ clientId: string; clientSecret: string } | null> {
  const [id, secret] = await Promise.all([
    resolveSecret({ boxRoot, name: GOOGLE_CLIENT_ID_SECRET_NAME, purpose: "google-oauth", access: "server" }),
    resolveSecret({ boxRoot, name: GOOGLE_CLIENT_SECRET_SECRET_NAME, purpose: "google-oauth", access: "server" }),
  ]);
  if (id.ok && secret.ok) return { clientId: id.value.value, clientSecret: secret.value.value };
  return null;
}

/**
 * The LOGIN surface's Google OAuth client credentials, from
 * `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`.
 *
 * This is process-level configuration, not a transition-window fallback. Fleet
 * login (`webapp/routes/auth.ts`, `auth-google.ts`) answers "is Google sign-in
 * available for this server" before any box exists, and the secret store grants
 * per box — so there is nothing for it to ask. Removing the env pair here would
 * disable Google sign-in outright, which is why the secret-store transition
 * kept it while retiring every genuine fallback around it.
 *
 * TODO(env-migration): GOOGLE_OAUTH_* are validated + redacted at startup
 * (lib/env.ts server/hub schemas); reads stay direct — they may be unset, in
 * which case Google sign-in is simply not offered.
 */
export function getLoginGoogleClientCreds(): { clientId: string; clientSecret: string } | null {
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
 * Client credentials come from the box's store grant.
 */
export async function getGoogleAuth(
  boxRoot?: string,
): Promise<OAuth2Client | null> {
  const creds = boxRoot === undefined ? null : await getBoxGoogleClientCreds(boxRoot);
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
