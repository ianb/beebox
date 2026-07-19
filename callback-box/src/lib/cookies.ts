/**
 * Raw `Cookie` header parsing, for the request paths that don't have
 * `@fastify/cookie`'s `request.cookies` decoration available.
 *
 * Two callers need this: the hub's raw WebSocket-upgrade handler
 * (`hub/hub-server.ts`), which sees a bare `http.IncomingMessage`, and the
 * box's mobile auth, which runs on both the decorated and undecorated paths
 * and so reads the raw header on both rather than branching.
 */

/**
 * Parse a `Cookie` header into a name -> value map. Never throws — the header
 * is untrusted input, so a malformed pair is skipped rather than failing the
 * whole parse and losing the well-formed cookies beside it.
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, values] of Object.entries(parseCookieHeaderAll(header))) {
    const first = values[0];
    if (first !== undefined) out[key] = first;
  }
  return out;
}

/**
 * Every value sent under each cookie name, in header order.
 *
 * A `Cookie` header can carry the same name more than once — browsers send one
 * entry per matching path, most-specific first. That is not an exotic case
 * here: boxes are path siblings on ONE origin, so a script running under box A
 * can call `document.cookie = "cb_mobile=junk; Path=/"` and its value will
 * accompany box B's real, `Path=/<slug>`-scoped cookie on every request to B.
 *
 * Collapsing to a single value therefore has to be a deliberate choice rather
 * than a parser accident. A credential check should try ALL the values under
 * its name and accept if any verifies — otherwise the shadowing cookie is a
 * trivial cross-box denial of service. (It is only a DoS: the per-box HMAC
 * means a forged value can never authenticate, just crowd out the real one.)
 */
export function parseCookieHeaderAll(header: string | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      const decoded = decodeURIComponent(value);
      const existing = out[key];
      if (existing) existing.push(decoded);
      else out[key] = [decoded];
    } catch (_e) {
      // Malformed percent-encoding — untrusted input, skip this cookie.
    }
  }
  return out;
}
