/**
 * Content-Security-Policy for the webapp — one source of truth shared by the
 * production Fastify `onSend` hook and the Vite dev server, so the two policies
 * can't drift. See `docs/content-security-policy.md` (and the design rationale
 * in `docs/implemented-plans/app-wide-csp.md`) for why each directive is here;
 * every origin/scheme is traced to a real browser connection — don't add one
 * without a verified consumer.
 *
 * The policy is shipped Report-Only first (the wiring sets
 * `Content-Security-Policy-Report-Only`); promotion to the enforcing header is a
 * separate, gated step driven by the violation digest.
 */

/**
 * Where violation reports are sent. Differs by deployment: prod serves the app
 * at the domain root so the root-level route `/api/csp-report` is reachable as a
 * root-absolute path; under the dev router the document lives at
 * `/<worktree>/<box>/…`, and only `/<worktree>/api/csp-report` proxies back to
 * the backend — hence the path is passed in rather than hardcoded.
 */
export const PROD_CSP_REPORT_PATH = "/api/csp-report";

/** Reporting-API endpoint name tying `report-to` to the `Reporting-Endpoints` header. */
const CSP_REPORT_ENDPOINT = "csp-endpoint";

export type CspMode = "dev" | "prod";

/**
 * Directives shared by dev and prod. Each origin/scheme is traced to a real
 * browser connection (Deepgram/OpenAI realtime sockets, blob/data media, the
 * YouTube embed iframe, external image hot-links + avatars); everything else is
 * same-origin and covered by `'self'`.
 */
const COMMON_DIRECTIVES: ReadonlyArray<readonly [string, string]> = [
  ["default-src", "'self'"],
  ["connect-src", "'self' https://api.deepgram.com wss://api.deepgram.com https://api.openai.com wss://api.openai.com"],
  ["img-src", "'self' data: blob: https:"],
  ["media-src", "'self' blob:"],
  ["worker-src", "'self'"],
  ["frame-src", "'self' https://www.youtube-nocookie.com"],
  ["font-src", "'self'"],
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["frame-ancestors", "'self'"],
];

/**
 * `script-src`/`style-src` differ by mode. Prod is strict (`script-src 'self'`);
 * dev relaxes it because Vite injects an inline react-refresh preamble and uses
 * eval-backed HMR. `style-src` needs `'unsafe-inline'` in both — React inline
 * `style={{…}}` props compile to governed `style=""` attributes.
 */
function modeDirectives(mode: CspMode): ReadonlyArray<readonly [string, string]> {
  if (mode === "dev") {
    return [
      ["script-src", "'self' 'unsafe-inline' 'unsafe-eval'"],
      ["style-src", "'self' 'unsafe-inline'"],
    ];
  }
  return [
    ["script-src", "'self'"],
    ["style-src", "'self' 'unsafe-inline'"],
  ];
}

/**
 * Serialize the CSP header value for the given mode, pointing the report
 * directives at `reportPath` (see `PROD_CSP_REPORT_PATH` for why it varies).
 */
export function buildCspPolicy({ mode, reportPath }: { mode: CspMode; reportPath: string }): string {
  const directives: ReadonlyArray<readonly [string, string]> = [
    ...modeDirectives(mode),
    ...COMMON_DIRECTIVES,
    ["report-uri", reportPath],
    ["report-to", CSP_REPORT_ENDPOINT],
  ];
  return directives.map(([name, value]) => `${name} ${value}`).join("; ");
}

/**
 * Value for the companion `Reporting-Endpoints` response header that the
 * `report-to` directive requires; must accompany the CSP header and point at the
 * same `reportPath`.
 */
export function reportingEndpointsHeader({ reportPath }: { reportPath: string }): string {
  return `${CSP_REPORT_ENDPOINT}="${reportPath}"`;
}
