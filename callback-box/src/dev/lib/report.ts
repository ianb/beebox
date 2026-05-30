/**
 * Knowledge Audit report generation — produces markdown reports
 * from audit results for manual evaluation.
 */

import type { TestResult } from "./test-runner.js";

export interface ReportOptions {
  boxRoot: string;
  results: TestResult[];
  timestamp?: string;
}

export function generateReport(options: ReportOptions): string {
  const { boxRoot, results } = options;
  const timestamp = options.timestamp ?? new Date().toISOString();
  const lines: string[] = [];

  lines.push(`# Knowledge Audit Report — ${timestamp}`);
  lines.push("");
  lines.push(`Box: ${boxRoot}`);
  lines.push(`Tests run: ${results.length}`);
  lines.push("");

  for (const result of results) {
    lines.push(formatTestResult(result));
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

function formatTestResult(result: TestResult): string {
  const { test, behavior, checks } = result;
  const lines: string[] = [];

  lines.push(...formatTestHeader(test));
  lines.push(...formatAgentBehavior(behavior));
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

function formatAgentBehavior(behavior: Behavior): string[] {
  const lines: string[] = [];
  lines.push("**Agent behavior:**");
  lines.push(`- Files read: ${behavior.filesRead.length === 0 ? "(none)" : behavior.filesRead.join(", ")}`);
  lines.push(`- Searches: ${behavior.searches.length === 0 ? "(none)" : behavior.searches.map((s) => `${s.tool}: ${s.summary}`).join("; ")}`);
  if (behavior.bashCommands.length > 0) {
    lines.push(`- Bash: ${behavior.bashCommands.join("; ")}`);
  }
  lines.push(`- Response length: ${behavior.responseLength} words`);
  lines.push("");
  return lines;
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

function formatCheckLines(checks: Checks): string[] {
  const checkLines: string[] = [];
  for (const c of checks.containsChecks) {
    checkLines.push(`- ${c.found ? "\u2713" : "\u2717"} Response contains "${c.expected}"`);
  }
  for (const c of checks.notContainsChecks) {
    // Forbidden: pass when *not* found, fail when found.
    checkLines.push(`- ${c.found ? "\u2717" : "\u2713"} Response does NOT contain "${c.forbidden}"`);
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
  for (const c of checks.shouldNotReadChecks) {
    checkLines.push(`- ${c.wasRead ? "\u2717" : "\u2713"} Did not read ${c.file}`);
  }
  for (const c of checks.bashContainsChecks) {
    const detail = c.found && c.matchedCommand ? ` (matched: "${c.matchedCommand}")` : "";
    checkLines.push(`- ${c.found ? "\u2713" : "\u2717"} Bash command contains "${c.expected}"${detail}`);
  }
  return checkLines;
}
