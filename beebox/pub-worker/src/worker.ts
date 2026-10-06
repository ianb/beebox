/**
 * pub-worker — the Cloudflare Worker that serves box-managed publications from
 * R2. The box server uploads it with one of two binding sets:
 *  - pinned site (`PUB_ID` + `HOST_HANDLE`): one Worker per publication, see
 *    `site.ts`.
 *  - shared host (`PUB_WORKER_MODE=shared-v1` + `PUB_BOX_HANDLE` +
 *    `PUB_HOSTNAME`): one Worker per box on a custom hostname, see
 *    `shared-site.ts`.
 *
 * A Worker with neither binding set has no publication to serve; every request
 * gets a 500 naming the misconfiguration and nothing is read from R2.
 *
 * The Worker treats its own R2 store as an untrusted boundary (principle #3 /
 * the Val Town lesson): it `safeParse`s the site manifest on every serve and
 * fails closed. Every response leaves through `withSecurityHeaders`.
 */

import { defaultDeps, type WorkerDeps } from "./deps";
import type { Env } from "./env";
import { withSecurityHeaders } from "./headers";
import { unconfigured } from "./responses";
import { handleSite, hasPinnedSiteBindings, readSiteWorkerIdentity } from "./site";
import { handleSharedSite, hasSharedHostBindings, readSharedHostIdentity } from "./shared-site";

// Re-export so the test suites keep importing the deps seam from `worker.ts`.
export type { WorkerDeps } from "./deps";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle({ request, env, deps: defaultDeps });
  },
} satisfies ExportedHandler<Env>;

/**
 * The full request pipeline with injectable {@link WorkerDeps}, ending at the
 * single `withSecurityHeaders` exit. Exported so tests exercise the account tiers
 * with a stub clock/JWKS; the default `fetch` calls it with {@link defaultDeps}.
 */
export async function handle({ request, env, deps }: { request: Request; env: Env; deps: WorkerDeps }): Promise<Response> {
  return withSecurityHeaders(await route({ request, env, deps }));
}

/** Pick the serving mode from the bindings; presence of any shared binding claims shared mode. */
async function route({ request, env, deps }: { request: Request; env: Env; deps: WorkerDeps }): Promise<Response> {
  if (hasSharedHostBindings(env)) return handleSharedSite({ request, env, deps, identity: readSharedHostIdentity(env) });
  if (hasPinnedSiteBindings(env)) return handleSite({ request, env, deps, identity: readSiteWorkerIdentity(env) });
  return unconfigured();
}
