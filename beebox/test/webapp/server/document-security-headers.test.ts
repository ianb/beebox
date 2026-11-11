// # Document security headers
//
// HTML documents get framing protection that browsers enforce (X-Frame-Options
// and a frame-ancestors-only CSP), a Referrer-Policy, and a Permissions-Policy.
// The Report-Only CSP's own frame-ancestors is ignored by browsers, so without
// these any site could frame the app. A route's own value wins, and non-HTML
// responses get none. Exercised on a bare Fastify instance wired like
// webapp/server/app.ts (CSP hook first, then this one).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import Fastify from "fastify";
import { registerCspReportingHeaders } from "../../../src/webapp/server-root/root-routes.js";
import { registerDocumentSecurityHeaders } from "../../../src/webapp/server/document-security-headers.js";

async function makeServer() {
  const app = Fastify();
  registerCspReportingHeaders(app, { mode: "prod", reportPath: "/api/csp-report" });
  registerDocumentSecurityHeaders(app);
  app.get("/page", async (_req, reply) => reply.type("text/html").send("<!doctype html><p>hi"));
  app.get("/data", async () => ({ ok: true }));
  // The frozen captured-page route sets its own CSP; the auth routes their own Referrer-Policy.
  app.get("/frozen", async (_req, reply) =>
    reply.header("content-security-policy", "sandbox allow-scripts").type("text/html").send("<p>frozen"),
  );
  app.get("/invite", async (_req, reply) => reply.header("Referrer-Policy", "no-referrer").type("text/html").send("<p>invite"));
  return app;
}

function securityHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  return {
    frameOptions: headers["x-frame-options"],
    csp: headers["content-security-policy"],
    reportOnlyPresent: headers["content-security-policy-report-only"] !== undefined,
    referrer: headers["referrer-policy"],
    permissions: headers["permissions-policy"],
  };
}

void test("an HTML document is protected from cross-origin framing and keeps its Report-Only CSP", async (t) => {
  const app = await makeServer();
  const page = await app.inject({ method: "GET", url: "/page" });
  t.check(securityHeaders(page.headers), {
    frameOptions: "SAMEORIGIN",
    csp: "frame-ancestors 'self'",
    reportOnlyPresent: true,
    referrer: "strict-origin-when-cross-origin",
    permissions: "usb=(), serial=(), hid=(), payment=()",
  });
});

void test("a route's own CSP and Referrer-Policy win; framing protection still applies", async (t) => {
  const app = await makeServer();
  const frozen = await app.inject({ method: "GET", url: "/frozen" });
  const invite = await app.inject({ method: "GET", url: "/invite" });
  t.check(
    { frozen: securityHeaders(frozen.headers), invite: securityHeaders(invite.headers) },
    {
      frozen: {
        frameOptions: "SAMEORIGIN",
        csp: "sandbox allow-scripts",
        reportOnlyPresent: false,
        referrer: "strict-origin-when-cross-origin",
        permissions: "usb=(), serial=(), hid=(), payment=()",
      },
      invite: {
        frameOptions: "SAMEORIGIN",
        csp: "frame-ancestors 'self'",
        reportOnlyPresent: true,
        referrer: "no-referrer",
        permissions: "usb=(), serial=(), hid=(), payment=()",
      },
    },
  );
});

void test("a non-HTML response gets none of them", async (t) => {
  const app = await makeServer();
  const data = await app.inject({ method: "GET", url: "/data" });
  t.check(securityHeaders(data.headers), {
    frameOptions: undefined,
    csp: undefined,
    reportOnlyPresent: false,
    referrer: undefined,
    permissions: undefined,
  });
});
