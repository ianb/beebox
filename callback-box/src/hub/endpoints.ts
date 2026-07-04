/**
 * Endpoints — the seam between supervision and routing (Track D's "Isolation
 * is layered" requirement, `docs/plans/boxes-as-packages-v2.md`, verbatim:
 * "routing consumes *endpoints*, of which 'child process the hub spawned' is
 * merely the first implementation").
 *
 * An endpoint is nothing more than "where do I send HTTP/WS traffic for this
 * slug right now." `src/hub/supervisor.ts` is the only thing that knows HOW
 * an endpoint comes to exist (today: spawn a child process and wait for it
 * to answer `/healthz`; tomorrow: a chroot'd process, a VM, a socket). This
 * module and `src/hub/hub-server.ts` must never import anything from
 * `supervisor.ts` — only this file's types.
 */

/** Where a box's traffic goes right now. */
export interface Endpoint {
  slug: string;
  /** e.g. `http://127.0.0.1:54213` — no trailing slash. */
  origin: string;
}

/**
 * What the routing layer needs from whatever is producing endpoints. A
 * live view — `get` reflects the current state (a box may be mid-restart
 * and briefly absent), not a snapshot taken once at startup.
 */
export interface EndpointProvider {
  /** The current endpoint for `slug`, or `undefined` if the box isn't up
   *  (unconfigured slug, still starting, crash-looped and marked unhealthy). */
  get(slug: string): Endpoint | undefined;
  /** All slugs this provider knows about, whether or not they currently
   *  have a live endpoint — used for the `/` box listing and `/healthz`. */
  slugs(): string[];
}

/**
 * A fixed-endpoint provider for tests: routing tests should never need a
 * real supervisor/child process, just a stand-in HTTP server's origin.
 */
export function staticEndpointProvider(endpoints: Endpoint[]): EndpointProvider {
  const bySlug = new Map(endpoints.map((endpoint) => [endpoint.slug, endpoint]));
  return {
    get: (slug) => bySlug.get(slug),
    slugs: () => Array.from(bySlug.keys()),
  };
}
