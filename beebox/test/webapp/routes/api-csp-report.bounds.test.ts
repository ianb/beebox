// # `POST /api/csp-report` — bounds against an unauthenticated amplification vector
//
// The CSP report sink MUST stay public (browsers post violation reports without a
// session), so it needs strict input bounds or it's a cheap memory/disk-blowup
// against an unauthenticated endpoint: a small body limit, per-field truncation,
// and a per-request report cap. See
// `issues/closed/bugs/2026-07-19-csp-report-endpoint-memory-exhaustion.md` and
// `src/webapp/routes/api-csp-report.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { makeTestServer } from "../../helpers/test-route-server.js";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

const ctx = await makeTestServer();
const logPath = path.join(ctx.boxRoot, ".beebox", "csp-reports.log");

async function postCsp(contentType: string, body: unknown) {
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

// ## An oversized field is truncated in the log
//
// Under the body limit, a large `document-uri` (5000 chars) still gets truncated
// per-field so no giant line is written.
void test("Under the body limit, a large document-uri (5000 chars) still gets truncated...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const bigDoc = "https://evil.example/" + "A".repeat(5000);
  t.check(
    await postCsp("application/csp-report", { "csp-report": { "violated-directive": "img-src", "blocked-uri": "https://x/y", "document-uri": bigDoc } })
    ,
    204,
  );

  const lines = logLines();
  const parsed = JSON.parse(lines[lines.length - 1] ?? "");
  // Field is capped well under its original 5021 chars: 2048 including the ellipsis (truncateTitle).
  t.check(parsed, { ts: isoDate(), directive: "img-src", blocked: "https://x/y", doc: bigDoc.slice(0, 2047) + "…" });

  // ## A body over the small dedicated limit is rejected (413), nothing logged

  const linesBefore = logLines();
  // 20 KB body — over the 16 KB CSP-report limit (but far under the server-wide
  // 50 MB JSON limit that used to apply).
  const huge = JSON.stringify({ "csp-report": { "document-uri": "https://x/" + "B".repeat(20_000) } });
  const status = await postCsp("application/csp-report", huge);
  t.check(status, 413);

  t.check(
    // The oversized report never reached the log — no new line appended.
    logLines(),
    linesBefore,
  );

  // ## An oversized `application/json` body is also rejected (413) — content-type can't bypass the bound
  //
  // The 16 KB cap must apply regardless of content-type. Sending the same oversized
  // payload as `application/json` used to fall through to Fastify's default parser
  // under the server-wide 50 MB limit; the per-route `bodyLimit` now bounds the raw
  // body for every content-type.

  const linesBeforeJson = logLines();
  const hugeJson = JSON.stringify({ "csp-report": { "document-uri": "https://x/" + "C".repeat(20_000) } });
  const jsonStatus = await postCsp("application/json", hugeJson);
  t.check(jsonStatus, 413);

  t.check(
    // Nothing logged from the rejected oversized JSON body.
    logLines(),
    linesBeforeJson,
  );

  // ## A batch POST logs at most the per-request cap

  const linesBeforeBatch = logLines();
  const batch = Array.from({ length: 50 }, (_v, i) => ({ type: "csp-violation", body: { effectiveDirective: "script-src", blockedURL: "https://cdn/" + i + ".js", documentURL: "https://app/p" } }));
  t.check(await postCsp("application/reports+json", batch), 204);

  t.check(
    // 50 reports posted, but only the first 20 are logged.
    logLines().slice(linesBeforeBatch.length).map((line) => JSON.parse(line)),
    Array.from({ length: 20 }, (_v, i) => ({
      ts: isoDate(),
      directive: "script-src",
      blocked: `https://cdn/${i}.js`,
      doc: "https://app/p",
    })),
  );
});
