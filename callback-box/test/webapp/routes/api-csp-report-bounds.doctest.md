# `POST /api/csp-report` — bounds against an unauthenticated amplification vector

The CSP report sink MUST stay public (browsers post violation reports without a
session), so it needs strict input bounds or it's a cheap memory/disk-blowup
against an unauthenticated endpoint: a small body limit, per-field truncation,
and a per-request report cap. See
`issues/closed/bugs/2026-07-19-csp-report-endpoint-memory-exhaustion.md` and
`src/webapp/routes/api-csp-report.ts`.

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

const ctx = await makeTestServer();
const logPath = path.join(ctx.boxRoot, ".callback-box", "csp-reports.log");

async function postCsp(contentType, body) {
  const res = await ctx.server.inject({
    method: "POST",
    url: "/api/csp-report",
    headers: { "content-type": contentType },
    payload: typeof body === "string" ? body : JSON.stringify(body),
  });
  return res.statusCode;
}

function logLines() {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf-8").split("\n").filter((l) => l.length > 0);
}
```

## An oversized field is truncated in the log

Under the body limit, a large `document-uri` (5000 chars) still gets truncated
per-field so no giant line is written.

```ts
const bigDoc = "https://evil.example/" + "A".repeat(5000);
await postCsp("application/csp-report", { "csp-report": { "violated-directive": "img-src", "blocked-uri": "https://x/y", "document-uri": bigDoc } })
=> 204

const lines = logLines();
const parsed = JSON.parse(lines[lines.length - 1]);
// Field is capped well under its original 5021 chars (2048 + ellipsis).
parsed.doc.length <= 2049
=> true

parsed.doc.length < bigDoc.length
=> true
```

## A body over the small dedicated limit is rejected (413), nothing logged

```ts continue
const before = logLines().length;
// 20 KB body — over the 16 KB CSP-report limit (but far under the server-wide
// 50 MB JSON limit that used to apply).
const huge = JSON.stringify({ "csp-report": { "document-uri": "https://x/" + "B".repeat(20_000) } });
const status = await postCsp("application/csp-report", huge);
status
=> 413

// The oversized report never reached the log — no new line appended.
logLines().length === before
=> true
```

## A batch POST logs at most the per-request cap

```ts continue
const beforeBatch = logLines().length;
const batch = Array.from({ length: 50 }, (_v, i) => ({ type: "csp-violation", body: { effectiveDirective: "script-src", blockedURL: "https://cdn/" + i + ".js", documentURL: "https://app/p" } }));
await postCsp("application/reports+json", batch)
=> 204

// 50 reports posted, but only the first 20 are logged.
logLines().length - beforeBatch
=> 20
```

```ts cleanup
await ctx.cleanup();
```
