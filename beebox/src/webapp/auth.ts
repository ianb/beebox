/**
 * Session authentication helpers.
 *
 * Uses signed cookies (HMAC-SHA256) — no server-side session store.
 * Auth is STRUCTURALLY ALWAYS-ON: a box requires authentication. The only
 * unauthenticated servers that can exist are test-constructed ones, via the
 * `openAccess` server-construction option (decorated onto the fastify instance;
 * see `src/types/fastify.d.ts`) — no CLI path sets it. "Is Google configured"
 * does not mean "is this box protected" — Google is just one login method
 * layered on top.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { IncomingHttpHeaders } from "node:http";
import type { FastifyRequest } from "fastify";
import { parseCookieHeader } from "../lib/cookies.js";
import { errnoCode } from "../lib/error-guards.js";
import { canonicalizeEmail, getLocalOwnerEmail, getLocalUser } from "./local-users.js";
import { getLocalUserCached } from "./local-users-cache.js";
import { AuthStoreUnavailableError } from "./local-users-errors.js";

const COOKIE_NAME = "bbx_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let cachedSecret: string | null = null;

function getSessionSecret(): string {
  if (cachedSecret) return cachedSecret;

  // Prefer explicit env var
  // TODO(env-migration): BBX_SESSION_SECRET is validated + redacted at startup
  // (lib/env.ts serverEnvSchema); this read stays direct because it carries a
  // file-fallback + caching path that doesn't belong in a schema.
  if (process.env.BBX_SESSION_SECRET) {
    cachedSecret = process.env.BBX_SESSION_SECRET;
    return cachedSecret;
  }

  // Auto-generate and persist
  const secretFile = path.join(os.homedir(), ".bbx-session-secret");
  try {
    cachedSecret = fs.readFileSync(secretFile, "utf-8").trim();
    return cachedSecret;
  } catch (e) {
    // Missing file is the normal first-run case (generate below). Anything
    // else (permissions, corruption) we'd want to notice before overwriting.
    const code = errnoCode(e);
    if (code !== "ENOENT") {
      console.warn(`Failed to read session secret at ${secretFile}, regenerating:`, e);
    }
    const generated = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    cachedSecret = generated;
    return cachedSecret;
  }
}

/**
 * Verify the request's Authorization header carries the configured
 * BBX_DIAG_API_KEY as a bearer token. Returns false when the env var
 * isn't set, when the header is missing, or when the value doesn't match.
 *
 * Timing-safe comparison so the key cannot be brute-forced via response time.
 */
