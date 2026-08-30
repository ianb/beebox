/**
 * Digest of Content-Security-Policy violation reports.
 *
 * Reads the JSONL `csp-reports.log` (written by the `/api/csp-report` sink) and
 * summarizes it: which directives fired, against which origins, how often, and
 * first/last seen. It *arranges context* for the harden decision and proposes the
 * Report-Only → enforcing flip when the log is clean, but it never edits the
 * policy itself; a human/agent confirms. See docs/content-security-policy.md.
 *
 * Default (box) mode is **incremental**: it reads the primary box's log, reports
 * only entries newer than the last run (tracked by a timestamp cursor written
 * beside the log, in the git-ignored `.beebox/`), and advances the cursor.
 * This is what the local scheduled review routine runs — each run only sees, and
 * analyzes, what's new. `--all` digests the whole log without touching the cursor
 * (use it to judge a harden); a positional `<logPath>` digests an explicit file.
 *
 *   pnpm csp-digest                 # new violations in ~/src/boxes/test1 since last run
 *   pnpm csp-digest --box <path>    # ... in another box
 *   pnpm csp-digest --all           # whole log, ignore + don't advance the cursor
 *   pnpm csp-digest --json          # emit the digest as JSON for an agent to analyze
 *   pnpm csp-digest <path-to-log>   # digest an explicit file (no cursor)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { cspReportLogPath } from "../webapp/routes/api-csp-report.js";
import { resolveOperationalRoot } from "../lib/box-shape.js";
import { isRecord } from "../core/card-io.js";

const CURSOR_FILE = "csp-digest-cursor.json";
// The package root, not the operational root — a v2 box's log lives under
// its `content/` subdirectory. `runDigest` resolves this (and any `--box`
// override) through `resolveOperationalRoot` before building the log path, so
// this constant can stay a stable, human-typeable path (and tolerates a path
// that isn't a box).
const DEFAULT_BOX = path.join(process.env.HOME ?? "~", "src/boxes/test1");

/** One parsed report line. */
export interface CspEntry {
  ts: string;
  directive: string;
  blocked: string;
  doc: string;
}

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

function str(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "-";
}

/**
 * Parse the JSONL log into entries. Each line is one JSON object; blank lines and
 * any non-JSON line (a partial write, or a pre-JSONL line from before this format)
 * are skipped — the log is append-only and best-effort.
 */
export function parseCspLog(logText: string): CspEntry[] {
  const entries: CspEntry[] = [];
  for (const line of logText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch (_e) {
      // Not JSON (partial write / legacy line) — drop it, don't fail the digest.
      continue;
    }
    if (!isRecord(obj)) continue;
    if (typeof obj["ts"] !== "string") continue;
    entries.push({ ts: obj["ts"], directive: str(obj["directive"]), blocked: str(obj["blocked"]), doc: str(obj["doc"]) });
  }
  return entries;
}

/**
 * Entries strictly newer than `since` (a prior cursor's ISO timestamp). ISO-8601
 * UTC timestamps are fixed-width, so lexical `>` is chronological. `since === null`
 * (no cursor yet) returns everything.
 */
export function entriesSince(entries: CspEntry[], since: string | null): CspEntry[] {
  if (since === null) return entries;
  return entries.filter((e) => e.ts > since);
}

/** Newest timestamp across entries, or null if there are none. Used to advance the cursor. */
export function newestTs(entries: CspEntry[]): string | null {
  let max: string | null = null;
  for (const e of entries) {
    if (max === null || e.ts > max) max = e.ts;
  }
  return max;
}

