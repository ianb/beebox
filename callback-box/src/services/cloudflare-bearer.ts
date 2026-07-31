/**
 * BearerProvider — the credential seam every Cloudflare REST adapter draws its
 * `Authorization: Bearer` value through (`docs/plans/pub-setup-wrangler.md`,
 * amendment 5).
 *
 * The wrangler OAuth access token is a short-lived string: whatever
 * `wrangler auth token` emitted can expire mid-flow (a long `cb pub go`
 * uploads many objects). So clients never hold a fixed token — they ask the
 * provider per request, and on a 401 they ask for a forced refresh and retry
 * once. A static API token (the connector's stored ingestion-bucket token, or
 * the `CLOUDFLARE_API_TOKEN` env escape hatch) is the degenerate provider that
 * returns the same string both ways.
 */

import type { WranglerService } from "./wrangler.js";

/** The wrangler login died mid-flow — the fix is a fresh `wrangler login`. */
export class WranglerAuthError extends Error {
  constructor() {
    super("wrangler could not supply a Cloudflare OAuth token — run `wrangler login` and retry");
    this.name = "WranglerAuthError";
  }
}

/** Supplies the current bearer. `refresh()` forces re-acquisition after a 401. */
export interface BearerProvider {
  get(): Promise<string>;
  refresh(): Promise<string>;
}

/** A fixed API token (env escape hatch, or the connector's stored token). */
export function staticBearer(token: string): BearerProvider {
  return {
    get: () => Promise.resolve(token),
    refresh: () => Promise.resolve(token),
  };
}

/**
 * The wrangler-login-backed provider: caches the emitted access token, and
 * re-runs `wrangler auth token` (which transparently uses the stored refresh
 * token) when a client reports it stale. Throws {@link WranglerAuthError} when
 * wrangler cannot mint one — the login was revoked or never happened.
 */
export function wranglerBearer(wrangler: WranglerService): BearerProvider {
  let cached: string | null = null;

  async function mint(): Promise<string> {
    const minted = await wrangler.authToken();
    if (minted === null) throw new WranglerAuthError();
    cached = minted;
    return minted;
  }

  return {
    async get(): Promise<string> {
      return cached ?? mint();
    },
    refresh(): Promise<string> {
      return mint();
    },
  };
}
