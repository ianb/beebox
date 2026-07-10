/**
 * Routing utilities for TanStack Router.
 *
 * The href() helper bypasses TanStack Router's strict type checking on
 * Link `to` props for dynamically constructed paths. Route type safety
 * comes from route definitions and useParams — Link type checking is
 * an incremental improvement to adopt later by converting individual
 * links to use route patterns + params.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function href(path: string): any {
  return path;
}

/**
 * Sanctioned escape hatch for the `search` prop on `Link`/`navigate` calls
 * whose `to` is a dynamically constructed {@link href} path. Because `href()`
 * returns `any`, TanStack Router can't resolve the target route's search-param
 * type, so `search` can't be checked against it. This helper centralizes what
 * were ~19 scattered `{...} as never` casts into this one named place —
 * greppable, documented, and the single spot to remove once navigations move
 * to statically-typed route `to`/`params` (which would restore real search
 * typing and make this unnecessary).
 *
 * Pass the fully-built search object (spread prior search in yourself if you're
 * merging). Prefer real route types wherever the target route is statically
 * known rather than href()-built.
 */
export function toSearch<T extends object>(params: T): never {
  // eslint-disable-next-line no-restricted-syntax -- deliberate router-boundary escape hatch: href() returns `any`, so the target route's search type is unresolvable and no sound type exists here; this is the single centralized home for what were ~19 scattered `{...} as never` casts (see this function's doc comment).
  return params as never;
}
