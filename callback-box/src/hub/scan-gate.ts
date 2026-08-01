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
 * Is this the scan upload surface of the box that owns `slug`? The hub does no
 * prefix stripping, so a box's `/api/scan/…` routes live at `/<slug>/api/scan/…`.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 */
function isScanPath(reqPath: string, slug: string): boolean {
  const prefix = `/${slug}/api/scan`;
  return reqPath === prefix || reqPath.startsWith(`${prefix}/`);
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
