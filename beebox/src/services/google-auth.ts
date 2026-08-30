/**
 * Google Auth service — typed interface for OAuth2 token management.
 *
 * Real implementation wraps google-auth-library's OAuth2Client.
 * Fake always returns a configurable access token without network calls.
 */

import type { OAuth2Client } from "google-auth-library";
import { classifyRefreshFailure } from "../connectors/google-auth-status.js";

class AccessTokenUnavailableError extends Error {
  constructor() {
    super("Failed to get access token");
    this.name = "AccessTokenUnavailableError";
  }
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface GoogleAuthService {
  /** Get a valid access token, refreshing if needed. */
  getAccessToken(): Promise<string>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

/**
 * Wrap an OAuth2Client as the token source for every Google API call.
 *
 * This is the one chokepoint where a dead grant surfaces: `getAccessToken()`
 * refreshes lazily, and every Google service (gmail, drive/sheets/docs,
 * calendar) obtains its bearer token here. Pass `boxRoot` so an `invalid_grant`
 * can be recorded against the right token file — omitting it still classifies
 * and rethrows, it just can't persist for a legacy per-box credential.
 */
export function createGoogleAuthService(
  client: OAuth2Client,
  opts?: { boxRoot?: string | undefined },
): GoogleAuthService {
  return {
    async getAccessToken() {
      let token: string | null | undefined;
      try {
        ({ token } = await client.getAccessToken());
      } catch (e) {
        const expired = await classifyRefreshFailure(e, { boxRoot: opts?.boxRoot });
        if (expired) throw expired;
        throw e;
      }
      if (!token) throw new AccessTokenUnavailableError();
      return token;
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeGoogleAuthOptions {
  /** Access token to return. Default: "fake-access-token" */
  accessToken?: string;
}

export function createFakeGoogleAuth(
  opts?: FakeGoogleAuthOptions,
): GoogleAuthService {
  return {
    async getAccessToken() {
      return opts?.accessToken ?? "fake-access-token";
    },
  };
}
