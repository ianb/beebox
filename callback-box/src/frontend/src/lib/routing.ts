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
