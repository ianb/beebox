// Rewrite the `Path` attribute of the box-issued mobile/session cookies so they
// survive behind the dev router's `/<worktree>/` prefix. Track B, chunk 2b of
// beebox/docs/implemented-plans/expose-dev-router.md (the iOS session-continuity leg).
//
// The box child sets `bbx_mobile` with `Path=/<boxSlug>` (webapp/mobile-cookie.ts)
// because it only knows its own slug. Behind the router the browser serves the
// SPA (and all its dev assets) under the Vite base `/<worktree>/…`, so a
// `Path=/<boxSlug>` cookie is dropped on the next request, the tRPC WebSocket
// upgrade, AND every worktree-root asset load (`/<worktree>/@vite/client`,
// `/<worktree>/src/…`) — a paired iOS webview then loads the box page but its JS
// bundle 401s (white screen). The router alone knows `/<worktree>`, so it
// rewrites the `Set-Cookie` Path to the worktree base on the responses it
// proxies (see rewriteMobileCookiePath for why `/<worktree>`, not the box path).
//
// Scope is deliberately narrow (security-critical):
//   - ONLY the named cookies below (`bbx_mobile`, `bbx_session`);
//   - ONLY their `Path` attribute — never HttpOnly/SameSite/Max-Age/Secure/value;
//   - ONLY when that Path is exactly `/<boxSlug>` (the value the box sets).
// `bbx_session` is issued host-wide `Path=/` (webapp/routes/auth.ts), so the
// exact-`/<boxSlug>` guard leaves it untouched — it already works behind any
// prefix. It is listed anyway so a future non-root `bbx_session` Path would be
// carried through the same rewrite. No other cookie or header is altered.

/** The cookies whose Path the router may rewrite. Everything else passes verbatim. */
const REWRITABLE_COOKIE_NAMES = new Set<string>(["bbx_mobile", "bbx_session"]);

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
 * Rewrite the `Path` of `bbx_mobile`/`bbx_session` from `/<boxSlug>` to the
 * WORKTREE prefix `/<worktree>` (the Vite base, `VITE_BASE=/<worktree>/`) across a
 * response's `Set-Cookie` header(s).
 *
 * NOT `/<worktree>/<boxSlug>` (the box path), even though the box lives there:
 * the dev SPA and ALL its assets are served under the Vite base
 * `/<worktree>/…` (`/<worktree>/@vite/client`, `/<worktree>/src/main.tsx`, …),
 * which are gated worktree-assets. A `/<worktree>/<boxSlug>` cookie is not sent
 * for those `/<worktree>/…` asset requests, so a mobile-only iOS webview loads
 * the box page but its JS bundle 401s → white screen. Scoping to `/<worktree>`
 * covers both the box paths and those assets. This does NOT widen access: the
 * `bbx_mobile` session is box-scoped (HMAC keyed to the box), so sending it to a
 * SIBLING box's path still fails that box's `verifyMobileSession`; the gate
 * enforces per-box server-side regardless of how broadly the cookie is sent.
 *
 * Accepts the raw Node header value (string, array, or undefined) and always
 * returns an array (or undefined) to assign straight back to `set-cookie`.
 */
export function rewriteMobileCookiePath(
  setCookie: string | string[] | undefined,
  { worktree, boxSlug }: { worktree: string; boxSlug: string },
): string[] | undefined {
  if (setCookie === undefined) return undefined;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  const boxPath = `/${boxSlug}`;
  const prefixedPath = `/${worktree}`;
  return list.map((cookie) => rewriteOne(cookie, { boxPath, prefixedPath }));
}
