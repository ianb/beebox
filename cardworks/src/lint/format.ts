import type { LintResult, LintSummary, LintIssue } from "./lint.js";

/**
 * Options for formatting lint results.
 */
export interface FormatOptions {
  /** Use colors in output (default: true if TTY) */
  colors?: boolean;
  /** Show only files with issues (default: false) */
  onlyIssues?: boolean;
  /** Base path to strip from file paths for shorter output */
  basePath?: string;
}

// ANSI color codes
const colors = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

/**
 * Format a single lint issue.
 */
function formatIssue(issue: LintIssue, useColors: boolean): string {
  const c = useColors ? colors : { red: "", yellow: "", gray: "", bold: "", reset: "" };

  const severity =
    issue.severity === "error"
      ? `${c.red}error${c.reset}`
      : `${c.yellow}warning${c.reset}`;

  const location = issue.location
    ? `${c.gray}${String(issue.location.startLine)}:${String(issue.location.startColumn)}${c.reset} `
    : "";

  return `  ${location}${severity}: ${issue.message}`;
}

/**
 * Format a single lint result.
 */
export function formatLintResult(result: LintResult, options: FormatOptions = {}): string {
  const useColors = options.colors ?? true;
  const c = useColors ? colors : { red: "", yellow: "", green: "", gray: "", bold: "", reset: "" };

  let path = result.path;
  if (options.basePath && path.startsWith(options.basePath)) {
    path = path.slice(options.basePath.length);
    if (path.startsWith("/")) path = path.slice(1);
  }

  const lines: string[] = [];
  const hasIssues = result.errors.length > 0 || result.warnings.length > 0;

  if (!hasIssues && options.onlyIssues) {
    return "";
  }

  if (hasIssues) {
    lines.push(`${c.bold}${path}${c.reset}`);

    for (const error of result.errors) {
      lines.push(formatIssue(error, useColors));
    }

    for (const warning of result.warnings) {
      lines.push(formatIssue(warning, useColors));
    }

    lines.push(""); // blank line after
  }

  return lines.join("\n");
}

/**
 * Format all lint results.
 */
export function formatLintResults(summary: LintSummary, options: FormatOptions = {}): string {
  const useColors = options.colors ?? true;
  const c = useColors ? colors : { red: "", yellow: "", green: "", gray: "", bold: "", reset: "" };

  const lines: string[] = [];

  // Format each result
  for (const result of summary.results) {
    const formatted = formatLintResult(result, options);
    if (formatted) {
      lines.push(formatted);
    }
  }

  // Summary line
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

    lines.push(
      `${String(summary.filesChecked)} files checked, ${parts} in ${String(summary.filesWithErrors)} file${summary.filesWithErrors === 1 ? "" : "s"}`
    );
  }

  return lines.join("\n");
}

/**
 * Format lint results as JSON.
 */
export function formatLintResultsJson(summary: LintSummary): string {
  return JSON.stringify(summary, null, 2);
}
