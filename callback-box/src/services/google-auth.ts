/**
 * Google Auth service — typed interface for OAuth2 token management.
 *
 * Real implementation wraps google-auth-library's OAuth2Client.
 * Fake always returns a configurable access token without network calls.
 */

import type { OAuth2Client } from "google-auth-library";

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

export function createGoogleAuthService(client: OAuth2Client): GoogleAuthService {
  return {
    async getAccessToken() {
      const { token } = await client.getAccessToken();
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
