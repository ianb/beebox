// Rewrite the `Path` attribute of the box-issued mobile/session cookies so they
// survive behind the dev router's `/<worktree>/` prefix. Track B, chunk 2b of
// callback-box/docs/plans/expose-dev-router.md (the iOS session-continuity leg).
//
// The box child sets `cb_mobile` with `Path=/<boxSlug>` (webapp/mobile-cookie.ts)
// because it only knows its own slug. Behind the router the browser path is
// `/<worktree>/<boxSlug>/…`, so a `Path=/<boxSlug>` cookie is dropped on the next
// request AND on the tRPC WebSocket upgrade — silently logging out a paired iOS
// app after one request. The router alone knows `/<worktree>`, so it rewrites the
// `Set-Cookie` Path on the responses it proxies.
//
// Scope is deliberately narrow (security-critical):
//   - ONLY the named cookies below (`cb_mobile`, `cb_session`);
//   - ONLY their `Path` attribute — never HttpOnly/SameSite/Max-Age/Secure/value;
//   - ONLY when that Path is exactly `/<boxSlug>` (the value the box sets).
// `cb_session` is issued host-wide `Path=/` (webapp/routes/auth.ts), so the
// exact-`/<boxSlug>` guard leaves it untouched — it already works behind any
// prefix. It is listed anyway so a future non-root `cb_session` Path would be
// carried through the same rewrite. No other cookie or header is altered.

/** The cookies whose Path the router may rewrite. Everything else passes verbatim. */
const REWRITABLE_COOKIE_NAMES = new Set<string>(["cb_mobile", "cb_session"]);

/** The name of a `Set-Cookie` string — the token before the first `=`. */
function cookieName(setCookie: string): string {
  const eq = setCookie.indexOf("=");
  return (eq === -1 ? setCookie : setCookie.slice(0, eq)).trim();
}

/**
 * Rewrite one `Set-Cookie` string's `Path=<boxPath>` → `Path=<prefixedPath>`,
 * touching ONLY that attribute and ONLY when its value is exactly `boxPath`.
 * Returns the input unchanged for any other cookie, Path value, or attribute.
 */
function rewriteOne(setCookie: string, { boxPath, prefixedPath }: { boxPath: string; prefixedPath: string }): string {
  if (!REWRITABLE_COOKIE_NAMES.has(cookieName(setCookie))) return setCookie;
  let changed = false;
  const segments = setCookie.split(";").map((seg) => {
    const eq = seg.indexOf("=");
    if (eq === -1) return seg; // valueless attribute (HttpOnly, Secure)
    if (seg.slice(0, eq).trim().toLowerCase() !== "path") return seg;
    if (seg.slice(eq + 1).trim() !== boxPath) return seg; // only the box's own Path
    changed = true;
    // Preserve the segment's original leading whitespace (`; Path=…`).
    const lead = seg.slice(0, seg.length - seg.trimStart().length);
    return `${lead}Path=${prefixedPath}`;
  });
  return changed ? segments.join(";") : setCookie;
}

/**
 * Rewrite the `Path` of `cb_mobile`/`cb_session` from `/<boxSlug>` to
 * `/<worktree>/<boxSlug>` across a response's `Set-Cookie` header(s). Accepts the
 * raw Node header value (a string, an array, or undefined) and always returns an
 * array (or undefined) suitable to assign straight back to `headers["set-cookie"]`.
 */
export function rewriteMobileCookiePath(
  setCookie: string | string[] | undefined,
  { worktree, boxSlug }: { worktree: string; boxSlug: string },
): string[] | undefined {
  if (setCookie === undefined) return undefined;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  const boxPath = `/${boxSlug}`;
  const prefixedPath = `/${worktree}/${boxSlug}`;
  return list.map((cookie) => rewriteOne(cookie, { boxPath, prefixedPath }));
}
