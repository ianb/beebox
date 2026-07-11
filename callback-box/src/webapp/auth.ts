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
  // TODO(env-migration): CB_SESSION_SECRET is validated + redacted at startup
  // (lib/env.ts serverEnvSchema); this read stays direct because it carries a
  // file-fallback + caching path that doesn't belong in a schema.
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
 * Whitelist: /api/trpc/health.check and /api/trpc/debugLog.get.
 * Top-level /healthz is handled by its own root-level route, not this bypass.
 */
export function isDiagnosticBypassRequest(request: FastifyRequest): boolean {
  if (request.method !== "GET") return false;
  const url = request.url;
  if (!url.includes("/api/trpc/health.check") && !url.includes("/api/trpc/debugLog.get")) return false;
  return verifyDiagBearerKey(request);
}

export interface SessionUser {
  email: string;
  name: string;
  picture?: string;
}

/**
 * Hub-mode header names (Track D, chunk D2). A box only trusts these when
 * `CB_HUB_SECRET` is set (see `isHubMode`) AND the request carries a valid
 * `x-cb-hub-secret` — never as a fallback outside hub mode. See
 * `resolveRequestIdentity` for the full contract and its rationale.
 */
export const HUB_EMAIL_HEADER = "x-cb-authenticated-email";
export const HUB_SECRET_HEADER = "x-cb-hub-secret";
export const HUB_AUTH_OFF_HEADER = "x-cb-hub-auth";

/**
 * True when this box process is running behind a hub (Track D, chunk D2).
 * The supervisor sets `CB_HUB_SECRET` in every child's env at boot; its
 * mere presence — not any request state — is what switches a box from
 * "verify my own session cookie" to "trust only hub-injected, secret-gated
 * headers." See `resolveRequestIdentity`.
 */
export function isHubMode(): boolean {
  return !!process.env.CB_HUB_SECRET;
}

/**
 * Timing-safe check that a request's `x-cb-hub-secret` header matches
 * `CB_HUB_SECRET`. Modeled on `verifyDiagBearerKey`'s length-check +
 * `timingSafeEqual` pattern. False when the env var isn't set (so hub-mode
 * checks fail closed even if `isHubMode()` was somehow bypassed), the
 * header is missing, or the value doesn't match.
 */
export function verifyHubSecret(request: FastifyRequest): boolean {
  const secret = process.env.CB_HUB_SECRET;
  if (!secret) return false;
  const header = request.headers[HUB_SECRET_HEADER];
  if (typeof header !== "string") return false;
  if (header.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(secret));
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
  const cookie = (request.cookies as Record<string, string | undefined>)[COOKIE_NAME];
  if (!cookie) return null;
  return verifySession(cookie);
}

/**
 * Parse a raw `Cookie` header string into a name -> value map. Only used by
 * `getSessionUserFromCookieHeader` below, for the one place that doesn't
 * have `@fastify/cookie`'s request decoration available: the hub's raw
 * WebSocket-upgrade path (`src/hub/hub-server.ts`), which sees a bare
 * `http.IncomingMessage`, not a `FastifyRequest`.
 */
function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch (_e) {
      // Malformed percent-encoding — untrusted input, skip this cookie.
    }
  }
  return out;
}

/**
 * Same as `getSessionUser`, but from a raw `Cookie` header string instead
 * of a `FastifyRequest`'s decorated `.cookies`. See `parseCookieHeader`.
 */
export function getSessionUserFromCookieHeader(cookieHeader: string | undefined): SessionUser | null {
  const cookie = parseCookieHeader(cookieHeader)[COOKIE_NAME];
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

/** Where a request's identity came from, or `null` when it's unauthenticated. */
export type IdentitySource = "hub" | "cookie" | "open" | null;

export interface RequestIdentity {
  email: string | null;
  name: string | null;
  source: IdentitySource;
}

/**
 * Resolve the authenticated identity for a request through ONE path,
 * consumed by both the box auth preHandler (`server-box-scope.ts`) and the
 * tRPC context creation, so the two can never diverge (Track D, chunk D2 —
 * `docs/implemented-plans/boxes-as-packages-v2.md` calls this out explicitly: identity
 * used to be recomputed separately in both places).
 *
 * In hub mode (`isHubMode()`), identity comes ONLY from hub-injected
 * headers gated by `CB_HUB_SECRET` — the session cookie is never
 * consulted, even if one is present. This is deliberate, not an oversight:
 * the session-cookie secret is symmetric (HMAC), so any box that can VERIFY
 * a cookie could also FORGE one for a sibling box. Under the plan's trust
 * model (hub trusted, boxes mutually untrusting) that is unacceptable, so
 * the hub is the only process that ever holds the session secret, and a
 * hub-mode box authenticates a request purely from the secret-gated
 * header the hub attached after checking the cookie itself.
 *
 * - Missing/invalid `x-cb-hub-secret` -> unauthenticated (`source: null`).
 *   Fails closed; a hub-mode box NEVER falls back to cookie verification —
 *   that fallback would reopen exactly the forgery hole above.
 * - Valid secret + `x-cb-authenticated-email` present -> `source: "hub"`.
 * - Valid secret + no email header, but `x-cb-hub-auth: off` -> `source:
 *   "open"` (the hub itself has no `GOOGLE_OAUTH_CLIENT_ID` configured, so
 *   there is no login and no identity fleet-wide — same semantics as
 *   today's single-box "auth disabled" mode).
 * - Valid secret, no email header, no `off` flag -> unauthenticated. This
 *   shouldn't happen from a well-behaved hub; treated as a fail-closed 401,
 *   not silently "open."
 *
 * Outside hub mode, behavior is byte-for-byte what it was before D2: the
 * session cookie is the only source (`source: "cookie"` when present), and
 * the hub headers are IGNORED even if somehow present on the request —
 * trusting them outside hub mode is exactly the spoofing hole this design
 * closes.
 */
export function resolveRequestIdentity(request: FastifyRequest): RequestIdentity {
  if (isHubMode()) {
    if (!verifyHubSecret(request)) return { email: null, name: null, source: null };
    const emailHeader = request.headers[HUB_EMAIL_HEADER];
    if (typeof emailHeader === "string" && emailHeader.length > 0) {
      return { email: emailHeader, name: emailHeader, source: "hub" };
    }
    if (request.headers[HUB_AUTH_OFF_HEADER] === "off") {
      return { email: null, name: null, source: "open" };
    }
    return { email: null, name: null, source: null };
  }
  const user = getSessionUser(request);
  if (user) return { email: user.email, name: user.name, source: "cookie" };
  return { email: null, name: null, source: null };
}

export { COOKIE_NAME, SESSION_MAX_AGE_MS };
