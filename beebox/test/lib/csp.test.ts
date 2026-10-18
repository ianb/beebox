// # CSP policy builder
//
// `buildCspPolicy` is the single source of truth for the webapp's Content-Security-Policy, shared by the production Fastify hook and the Vite dev server so the two can't drift. Prod is strict; dev relaxes `script-src`/`style-src` for Vite's inline HMR. Every directive's origins are traced to a real browser connection in the plan.

import { test } from "tap";
import "agent-doctest/tap";
import { buildCspPolicy, reportingEndpointsHeader, PROD_CSP_REPORT_PATH } from "../../src/lib/csp.js";

const prod = buildCspPolicy({ mode: "prod", reportPath: PROD_CSP_REPORT_PATH });
const dev = buildCspPolicy({ mode: "dev", reportPath: "/wt/api/csp-report" });

// ## Prod is strict
//
// `script-src` is exactly `'self'` — no `'unsafe-eval'` (p5's lazy eval features are isolated, not blanket-permitted) and no `'unsafe-inline'`:
void test("script-src is exactly 'self' — no 'unsafe-eval' (p5's lazy eval features are...", async (t) => {
  // doctest:L16
  await t.checkText(prod.includes("script-src 'self';"), "true");

  // doctest:L19
  await t.checkText(prod.includes("script-src 'self' 'unsafe"), "false");
});

// `style-src` keeps `'unsafe-inline'` (React inline `style={{…}}` props compile to governed `style=""` attributes):
void test("style-src keeps 'unsafe-inline' (React inline style={{…}} props compile to go...", async (t) => {
  // doctest:L26
  await t.checkText(prod.includes("style-src 'self' 'unsafe-inline'"), "true");
});

// ## Dev relaxes script/style
//
// Dev `script-src` adds `'unsafe-inline' 'unsafe-eval'` for Vite's injected react-refresh preamble and eval-backed HMR:
void test("Dev script-src adds 'unsafe-inline' 'unsafe-eval' for Vite's injected react-r...", async (t) => {
  // doctest:L35
  await t.checkText(dev.includes("script-src 'self' 'unsafe-inline' 'unsafe-eval'"), "true");
});

// ## Shared directives (both modes)
//
// The external-origin allowlist, the YouTube embed frame, and the report directives are identical across modes — only the report path differs:
void test("The external-origin allowlist, the YouTube embed frame, and the report direct...", async (t) => {
  // doctest:L44
  await t.checkText(
    [prod, dev].every((p) => p.includes("frame-src 'self' https://www.youtube-nocookie.com"))
    ,
    "true",
  );

  // doctest:L47
  await t.checkText(
    [prod, dev].every((p) => p.includes("connect-src 'self' https://api.deepgram.com wss://api.deepgram.com https://api.openai.com wss://api.openai.com"))
    ,
    "true",
  );

  // doctest:L50
  await t.checkText([prod, dev].every((p) => p.includes("img-src 'self' data: blob: https:")), "true");

  // doctest:L53
  await t.checkText([prod, dev].every((p) => p.includes("object-src 'none'") && p.includes("frame-ancestors 'self'") && p.includes("base-uri 'self'")), "true");
});

// The report directives must be present (without them Report-Only has no server-side sink), pointing at the given path:
void test("The report directives must be present (without them Report-Only has no server...", async (t) => {
  // doctest:L60
  await t.checkText(prod.includes("report-uri /api/csp-report") && prod.includes("report-to csp-endpoint"), "true");

  // doctest:L63
  await t.checkText(dev.includes("report-uri /wt/api/csp-report"), "true");
});

// ## Reporting-Endpoints companion header
//
// `report-to` only works if the response also carries a `Reporting-Endpoints` header naming the same endpoint and path:
void test("report-to only works if the response also carries a Reporting-Endpoints heade...", async (t) => {
  // doctest:L72
  t.check(reportingEndpointsHeader({ reportPath: PROD_CSP_REPORT_PATH }), "csp-endpoint=\"/api/csp-report\"");
});
