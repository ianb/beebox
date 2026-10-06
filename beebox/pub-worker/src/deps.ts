/**
 * The Worker's injectable dependencies — a clock and a JWKS fetcher factory —
 * so tests drive the account tiers deterministically (principle #10): sign
 * assertions against a known `exp` and supply a stub JWKS with no network.
 * Production wires the real ones via {@link defaultDeps}.
 *
 * Lives in its own module (not `worker.ts`) so `access-auth.ts` and `site.ts`
 * can depend on the type without importing `worker.ts` (which imports them —
 * a value-import cycle otherwise). `worker.ts` re-exports `WorkerDeps` for tests.
 */

import { jwksFetcherFor, type GetJwks } from "./access";

export interface WorkerDeps {
  /** Current epoch-ms; threaded into Access `exp` checks and manifest expiry. */
  now: () => number;
  /** Builds the {@link GetJwks} for a team domain (prod: {@link jwksFetcherFor}). */
  jwksFor: (teamDomain: string) => GetJwks;
}

export const defaultDeps: WorkerDeps = {
  now: () => Date.now(),
  jwksFor: jwksFetcherFor,
};
