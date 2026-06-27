/**
 * Markdown linting for `cb validate`: file discovery, the markdownlint config
 * (style rules + the box's custom CB001/CB002 link rules), and result
 * formatting. Split out of `validate.ts` so the staged/all/box-wide collectors
 * share one definition of "what counts as a lintable markdown file" and how it's
 * linted.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { lint as markdownlint } from "markdownlint/promise";
import type { LintError } from "markdownlint";
import { customLinkRules, linkRuleConfig } from "../../core/markdown-lint-rules.js";

const SKIP_DIRS = new Set(["node_modules", ".git", ".pnpm", ".claude"]);
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

export async function findMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (entries === null) return [];
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        const sub = await findMarkdownFiles(path.join(dir, entry.name));
        results.push(...sub);
      }
    } else if (entry.isFile() && entry.name.endsWith(".md") && !SKIP_FILES.has(entry.name)) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results.toSorted();
}

export interface MarkdownLintSummary {
  filesChecked: number;
  filesWithErrors: number;
  totalErrors: number;
  errors: Record<string, LintError[]>;
}

export async function lintMarkdownFiles(
  files: string[],
  { boxRoot }: { boxRoot: string }
): Promise<MarkdownLintSummary> {
  const results = await markdownlint({ files, config: markdownConfig(boxRoot), customRules: customLinkRules });
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
