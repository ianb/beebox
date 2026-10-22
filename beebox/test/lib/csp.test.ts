// # CSP policy builder
//
// `buildCspPolicy` is the single source of truth for the webapp's Content-Security-Policy, shared by the production Fastify hook and the Vite dev server so the two can't drift. Prod is strict; dev relaxes `script-src`/`style-src` for Vite's inline HMR. Every directive's origins are traced to a real browser connection in the plan.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  buildCspPolicy,
  reportingEndpointsHeader,
  PROD_CSP_REPORT_PATH,
} from "../../src/lib/csp.js";

const prod = buildCspPolicy({ mode: "prod", reportPath: PROD_CSP_REPORT_PATH });
const dev = buildCspPolicy({ mode: "dev", reportPath: "/wt/api/csp-report" });

// ## Prod is strict
//
// `script-src` is exactly `'self'` — no `'unsafe-eval'` (p5's lazy eval features are isolated, not blanket-permitted) and no `'unsafe-inline'`:
void test("script-src is exactly 'self' — no 'unsafe-eval' (p5's lazy eval features are...", async (t) => {
  t.check(prod.split("; "), [
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "default-src 'self'",
    "connect-src 'self' https://api.deepgram.com wss://api.deepgram.com https://api.openai.com wss://api.openai.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "frame-src 'self' https://www.youtube-nocookie.com",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ]);
});

// `style-src` keeps `'unsafe-inline'` (React inline `style={{…}}` props compile to governed `style=""` attributes):
void test("style-src keeps 'unsafe-inline' (React inline style={{…}} props compile to go...", async (t) => {
  t.check(prod.split("; ")[1], "style-src 'self' 'unsafe-inline'");
});

// ## Dev relaxes script/style
//
// Dev `script-src` adds `'unsafe-inline' 'unsafe-eval'` for Vite's injected react-refresh preamble and eval-backed HMR:
void test("Dev script-src adds 'unsafe-inline' 'unsafe-eval' for Vite's injected react-r...", async (t) => {
  t.check(dev.split("; "), [
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "default-src 'self'",
    "connect-src 'self' https://api.deepgram.com wss://api.deepgram.com https://api.openai.com wss://api.openai.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "frame-src 'self' https://www.youtube-nocookie.com",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "report-uri /wt/api/csp-report",
    "report-to csp-endpoint",
  ]);
});

// ## Shared directives (both modes)
//
// The external-origin allowlist, the YouTube embed frame, and the report directives are identical across modes — only the report path differs:
void test("The external-origin allowlist, the YouTube embed frame, and the report direct...", async (t) => {
  const shared = [
    "default-src 'self'",
    "connect-src 'self' https://api.deepgram.com wss://api.deepgram.com https://api.openai.com wss://api.openai.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "frame-src 'self' https://www.youtube-nocookie.com",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ];
  t.check(prod.split("; ").slice(2, -2), shared);
  t.check(dev.split("; ").slice(2, -2), shared);
});

// The report directives must be present (without them Report-Only has no server-side sink), pointing at the given path:
void test("The report directives must be present (without them Report-Only has no server...", async (t) => {
  t.check(prod.split("; ").slice(-2), [
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ]);
  t.check(dev.split("; ").slice(-2), [
    "report-uri /wt/api/csp-report",
    "report-to csp-endpoint",
  ]);
});

// ## Reporting-Endpoints companion header
//
// `report-to` only works if the response also carries a `Reporting-Endpoints` header naming the same endpoint and path:
void test("report-to only works if the response also carries a Reporting-Endpoints heade...", async (t) => {
  t.check(
    reportingEndpointsHeader({ reportPath: PROD_CSP_REPORT_PATH }),
    'csp-endpoint="/api/csp-report"',
  );
});
