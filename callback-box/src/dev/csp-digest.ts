/**
 * Digest of Content-Security-Policy violation reports.
 *
 * Reads a `csp-reports.log` (written by the `/api/csp-report` sink) and
 * summarizes it: which directives fired, against which origins, how often, and
 * first/last seen. Meant to be run by the scheduled violation-review routine
 * (dev + prod) — it *arranges context* for the harden decision and proposes the
 * Report-Only → enforcing flip when the log is clean, but it never edits the
 * policy itself; a human/agent confirms. See docs/content-security-policy.md.
 *
 *   pnpm csp-digest <path-to-csp-reports.log>
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

interface CspViolation {
  directive: string;
  blocked: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

export interface CspDigest {
  total: number;
  violations: CspViolation[];
  clean: boolean;
  /** Human-readable summary ready to drop into a routine's report. */
  summary: string;
}

const LINE_RE = /^(\S+) \[csp] directive=(\S+) blocked=(\S+) doc=(.*)$/;

/**
 * Parse + dedupe a report log into a digest. Pure (takes the log text), so the
 * routine can read prod and dev logs and digest each. Unparseable lines are
 * ignored (the log is append-only and best-effort).
 */
export function digestCspReports(logText: string): CspDigest {
  const byKey = new Map<string, CspViolation>();
  let total = 0;
  for (const line of logText.split("\n")) {
    const m = LINE_RE.exec(line);
    if (m === null) continue;
    const [, ts, directive, blocked] = m;
    total++;
    const key = `${directive} ${blocked}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { directive: directive!, blocked: blocked!, count: 1, firstSeen: ts!, lastSeen: ts! });
    } else {
      existing.count++;
      existing.lastSeen = ts!;
    }
  }
  const violations = [...byKey.values()].toSorted((a, b) => b.count - a.count);
  const clean = violations.length === 0;
  return { total, violations, clean, summary: formatSummary({ violations, clean, total }) };
}

function formatSummary({ violations, clean, total }: { violations: CspViolation[]; clean: boolean; total: number }): string {
  if (clean) {
    return [
      "✅ No CSP violations recorded.",
      "Safe to harden: propose flipping Content-Security-Policy-Report-Only →",
      "Content-Security-Policy (keep script-src 'self'). Confirm with the boxholder",
      "before flipping — this tool proposes, it does not change the policy.",
    ].join("\n");
  }
  const lines = [
    `⚠️  ${total} CSP violation(s), ${violations.length} distinct. Do NOT harden until each is resolved.`,
    "For each: is the blocked origin a legitimate consumer to allowlist, or a real bug?",
    "",
  ];
  for (const v of violations) {
    lines.push(`  ${v.directive}  ←  ${v.blocked}  (${v.count}×, ${v.firstSeen} … ${v.lastSeen})`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const logPath = process.argv[2];
  if (logPath === undefined || logPath === "") {
    process.stderr.write("usage: pnpm csp-digest <path-to-csp-reports.log>\n");
    process.exitCode = 1;
    return;
  }
  let text = "";
  try {
    text = await fs.readFile(path.resolve(logPath), "utf-8");
  } catch (_e) {
    // A missing log means no reports yet — that's a clean digest, not an error.
    text = "";
  }
  process.stdout.write(`${digestCspReports(text).summary}\n`);
}

// Run only as a script, not when imported by the doctest.
if (process.argv[1] !== undefined && process.argv[1].endsWith("csp-digest.ts")) {
  await main();
}
