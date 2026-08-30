/**
 * Cloudflare Access gate shared by the serve path (`index.ts`, for `/a/` tiers)
 * and the submit endpoint (`submit.ts`, for account-tier submitters). Wraps the
 * low-level `verifyAccessAssertion` (`access.ts`) with the Worker's fail-closed
 * policy and returns either the verified email or the exact response to return
 * unchanged:
 *  - Access NOT configured (no team domain / aud) → **404**: the box hasn't set
 *    up account tiers, so the gated surface isn't served here — treated like a
 *    missing surface rather than advertising gated content with a 401.
 *  - Missing/invalid/expired/wrong-`aud` assertion → **401**: Access should have
 *    supplied a valid assertion, so its absence means misconfig or a bypass
 *    attempt; never serve (fail-closed, principle #4).
 */

import { verifyAccessAssertion } from "./access";
import type { WorkerDeps } from "./deps";
import { accessConfig, type Env } from "./env";
import { notFound, unauthorized } from "./responses";

export type AuthResult = { ok: true; email: string } | { ok: false; response: Response };

/** Authenticate a request via Cloudflare Access; the verified email or a fail-closed response. */
export async function authenticateAccess({
  request,
  env,
  deps,
}: {
  request: Request;
  env: Env;
  deps: WorkerDeps;
}): Promise<AuthResult> {
  const config = accessConfig(env);
  if (config === null) return { ok: false, response: notFound() };
  const result = await verifyAccessAssertion({
    request,
    config,
    getJwks: deps.jwksFor(config.teamDomain),
    now: deps.now,
  });
  if (!result.ok) return { ok: false, response: unauthorized() };
  return { ok: true, email: result.email };
}
