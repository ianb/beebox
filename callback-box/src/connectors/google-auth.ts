/**
 * Shared Google OAuth2 utility.
 *
 * Not a connector — just handles OAuth2 token management.
 * All Google connectors (calendar, gmail API, drive) share these credentials.
 *
 * Config: config/connectors/google.secret.json
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { OAuth2Client } from "google-auth-library";

export interface GoogleSecretConfig {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  accessToken?: string;
  tokenExpiry?: string;
}

const REDIRECT_URI = "http://localhost:8976/oauth/callback";

/** All scopes we request during auth */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

function secretPath(boxRoot: string): string {
  return path.join(boxRoot, "config/connectors/google.secret.json");
}

/**
 * Load Google secret config from disk. Returns null if not configured.
 */
export async function loadGoogleSecret(
  boxRoot: string
): Promise<GoogleSecretConfig | null> {
  try {
    const content = await fs.readFile(secretPath(boxRoot), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save Google secret config to disk (merges with existing).
 */
export async function saveGoogleSecret(
  boxRoot: string,
  updates: Partial<GoogleSecretConfig>
): Promise<void> {
  const existing = (await loadGoogleSecret(boxRoot)) || {};
  const merged = { ...existing, ...updates };
  const dir = path.dirname(secretPath(boxRoot));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(secretPath(boxRoot), JSON.stringify(merged, null, 2));
}

/**
 * Get an authenticated OAuth2Client with auto-refresh.
 * Returns null if not configured or missing refresh token.
 */
export async function getGoogleAuth(
  boxRoot: string
): Promise<OAuth2Client | null> {
  const secret = await loadGoogleSecret(boxRoot);
  if (!secret || !secret.clientId || !secret.clientSecret || !secret.refreshToken) {
    return null;
  }

  const client = new OAuth2Client(
    secret.clientId,
    secret.clientSecret,
    REDIRECT_URI
  );

  client.setCredentials({
    refresh_token: secret.refreshToken,
    access_token: secret.accessToken ?? null,
    expiry_date: secret.tokenExpiry
      ? new Date(secret.tokenExpiry).getTime()
      : null,
  });

  // Auto-save refreshed tokens
  client.on("tokens", async (tokens) => {
    const updates: Partial<GoogleSecretConfig> = {};
    if (tokens.access_token) {
      updates.accessToken = tokens.access_token;
    }
    if (tokens.expiry_date) {
      updates.tokenExpiry = new Date(tokens.expiry_date).toISOString();
    }
    if (tokens.refresh_token) {
      updates.refreshToken = tokens.refresh_token;
    }
    await saveGoogleSecret(boxRoot, updates);
  });

  return client;
}

/**
 * Create a new OAuth2Client for the auth flow (before we have tokens).
 */
export function createOAuth2Client(
  clientId: string,
  clientSecret: string
): OAuth2Client {
  return new OAuth2Client(clientId, clientSecret, REDIRECT_URI);
}
