/**
 * Lint-result types and terminal formatting for `cb validate`.
 *
 * Absorbed from the former `cardworks` package (lint/format.ts + the result
 * types from lint/lint.ts). The XML lint *engine* did not come along — only
 * the shared result shapes and the formatter callback-box's own
 * `card-lint.ts` dispatcher produces and prints.
 */

/** Minimal source location. The formatter reads only startLine/startColumn. */
export interface Location {
  source: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** A lint issue (error or warning). */
export interface LintIssue {
  type: "parse" | "validation" | "reference" | "id" | "schema" | "contains";
  severity: "error" | "warning";
  message: string;
  location?: Location;
}

/** Result of linting a single card. */
export interface LintResult {
  path: string;
  errors: LintIssue[];
  warnings: LintIssue[];
}

/** Summary of all lint results. */
export interface LintSummary {
  results: LintResult[];
  totalErrors: number;
  totalWarnings: number;
  filesChecked: number;
  filesWithErrors: number;
}

interface FormatOptions {
  /** Use colors in output (default: true). */
  colors?: boolean;
  /** Show only files with issues (default: false). */
  onlyIssues?: boolean;
  /** Base path to strip from file paths for shorter output. */
  basePath?: string;
}

// ANSI color codes
const colors = {
  red: "[31m",
  yellow: "[33m",
  green: "[32m",
  gray: "[90m",
  bold: "[1m",
  reset: "[0m",
};

const noColors = { red: "", yellow: "", green: "", gray: "", bold: "", reset: "" };

function formatIssue(issue: LintIssue, useColors: boolean): string {
  const c = useColors ? colors : noColors;

  const severity =
    issue.severity === "error"
      ? `${c.red}error${c.reset}`
      : `${c.yellow}warning${c.reset}`;

  const location = issue.location
    ? `${c.gray}${String(issue.location.startLine)}:${String(issue.location.startColumn)}${c.reset} `
    : "";

  return `  ${location}${severity}: ${issue.message}`;
}

function formatLintResult(result: LintResult, options: FormatOptions): string {
  const useColors = options.colors === undefined ? true : options.colors;
  const c = useColors ? colors : noColors;

  let path = result.path;
  if (options.basePath !== undefined && path.startsWith(options.basePath)) {
    path = path.slice(options.basePath.length);
    if (path.startsWith("/")) path = path.slice(1);
  }

  const lines: string[] = [];
  const hasIssues = result.errors.length > 0 || result.warnings.length > 0;

  if (!hasIssues && options.onlyIssues === true) {
    return "";
  }

  if (hasIssues) {
    lines.push(`${c.bold}${path}${c.reset}`);
    for (const error of result.errors) lines.push(formatIssue(error, useColors));
    for (const warning of result.warnings) lines.push(formatIssue(warning, useColors));
    lines.push(""); // blank line after
  }

  return lines.join("\n");
}

/**
 * Count broken-reference warnings (`type === "reference"`) across all
 * results. These are the subset of warnings raised by the ref-resolution
 * walk in `card-lint.ts` — worth calling out separately in the summary since
 * they accumulate silently (a box can carry thousands from renames/deletes)
 * and would otherwise hide inside the generic warning count.
 */
export function countBrokenRefs(summary: LintSummary): number {
  let count = 0;
  for (const result of summary.results) {
    for (const warning of result.warnings) {
      if (warning.type === "reference") count++;
    }
  }
  return count;
}

/**
 * Format all lint results into a terminal-ready string with a summary line.
 */
export function formatLintResults(summary: LintSummary, options?: FormatOptions): string {
  const opts = options === undefined ? {} : options;
  const useColors = opts.colors === undefined ? true : opts.colors;
  const c = useColors ? colors : noColors;

  const lines: string[] = [];
  for (const result of summary.results) {
    const formatted = formatLintResult(result, opts);
    if (formatted) lines.push(formatted);
  }

  if (summary.totalErrors === 0 && summary.totalWarnings === 0) {
    lines.push(
      `${c.green}✓${c.reset} ${String(summary.filesChecked)} files checked, no issues found`
    );
  } else {
    const errorPart =
      summary.totalErrors > 0
        ? `${c.red}${String(summary.totalErrors)} error${summary.totalErrors === 1 ? "" : "s"}${c.reset}`
        : "";
    const warningPart =
      summary.totalWarnings > 0
        ? `${c.yellow}${String(summary.totalWarnings)} warning${summary.totalWarnings === 1 ? "" : "s"}${c.reset}`
        : "";
    const parts = [errorPart, warningPart].filter(Boolean).join(" and ");
    const brokenRefs = countBrokenRefs(summary);
    const brokenRefPart =
      brokenRefs > 0
        ? ` (${c.yellow}${String(brokenRefs)} broken ref${brokenRefs === 1 ? "" : "s"}${c.reset})`
        : "";
    lines.push(
      `${String(summary.filesChecked)} file${summary.filesChecked === 1 ? "" : "s"} checked, ${parts} in ${String(summary.filesWithErrors)} file${summary.filesWithErrors === 1 ? "" : "s"}${brokenRefPart}`
    );
  }

  return lines.join("\n");
}
