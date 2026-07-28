/**
 * Shared Google OAuth2 client.
 *
 * Not a connector — just builds the OAuth2Client all Google connectors
 * (calendar, gmail API, drive) share. The token record it reads and writes
 * lives in `google-token-store.ts`; client credentials always come from the
 * GOOGLE_OAUTH_CLIENT_ID/SECRET env vars.
 */

import { OAuth2Client } from "google-auth-library";
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

/**
 * Get Google OAuth client credentials from env vars.
 */
export function getGoogleClientCreds(): { clientId: string; clientSecret: string } | null {
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
 * Client credentials always come from env vars.
 */
export async function getGoogleAuth(
  boxRoot?: string,
): Promise<OAuth2Client | null> {
  const creds = getGoogleClientCreds();
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
