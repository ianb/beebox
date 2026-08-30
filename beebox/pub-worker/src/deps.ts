/**
 * The Worker's injectable dependencies — a clock, a JWKS fetcher factory, and an
 * id generator — so tests drive the account tiers and the submit endpoint
 * deterministically (principle #10): sign assertions against a known `exp`,
 * supply a stub JWKS with no network, and assert fixed access-log / submission
 * object keys. Production wires the real ones via {@link defaultDeps}.
 *
 * Lives in its own module (not `index.ts`) so `access-auth.ts` and `submit.ts`
 * can depend on the type without importing `index.ts` (which imports them —
 * a value-import cycle otherwise). `index.ts` re-exports `WorkerDeps` for tests.
 */

import { jwksFetcherFor, type GetJwks } from "./access";

export interface WorkerDeps {
  /** Current epoch-ms; threaded into Access `exp` checks and the access-log / submission `ts`. */
  now: () => number;
  /** Builds the {@link GetJwks} for a team domain (prod: {@link jwksFetcherFor}). */
  jwksFor: (teamDomain: string) => GetJwks;
  /** Fresh id for a per-view access-log object or a per-submission object key. */
  newId: () => string;
}

export const defaultDeps: WorkerDeps = {
  now: () => Date.now(),
  jwksFor: jwksFetcherFor,
  newId: () => crypto.randomUUID(),
};
