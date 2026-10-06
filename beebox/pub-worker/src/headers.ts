/**
 * The security header set applied to EVERY response — 200, 404, 410, no
 * exceptions (locked decision 5 + the Prior-art cache finding). Centralized so
 * there is exactly one place a response can be built, and `withSecurityHeaders`
 * is the sole exit through which the Worker returns anything.
 *
 * Why each one:
 *  - `Cache-Control: no-store` — Cloudflare would otherwise edge-cache a 200 for
 *    up to 120 min (and 404/410 for 3 min), so a revoked secret URL could keep
 *    serving from cache. `no-store` trades edge caching for revocation
 *    correctness (right at personal scale: free tier is 100k req/day).
 *  - `X-Robots-Tag: noindex` — discoverability is never a tier (ChatGPT lesson).
 *  - `Referrer-Policy: no-referrer` — secret URLs must not leak via `Referer`
 *    on outbound links (Google-Docs lesson).
 *  - `X-Content-Type-Options: nosniff` — we always set an explicit Content-Type
 *    and never let the browser sniff.
 *  - `Cross-Origin-Opener-Policy: same-origin` — isolate the browsing context.
 *  - CSP — published sites may load `https:` scripts, styles, images, and
 *    fonts, but `connect-src 'self'`, `form-action 'none'`, and
 *    `frame-ancestors 'none'` keep a page from posting data out or being framed.
 *  - `Cross-Origin-Resource-Policy: same-origin` — assets are not embeddable
 *    cross-origin.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: https:",
  "font-src 'self' data: https:",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": CSP,
  "Cross-Origin-Resource-Policy": "same-origin",
};

/**
 * Copy `res`, layering the fixed security header set on top. The set never
 * includes `Content-Type`, so an asset's already-set content type survives.
 * Every response the Worker returns passes through here exactly once.
 */
export function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
