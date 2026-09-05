/**
 * Issuing the `bbx_mobile` cookie.
 *
 * Kept separate from `core/mobile/mobile-session.ts` (which is pure crypto,
 * usable by the hub) because setting a cookie needs a Fastify reply and the
 * box's public URL.
 */

import type { FastifyReply } from "fastify";
import { MOBILE_COOKIE_NAME, MOBILE_SESSION_TTL_MS, signMobileSession } from "../core/mobile/mobile-session.js";
import { isMobileDeviceActive, type MobileBearerIdentity } from "../core/mobile/pairing.js";
import type { MobileRequestAuth } from "../core/mobile/request-auth.js";
import { getPublicUrl } from "../lib/public-url.js";

/**
 * Attach a freshly-minted `bbx_mobile` to a reply.
 *
 * `secure` is decided from the box's public URL, matching `routes/auth.ts`'s
 * `bbx_mobile` rather than inventing a second rule. Deciding it from the
 * REQUEST's protocol would be wrong behind the hub: the browser speaks HTTPS
 * to the hub, which proxies to the box over plain HTTP, so a per-request check
 * would omit `Secure` in production and let the cookie ride an HTTP downgrade.
 *
 * `path` scopes the cookie to the one box that can verify it, so a browser
 * holding cookies for several boxes never offers one box's cookie to another.
 */
export function setMobileSessionCookie(
  reply: FastifyReply,
  opts: { boxRoot: string; boxSlug: string; identity: MobileBearerIdentity },
): void {
  const value = signMobileSession(opts.boxRoot, {
    deviceId: opts.identity.deviceId,
    createdBy: opts.identity.createdBy,
    ttlMs: MOBILE_SESSION_TTL_MS,
  });
  reply.setCookie(MOBILE_COOKIE_NAME, value, {
    path: `/${opts.boxSlug}`,
    httpOnly: true,
    secure: getPublicUrl("http://localhost").startsWith("https"),
    sameSite: "lax",
    maxAge: MOBILE_SESSION_TTL_MS / 1000,
  });
}

/**
 * Renew a mobile session cookie when it's worth renewing.
 *
 * The whole point of a short TTL is that a revoked device loses access within
 * one TTL. That only holds if renewal re-checks revocation — a cookie renewed
 * purely from itself would live forever and revocation would never take
 * effect. So renewal reads the device store.
 *
 * To keep that read off the hot path it only happens past the cookie's
 * halfway point, so an active session costs at most one store read per half
 * TTL rather than one per request. A bearer-authenticated request always
 * (re)issues, because verifying the bearer already read the store.
 *
 * A revoked device is not merely denied a new cookie — its existing one is
 * cleared, so it fails closed at once on this box rather than lingering for
 * the remainder of its TTL.
 */
export function renewMobileSessionCookie(
  reply: FastifyReply,
  opts: { boxRoot: string; boxSlug: string; auth: MobileRequestAuth },
): void {
  const { boxRoot, boxSlug, auth } = opts;
  if (auth.source === "bearer") {
    setMobileSessionCookie(reply, { boxRoot, boxSlug, identity: auth });
    return;
  }
  if (auth.expiresAt !== null && auth.expiresAt - Date.now() > MOBILE_SESSION_TTL_MS / 2) return;
  if (!isMobileDeviceActive(boxRoot, auth.deviceId)) {
    reply.clearCookie(MOBILE_COOKIE_NAME, { path: `/${boxSlug}` });
    return;
  }
  setMobileSessionCookie(reply, { boxRoot, boxSlug, identity: auth });
}
