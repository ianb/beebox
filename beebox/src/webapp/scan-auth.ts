/**
 * The auth gate for the scan upload routes (`/api/scan/…`, Track 2).
 *
 * Two credentials, and nothing else, reach these routes:
 *
 * - `Authorization: Bearer <scan-token>` — the uploader's dedicated credential,
 *   verified against the box's OWN scan-token store (`core/scan/tokens.ts`).
 *   The hub verifies the same bearer against the same on-disk store before
 *   proxying, and additionally refuses to proxy it anywhere but `/api/scan/…`;
 *   neither process trusts the other's verdict.
 * - A full owner identity — the boxholder's browser session, so these routes can
 *   be exercised by hand. Resolved through `resolveRequestIdentity`, the SAME
 *   resolver the box auth preHandler and the tRPC context use, so ownership
 *   can't drift into a second, independently-computed answer.
 *
 * The scan routes register this preHandler in ADDITION to the box's general
 * auth hook, which runs first and does not know scan tokens exist. So the scan
 * routes must be registered in their own Fastify scope, outside that hook — see
 * Track 2. A scan token reaching any other surface is rejected by construction:
 * no other gate reads the scan store.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveScanRequestAuth } from "../core/scan/tokens.js";
import { getOwnerEmail, resolveRequestIdentity } from "./auth.js";

/** Who a scan route is acting for — Track 2 records `tokenName` as provenance
 *  (`scan-upload/<tokenName>`); an owner-driven request has none. */
export interface ScanAuth {
  source: "scan-token" | "owner";
  tokenName: string | null;
  email: string | null;
}

/**
 * Resolved auth, keyed by the request object. A WeakMap rather than a Fastify
 * request decorator so the type lives here with the resolver instead of in an
 * ambient `.d.ts` far from its only consumer; entries die with the request.
 */
const scanAuthByRequest = new WeakMap<FastifyRequest, ScanAuth>();

/** The auth the scan preHandler resolved for this request, or undefined if it
 *  never ran (a route that forgot to install the preHandler — the caller should
 *  treat that as a broken invariant, not as "unauthenticated"). */
export function scanAuthOf(request: FastifyRequest): ScanAuth | undefined {
  return scanAuthByRequest.get(request);
}

/**
 * Resolve scan auth for a request, or null if it carries none.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 */
async function resolveScanAuth(request: FastifyRequest, opts: { boxRoot: string }): Promise<ScanAuth | null> {
  const scanToken = await resolveScanRequestAuth(opts.boxRoot, request.headers);
  if (scanToken) return { source: "scan-token", tokenName: scanToken.name, email: null };

  const identity = resolveRequestIdentity(request, { openAccess: request.server.openAccess });
  // `source: "open"` is the test-only auth-off construction option, which the
  // tRPC context also treats as owner. Everything else must BE the owner: box
  // members with access are not enough for an ingest credential surface.
  if (identity.source === "open") return { source: "owner", tokenName: null, email: identity.email };
  const ownerEmail = getOwnerEmail();
  if (identity.email !== null && ownerEmail !== null && identity.email === ownerEmail) {
    return { source: "owner", tokenName: null, email: identity.email };
  }
  return null;
}

/**
 * Build the preHandler the scan routes install. Rejects with a bare 401 (these
 * routes are machine-facing — a browser redirect to login would be a nonsense
 * response to the uploader).
 */
export function makeScanAuthPreHandler(opts: {
  boxRoot: string;
}): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const auth = await resolveScanAuth(request, opts);
    if (!auth) {
      await reply.status(401).send({ error: "Not authenticated" });
      return;
    }
    scanAuthByRequest.set(request, auth);
  };
}