/** Dedupe entries into a digest. `incremental` + `since` only shape the summary wording. */
export function digestEntries(entries: CspEntry[], opts?: { incremental?: boolean; since?: string }): CspDigest {
  const byKey = new Map<string, CspViolation>();
  for (const e of entries) {
    const key = `${e.directive} ${e.blocked}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { directive: e.directive, blocked: e.blocked, count: 1, firstSeen: e.ts, lastSeen: e.ts });
    } else {
      existing.count++;
      existing.lastSeen = e.ts;
    }
  }
  const violations = [...byKey.values()].toSorted((a, b) => b.count - a.count);
  const clean = violations.length === 0;
  const summary = formatSummary({
    violations,
    clean,
    total: entries.length,
    incremental: opts?.incremental ?? false,
    since: opts?.since ?? "(first run)",
  });
  return { total: entries.length, violations, clean, summary };
}

/** Convenience for whole-log digests (used by the doctest): parse + dedupe in one call. */
export function digestCspReports(logText: string): CspDigest {
  return digestEntries(parseCspLog(logText));
}

function formatViolationLines(violations: CspViolation[]): string[] {
  return violations.map((v) => `  ${v.directive}  ←  ${v.blocked}  (${v.count}×, ${v.firstSeen} … ${v.lastSeen})`);
}

function formatSummary(
  { violations, clean, total, incremental, since }:
  { violations: CspViolation[]; clean: boolean; total: number; incremental: boolean; since: string },
): string {
  // Incremental (box) mode reports only the delta since the cursor. The harden
  // verdict is a whole-log judgment, so it's deferred to `--all`, not asserted here.
  if (incremental) {
    if (clean) return `✅ No new CSP violations since ${since}.`;
    return [
      `⚠️  ${total} new CSP violation(s) since ${since}, ${violations.length} distinct:`,
      "",
      ...formatViolationLines(violations),
      "",
      "Analyze each: a legitimate consumer to allowlist (src/lib/csp.ts) or a real bug?",
      "Run `pnpm csp-digest --all` for the full-log view before judging a harden.",
    ].join("\n");
  }
  if (clean) {
    return [
      "✅ No CSP violations recorded.",
      "Safe to harden: propose flipping Content-Security-Policy-Report-Only →",
      "Content-Security-Policy (keep script-src 'self'). Confirm with the boxholder",
      "before flipping — this tool proposes, it does not change the policy.",
    ].join("\n");
  }
  return [
    `⚠️  ${total} CSP violation(s), ${violations.length} distinct. Do NOT harden until each is resolved.`,
    "For each: is the blocked origin a legitimate consumer to allowlist, or a real bug?",
    "",
    ...formatViolationLines(violations),
  ].join("\n");
}

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (_e) {
    // A missing log means no reports yet — that's a clean digest, not an error.
    return "";
  }
}

async function readCursor(cursorFile: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(cursorFile, "utf-8"));
    return typeof parsed?.since === "string" ? parsed.since : null;
  } catch (_e) {
    // No cursor yet (first run) or unreadable — treat as "everything is new".
    return null;
  }
}

async function writeCursor(cursorFile: string, since: string): Promise<void> {
  await fs.mkdir(path.dirname(cursorFile), { recursive: true });
  await fs.writeFile(cursorFile, `${JSON.stringify({ since }, null, 2)}\n`);
}

async function runDigest(
  logPath: string | undefined,
  opts: { box?: string; all?: boolean; json?: boolean },
): Promise<void> {
  // Explicit-file mode (positional path): digest exactly that file, no cursor.
  // Box mode (default): resolve the log under the box and track a sibling cursor,
  // unless --all asks for the whole-log view.
  let resolvedLog: string;
  let cursorFile: string | null;
  if (logPath !== undefined && logPath !== "") {
    resolvedLog = path.resolve(logPath);
    cursorFile = null;
  } else {
    resolvedLog = cspReportLogPath(await resolveOperationalRoot(opts.box ?? DEFAULT_BOX));
    cursorFile = opts.all === true ? null : path.join(path.dirname(resolvedLog), CURSOR_FILE);
  }

  const entries = parseCspLog(await readFileOrEmpty(resolvedLog));
  const since = cursorFile === null ? null : await readCursor(cursorFile);
  const selected = entriesSince(entries, since);
  const digest = digestEntries(selected, { incremental: cursorFile !== null, since: since ?? "(first run)" });

  process.stdout.write(opts.json === true ? `${JSON.stringify(digest, null, 2)}\n` : `${digest.summary}\n`);

  // Advance the cursor to the newest entry in the whole file (the tail), so the
  // next run resumes after it. No-op when the log is empty or we're not tracking.
  if (cursorFile !== null) {
    const newest = newestTs(entries);
    if (newest !== null) await writeCursor(cursorFile, newest);
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("csp-digest")
    .description("Summarize CSP violation reports; incremental by default (per-box cursor).")
    .argument("[logPath]", "digest an explicit log file (disables the cursor)")
    .option("--box <path>", "box root whose log to read", DEFAULT_BOX)
    .option("--all", "digest the whole log; ignore and don't advance the cursor")
    .option("--json", "emit the digest as JSON instead of the text summary")
    .action(runDigest);
  await program.parseAsync();
}

// Run only as a script, not when imported by the doctest.
if (process.argv[1] !== undefined && process.argv[1].endsWith("csp-digest.ts")) {
  await main();
}
