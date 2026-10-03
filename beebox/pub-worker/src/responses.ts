/**
 * The Worker's response constructors — one place each status is built, so the
 * serve paths (`site.ts`, `shared-site.ts`) and the account-auth wrapper
 * (`access-auth.ts`) all return byte-identical typed refusals. Every
 * response still leaves through `withSecurityHeaders` at the single `handle`
 * exit; these just set the status, a plain-text body, and (for 405) `Allow`.
 */

function plain(body: string, { status, extraHeaders }: { status: number; extraHeaders?: Record<string, string> }): Response {
  const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8" });
  if (extraHeaders !== undefined) {
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  }
  return new Response(body, { status, headers });
}

export function notFound(): Response {
  return plain("Not Found", { status: 404 });
}

export function gone(): Response {
  return plain("Gone", { status: 410 });
}

/** Missing/invalid Access assertion on a gated surface — Access should have supplied one. */
export function unauthorized(): Response {
  return plain("Unauthorized", { status: 401 });
}

/** Verified viewer, but not permitted by the current manifest's allowlist. */
export function forbidden(): Response {
  return plain("Forbidden", { status: 403 });
}

export function methodNotAllowed(allow: string): Response {
  return plain("Method Not Allowed", { status: 405, extraHeaders: { Allow: allow } });
}

/** The Worker was deployed without a pinned-site or shared-host binding set. */
export function unconfigured(): Response {
  return plain("Publication Worker is not configured: no pinned-site or shared-host bindings", { status: 500 });
}
