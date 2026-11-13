import type { FastifyInstance } from "fastify";

/**
 * Headers every HTML document gets, beside the CSP:
 *
 * - `X-Frame-Options: SAMEORIGIN` and an enforced
 *   `Content-Security-Policy: frame-ancestors 'self'`. The Report-Only policy
 *   already names `frame-ancestors`, but browsers ignore that directive in
 *   Report-Only, so until now any site could frame the app (clickjacking).
 *   Same-origin frames — the theme studio, PDF and frozen pages, exhibits under
 *   the dev router — keep working. The enforced CSP carries only
 *   `frame-ancestors`; promoting the rest of the policy is a separate step
 *   (`docs/content-security-policy.md`).
 * - `Referrer-Policy: strict-origin-when-cross-origin`, so a link out sends
 *   the origin and never a box path.
 * - `Permissions-Policy` turning off device APIs nothing here uses (USB,
 *   serial, HID, payment). Camera, microphone, display capture, geolocation,
 *   wake lock and clipboard stay at their defaults: capture, screenshots,
 *   location, and box views use them.
 * - `Strict-Transport-Security` for one day, no subdomains. Cloudflare
 *   (Flexible SSL) did not send it as of 2026-11-11. Browsers ignore it on a
 *   plain-HTTP response, so local dev over http is unaffected. Raising the
 *   max-age is a later step once a day's worth has run without trouble.
 *
 * A route that already set one of these headers keeps its own value: the
 * frozen captured-page route's `sandbox` CSP, and the auth routes'
 * `Referrer-Policy: no-referrer`.
 */
export const DOCUMENT_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["X-Frame-Options", "SAMEORIGIN"],
  ["Content-Security-Policy", "frame-ancestors 'self'"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "usb=(), serial=(), hid=(), payment=()"],
  ["Strict-Transport-Security", "max-age=86400"],
];

export function registerDocumentSecurityHeaders(server: FastifyInstance): void {
  // eslint-disable-next-line max-params -- Fastify onSend hook requires 4 params
  server.addHook("onSend", (_request, reply, payload, done) => {
    const contentType = String(reply.getHeader("content-type") ?? "");
    if (contentType.includes("text/html")) {
      for (const [name, value] of DOCUMENT_SECURITY_HEADERS) {
        if (reply.getHeader(name) === undefined) reply.header(name, value);
      }
    }
    done(null, payload);
  });
}