export function verifyDiagBearerKey(request: FastifyRequest): boolean {
  const key = process.env.BBX_DIAG_API_KEY;
  if (!key) return false;
  const auth = request.headers["authorization"];
  if (typeof auth !== "string") return false;
  const expected = `Bearer ${key}`;
  if (auth.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
}

/**
 * Allow CLI/agent access to a narrow set of read-only diagnostic endpoints
 * via a shared secret in BBX_DIAG_API_KEY (in /home/beebox/.env on prod).
 *
 * Bypasses per-box cookie auth ONLY when ALL of the following hold:
 *   - the request method is GET
 *   - the request path matches a whitelisted diagnostic endpoint
 *   - the bearer key check passes (see verifyDiagBearerKey)
 *
 * Whitelist: /api/trpc/health.check, /api/trpc/debugLog.get and
 * /api/trpc/chat.statusAll (the field-test harness's quiescence poll — a
 * running/busy roll-up carrying no conversation content).
 * Top-level /healthz is handled by its own root-level route, not this bypass.
 *
 * The whitelist is checked against the EXACT set of tRPC procedures the URL
 * names, not a substring: a tRPC batch URL like
 * `/api/trpc/health.check,history.list?batch=1` lists multiple comma-separated
 * procedures, and EVERY one must be whitelisted. A substring test
 * (`url.includes("health.check")`) let such a batch bypass auth while carrying
 * a non-whitelisted `publicProcedure` (e.g. `history.list`) — a privilege
 * widening for diag-key holders, now closed.
 */
const DIAG_PROCEDURE_WHITELIST: ReadonlySet<string> = new Set([
  "health.check",
  "debugLog.get",
  "chat.statusAll",
]);

/** Extract the comma-separated tRPC procedure list from a URL's path segment
 *  (the text after `/api/trpc/`, before the query), or `null` when the URL
 *  isn't a tRPC call. */
function parseTrpcProcedures(url: string): string[] | null {
  const marker = "/api/trpc/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const afterMarker = url.slice(idx + marker.length);
  const pathSegment = afterMarker.split("?")[0];
  if (pathSegment === undefined || pathSegment.length === 0) return null;
  return pathSegment.split(",");
}

export function isDiagnosticBypassRequest(request: FastifyRequest): boolean {
  if (request.method !== "GET") return false;
  const procedures = parseTrpcProcedures(request.url);
  if (procedures === null || procedures.length === 0) return false;
  if (!procedures.every((proc) => DIAG_PROCEDURE_WHITELIST.has(proc))) return false;
  return verifyDiagBearerKey(request);
}

export interface SessionUser {
  email: string;
  name: string;
  picture?: string;
  /**
   * The local record's session generation at mint time (Track D). Present only
   * for an email that has a local credential record; a Google-only identity
   * mints no `gen`. `resolveRequestIdentity` compares it against the record's
   * current `gen` to revoke sessions on a password change or user removal.
   */
  gen?: number;
}

/**
 * Hub-mode header names (Track D, chunk D2). A box only trusts these when
 * `BBX_HUB_SECRET` is set (see `isHubMode`) AND the request carries a valid
 * `x-bbx-hub-secret` — never as a fallback outside hub mode. See
 * `resolveRequestIdentity` for the full contract and its rationale.
 */
export const HUB_EMAIL_HEADER = "x-bbx-authenticated-email";
export const HUB_SECRET_HEADER = "x-bbx-hub-secret";
export const HUB_AUTH_OFF_HEADER = "x-bbx-hub-auth";

/**
 * True when this box process is running behind a hub (Track D, chunk D2).
 * The supervisor sets `BBX_HUB_SECRET` in every child's env at boot; its
 * mere presence — not any request state — is what switches a box from
 * "verify my own session cookie" to "trust only hub-injected, secret-gated
 * headers." See `resolveRequestIdentity`.
 */
export function isHubMode(): boolean {
  return !!process.env.BBX_HUB_SECRET;
}

/**
 * The request shape `resolveRequestIdentity` (and `verifyHubSecret`) reads: raw
 * `headers` always, plus `@fastify/cookie`'s `cookies` decoration WHEN present.
 * The tRPC WebSocket upgrade hands `createContext` a raw `http.IncomingMessage`
 * that has no `.cookies` decoration, so `cookies` is optional and the resolver
 * falls back to parsing the raw `Cookie` header there — without that fallback a
 * cookie-authenticated WS/subscription silently loses its identity at context
 * creation once auth is the default-on wall. A decorated `FastifyRequest` is
 * assignable to this, so every existing caller keeps working unchanged.
 */
export interface IdentityRequest {
  headers: IncomingHttpHeaders;
  cookies?: { [cookieName: string]: string | undefined };
}

/**
 * Timing-safe check that a request's `x-bbx-hub-secret` header matches
 * `BBX_HUB_SECRET`. Modeled on `verifyDiagBearerKey`'s length-check +
 * `timingSafeEqual` pattern. False when the env var isn't set (so hub-mode
 * checks fail closed even if `isHubMode()` was somehow bypassed), the
 * header is missing, or the value doesn't match.
 */
export function verifyHubSecret(request: Pick<IdentityRequest, "headers">): boolean {
  const secret = process.env.BBX_HUB_SECRET;
  if (!secret) return false;
  const header = request.headers[HUB_SECRET_HEADER];
  if (typeof header !== "string") return false;
  if (header.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(secret));
}

/**
 * The local record's session generation for `email`, or `undefined` when the
 * email has no local record (a Google-only identity) — the value stamped into a
 * freshly-minted session so a later password change or user removal can revoke
 * it (Track D). A corrupt/unreadable auth store degrades to `undefined` here
 * (mint without `gen`) rather than failing the login that mints it: the
 * request-boundary resolver already fails the whole box closed (503) on an
 * unavailable store, so a gen-less cookie minted during that window is harmless
 * (it re-authenticates once the store heals and a record is found — or stays a
 * valid Google-only identity if none is).
 */
function currentGenForEmail(email: string): number | undefined {
  try {
    return getLocalUser(email)?.gen;
  } catch (e) {
    if (e instanceof AuthStoreUnavailableError) {
      console.warn(
        `[auth] could not read the session generation for ${email} (auth store unavailable); minting without gen:`,
        e,
      );
      return undefined;
    }
    throw e;
  }
}

/**
 * Create a signed session cookie value for the given user. Stamps the local
 * record's current `gen` (Track D) when the email has one, looked up here so
 * BOTH login paths (password POST and Google callback) get it uniformly.
 */
export function signSession(user: SessionUser): string {
  const email = canonicalizeEmail(user.email);
  const gen = currentGenForEmail(email);
  const payload = JSON.stringify({
    email,
    name: user.name,
    ...(user.picture ? { picture: user.picture } : {}),
    ...(gen !== undefined ? { gen } : {}),
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

  // `crypto.timingSafeEqual` THROWS on unequal-length buffers, so a malformed
  // cookie like `bbx_session=e30.x` (valid base64url payload, 1-char signature)
  // would surface as a logged 500 instead of a clean "no session". Compare
  // lengths first — an untrusted, wrong-length signature is simply invalid —
  // then use the timing-safe compare only when the lengths match.
  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const data = JSON.parse(payload);
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    if (typeof data.email !== "string") return null;
    const gen = typeof data.gen === "number" ? data.gen : undefined;
    return {
      email: canonicalizeEmail(data.email),
      name: data.name || data.email,
      picture: data.picture,
      ...(gen !== undefined ? { gen } : {}),
    };
  } catch (_e) {
    // Payload isn't valid JSON — untrusted/tampered cookie, treat as no session.
    return null;
  }
}

/**
 * Extract the authenticated user from a request's session cookie.
 */
export function getSessionUser(request: FastifyRequest): SessionUser | null {
  const cookie = request.cookies[COOKIE_NAME];
  if (!cookie) return null;
  return verifySession(cookie);
}

/**
 * Same as `getSessionUser`, but from a raw `Cookie` header string instead
 * of a `FastifyRequest`'s decorated `.cookies` — for the paths without
 * `@fastify/cookie`'s decoration (see `lib/cookies.ts`).
 */
function getSessionUserFromCookieHeader(cookieHeader: string | undefined): SessionUser | null {
  const cookie = parseCookieHeader(cookieHeader)[COOKIE_NAME];
  if (!cookie) return null;
  return verifySession(cookie);
}

/**
 * Display name for an email from the local-user store, or `null` when there is
 * no record or the store can't be read — the call site degrades to the email.
 * Shared by the chat-send sender lookup and the browse-owner identity rung.
 */
export function localUserName(email: string): string | null {
  try {
    return getLocalUser(email)?.name ?? null;
  } catch (e) {
    if (e instanceof AuthStoreUnavailableError) {
      console.warn(`[auth] could not resolve a display name for ${email} (auth store unavailable); using the email:`, e);
      return null;
    }
    throw e;
  }
}

let loggedAuthStoreUnavailable = false;

/**
 * Get the owner email. `BBX_OWNER_EMAIL` is an override; when it's unset the
 * owner falls back to the local credential store's owner account
 * (`getLocalOwnerEmail`, `local-users.ts`), so the env var becomes optional
 * once a local owner exists.
 *
 * A corrupt/unreadable auth store (`AuthStoreUnavailableError`) degrades to
 * `null` here — owner checks then fail CLOSED to non-owner (`isOwner` → false,
 * `canAccessBox` denies) rather than crashing every unauthenticated code path.
 * The error is logged once. Cookie VERIFICATION at the request boundary needs
 * the sharper, distinct handling Track D adds (`auth-store-unavailable` → 503),
 * because treating a corrupt store as "no record" there would fail OPEN for the
 * very sessions revocation exists to kill; this owner-lookup path is not that.
 */
export function getOwnerEmail(): string | null {
  if (process.env.BBX_OWNER_EMAIL) return canonicalizeEmail(process.env.BBX_OWNER_EMAIL);
  try {
    const localOwner = getLocalOwnerEmail();
    return localOwner ? canonicalizeEmail(localOwner) : null;
  } catch (e) {
    if (e instanceof AuthStoreUnavailableError) {
      if (!loggedAuthStoreUnavailable) {
        console.error("[auth] auth store unavailable while resolving owner email; treating as no owner:", e);
        loggedAuthStoreUnavailable = true;
      }
      return null;
    }
    throw e;
  }
}

/**
 * Where a request's identity came from, or `null` when it's unauthenticated.
 *
 * `"unavailable"` is a DISTINCT fail-closed outcome (Track D): the credential
 * store is corrupt/unreadable, so the cookie's `gen` can't be verified. Every
 * consumer answers `503` for it — NEVER 401 (which would read as "just log in")
 * and never a fall-through to "no record" (which would fail OPEN for exactly the
 * sessions `gen`-revocation exists to kill).
 *
 * `"browse"` is the box-scoped rung `webapp/box-identity.ts` adds on top of this
 * resolver: the machine-wide browse key, on a box whose `config/box.json` says
 * `agentBrowsing: "owner"`. It carries the owner's email, so it is a person for
 * box-scoped purposes — but it is still a machine credential, so a gate over the
 * MACHINE-level secret store must exclude it explicitly (see
 * `docs/plans/secret-custody.md`). `resolveRequestIdentity` itself never returns
 * it.
 */
export type IdentitySource = "hub" | "cookie" | "open" | "unavailable" | "browse" | null;

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
 * headers gated by `BBX_HUB_SECRET` — the session cookie is never
 * consulted, even if one is present. This is deliberate, not an oversight:
 * the session-cookie secret is symmetric (HMAC), so any box that can VERIFY
 * a cookie could also FORGE one for a sibling box, so the hub is the only
 * process that ever holds the session secret, and a hub-mode box authenticates
 * a request purely from the secret-gated header the hub attached after checking
 * the cookie itself.
 *
 * Scope, stated honestly: this closes cross-box *authentication* forgery at the
 * SERVER. It does NOT give boxes browser-level isolation — boxes are path
 * siblings on ONE origin (`/<slug>/…`), so a script in one box can make
 * same-origin requests to another box's API with that box's ambient credentials.
 * We do not claim otherwise. That is acceptable because a beebox instance is
 * SINGLE-OPERATOR: every box on an origin belongs to one operator, running content
 * they or their agents authored — no operator co-hosts a *different* operator's
 * boxes on the same origin (e.g. all of one person's boxes live on their own
 * domain). So cross-box browser isolation is a non-goal, not a gap. If boxes ever
 * render third-party-authored views or are shared between people, revisit
 * (per-box origins or sandboxed content). See `docs/content-security-policy.md`.
 *
 * - Missing/invalid `x-bbx-hub-secret` -> unauthenticated (`source: null`).
 *   Fails closed; a hub-mode box NEVER falls back to cookie verification —
 *   that fallback would reopen exactly the forgery hole above.
 * - Valid secret + `x-bbx-authenticated-email` present -> `source: "hub"`.
 * - Valid secret + no email header, but `x-bbx-hub-auth: off` -> `source:
 *   "open"` (the hub itself has no `GOOGLE_OAUTH_CLIENT_ID` configured, so
 *   there is no login and no identity fleet-wide — same semantics as
 *   today's single-box "auth disabled" mode).
 * - Valid secret, no email header, no `off` flag -> unauthenticated. This
 *   shouldn't happen from a well-behaved hub; treated as a fail-closed 401,
 *   not silently "open."
 *
 * Outside hub mode, the session cookie is the primary source (`source:
 * "cookie"` when present), and the hub headers are IGNORED even if somehow
 * present on the request — trusting them outside hub mode is exactly the
 * spoofing hole this design closes. When there is no cookie and the server was
 * constructed with `openAccess: true` (the in-process test seam that replaced
 * the `BBX_ALLOW_UNAUTHENTICATED` opt-out), the resolver returns `source:
 * "open"` — the always-on-auth plan's consolidation of the scattered
 * "auth disabled ⇒ open" recomputation into this one resolver. `openAccess` is
 * the caller's per-instance flag (`request.server.openAccess` / the registering
 * instance), never read from the environment.
 */
export function resolveRequestIdentity(
  request: IdentityRequest,
  { openAccess }: { openAccess: boolean },
): RequestIdentity {
  if (isHubMode()) {
    if (!verifyHubSecret(request)) return { email: null, name: null, source: null };
    const emailHeader = request.headers[HUB_EMAIL_HEADER];
    if (typeof emailHeader === "string" && emailHeader.length > 0) {
      const email = canonicalizeEmail(emailHeader);
      return { email, name: email, source: "hub" };
    }
    if (request.headers[HUB_AUTH_OFF_HEADER] === "off") {
      return { email: null, name: null, source: "open" };
    }
    return { email: null, name: null, source: null };
  }
  const user = sessionUserFromRequest(request);
  if (user) return classifyLocalRecord(user);
  // Open access (the `openAccess` construction option): no cookie and no wall,
  // so identity is "open" — the SAME source hub mode returns when the hub
  // advertises `x-bbx-hub-auth: off`. This is the ONE place openness is decided;
  // the openness-recomputing call sites read `identity.source` instead of
  // re-deriving it (principle #8: one way to do each thing).
  if (openAccess) return { email: null, name: null, source: "open" };
  return { email: null, name: null, source: null };
}

/**
 * Read the session cookie for the identity resolver. Prefers `@fastify/cookie`'s
 * decorated `request.cookies`; when that decoration is absent (the tRPC WS
 * upgrade's raw `IncomingMessage`) it parses the raw `Cookie` header instead, so
 * a cookie-authenticated WS keeps its identity at context creation (Track D).
 */
function sessionUserFromRequest(request: IdentityRequest): SessionUser | null {
  const cookies = request.cookies;
  if (cookies !== undefined) {
    const cookie = cookies[COOKIE_NAME];
    return cookie ? verifySession(cookie) : null;
  }
  return getSessionUserFromCookieHeader(request.headers.cookie);
}

let loggedResolverAuthStoreUnavailable = false;

/**
 * Apply the `gen` session-revocation rules to a verified cookie identity
 * (Track D). The single, consistent rule set:
 *
 * - a local record exists → the cookie MUST carry `gen === record.gen`; absent
 *   or stale (a pre-password-change cookie) → revoked → unauthenticated;
 * - no record, but the cookie carries a `gen` → dead (its record vanished — this
 *   is how removing a local user revokes its sessions) → unauthenticated;
 * - no record, no `gen` → valid Google-only identity (`canAccessBox` still gates
 *   authorization).
 *
 * A corrupt/unreadable store fails closed DISTINCTLY as `source: "unavailable"`
 * (→ 503), never as "no record" (which would fail OPEN for revoked sessions).
 */
function classifyLocalRecord(user: SessionUser): RequestIdentity {
  let record;
  try {
    record = getLocalUserCached(user.email);
  } catch (e) {
    if (e instanceof AuthStoreUnavailableError) {
      if (!loggedResolverAuthStoreUnavailable) {
        console.error("[auth] auth store unavailable while verifying a session cookie; failing closed (503):", e);
        loggedResolverAuthStoreUnavailable = true;
      }
      return { email: null, name: null, source: "unavailable" };
    }
    throw e;
  }
  if (record) {
    if (user.gen !== record.gen) return { email: null, name: null, source: null };
    return { email: user.email, name: user.name, source: "cookie" };
  }
  if (user.gen !== undefined) return { email: null, name: null, source: null };
  return { email: user.email, name: user.name, source: "cookie" };
}

export { COOKIE_NAME, SESSION_MAX_AGE_MS };
