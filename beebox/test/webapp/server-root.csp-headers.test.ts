// # CSP headers + report sink
//
// The CSP Report-Only header attaches to HTML document responses only, and yields to any route that already set its own CSP (the frozen captured-page route's `sandbox` policy must stay authoritative). The report sink accepts both wire formats and appends to a log. These exercise the wiring directly on a bare Fastify instance.

import { test } from "tap";
import "agent-doctest/tap";
import { isoDate } from "agent-doctest/check";
import Fastify from "fastify";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerCspReportingHeaders } from "../../src/webapp/server-root/root-routes.js";
import { registerCspReportRoute } from "../../src/webapp/routes/api-csp-report.js";
import { createTestServer } from "../helpers/test-server.js";

async function makeServer() {
  const app = Fastify();
  registerCspReportingHeaders(app, { mode: "prod", reportPath: "/api/csp-report" });
  app.get("/page", async (_req, reply) => reply.type("text/html").send("<!doctype html><p>hi"));
  app.get("/data", async () => ({ ok: true }));
  // Mimic the frozen route: it sets its own CSP before responding.
  app.get("/frozen", async (_req, reply) =>
    reply.header("content-security-policy", "sandbox allow-scripts").type("text/html").send("<p>frozen"),
  );
  return app;
}

// ## HTML documents get Report-Only + Reporting-Endpoints
void test("HTML documents get Report-Only + Reporting-Endpoints", async (t) => {
  // doctest:L30
  const app = await makeServer();
  const html = await app.inject({ method: "GET", url: "/page" });
  t.check(
    html.headers["content-security-policy-report-only"]?.toString(),
    "script-src 'self'; style-src 'self' 'unsafe-inline'; default-src 'self'; connect-src 'self' https://api.deepgram.com wss://api.deepgram.com https://api.openai.com wss://api.openai.com; img-src 'self' data: blob: https:; media-src 'self' blob:; worker-src 'self'; frame-src 'self' https://www.youtube-nocookie.com; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; report-uri /api/csp-report; report-to csp-endpoint");

  // doctest:L35
  t.check(html.headers["reporting-endpoints"], "csp-endpoint=\"/api/csp-report\"");

  // ## Non-HTML responses get no CSP
  //
  // A JSON API response is not a document — it must not carry the policy:

  // doctest:L44
  const data = await app.inject({ method: "GET", url: "/data" });
  t.check(data.headers["content-security-policy-report-only"], undefined);

  // ## The hook yields to a route's own CSP (frozen pages)
  //
  // When a response already set a CSP, the hook leaves it and adds no Report-Only header — so the frozen-page `sandbox` policy stays authoritative:

  // doctest:L54
  const frozen = await app.inject({ method: "GET", url: "/frozen" });
  t.check(frozen.headers["content-security-policy"], "sandbox allow-scripts");

  // doctest:L58
  t.check(frozen.headers["content-security-policy-report-only"], undefined);
});

// ## The report sink records violations
//
// Both the legacy `application/csp-report` object and the Reporting-API `application/reports+json` array are normalized and appended:
void test("Both the legacy application/csp-report object and the Reporting-API applicati...", async (t) => {
  // doctest:L67
  const dir = await mkdtemp(join(tmpdir(), "csp-sink-"));
  const sink = Fastify();
  registerCspReportRoute({ server: sink, logDir: dir });
  const legacy = await sink.inject({
    method: "POST",
    url: "/api/csp-report",
    headers: { "content-type": "application/csp-report" },
    payload: JSON.stringify({ "csp-report": { "violated-directive": "frame-src", "blocked-uri": "https://evil.test", "document-uri": "https://app/page" } }),
  });
  t.check(legacy.statusCode, 204);

  // doctest:L81
  const reportsApi = await sink.inject({
    method: "POST",
    url: "/api/csp-report",
    headers: { "content-type": "application/reports+json" },
    payload: JSON.stringify([{ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "http://x.test/a.png", documentURL: "https://app/p2" } }]),
  });
  t.check(reportsApi.statusCode, 204);

  // doctest:L90
  const log = await readFile(join(dir, ".beebox", "csp-reports.log"), "utf-8");
  const lines = log.trim().split("\n").map((l) => JSON.parse(l));
  t.check(lines, [
    { ts: isoDate(), directive: "frame-src", blocked: "https://evil.test", doc: "https://app/page" },
    { ts: isoDate(), directive: "img-src", blocked: "http://x.test/a.png", doc: "https://app/p2" },
  ]);

  // The sink writes JSONL — one JSON object per line (`ts`, `directive`, `blocked`, `doc`) — so the digest can read it back incrementally.
});

// ## The real Fastify server selects the built-frontend policy
//
// This pins `createServer` itself rather than rebuilding the CSP hook in the
// test. The route stands in for any HTML document so the assertion does not
// depend on a prebuilt frontend bundle being present in the source checkout.
void test("This pins createServer itself rather than rebuilding the CSP hook in the test.", async (t) => {
  t.teardown(async () => {
    try {
      await real.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L116
  const real = await createTestServer();
  real.server.get("/__csp-built-document", async (_request, reply) =>
    reply.type("text/html").send("<!doctype html><p>built"),
  );
  const built = await real.server.inject({ method: "GET", url: "/__csp-built-document" });
  t.check(
    { status: built.statusCode, policy: built.headers["content-security-policy-report-only"]?.toString() },
    {
      status: 200,
      policy: "script-src 'self'; style-src 'self' 'unsafe-inline'; default-src 'self'; connect-src 'self' https://api.deepgram.com wss://api.deepgram.com https://api.openai.com wss://api.openai.com; img-src 'self' data: blob: https:; media-src 'self' blob:; worker-src 'self'; frame-src 'self' https://www.youtube-nocookie.com; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; report-uri /api/csp-report; report-to csp-endpoint",
    },
  );
});
