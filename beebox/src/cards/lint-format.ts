/**
 * Lint-result types and terminal formatting for `bbx validate`.
 *
 * Absorbed from the former `cardworks` package (lint/format.ts + the result
 * types from lint/lint.ts). The XML lint *engine* did not come along — only
 * the shared result shapes and the formatter beebox's own
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
  type:
    | "parse"
    | "validation"
    | "reference"
    | "id"
    | "schema"
    | "contains"
    | "canonical"
    | "absolute-path"
    | "display-path"
    | "body";
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
  /** Show only files with issues (default: false). */
  onlyIssues?: boolean;
  /** Base path to strip from file paths for shorter output. */
  basePath?: string;
}

function formatIssue(issue: LintIssue): string {
  const severity = issue.severity === "error" ? "error" : "warning";

  const location = issue.location
    ? `${String(issue.location.startLine)}:${String(issue.location.startColumn)} `
    : "";

  return `  ${location}${severity}: ${issue.message}`;
}

function formatLintResult(result: LintResult, options: FormatOptions): string {
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
    lines.push(path);
    for (const error of result.errors) lines.push(formatIssue(error));
    for (const warning of result.warnings) lines.push(formatIssue(warning));
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
 * Count non-canonical-ref warnings (`type === "canonical"`) across all results.
 * A separate count from {@link countBrokenRefs} on purpose: a relative ref
 * still *resolves*, so mixing it into the broken-ref number would make a box
 * with clean links look broken. Only populated when `bbx validate --canonical`
 * asked for the check.
 */
export function countNonCanonicalRefs(summary: LintSummary): number {
  let count = 0;
  for (const result of summary.results) {
    for (const warning of result.warnings) {
      if (warning.type === "canonical") count++;
    }
  }
  return count;
}

/**
 * Format all lint results into a terminal-ready string with a summary line.
 */
export function formatLintResults(summary: LintSummary, options?: FormatOptions): string {
  const opts = options === undefined ? {} : options;

  const lines: string[] = [];
  for (const result of summary.results) {
    const formatted = formatLintResult(result, opts);
    if (formatted) lines.push(formatted);
  }

  if (summary.totalErrors === 0 && summary.totalWarnings === 0) {
    lines.push(
      `✓ ${String(summary.filesChecked)} files checked, no issues found`
    );
  } else {
    const errorPart =
      summary.totalErrors > 0
        ? `${String(summary.totalErrors)} error${summary.totalErrors === 1 ? "" : "s"}`
        : "";
    const warningPart =
      summary.totalWarnings > 0
        ? `${String(summary.totalWarnings)} warning${summary.totalWarnings === 1 ? "" : "s"}`
        : "";
    const parts = [errorPart, warningPart].filter(Boolean).join(" and ");
    const brokenRefs = countBrokenRefs(summary);
    const brokenRefPart =
      brokenRefs > 0
        ? ` (${String(brokenRefs)} broken ref${brokenRefs === 1 ? "" : "s"})`
        : "";
    lines.push(
      `${String(summary.filesChecked)} file${summary.filesChecked === 1 ? "" : "s"} checked, ${parts} in ${String(summary.filesWithErrors)} file${summary.filesWithErrors === 1 ? "" : "s"}${brokenRefPart}`
    );
  }

  return lines.join("\n");
}
