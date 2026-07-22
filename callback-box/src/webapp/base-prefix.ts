/**
 * Path-prefix reconstruction for login redirects behind a fronting proxy.
 *
 * A trusted fronting proxy (the dev router in dev, the hub for its children)
 * injects `X-CB-Base-Prefix: /<segment>` to tell the backend which single path
 * segment it stripped, so server-side login redirects can rebuild the full
 * browser path the backend never saw (Track A of
 * `docs/implemented-plans/expose-dev-router.md`). The Vite dev-proxy strips the
 * `/<worktree>` prefix before the backend, so the backend can't derive it from
 * `request.url` — the fronting proxy is the only party that knows it.
 *
 * The header is UNTRUSTED as a client-supplied value: a client must never set
 * it, so the proxy strips any client copy before injecting its own, and every
 * read re-validates. `validateBasePrefix` fails safe to "" (today's no-prefix
 * behavior) for anything that isn't a single leading-slash path segment, so an
 * accepted value can only ever prepend a same-origin path — never escape the
 * origin (`//host`, needs a second `/`) or traverse (`..`).
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import type { IncomingHttpHeaders } from "node:http";

/** The trusted-proxy prefix header. Lowercase — Node header keys are lowercased. */
export const BASE_PREFIX_HEADER = "x-cb-base-prefix";

/** A single path segment: leading slash then letters, digits, `.`, `_`, `-`
 *  (`\w` is `[A-Za-z0-9_]`, so this is `^/[A-Za-z0-9._-]+$` in the optimized
 *  form the linter requires). */
const BASE_PREFIX_RE = /^\/[\w.-]+$/;

/**
 * Validate an untrusted base-prefix value, failing safe to "" (no prefix). "" is
 * exactly today's behavior, so an absent/invalid header changes nothing.
 */
export function validateBasePrefix(raw: string | undefined): string {
  if (raw === undefined) return "";
  const value = raw.trim();
  // `..` is a legal `[A-Za-z0-9._-]+` run, so the regex alone would pass `/..`;
  // reject traversal explicitly before the shape check.
  if (value.includes("..")) return "";
  if (!BASE_PREFIX_RE.test(value)) return "";
  return value;
}

/** Read and validate the base prefix from request headers (fail-safe to ""). */
export function readBasePrefix(headers: IncomingHttpHeaders): string {
  const raw = headers[BASE_PREFIX_HEADER];
  return validateBasePrefix(Array.isArray(raw) ? raw[0] : raw);
}

/**
 * Remove any client-supplied base-prefix header (case-insensitive), in place. A
 * client must never set it; only a trusted fronting proxy may.
 */
export function stripBasePrefixHeader(headers: IncomingHttpHeaders): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === BASE_PREFIX_HEADER) delete headers[key];
  }
}

/**
 * Inject the trusted base prefix, stripping any client-supplied copy first, so a
 * spoofed value can never survive alongside the real one.
 */
export function injectBasePrefix(headers: IncomingHttpHeaders, prefix: string): void {
  stripBasePrefixHeader(headers);
  headers[BASE_PREFIX_HEADER] = prefix;
}

/**
 * Redirect an unauthenticated navigation to the login page, carrying the base
 * prefix (from the trusted `x-cb-base-prefix` header) on BOTH the login path and
 * the `returnTo`, so login is reachable behind a stripped prefix and returns the
 * user to where they were. With no prefix this is a bare
 * `/auth/login?returnTo=<url>` — identical to the pre-Track-A behavior.
 */
export function loginRedirect(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const prefix = readBasePrefix(request.headers);
  const returnTo = `${prefix}${request.url}`;
  return reply.redirect(`${prefix}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
}
