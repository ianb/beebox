/**
 * Session authentication helpers.
 *
 * Uses signed cookies (HMAC-SHA256) — no server-side session store.
 * Auth is opt-in: disabled when GOOGLE_OAUTH_CLIENT_ID is not set.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { FastifyRequest } from "fastify";

const COOKIE_NAME = "cb_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let cachedSecret: string | null = null;

function getSessionSecret(): string {
  if (cachedSecret) return cachedSecret;

  // Prefer explicit env var
  if (process.env.CB_SESSION_SECRET) {
    cachedSecret = process.env.CB_SESSION_SECRET;
    return cachedSecret;
  }

  // Auto-generate and persist
  const secretFile = path.join(os.homedir(), ".cb-session-secret");
  try {
    cachedSecret = fs.readFileSync(secretFile, "utf-8").trim();
    return cachedSecret;
  } catch {
    const generated = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    cachedSecret = generated;
    return cachedSecret;
  }
}

export function isAuthEnabled(): boolean {
  return !!process.env.GOOGLE_OAUTH_CLIENT_ID;
}

export function getPublicUrl(): string {
  return process.env.CB_PUBLIC_URL || process.env.PUBLIC_URL || "http://localhost:3210";
}

/**
 * Create a signed session cookie value for the given email.
 */
export function signSession(email: string): string {
  const payload = JSON.stringify({
    email,
    exp: Date.now() + SESSION_MAX_AGE_MS,
  });
  const sig = crypto
    .createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("hex");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

/**
 * Verify a signed session cookie and return the email, or null if invalid/expired.
 */
export function verifySession(cookie: string): string | null {
  const dotIndex = cookie.indexOf(".");
  if (dotIndex === -1) return null;

  const payloadB64 = cookie.slice(0, dotIndex);
  const sig = cookie.slice(dotIndex + 1);

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf-8");
  } catch {
    return null;
  }

  const expectedSig = crypto
    .createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedSig, "hex"))) {
    return null;
  }

  try {
    const data = JSON.parse(payload);
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    if (typeof data.email !== "string") return null;
    return data.email;
  } catch {
    return null;
  }
}

/**
 * Extract the authenticated email from a request's session cookie.
 */
export function getSessionEmail(request: FastifyRequest): string | null {
  const cookie = (request.cookies as Record<string, string | undefined>)?.[COOKIE_NAME];
  if (!cookie) return null;
  return verifySession(cookie);
}

/**
 * Get the owner email from environment, or null if not set.
 */
export function getOwnerEmail(): string | null {
  return process.env.CB_OWNER_EMAIL || null;
}

/**
 * Check if the authenticated user is the system owner.
 */
export function isOwner(request: FastifyRequest): boolean {
  const ownerEmail = getOwnerEmail();
  if (!ownerEmail) return false;
  const email = getSessionEmail(request);
  return email === ownerEmail;
}

export { COOKIE_NAME, SESSION_MAX_AGE_MS };
