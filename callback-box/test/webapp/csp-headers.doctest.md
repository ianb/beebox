# CSP headers + report sink

The CSP Report-Only header attaches to HTML document responses only, and yields to any route that already set its own CSP (the frozen captured-page route's `sandbox` policy must stay authoritative). The report sink accepts both wire formats and appends to a log. These exercise the wiring directly on a bare Fastify instance.

```ts setup
import Fastify from "fastify";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerCspReportingHeaders } from "../../src/webapp/server-root.js";
import { registerCspReportRoute } from "../../src/webapp/routes/api-csp-report.js";

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
```

## HTML documents get Report-Only + Reporting-Endpoints

```ts
const app = await makeServer();
const html = await app.inject({ method: "GET", url: "/page" });
html.headers["content-security-policy-report-only"]?.toString().includes("script-src 'self';")
=> true

html.headers["reporting-endpoints"]
=> csp-endpoint="/api/csp-report"
```

## Non-HTML responses get no CSP

A JSON API response is not a document — it must not carry the policy:

```ts continue
const data = await app.inject({ method: "GET", url: "/data" });
data.headers["content-security-policy-report-only"] === undefined
=> true
```

## The hook yields to a route's own CSP (frozen pages)

When a response already set a CSP, the hook leaves it and adds no Report-Only header — so the frozen-page `sandbox` policy stays authoritative:

```ts continue
const frozen = await app.inject({ method: "GET", url: "/frozen" });
frozen.headers["content-security-policy"]
=> sandbox allow-scripts

frozen.headers["content-security-policy-report-only"] === undefined
=> true
```

## The report sink records violations

Both the legacy `application/csp-report` object and the Reporting-API `application/reports+json` array are normalized and appended:

```ts
const dir = await mkdtemp(join(tmpdir(), "csp-sink-"));
const sink = Fastify();
registerCspReportRoute({ server: sink, logDir: dir });
const legacy = await sink.inject({
  method: "POST",
  url: "/api/csp-report",
  headers: { "content-type": "application/csp-report" },
  payload: JSON.stringify({ "csp-report": { "violated-directive": "frame-src", "blocked-uri": "https://evil.test", "document-uri": "https://app/page" } }),
});
legacy.statusCode
=> 204
```

```ts continue
const reportsApi = await sink.inject({
  method: "POST",
  url: "/api/csp-report",
  headers: { "content-type": "application/reports+json" },
  payload: JSON.stringify([{ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "http://x.test/a.png", documentURL: "https://app/p2" } }]),
});
reportsApi.statusCode
=> 204

const log = await readFile(join(dir, ".callback-box", "csp-reports.log"), "utf-8");
const lines = log.trim().split("\n").map((l) => JSON.parse(l));
lines.length
=> 2
```

The sink writes JSONL — one JSON object per line (`ts`, `directive`, `blocked`, `doc`) — so the digest can read it back incrementally:

```ts continue
`${lines[0].directive} ${lines[0].blocked}`
=> frame-src https://evil.test

`${lines[1].directive} ${lines[1].blocked}`
=> img-src http://x.test/a.png

typeof lines[0].ts
=> string
```
