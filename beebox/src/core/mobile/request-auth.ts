/**
 * The single place that decides whether a request carries valid mobile-device
 * auth. Every mobile gate — the box's auth preHandler, the tRPC context, the
 * SPA fallback, `/api/boxes`, and the hub's proxy and WS-upgrade gates — goes
 * through here, so none of them can drift from the others.
 *
 * This replaces three verbatim copies of a `?mobileToken=` URL parser that
 * previously lived in `hub/hub-server.ts`, `webapp/server-box-scope.ts`, and
 * `webapp/server-root.ts`. The durable device token no longer travels in a URL
 * at all — see `mobile-session.ts` for why, and `docs/mobile-contract.md` §2
 * for the carriers that remain.
 *
 * Two credentials are accepted, and they are not interchangeable:
 *
 * - `Authorization: Bearer <deviceToken>` — the durable token. Native API
 *   calls and the initial webview navigation use it. Verifying it reads AND
 *   writes the device store (`lastUsedAt`), so it is the cold path.
 * - `Cookie: bbx_mobile=<signed>` — the short-lived session. Browser
 *   navigations and WebSocket upgrades use it, because the browser `WebSocket`
 *   API cannot set headers. Verifying it is pure HMAC, so it is the hot path.
 */

import { verifyMobileSession, MOBILE_COOKIE_NAME } from "./mobile-session.js";
import { resolveMobileBearerIdentity, type MobileBearerIdentity } from "./pairing.js";
import { parseCookieHeaderAll } from "../../lib/cookies.js";

/** The credential a request authenticated with, for the caller that cares. */
export type MobileAuthSource = "bearer" | "cookie";

export interface MobileRequestAuth extends MobileBearerIdentity {
  source: MobileAuthSource;
  /** Cookie expiry (epoch ms), or null on the bearer path. Drives renewal. */
  expiresAt: number | null;
}

/** Headers a mobile gate needs, in the shape both Fastify and raw Node give. */
export interface MobileAuthHeaders {
  authorization?: string | string[] | undefined;
  cookie?: string | string[] | undefined;
}

/** Node gives repeated headers as arrays; only a single value can be a credential. */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Resolve a request's mobile identity, or null if it carries none.
 *
 * The cookie is checked first: it is the hot path, and checking it first
 * avoids the device-store read/write that bearer verification performs on
 * every call.
 */
export async function resolveMobileRequestAuth(
  boxRoot: string,
  headers: MobileAuthHeaders,
): Promise<MobileRequestAuth | null> {
  // Try EVERY bbx_mobile value, not just the first. Boxes are path siblings on
  // one origin, so a script under box A can set `bbx_mobile=junk; Path=/` and
  // that value rides alongside box B's real cookie on requests to B. Checking
  // only one would let any box deny service to its siblings. It cannot let one
  // box authenticate as another: the signature is per-box.
  const cookies = parseCookieHeaderAll(single(headers.cookie));
  for (const value of cookies[MOBILE_COOKIE_NAME] ?? []) {
    const session = verifyMobileSession(boxRoot, value);
    if (session) {
      return {
        deviceId: session.deviceId,
        createdBy: session.createdBy,
        source: "cookie",
        expiresAt: session.exp,
      };
    }
  }

  const bearer = await resolveMobileBearerIdentity(boxRoot, single(headers.authorization));
  if (bearer) return { ...bearer, source: "bearer", expiresAt: null };

  return null;
}

/** Boolean form, for the gates that only need yes/no. */
export async function verifyMobileRequest(boxRoot: string, headers: MobileAuthHeaders): Promise<boolean> {
  return (await resolveMobileRequestAuth(boxRoot, headers)) !== null;
}
