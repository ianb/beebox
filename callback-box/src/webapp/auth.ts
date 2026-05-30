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
  } catch (e) {
    // Missing file is the normal first-run case (generate below). Anything
    // else (permissions, corruption) we'd want to notice before overwriting.
    const code = e instanceof Error && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code !== "ENOENT") {
      console.warn(`Failed to read session secret at ${secretFile}, regenerating:`, e);
    }
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
 * Verify the request's Authorization header carries the configured
 * CB_DIAG_API_KEY as a bearer token. Returns false when the env var
 * isn't set, when the header is missing, or when the value doesn't match.
 *
 * Timing-safe comparison so the key cannot be brute-forced via response time.
 */
export function verifyDiagBearerKey(request: FastifyRequest): boolean {
  const key = process.env.CB_DIAG_API_KEY;
  if (!key) return false;
  const auth = request.headers["authorization"];
  if (typeof auth !== "string") return false;
  const expected = `Bearer ${key}`;
  if (auth.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
}

/**
 * Allow CLI/agent access to a narrow set of read-only diagnostic endpoints
 * via a shared secret in CB_DIAG_API_KEY (in /home/callback/.env on prod).
 *
 * Bypasses per-box cookie auth ONLY when ALL of the following hold:
 *   - the request method is GET
 *   - the request path matches a whitelisted diagnostic endpoint
 *   - the bearer key check passes (see verifyDiagBearerKey)
 *
 * Whitelist: /api/debug-log, /api/trpc/health.check.
 * Top-level /healthz is handled by its own root-level route, not this bypass.
 */
export function isDiagnosticBypassRequest(request: FastifyRequest): boolean {
  if (request.method !== "GET") return false;
  const url = request.url;
  const isDebugLog = url.includes("/api/debug-log");
  const isHealth = url.includes("/api/trpc/health.check");
  if (!isDebugLog && !isHealth) return false;
  return verifyDiagBearerKey(request);
}

export interface SessionUser {
  email: string;
  name: string;
  picture?: string;
}

/**
 * Create a signed session cookie value for the given user.
 */
export function signSession(user: SessionUser): string {
  const payload = JSON.stringify({
    email: user.email,
    name: user.name,
    ...(user.picture ? { picture: user.picture } : {}),
    exp: Date.now() + SESSION_MAX_AGE_MS,
  });
  const sig = crypto
    .createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("hex");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

/**
 * Verify a signed session cookie and return the user, or null if invalid/expired.
 */
export function verifySession(cookie: string): SessionUser | null {
  const dotIndex = cookie.indexOf(".");
  if (dotIndex === -1) return null;

  const payloadB64 = cookie.slice(0, dotIndex);
  const sig = cookie.slice(dotIndex + 1);

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf-8");
  } catch (_e) {
    // Malformed/garbage cookie value — untrusted input, treat as no session.
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
    return { email: data.email, name: data.name || data.email, picture: data.picture };
  } catch (_e) {
    // Payload isn't valid JSON — untrusted/tampered cookie, treat as no session.
    return null;
  }
}

/**
 * Extract the authenticated user from a request's session cookie.
 */
export function getSessionUser(request: FastifyRequest): SessionUser | null {
  const cookie = (request.cookies as Record<string, string | undefined>)?.[COOKIE_NAME];
  if (!cookie) return null;
  return verifySession(cookie);
}

/**
 * Extract the authenticated email from a request's session cookie.
 */
export function getSessionEmail(request: FastifyRequest): string | null {
  return getSessionUser(request)?.email ?? null;
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
