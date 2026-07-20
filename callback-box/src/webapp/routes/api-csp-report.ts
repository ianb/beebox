/**
 * Root-level sink for Content-Security-Policy violation reports.
 *
 * The CSP header's `report-uri`/`report-to` directives point browsers here. A
 * report has no box context (it's a document-level header), so this route is
 * registered on the root server, unauthenticated — browsers POST CSP reports
 * without credentials, and the body carries no secrets. Reports are appended as
 * JSONL (one JSON object per line: `ts`, `directive`, `blocked`, `doc`) to a
 * single app-global log (there is no server-level state dir in this codebase, so
 * it lives under the primary box's `.callback-box/`); the violation-digest
 * tooling reads it back incrementally via a cursor. Mirrors the append+rolling-
 * truncate shape of `api-debug-log.ts`, deliberately without a cross-process
 * lock; the rolling truncate cuts on a newline boundary so JSONL stays valid.
 */

import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { isRecord } from "../../lib/is-record.js";

const CSP_REPORT_LOG = "csp-reports.log";
const MAX_LOG_FILE_BYTES = 200_000;

// Bounds against an unauthenticated memory/disk-amplification vector (the
// endpoint MUST stay public — browsers post reports without a session). A real
// CSP report is a few hundred bytes; these caps are generous headroom, not a
// guess at the wire format.
//
// - Body limit: reject anything that isn't tiny before it's even buffered. Set
//   on the content-type parser below (the server-wide 50 MB JSON limit does not
//   apply to these two CSP content types).
// - Field cap: truncate each logged field so one report can't write a
//   multi-megabyte line (a ~49 MB `documentURL` was the reported vector).
// - Report cap: a Reporting-API POST is an array; bound how many we log per
//   request so a single post can't append thousands of lines.
const MAX_REPORT_BODY_BYTES = 16 * 1024;
const MAX_FIELD_CHARS = 2_048;
const MAX_REPORTS_PER_REQUEST = 20;

/**
 * Absolute path of the CSP report log under a box. The sink writes here and the
 * digest tool (`src/dev/csp-digest.ts`) reads from the same place — keep both
 * going through this helper so they never drift.
 */
export function cspReportLogPath(boxRoot: string): string {
  return path.join(boxRoot, ".callback-box", CSP_REPORT_LOG);
}

/**
 * The two wire shapes a browser may send: the legacy `application/csp-report`
 * single object, or the Reporting-API `application/reports+json` array. Both are
 * normalized to `{ directive, blockedUri, documentUri }` for logging.
 */
interface NormalizedReport {
  directive: string;
  blockedUri: string;
  documentUri: string;
}

function str(value: unknown): string {
  if (typeof value !== "string" || value === "") return "-";
  // Truncate per-field so a single report can't write a giant log line.
  return value.length > MAX_FIELD_CHARS ? value.slice(0, MAX_FIELD_CHARS) + "…" : value;
}

function normalizeReports(body: unknown): NormalizedReport[] {
  // Reporting-API form: an array of { type, body: { effectiveDirective, blockedURL, documentURL } }.
  if (Array.isArray(body)) {
    const out: NormalizedReport[] = [];
    // Bound how many reports one POST can log (a Reporting-API batch is an
    // array; cap it so a single request can't append thousands of lines).
    for (const entry of body.slice(0, MAX_REPORTS_PER_REQUEST)) {
      if (!isRecord(entry)) continue;
      if (entry["type"] !== undefined && entry["type"] !== "csp-violation") continue;
      const b = isRecord(entry["body"]) ? entry["body"] : {};
      out.push({
        directive: str(b["effectiveDirective"] ?? b["violatedDirective"]),
        blockedUri: str(b["blockedURL"]),
        documentUri: str(b["documentURL"]),
      });
    }
    return out;
  }
  // Legacy form: { "csp-report": { "violated-directive", "blocked-uri", "document-uri" } }.
  if (isRecord(body)) {
    const r = body["csp-report"];
    if (isRecord(r)) {
      const rep = r;
      return [
        {
          directive: str(rep["effective-directive"] ?? rep["violated-directive"]),
          blockedUri: str(rep["blocked-uri"]),
          documentUri: str(rep["document-uri"]),
        },
      ];
    }
  }
  return [];
}

export function registerCspReportRoute({ server, logDir }: { server: FastifyInstance; logDir: string }): void {
  const logFile = cspReportLogPath(logDir);

  // Neither CSP report content-type is handled by Fastify's default JSON parser;
  // register a tolerant string parser that JSON-decodes the body and never
  // rejects (a malformed report should be dropped, not 415/500 the browser).
  server.addContentTypeParser(
    ["application/csp-report", "application/reports+json"],
    { parseAs: "string", bodyLimit: MAX_REPORT_BODY_BYTES },
    // eslint-disable-next-line max-params -- Fastify's content-type parser callback signature is (request, body, done)
    (_request, body, done) => {
      try {
        done(null, JSON.parse(typeof body === "string" ? body : body.toString("utf-8")));
      } catch (_e) {
        // A malformed report is dropped (empty object → no records), not rejected.
        done(null, {});
      }
    },
  );

  async function appendLines(lines: string[]): Promise<void> {
    try {
      await mkdir(path.dirname(logFile), { recursive: true });
      await appendFile(logFile, lines.join(""));
      const s = await stat(logFile);
      if (s.size > MAX_LOG_FILE_BYTES) {
        const content = await readFile(logFile, "utf-8");
        const half = content.slice(content.length / 2);
        const firstNewline = half.indexOf("\n");
        // Cut on a newline boundary so JSONL stays valid. If the retained half
        // has NO newline (a single oversized partial line), drop it entirely
        // rather than keep a giant fragment — the field caps make this
        // near-impossible, but the truncation must not depend on that.
        await writeFile(logFile, firstNewline === -1 ? "" : half.slice(firstNewline + 1));
      }
    } catch (_e) {
      // A logging failure must not break the report endpoint.
    }
  }

  server.post("/api/csp-report", async (request, reply) => {
    const reports = normalizeReports(request.body);
    if (reports.length > 0) {
      const ts = new Date().toISOString();
      const lines = reports.map(
        (r) => `${JSON.stringify({ ts, directive: r.directive, blocked: r.blockedUri, doc: r.documentUri })}\n`,
      );
      await appendLines(lines);
    }
    // 204 regardless: report intake is best-effort and the browser ignores the body.
    return reply.status(204).send();
  });
}
