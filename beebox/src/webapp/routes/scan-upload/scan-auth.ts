/**
 * The auth gate for the scan upload routes (`/api/scan/…`, Track 2).
 *
 * One credential reaches these routes: `Authorization: Bearer <scan-token>`,
 * verified against the box's OWN scan-token store (`core/scan/tokens.ts`). Any
 * member may mint one; it is valid only while its creator can still open the
 * box (`canAccessBox`, checked on every request). The hub verifies the same
 * bearer against the same on-disk store before proxying, and additionally
 * refuses to proxy it anywhere but `/api/scan/…`; neither process trusts the
 * other's verdict.
 *
 * The scan routes register this preHandler in ADDITION to the box's general
 * auth hook, which runs first and does not know scan tokens exist. So the scan
 * routes must be registered in their own Fastify scope, outside that hook — see
 * Track 2. A scan token reaching any other surface is rejected by construction:
 * no other gate reads the scan store.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveScanRequestAuth } from "../../../core/scan/tokens.js";
import { getOwnerEmail } from "../../auth.js";
import { canAccessBox } from "../../box-access.js";

/** Who a scan route is acting for — Track 2 records `tokenName` as provenance
 *  (`scan-upload/<tokenName>`); a request on an auth-off test server has none. */
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
  if (scanToken) {
    // Any member may mint a scan token. The token is valid only while its
    // creator can still open the box, so removing a member from
    // `allowedEmails` also stops that member's uploaders. A null creator is the
    // owner on an open-access box.
    const creator = scanToken.createdBy;
    if (creator !== null && !(await canAccessBox({ boxRoot: opts.boxRoot, email: creator, ownerEmail: getOwnerEmail() }))) {
      return null;
    }
    return { source: "scan-token", tokenName: scanToken.name, email: null };
  }

  // The auth-off construction option route tests use. Decided by the server
  // itself, not by identity: a hub's auth-off header reaches this box on a browse
  // key too, and that is not a scan credential.
  if (request.server.openAccess) return { source: "owner", tokenName: null, email: null };
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
