/**
 * Short-lived, box-scoped mobile session cookie (`bbx_mobile`).
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
 * Deliberately NOT signed with `BBX_SESSION_SECRET`. `webapp/auth.ts`'s
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
 *
 * On a unit host (docs/implemented-plans/per-box-units.md, question 7) the hub runs
 * outside every box and cannot read the file secret, so the key is DERIVED
 * instead: HKDF over the per-box, per-boot hub secret the box receives as a
 * systemd credential (`BBX_HUB_SECRET` with `BBX_UNIT_HOST=1`), which the hub
 * holds for that box and no sibling knows. Both sides derive the same key and
 * the hub refuses a junk cookie without waking the box. The secret changes at
 * reboot, so cookies die with it; the device re-mints one from its bearer.
 * No file is written on that host. A spawning hub shares one secret across
 * its children, so there the per-box file stays the key.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../../shared/error-guards.js";
import { serverSecret } from "../../lib/server-secrets.js";

/** Cookie name. Mirrored in `docs/mobile-contract.md` §8 (mirrored constants). */
export const MOBILE_COOKIE_NAME = "bbx_mobile";

/**
 * One hour. Short enough to bound revocation latency to something a boxholder
 * would accept, long enough that renewal is not chatty. Renewal happens on
 * every authenticated response, so an actively-used session never expires
 * out from under the user.
 */
export const MOBILE_SESSION_TTL_MS = 60 * 60 * 1000;

const SECRET_RELATIVE_PATH = ".beebox/mobile-session.secret";
const SECRET_BYTES = 32;

/**
 * The signed payload. It carries the WHOLE of `MobileBearerIdentity`, not just
 * `deviceId`, so a cookie-authenticated request resolves to exactly the
 * identity a bearer-authenticated one does.
 *
 * `createdBy` is load-bearing, not decoration: `webapp/routes/capture-request-owner.ts`
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

/** HKDF context for the unit-host key: changing it invalidates every live cookie on such a host. */
const UNIT_HOST_KEY_INFO = "beebox mobile session v1";
const derivedKeys = new Map<string, string>();

/** The cookie key a unit host derives from a box's hub secret; the hub and the box both call this. */
export function deriveMobileSessionKey(hubSecret: string): string {
  const cached = derivedKeys.get(hubSecret);
  if (cached !== undefined) return cached;
  const key = Buffer.from(crypto.hkdfSync("sha256", hubSecret, "", UNIT_HOST_KEY_INFO, SECRET_BYTES)).toString("hex");
  derivedKeys.set(hubSecret, key);
  return key;
}

/** The derived key when this process is a box unit on a unit host; null elsewhere. */
function unitHostKey(): string | null {
  if (process.env.BBX_UNIT_HOST !== "1") return null;
  const hubSecret = serverSecret("BBX_HUB_SECRET");
  if (!hubSecret) return null;
  return deriveMobileSessionKey(hubSecret);
}

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
  const derived = unitHostKey();
  if (derived !== null) return derived;
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

function signature(key: string, payload: string): string {
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
  return `${Buffer.from(payload).toString("base64url")}.${signature(getOrCreateSecret(boxRoot), payload)}`;
}

/**
 * Verify a `bbx_mobile` cookie value. Returns null — never throws — for every
 * failure: absent, malformed, tampered, signed by another box, or expired.
 * The whole input is untrusted, so every step fails closed.
 */
export function verifyMobileSession(boxRoot: string, cookie: string | undefined): MobileSession | null {
  return verifyMobileSessionWithKey(readSecret(boxRoot), cookie);
}

/**
 * The same check against a key the caller holds: the hub on a unit host,
 * with the key it derives from the box's hub secret. A null key (a box that
 * has never minted) verifies nothing.
 */
export function verifyMobileSessionWithKey(key: string | null, cookie: string | undefined): MobileSession | null {
  if (typeof cookie !== "string" || cookie.length === 0) return null;

  const dotIndex = cookie.indexOf(".");
  if (dotIndex === -1) return null;
  const payloadB64 = cookie.slice(0, dotIndex);
  const presented = cookie.slice(dotIndex + 1);

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
  if (key === null) return null;
  if (!signaturesEqual(presented, signature(key, payload))) return null;

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

/** Test seam: drop cached secrets so a test can swap box roots in-process. */
export function clearMobileSessionSecretCache(): void {
  secretCache.clear();
  derivedKeys.clear();
}
