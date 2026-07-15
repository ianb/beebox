/**
 * The Worker's response constructors — one place each status is built, so the
 * serve path (`index.ts`), the account-auth wrapper (`access-auth.ts`), and the
 * submit endpoint (`submit.ts`) all return byte-identical typed refusals. Every
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

/** Verified viewer, but not permitted by the current manifest (allowlist / no-submit). */
export function forbidden(): Response {
  return plain("Forbidden", { status: 403 });
}

export function methodNotAllowed(allow: string): Response {
  return plain("Method Not Allowed", { status: 405, extraHeaders: { Allow: allow } });
}

/** Body content-type the endpoint won't accept (submit takes urlencoded only). */
export function unsupportedMediaType(): Response {
  return plain("Unsupported Media Type", { status: 415 });
}

/** Field-validation failure — the body names each offending field (submit only). */
export function badRequest(message: string): Response {
  return plain(message, { status: 400 });
}

/** Body exceeded the hard ceiling or the manifest's `maxSubmissionBytes`. */
export function payloadTooLarge(): Response {
  return plain("Payload Too Large", { status: 413 });
}

/** Daily cap or per-IP rate limit tripped. */
export function tooManyRequests(): Response {
  return plain("Too Many Requests", { status: 429 });
}
