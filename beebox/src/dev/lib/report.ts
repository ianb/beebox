/**
 * Knowledge Audit report generation — produces markdown reports
 * from audit results for manual evaluation.
 */

import type { TestResult } from "./test-runner.js";
import type { ContextHistoryEntry } from "./context-history.js";
import { invariant } from "../../lib/invariant.js";

export interface ReportOptions {
  boxRoot: string;
  results: TestResult[];
  timestamp?: string;
  /**
   * Prior history for this box (audit id → entries, oldest first), loaded
   * before this run was appended. Drives the run-over-run baseline deltas.
   */
  priorHistory?: Record<string, ContextHistoryEntry[]>;
}

export function generateReport(options: ReportOptions): string {
  const { boxRoot, results } = options;
  const priorHistory = options.priorHistory ?? {};
  const timestamp = options.timestamp ?? new Date().toISOString();
  const lines: string[] = [];

  lines.push(`# Knowledge Audit Report — ${timestamp}`);
  lines.push("");
  lines.push(`Box: ${boxRoot}`);
  const engines = [...new Set(results.map((result) => result.engine))];
  lines.push(`Engine: ${engines.join(", ")}`);
  lines.push(`Tests run: ${results.length}`);
  lines.push("");

  const summary = renderContextSummary(results, priorHistory);
  if (summary.length > 0) {
    lines.push(...summary);
    lines.push("---");
    lines.push("");
  }

  for (const result of results) {
    lines.push(formatTestResult(result, lastBaseline(priorHistory[result.test.id])));
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

/** Most recent prior baseline for an audit, or undefined on its first run. */
function lastBaseline(entries: ContextHistoryEntry[] | undefined): number | undefined {
  if (!entries || entries.length === 0) return undefined;
  const last = entries[entries.length - 1];
  invariant(last !== undefined, "entries must be non-empty (checked above)");
  return last.initial;
}

/** Rounded thousands delta between a current and prior baseline. */
function deltaK(current: number, prior: number): number {
  return Math.round((current - prior) / 1000);
}

/**
 * Trailing clause comparing a baseline to the prior run's, e.g. "; -3k from
 * last run". Empty when there's no prior run; "~same" when the change rounds
 * below 1k (sub-1k drift is noise at this report's 1k resolution).
 */
export function formatBaselineDelta(current: number, prior: number | undefined): string {
  if (prior === undefined) return "";
  const k = deltaK(current, prior);
  if (k === 0) return "; ~same as last run";
  return `; ${k > 0 ? "+" : "-"}${Math.abs(k)}k from last run`;
}

/** Δ-column cell for the summary table: "—" first run, "~0" sub-1k, else signed. */
function formatDeltaCell(current: number, prior: number | undefined): string {
  if (prior === undefined) return "—";
  const k = deltaK(current, prior);
  if (k === 0) return "~0";
  return `${k > 0 ? "+" : "-"}${Math.abs(k)}k`;
}

/**
 * Aggregate baseline table opening the report: every audit's always-on
 * baseline, sorted high→low, with the run-over-run delta. The lowest baseline
 * is the cleanest estimate of the pure always-on tier (a 0-read audit pays only
 * the baseline), so it's called out. Empty when no result measured context.
 */
export function renderContextSummary(
  results: TestResult[],
  priorHistory: Record<string, ContextHistoryEntry[]>,
): string[] {
  const rows = results.flatMap((r) => {
    if (r.behavior.context === null) return [];
    return [
      {
        id: r.test.id,
        initial: r.behavior.context.initialTokens,
        prior: lastBaseline(priorHistory[r.test.id]),
      },
    ];
  });
  if (rows.length === 0) return [];
  rows.sort((a, b) => b.initial - a.initial);

  const lines: string[] = ["## Context baselines", "", "| Audit | Initial | Δ last run |", "|---|--:|--:|"];
  for (const row of rows) {
    lines.push(`| ${row.id} | ${tokensToK(row.initial)} | ${formatDeltaCell(row.initial, row.prior)} |`);
  }
  const lowest = rows[rows.length - 1];
  invariant(lowest !== undefined, "rows must be non-empty (checked above)");
  lines.push("");
  lines.push(`Lowest baseline ≈ pure always-on tier: ${tokensToK(lowest.initial)} (\`${lowest.id}\`).`);
  lines.push("");
  return lines;
}

function formatTestResult(result: TestResult, priorInitial: number | undefined): string {
  const { test, behavior, checks } = result;
  const lines: string[] = [];

  lines.push(...formatTestHeader(test));
  lines.push(...formatAgentBehavior(behavior, priorInitial));
  lines.push(...formatResponse(behavior));

  const checkLines = formatCheckLines(checks);
  if (checkLines.length > 0) {
    lines.push("**Automated checks:**");
    lines.push(...checkLines);
    lines.push("");
  }

  lines.push("**Assessment:** (to be filled in during evaluation)");
  lines.push("");

  return lines.join("\n");
}

type Test = TestResult["test"];
type Behavior = TestResult["behavior"];
type Checks = TestResult["checks"];

function formatTestHeader(test: Test): string[] {
  const lines: string[] = [];
  lines.push(`## ${test.id}`);
  lines.push(`**Prompt:** "${test.prompt}"`);
  lines.push(`**Expected level:** ${test.expected_level}`);
  lines.push(`**Watch for:** ${test.watch_for}`);
  if (test.notes) {
    lines.push(`**Notes:** ${test.notes}`);
  }
  lines.push("");
  return lines;
}

function formatAgentBehavior(behavior: Behavior, priorInitial: number | undefined): string[] {
  const lines: string[] = [];
  lines.push("**Agent behavior:**");
  lines.push(`- Files read: ${behavior.filesRead.length === 0 ? "(none)" : behavior.filesRead.join(", ")}`);
  lines.push(`- Searches: ${behavior.searches.length === 0 ? "(none)" : behavior.searches.map((s) => `${s.tool}: ${s.summary}`).join("; ")}`);
  if (behavior.bashCommands.length > 0) {
    lines.push(`- Bash: ${behavior.bashCommands.join("; ")}`);
  }
  lines.push(`- Response length: ${behavior.responseLength} words`);
  const contextLine = formatContextLine(behavior.context, priorInitial);
  if (contextLine) lines.push(contextLine);
  lines.push("");
  return lines;
}

/** Round a token count to the nearest 1k, e.g. 38539 → "39k". */
function tokensToK(n: number): string {
  return `${Math.round(n / 1000)}k`;
}

/**
 * One-line context-size summary. The report is a human-read artifact, so 1k
 * rounding reads cleaner than exact counts. Collapses to just the baseline
 * when the context never grew (single-turn / 0-read answers).
 */
function formatContextLine(context: Behavior["context"], priorInitial: number | undefined): string | null {
  if (!context) return null;
  const { initialTokens, peakTokens, addedTokens, turnCount } = context;
  const turns = `${turnCount} turn${turnCount === 1 ? "" : "s"}`;
  const delta = formatBaselineDelta(initialTokens, priorInitial);
  if (addedTokens === 0) {
    return `- Context: ${tokensToK(initialTokens)} initial (${turns}${delta})`;
  }
  return `- Context: ${tokensToK(initialTokens)} initial → ${tokensToK(peakTokens)} peak (+${tokensToK(addedTokens)} over ${turns}${delta})`;
}

function formatResponse(behavior: Behavior): string[] {
  const lines: string[] = [];
  lines.push("**Response:**");
  const truncated = behavior.responseText.length > 2000
    ? behavior.responseText.substring(0, 2000) + "..."
    : behavior.responseText;
  for (const line of truncated.split("\n")) {
    lines.push(`> ${line}`);
  }
  lines.push("");
  return lines;
}

function formatShouldReadAny(checks: Checks): string[] {
  if (checks.shouldReadAnyCheck === undefined) return [];
  const check = checks.shouldReadAnyCheck;
  const detail = check.matched === undefined ? "" : ` (matched ${check.matched})`;
  return [`- ${check.wasRead ? "\u2713" : "\u2717"} Read any of [${check.files.join(", ")}]${detail}`];
}

function formatCheckLines(checks: Checks): string[] {
  const checkLines = formatPositiveTextChecks(checks);
  for (const c of checks.notContainsChecks) {
    // Forbidden: pass when *not* found, fail when found.
    checkLines.push(`- ${c.found ? "\u2717" : "\u2713"} Response does NOT contain "${c.forbidden}"`);
  }
  for (const c of checks.notMatchesChecks) {
    // Forbidden pattern: pass when *not* matched, fail when matched.
    const detail = c.found && c.matched ? ` (matched "${c.matched}")` : "";
    checkLines.push(`- ${c.found ? "✗" : "✓"} Response does NOT match /${c.pattern}/${detail}`);
  }
  if (checks.containsAnyCheck) {
    const c = checks.containsAnyCheck;
    const detail = c.found && c.matched ? ` (matched "${c.matched}")` : "";
    checkLines.push(`- ${c.found ? "\u2713" : "\u2717"} Response contains any of [${c.options.map((o) => `"${o}"`).join(", ")}]${detail}`);
  }
  for (const c of checks.cardsContainChecks) {
    const detail = c.found && c.foundIn ? ` (in ${c.foundIn})` : "";
    checkLines.push(`- ${c.found ? "\u2713" : "\u2717"} Card contains "${c.expected}"${detail}`);
  }
  for (const c of checks.shouldReadChecks) {
    checkLines.push(`- ${c.wasRead ? "\u2713" : "\u2717"} Read ${c.file}`);
  }
  checkLines.push(...formatShouldReadAny(checks));
  for (const c of checks.shouldNotReadChecks) {
    checkLines.push(`- ${c.wasRead ? "\u2717" : "\u2713"} Did not read ${c.file}`);
  }
  for (const c of checks.bashContainsChecks) {
    const detail = c.found && c.matchedCommand ? ` (matched: "${c.matchedCommand}")` : "";
    checkLines.push(`- ${c.found ? "\u2713" : "\u2717"} Bash command contains "${c.expected}"${detail}`);
  }
  return checkLines;
}

function formatPositiveTextChecks(checks: Checks): string[] {
  const lines = checks.containsChecks.map((check) =>
    `- ${check.found ? "✓" : "✗"} Response contains "${check.expected}"`);
  for (const check of checks.matchesChecks) {
    const detail = check.found && check.matched ? ` (matched "${check.matched}")` : "";
    lines.push(`- ${check.found ? "✓" : "✗"} Response matches /${check.pattern}/${detail}`);
  }
  return lines;
}
