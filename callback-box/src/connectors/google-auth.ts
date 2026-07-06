/**
 * Shared Google OAuth2 utility.
 *
 * Not a connector — just handles OAuth2 token management.
 * All Google connectors (calendar, gmail API, drive) share these credentials.
 *
 * Token storage: centralized via CB_GOOGLE_TOKENS_FILE env var (preferred),
 * or per-box config/connectors/google.secret.json (legacy fallback).
 * Client credentials always come from GOOGLE_OAUTH_CLIENT_ID/SECRET env vars.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { OAuth2Client } from "google-auth-library";
import { withCardLock } from "../lib/card-lock.js";

class NoTokenStoragePathError extends Error {
  constructor() {
    super("No token storage path: set CB_GOOGLE_TOKENS_FILE or provide boxRoot");
    this.name = "NoTokenStoragePathError";
  }
}

export interface GoogleTokens {
  refreshToken?: string;
  accessToken?: string;
  tokenExpiry?: string;
}

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

function legacySecretPath(boxRoot: string): string {
  return path.join(boxRoot, "config/connectors/google.secret.json");
}

/**
 * Resolve the centralized token file path.
 * Returns the path from CB_GOOGLE_TOKENS_FILE env var, or null if not set.
 */
function centralTokenPath(): string | null {
  return process.env.CB_GOOGLE_TOKENS_FILE || null;
}

/**
 * Load Google tokens from disk. Checks centralized path first, then
 * falls back to per-box google.secret.json for backward compatibility.
 */
export async function loadGoogleTokens(boxRoot?: string): Promise<GoogleTokens | null> {
  // Try centralized file first
  const central = centralTokenPath();
  if (central) {
    try {
      const content = await fs.readFile(central, "utf-8");
      return JSON.parse(content);
    } catch (e) {
      // Usually the file doesn't exist yet; fall through to the legacy
      // location. Log at debug so a real read/parse error is still visible.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.debug("Could not read centralized Google tokens file, falling back:", e);
      }
    }
  }

  // Fall back to per-box legacy file
  if (boxRoot) {
    try {
      const content = await fs.readFile(legacySecretPath(boxRoot), "utf-8");
      return JSON.parse(content);
    } catch (e) {
      // No legacy tokens file (or it's unreadable) — treat as "no tokens".
      // Log at debug so a real read/parse error is still visible.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.debug("Could not read legacy Google tokens file:", e);
      }
      return null;
    }
  }

  return null;
}

/**
 * Save Google tokens. Writes to centralized path if configured,
 * otherwise falls back to per-box path.
 */
export async function saveGoogleTokens(
  updates: Partial<GoogleTokens>,
  opts?: { boxRoot?: string },
): Promise<void> {
  const { boxRoot } = opts ?? {};
  const central = centralTokenPath();
  const targetPath = central || (boxRoot ? legacySecretPath(boxRoot) : null);
  if (!targetPath) {
    throw new NoTokenStoragePathError();
  }

  // Serialize the read-merge-write on the token file. The OAuth callback and
  // the auto-refresh `tokens` event handler both call this with PARTIAL
  // updates; without the lock a concurrent access-token save and refresh-token
  // save can each read the old file and drop the other's field.
  await withCardLock(targetPath, async () => {
    let existing: GoogleTokens = {};
    try {
      const content = await fs.readFile(targetPath, "utf-8");
      existing = JSON.parse(content);
    } catch (e) {
      // No existing tokens file (or unreadable) — start fresh and merge into {}.
      // Log at debug so a real read/parse error is still visible.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.debug("Could not read existing Google tokens file, starting fresh:", e);
      }
    }

    const merged = { ...existing, ...updates };
    const dir = path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify(merged, null, 2));
  });
}

/**
 * Get Google OAuth client credentials from env vars.
 */
export function getGoogleClientCreds(): { clientId: string; clientSecret: string } | null {
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
  // save here would otherwise be an unhandled rejection.
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
