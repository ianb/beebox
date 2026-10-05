/**
 * BearerProvider — the credential seam every Cloudflare REST adapter draws its
 * `Authorization: Bearer` value through. Clients ask the provider per request,
 * and on a 401 they ask for a forced refresh and retry once. The box server's
 * stored publishing-connection API token is a static provider that returns the
 * same string both ways.
 */

/** Supplies the current bearer. `refresh()` forces re-acquisition after a 401. */
export interface BearerProvider {
  get(): Promise<string>;
  refresh(): Promise<string>;
}

/** A fixed API token (the stored publishing-connection token). */
export function staticBearer(token: string): BearerProvider {
  return {
    get: () => Promise.resolve(token),
    refresh: () => Promise.resolve(token),
  };
}
