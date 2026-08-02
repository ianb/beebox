/**
 * The hub's half of scan-upload-token enforcement.
 *
 * Scan tokens are verified independently at BOTH boundaries — here against the
 * target box's store file on disk (the same file the child reads), and again in
 * the child's own route preHandler (`webapp/scan-auth.ts`). Neither process
 * trusts the other (`docs/engineering-principles.md` #3: validate at
 * boundaries — both boundaries).
 *
 * The hub adds one restriction the child cannot: the PATH. A scan token
 * authorizes `/<slug>/api/scan/…` and nothing else, so a scan bearer aimed
 * anywhere else never gets past this gate — it doesn't reach the child, doesn't
 * cold-start a lazy box, and never earns hub-injected identity headers.
 */

import type http from "node:http";
import { resolveScanRequestAuth } from "../core/scan/tokens.js";

/**
 * The two paths the contract defines, and nothing else — not the `/api/scan/`
 * subtree, not a trailing-slash variant, not a subpath below either. A scan
 * token's whole point is that it reaches exactly the surface it was minted for,
 * so anything the contract does not name is somebody else's protected route.
 * The hash is matched in its documented form (64 lowercase hex); a malformed one
 * never needs a box woken to be told it is malformed.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 */
const SCAN_PATHS = /^\/api\/scan\/(?:check|files\/[\da-f]{64})$/u;

/**
 * Is this the scan upload surface of the box that owns `slug`? The hub does no
 * prefix stripping, so a box's `/api/scan/…` routes live at `/<slug>/api/scan/…`.
 */
function isScanPath(reqPath: string, slug: string): boolean {
  const prefix = `/${slug}`;
  if (!reqPath.startsWith(`${prefix}/`)) return false;
  return SCAN_PATHS.test(reqPath.slice(prefix.length));
}

/**
 * Shape-only matcher for a box-relative scan-upload subpath (`/api/scan/check`
 * or `/api/scan/files/<64-hex>`), for callers that gate on path shape and
 * delegate bearer verification downstream — the dev router's auth wall
 * (`bin/router-auth.ts`) uses this the way it reuses `isPairingRedeemUrl`:
 * the request is forwarded, and this hub gate plus the child's scan-auth
 * preHandler still independently verify the token.
 */
export function isScanUploadSubpath(subpath: string): boolean {
  return SCAN_PATHS.test(subpath);
}

/**
 * Does this request carry a scan-upload token the named box accepts, ON a scan
 * path? The path check comes first, so a valid scan bearer on any other path
 * answers false and falls through to the hub's normal wall (a 401 for API
 * paths). WS upgrades deliberately never call this: scan tokens cannot open a
 * WebSocket.
 */
export async function hasScanAuth(opts: {
  boxRoot: string | undefined;
  headers: http.IncomingHttpHeaders;
  reqPath: string;
  slug: string;
}): Promise<boolean> {
  if (!isScanPath(opts.reqPath, opts.slug)) return false;
  if (opts.boxRoot === undefined) return false;
  return (await resolveScanRequestAuth(opts.boxRoot, opts.headers)) !== null;
}
