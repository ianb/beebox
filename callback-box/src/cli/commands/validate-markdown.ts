/**
 * Markdown linting for `cb validate`: file discovery, the markdownlint config
 * (style rules + the box's custom CB001/CB002 link rules), and result
 * formatting. Split out of `validate.ts` so the staged/all/box-wide collectors
 * share one definition of "what counts as a lintable markdown file" and how it's
 * linted.
 */

import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import { lint as markdownlint } from "markdownlint/promise";
import type { LintError } from "markdownlint";
import { customLinkRules, linkRuleConfig } from "../../core/markdown-lint-rules.js";
import { listBoxMarkdownFiles } from "../../core/list-cards.js";

const execFileP = promisify(execFile);

const SKIP_DIRS = new Set(["node_modules", ".git", ".pnpm", ".claude", ".callback-box"]);
const SKIP_FILES = new Set(["CLAUDE.md"]);

// Opt-in validity rules: a few markdownlint style rules plus the box's custom
// link rules (CB001/CB002). `default: false` keeps everything else off. CB002
// needs the box root, so this is a per-call builder, not a constant.
function markdownConfig(boxRoot: string): Record<string, unknown> {
  return {
    default: false,
    MD009: true, // trailing spaces
    MD037: true, // spaces inside emphasis markers
    MD038: true, // spaces inside code span elements
    MD047: true, // files should end with a single newline
    ...linkRuleConfig(boxRoot),
  };
}

/**
 * True if `filePath` is a markdown file we lint. Shared by the recursive box
 * scan and the staged-file collector so `--all` and `--staged` agree on the
 * skip set (CLAUDE.md, and anything under node_modules/.git/.pnpm/.claude).
 */
export function isLintableMarkdown(filePath: string): boolean {
  if (!filePath.endsWith(".md")) return false;
  const parts = filePath.split(path.sep);
  if (parts.some((p) => SKIP_DIRS.has(p))) return false;
  return !SKIP_FILES.has(parts[parts.length - 1]!);
}

/**
 * Absolute paths of git-staged markdown files worth linting (same skip set as
 * the box scan). Mirrors `listStagedCards`, so `cb validate --staged` covers a
 * staged dossier edit the way it already covers staged cards.
 */
export async function listStagedMarkdown(boxRoot: string): Promise<string[]> {
  const { stdout } = await execFileP(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { cwd: boxRoot, maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout
    .split("\n")
    .filter((rel) => rel !== "" && isLintableMarkdown(rel))
    .map((rel) => path.join(boxRoot, rel));
}

export interface MarkdownLintSummary {
  filesChecked: number;
  filesWithErrors: number;
  totalErrors: number;
  errors: Record<string, LintError[]>;
}

async function runMarkdownlint(files: string[], config: Record<string, unknown>): Promise<MarkdownLintSummary> {
  const results = await markdownlint({ files, config, customRules: customLinkRules });
  let filesWithErrors = 0;
  let totalErrors = 0;
  const errors: Record<string, LintError[]> = {};
  for (const file of files) {
    const fileErrors = results[file] ?? [];
    if (fileErrors.length > 0) {
      filesWithErrors++;
      totalErrors += fileErrors.length;
      errors[file] = fileErrors;
    }
  }
  return { filesChecked: files.length, filesWithErrors, totalErrors, errors };
}

/** Full markdown validity: style rules (MD0xx) + the custom link rules. */
export async function lintMarkdownFiles(
  files: string[],
  { boxRoot }: { boxRoot: string }
): Promise<MarkdownLintSummary> {
  return runMarkdownlint(files, markdownConfig(boxRoot));
}

/**
 * Box-wide broken-link scan for the commit-time WARNING pass: link rules only
 * (no style rules), and the caller treats it as non-fatal. Catches a move that
 * breaks links in an *unstaged* referrer — which `--staged` can never see —
 * without blocking the commit. Returns formatted findings, or null if clean.
 */
export async function boxWideLinkWarnings(boxRoot: string): Promise<string | null> {
  const mdFiles = await listBoxMarkdownFiles(boxRoot);
  if (mdFiles.length === 0) return null;
  const summary = await runMarkdownlint(mdFiles, { default: false, ...linkRuleConfig(boxRoot) });
  if (summary.totalErrors === 0) return null;
  const fileWord = summary.filesWithErrors === 1 ? "file" : "files";
  return (
    `${formatMarkdownResults(summary, { colors: false })}\n\n` +
    `${summary.totalErrors} broken internal link(s) in ${summary.filesWithErrors} ${fileWord} ` +
    "(warning — not blocking the commit; fix with `cb mv` or by correcting the link)"
  );
}

export function formatMarkdownResults(summary: MarkdownLintSummary, { colors }: { colors: boolean }): string {
  const lines: string[] = [];
  const ESC = "";
  const red = colors ? (s: string) => `${ESC}[31m${s}${ESC}[0m` : (s: string) => s;
  for (const [file, fileErrors] of Object.entries(summary.errors)) {
    for (const e of fileErrors) {
      const rule = e.ruleNames[0] ?? "unknown";
      const detail = e.errorDetail ? ` (${e.errorDetail})` : "";
      lines.push(`${red("error")}  ${file}:${e.lineNumber}  [${rule}] ${e.ruleDescription}${detail}`);
    }
  }
  return lines.join("\n");
}
