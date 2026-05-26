/**
 * Semantic text formatting for CLI and web output.
 *
 * Provides semantic formatters (header, success, error, etc.) that
 * translate to ANSI colors for terminal output. The web UI can
 * render these ANSI codes using ansi-to-html.
 */

import { Chalk } from "chalk";

// Force color output even when not a TTY (for web streaming)
const chalk = new Chalk({ level: 2 });

/**
 * Semantic text formatters.
 *
 * These provide consistent styling across the application.
 * Use these instead of raw chalk calls for maintainability.
 */
export const fmt = {
  // === Structure ===

  /** Section header (e.g., "=== Phase 1: Triage ===") */
  header: (text: string) => chalk.bold.cyan(text),

  /** Subheader or label */
  subheader: (text: string) => chalk.bold(text),

  /** Dimmed/muted text for less important info */
  dim: (text: string) => chalk.dim(text),

  // === Status ===

  /** Success indicator */
  success: (text: string) => chalk.green(text),

  /** Success with checkmark */
  ok: (text: string) => chalk.green(`✓ ${text}`),

  /** Error indicator */
  error: (text: string) => chalk.red(text),

  /** Error with X mark */
  fail: (text: string) => chalk.red(`✗ ${text}`),

  /** Warning */
  warn: (text: string) => chalk.yellow(text),

  /** Info/note - uses cyan for better readability on dark backgrounds */
  info: (text: string) => chalk.cyan(text),

  // === Content types ===

  /** File path */
  path: (text: string) => chalk.cyan(text),

  /** Command name */
  cmd: (text: string) => chalk.yellow(text),

  /** Numeric value or count */
  num: (n: number | string) => chalk.magenta(String(n)),

  /** Code or technical term */
  code: (text: string) => chalk.cyan(text),

  /** Emphasis */
  em: (text: string) => chalk.italic(text),

  /** Strong emphasis */
  strong: (text: string) => chalk.bold(text),

  // === Semantic status values ===

  /** Status badge - colored based on status value */
  status: (status: string) => {
    switch (status) {
      case "new":
        return chalk.blue(status);
      case "interesting":
      case "ready":
        return chalk.yellow(status);
      case "fetched":
      case "processed":
      case "summarized":
        return chalk.green(status);
      case "skipped":
      case "fetch-failed":
      case "failed":
        return chalk.red(status);
      case "possibly-interesting":
        return chalk.cyan(status);
      default:
        return chalk.gray(status);
    }
  },

  // === Compound formatters ===

  /** Phase header (e.g., "=== Phase 1: Triage ===") */
  phase: (name: string) => chalk.bold.cyan(`=== ${name} ===`),

  /** Result line with status icon */
  result: (params: { success: boolean; label: string; message: string }) => {
    const { success, label, message } = params;
    return success
      ? `  ${chalk.green("✓")} ${label}: ${message}`
      : `  ${chalk.red("✗")} ${label}: ${message}`;
  },

  /** Progress indicator */
  progress: (params: { current: number; total: number; label: string }) => {
    const { current, total, label } = params;
    return chalk.dim(`[${current}/${total}]`) + ` ${label}`;
  },

  /** Key-value pair */
  kv: (key: string, value: string) =>
    `${chalk.dim(key + ":")} ${value}`,

  /** List item with bullet */
  bullet: (text: string) => `  ${chalk.dim("•")} ${text}`,

  /** Indented text */
  indent: (text: string, level = 1) => "  ".repeat(level) + text,
};

/**
 * Strip ANSI codes from text.
 * Useful for logging or when color support is disabled.
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[\d;]*m/g, "");
}

/**
 * Check if the terminal supports colors.
 */
export function supportsColor(): boolean {
  return chalk.level > 0;
}
