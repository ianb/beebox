/**
 * The box browser pass: a short-lived signed cookie that lets the box's own
 * browser (`bbx browser`, `bbx view look`) open the box's own pages with the
 * agent's authority (docs/plans/agent-self-view.md, Track A).
 *
 * It proves "the box browser of this box, until `exp`": the key is per box
 * (the per-box secret file, or on a unit host the per-box hub secret), so the
 * signature alone binds it to one box and the payload needs no box name. A request it
 * admits is actor `agent` with no user: a verified pass wins over any person
 * credential on the same request, so a login the person left in the shared
 * browser never lends the agent the owner's authority.
 *
 * Signed like the mobile cookie (`core/mobile/session.ts`): HMAC with a key the
 * box and the hub both hold. The pass key is an HKDF subkey of that cookie key,
 * so a mobile cookie never verifies as a pass and a pass never as a mobile
 * cookie. Verification is pure, with no filesystem access beyond the cached
 * key read.
 *
 * Two checks gate every use, in this order: `passSiteOk` (the request came from
 * the box's own pages or a typed navigation, not another site; `SameSite`
 * alone admits same-site pages on sibling subdomains), then the signature.
 */

import * as crypto from "node:crypto";
import { z } from "zod";
import { parseCookieHeaderAll } from "../../lib/cookies.js";
import { boxCookieSigningKey, boxCookieVerifyKey, deriveMobileSessionKey } from "../mobile/session.js";

export const BROWSER_PASS_COOKIE = "bbx_browser_pass";
/** One hour: the life of a leaked value. The engine refreshes well before it. */
export const BROWSER_PASS_TTL_MS = 60 * 60 * 1000;

/** HKDF context; changing it invalidates every live pass. */
const PASS_KEY_INFO = "beebox box browser pass v1";
const PASS_KEY_BYTES = 32;

const PassPayload = z.strictObject({
  exp: z.number().int(),
});

/** Headers in the shape Fastify and raw Node share. */
export interface PassHeaders {
  cookie?: string | string[] | undefined;
  origin?: string | string[] | undefined;
  upgrade?: string | string[] | undefined;
  "sec-fetch-site"?: string | string[] | undefined;
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The pass key under a box's cookie key. */
function passKey(cookieKey: string): string {
  return Buffer.from(crypto.hkdfSync("sha256", cookieKey, "", PASS_KEY_INFO, PASS_KEY_BYTES)).toString("hex");
}

/** The pass key the hub on a unit host derives from a box's hub secret. */
export function passKeyFromHubSecret(hubSecret: string): string | null {
  if (hubSecret.length === 0) return null;
  return passKey(deriveMobileSessionKey(hubSecret));
}

function signature(key: string, payload: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}

/** A SHA-256 HMAC in hex; anything else is refused before comparing. */
const HEX_SIGNATURE = /^[\da-f]{64}$/;

function signaturesEqual(a: string, b: string): boolean {
  // Lengths in characters can match while bytes differ (`é` is two bytes), and
  // `timingSafeEqual` throws on unequal byte lengths: check the format first.
  if (!HEX_SIGNATURE.test(a) || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Mint a pass for this box. The caller sets the cookie. */
export function signBrowserPass(boxRoot: string, opts: { ttlMs: number; now: number }): { value: string; exp: number } {
  const key = passKey(boxCookieSigningKey(boxRoot));
  const exp = opts.now + opts.ttlMs;
  const payload = JSON.stringify({ exp });
  return { value: `${Buffer.from(payload).toString("base64url")}.${signature(key, payload)}`, exp };
}

/** Does this one cookie value verify as a live pass under `key`? Never throws. */
export function passValueValid(key: string | null, pass: { value: string; now: number }): boolean {
  if (key === null) return false;
  const { value, now } = pass;
  const dot = value.indexOf(".");
  if (dot === -1) return false;
  const payload = Buffer.from(value.slice(0, dot), "base64url").toString("utf-8");
  if (!signaturesEqual(value.slice(dot + 1), signature(key, payload))) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (_e) {
    // Signature-valid non-JSON cannot come from signBrowserPass; refuse it.
    return false;
  }
  const result = PassPayload.safeParse(parsed);
  // `<=`: a pass whose `exp` is exactly now has no validity left.
  return result.success && result.data.exp > now;
}

/**
 * Was this request made by the box's own pages, or by a typed navigation?
 *
 * `same-origin` and `none` (the agent's `open`) pass; `same-site` and
 * `cross-site` refuse. Chrome sends no fetch metadata on a WebSocket
 * handshake, so an unlabelled upgrade passes only when its `Origin` is the
 * app's. Any other unlabelled request refuses: the pass lives only in Chrome,
 * which always labels its requests.
 */
export function passSiteOk(headers: PassHeaders, appOrigin: string | null): boolean {
  const site = single(headers["sec-fetch-site"]);
  if (site !== undefined) return site === "same-origin" || site === "none";
  const isUpgrade = (single(headers.upgrade) ?? "").toLowerCase() === "websocket";
  return isUpgrade && appOrigin !== null && single(headers.origin) === appOrigin;
}

/**
 * Does the request carry a live pass for this key, from an allowed site?
 * Every value under the cookie name is tried: a browser can send several.
 */
export function verifyBrowserPassWithKey(key: string | null, opts: { appOrigin: string | null; headers: PassHeaders; now: number }): boolean {
  const values = parseCookieHeaderAll(single(opts.headers.cookie))[BROWSER_PASS_COOKIE] ?? [];
  if (values.length === 0) return false;
  if (!passSiteOk(opts.headers, opts.appOrigin)) return false;
  return values.some((value) => passValueValid(key, { value, now: opts.now }));
}

/** The pass key read from the box's own cookie secret; null when the box never minted one. */
export function boxPassVerifyKey(boxRoot: string): string | null {
  const cookieKey = boxCookieVerifyKey(boxRoot);
  return cookieKey === null ? null : passKey(cookieKey);
}

/** The box's and the dev router's check, with the key read from the box. */
export function verifyBrowserPass(boxRoot: string, opts: { appOrigin: string | null; headers: PassHeaders; now?: number }): boolean {
  return verifyBrowserPassWithKey(boxPassVerifyKey(boxRoot), {
    appOrigin: opts.appOrigin,
    headers: opts.headers,
    now: opts.now ?? Date.now(),
  });
}

/**
 * A `Cookie` header with every pass value that `keep` refuses removed; the
 * hub forwards only the target box's own pass. Undefined when nothing is left.
 */
export function stripForeignBrowserPasses(cookieHeader: string | undefined, keep: (value: string) => boolean): string | undefined {
  if (cookieHeader === undefined) return undefined;
  const parts = cookieHeader.split(";").filter((part) => {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== BROWSER_PASS_COOKIE) return true;
    return keep(part.slice(eq + 1).trim());
  });
  const joined = parts.map((part) => part.trim()).filter((part) => part !== "").join("; ");
  return joined === "" ? undefined : joined;
}
