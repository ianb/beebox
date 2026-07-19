/**
 * Short-lived, box-scoped mobile session cookie (`cb_mobile`).
 *
 * A paired mobile device authenticates with its durable device token (see
 * `pairing.ts`) in an `Authorization: Bearer` header. That token must never
 * appear in a URL — it does not expire, so a copy captured from an access log,
 * a `Referer`, or WebKit history is replayable until someone manually revokes
 * the device. This module issues a short-lived credential that CAN ride a URL-
 * adjacent channel safely: a signed cookie the browser attaches to navigations
 * and — the reason this exists at all — to WebSocket upgrades, which the
 * browser `WebSocket` API cannot attach headers to.
 *
 * Deliberately NOT signed with `CB_SESSION_SECRET`. `webapp/auth.ts`'s
 * `resolveRequestIdentity` explains why a box may never hold that secret: it is
 * symmetric, so a box that can verify a session cookie could forge one for a
 * sibling box. This cookie's secret is per-box, so forging it only ever grants
 * access to the box that already owns the secret — no cross-box escalation
 * exists to prevent.
 *
 * Verification is pure HMAC with no filesystem access, which is what makes it
 * affordable on every request and at the hub's proxy gate. The trade is that a
 * signed cookie cannot be revoked before it expires: `MOBILE_SESSION_TTL_MS`
 * bounds how long a revoked device keeps a live session. Renewal re-checks the
 * device store, so a revoked device stops renewing at once and is locked out
 * within one TTL.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../../lib/error-guards.js";

/** Cookie name. Mirrored in `docs/mobile-contract.md` §8 (mirrored constants). */
export const MOBILE_COOKIE_NAME = "cb_mobile";

/**
 * One hour. Short enough to bound revocation latency to something a boxholder
 * would accept, long enough that renewal is not chatty. Renewal happens on
 * every authenticated response, so an actively-used session never expires
 * out from under the user.
 */
export const MOBILE_SESSION_TTL_MS = 60 * 60 * 1000;

const SECRET_RELATIVE_PATH = ".callback-box/mobile-session.secret";
const SECRET_BYTES = 32;

/**
 * The signed payload. It carries the WHOLE of `MobileBearerIdentity`, not just
 * `deviceId`, so a cookie-authenticated request resolves to exactly the
 * identity a bearer-authenticated one does.
 *
 * `createdBy` is load-bearing, not decoration: `webapp/capture-request-owner.ts`
 * uses it as the authenticated email for capture-session ownership, which is
 * what enforces cross-user isolation (`core/capture/pending.ts` X4). A cookie
 * that dropped it would silently downgrade that check for any gate that
 * later moved from the bearer path to the shared resolver.
 */
const MobileSessionSchema = z.object({
  deviceId: z.string().min(1),
  createdBy: z.string().nullable(),
  exp: z.number(),
});
export type MobileSession = z.infer<typeof MobileSessionSchema>;

/** Per-box secret, cached per box root — the file is read once per process. */
const secretCache = new Map<string, string>();

function secretPath(boxRoot: string): string {
  return path.join(boxRoot, SECRET_RELATIVE_PATH);
}

/**
 * Read the box's cookie-signing secret, or null if it doesn't exist yet.
 *
 * Read-only on purpose. Two separate processes verify these cookies — the box
 * and the hub — with separate caches and no way to invalidate each other's. If
 * verification could generate a secret, whichever process first saw a missing
 * or unreadable file would mint a new one and cache it, while the other kept
 * signing with the old value: every cookie would then verify in one process and
 * fail in the other, indefinitely and silently. Only `signMobileSession`
 * creates (see `getOrCreateSecret`), and only the box ever signs.
 */
function readSecret(boxRoot: string): string | null {
  const cached = secretCache.get(boxRoot);
  if (cached !== undefined) return cached;

  const file = secretPath(boxRoot);
  try {
    const secret = fs.readFileSync(file, "utf-8").trim();
    if (secret.length > 0) {
      secretCache.set(boxRoot, secret);
      return secret;
    }
    // An empty secret file would sign everything with "" — treat it as absent
    // rather than issuing forgeable cookies.
    console.warn(`[mobile-session] empty secret file at ${file}`);
    return null;
  } catch (e) {
    // Missing file is the normal first-run case: nothing has minted yet, so
    // there is nothing to verify either. Anything else (permissions,
    // corruption) is worth a human's attention.
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`[mobile-session] failed to read secret at ${file}:`, e);
    }
    return null;
  }
}

/**
 * The signing path's secret, created on first mint.
 *
 * Creating invalidates nothing, because a secret is only ever created when
 * none was readable — no live cookie could have been signed with one.
 */
function getOrCreateSecret(boxRoot: string): string {
  const existing = readSecret(boxRoot);
  if (existing !== null) return existing;

  const file = secretPath(boxRoot);
  const generated = crypto.randomBytes(SECRET_BYTES).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, generated, { mode: 0o600 });
  secretCache.set(boxRoot, generated);
  return generated;
}

/** The signature this box would produce for a payload, or null if it has no secret. */
function expectedSignature(boxRoot: string, payload: string): string | null {
  const key = readSecret(boxRoot);
  if (key === null) return null;
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}

/**
 * Compare two hex signatures without leaking their contents through timing.
 * `crypto.timingSafeEqual` THROWS on a length mismatch, so the length check
 * must come first — an attacker-supplied cookie controls this length.
 */
function signaturesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Mint a cookie value for a device. The caller decides the cookie attributes. */
export function signMobileSession(
  boxRoot: string,
  opts: { deviceId: string; createdBy: string | null; ttlMs: number },
): string {
  const payload = JSON.stringify({
    deviceId: opts.deviceId,
    createdBy: opts.createdBy,
    exp: Date.now() + opts.ttlMs,
  });
  const signature = crypto
    .createHmac("sha256", getOrCreateSecret(boxRoot))
    .update(payload)
    .digest("hex");
  return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}

/**
 * Verify a `cb_mobile` cookie value. Returns null — never throws — for every
 * failure: absent, malformed, tampered, signed by another box, or expired.
 * The whole input is untrusted, so every step fails closed.
 */
export function verifyMobileSession(boxRoot: string, cookie: string | undefined): MobileSession | null {
  if (typeof cookie !== "string" || cookie.length === 0) return null;

  const dotIndex = cookie.indexOf(".");
  if (dotIndex === -1) return null;
  const payloadB64 = cookie.slice(0, dotIndex);
  const signature = cookie.slice(dotIndex + 1);

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf-8");
  } catch (_e) {
    // Undecodable base64url — garbage or a tampered cookie.
    return null;
  }

  // Null means no secret exists for this box — nothing has ever been minted,
  // so no cookie could legitimately verify. Fail closed rather than create one
  // (see readSecret).
  const expected = expectedSignature(boxRoot, payload);
  if (expected === null) return null;
  if (!signaturesEqual(signature, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (_e) {
    // Signature-valid but non-JSON is impossible for anything we minted; treat
    // it as hostile rather than assuming our own writer produced it.
    return null;
  }

  const result = MobileSessionSchema.safeParse(parsed);
  if (!result.success) return null;
  // `<=`, not `<`: a cookie whose `exp` is exactly now has no validity left.
  // With `<` a zero-TTL cookie verifies for up to a millisecond after minting,
  // which is the fail-open direction on the one comparison that bounds
  // revocation latency.
  if (result.data.exp <= Date.now()) return null;
  return result.data;
}

/** Test seam: drop cached secrets so a doctest can swap box roots in-process. */
export function clearMobileSessionSecretCache(): void {
  secretCache.clear();
}
