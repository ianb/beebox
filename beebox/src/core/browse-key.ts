/**
 * The local-dev browser API key (`BBX_BROWSE_API_KEY`).
 *
 * An agent driving a real browser (`bin/browse`) has no way to log in: there
 * is no password it may hold, and the box's other credentials don't fit —
 * the per-box agent loopback token (`core/agent/token.ts`) is a 0600 file
 * secret for subprocesses calling their own box, and teaching the public
 * front door to accept it would promote a file secret into a network
 * credential on every deployment.
 *
 * So this is a deliberate, operator-set key in the mould of
 * `BBX_DIAG_API_KEY` (`webapp/auth.ts`) — with one difference: the diag key is
 * whitelisted down to two read-only procedures, while this one is full
 * access, because a browser has to load the whole app.
 *
 * **Scope: the whole machine, not one box.** There is no box parameter here on
 * purpose — one dev router fronts every worktree and every box, so its gate has
 * exactly one key to compare against. A holder of this key reaches every box
 * the router serves, the hub's box list, and the worktree's Vite dev assets
 * (`@fs` included). Do not read it as a per-box credential the way the agent
 * token or a mobile device token is.
 *
 * The property that makes that acceptable is that it is **opt-in and absent by
 * default**: with `BBX_BROWSE_API_KEY` unset, every function here returns false
 * and nothing changes anywhere. It is meant for a local dev machine. Setting
 * it on a publicly-reachable deployment hands whoever holds it the whole
 * fleet, so don't, unless that is exactly what you want.
 *
 * **What the key means inside a box is the box's call.** By default it clears
 * the auth wall and is nobody — `authed`, never a `user`. A box built for
 * agent-driven browsing declares `agentBrowsing: "owner"` in its
 * `config/box.json`, and inside that box the key resolves to the owner's
 * identity (`webapp/box-identity.ts`). A box that never said so keeps the
 * fence, so a machine-wide key does not silently become a person on a box
 * somebody actually uses.
 *
 * Accepted from a bearer header OR a cookie. The cookie is what a browser
 * needs: it rides every request to the origin including the WebSocket
 * upgrade, which an `Authorization` header does not. The header form is for
 * `curl` probes and other non-browser callers.
 *
 * Header-based (not Fastify-typed) so the three gates that need it can share
 * one implementation: the box's own wall (`webapp/server-box-scope.ts`), the
 * hub (`hub/hub-server.ts`, both its HTTP and upgrade paths), and the dev
 * router (`workstreams-app/src/router/router-auth-deps.ts`).
 */

import * as crypto from "node:crypto";
import { parseCookieHeaderAll } from "../lib/cookies.js";

/** The cookie `bin/browse` installs so subresources and the WS carry the key. */
export const BROWSE_KEY_COOKIE = "bbx_browse_key";

/** Headers a browse-key check needs, in the shape Fastify and raw Node share. */
export interface BrowseKeyHeaders {
  authorization?: string | string[] | undefined;
  cookie?: string | string[] | undefined;
}

/** Node gives repeated headers as arrays; only a single value can be a credential. */
function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Constant-time compare against the configured key.
 *
 * Lengths are compared as BYTES, not as JS string length: `timingSafeEqual`
 * throws on a length mismatch, and for a non-ASCII key equal character length
 * does not mean equal byte length — comparing `.length` would let a same-
 * character-length ASCII value reach `timingSafeEqual` and throw out of an
 * auth check. Encoding first and comparing `byteLength` cannot. The length
 * check leaks only the length, not the contents.
 */
function matchesKey(supplied: string, key: string): boolean {
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(key, "utf8");
  if (a.byteLength !== b.byteLength) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Does this request carry the configured browse key?
 *
 * False whenever `BBX_BROWSE_API_KEY` is unset — the fail-closed default, and
 * the case that must never regress.
 *
 * Every value sent under the cookie name is checked, not just the first:
 * boxes are path siblings on one origin, so a browser can send several
 * `cb_browse_key` entries (one per matching path) and the one we want is not
 * reliably first. Same reasoning as the mobile cookie's use of
 * `parseCookieHeaderAll`.
 */
export function verifyBrowseKey(headers: BrowseKeyHeaders): boolean {
  const key = process.env.BBX_BROWSE_API_KEY;
  if (!key) return false;

  const auth = single(headers.authorization);
  if (auth !== undefined && auth.startsWith("Bearer ") && matchesKey(auth.slice("Bearer ".length), key)) {
    return true;
  }

  const cookies = parseCookieHeaderAll(single(headers.cookie))[BROWSE_KEY_COOKIE] ?? [];
  return cookies.some((value) => matchesKey(value, key));
}
