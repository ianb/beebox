/**
 * cb validate - Validate cards and markdown against schemas/rules
 */

import { Command } from "commander";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { lintAll, lintCards, formatLintResults, type LintSummary } from "cardworks";
import { lint as markdownlint } from "markdownlint/promise";
import type { LintError } from "markdownlint";
import { noViewLabelLinks, noBrokenInternalLinks } from "../../core/markdown-lint-rules.js";
import { requireBoxRoot, isCardFile, isMarkdownFile } from "../lib/paths.js";
import { createLoader } from "../lib/loader.js";
import { getStatus } from "../lib/git.js";
import { lintAttachLayout, type AttachLintError } from "../../lib/attach-lint.js";

const SKIP_DIRS = new Set(["node_modules", ".git", ".pnpm", ".claude"]);
const SKIP_FILES = new Set(["CLAUDE.md"]);

// Opt-in validity rules only — style rules are not enforced.
const MARKDOWN_CONFIG = {
  default: false,
  MD009: true, // trailing spaces
  MD037: true, // spaces inside emphasis markers
  MD038: true, // spaces inside code span elements
  MD047: true, // files should end with a single newline
};

const CUSTOM_RULES = [noViewLabelLinks, noBrokenInternalLinks];

async function findMarkdownFiles(dir: string): Promise<string[]> {
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

interface MarkdownLintSummary {
  filesChecked: number;
  filesWithErrors: number;
  totalErrors: number;
  errors: Record<string, LintError[]>;
}

async function lintMarkdownFiles(files: string[]): Promise<MarkdownLintSummary> {
  const results = await markdownlint({ files, config: MARKDOWN_CONFIG, customRules: CUSTOM_RULES });
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

function formatMarkdownResults(summary: MarkdownLintSummary, { colors }: { colors: boolean }): string {
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

function formatAttachLintErrors(errors: AttachLintError[], { colors }: { colors: boolean }): string {
  if (errors.length === 0) return "";
  const ESC = "";
  const red = colors ? (s: string) => `${ESC}[31m${s}${ESC}[0m` : (s: string) => s;
  return errors
    .map((e) => `${red("error")}  ${e.path}  [${e.rule}] ${e.message}`)
    .join("\n");
}

export const validateCommand = new Command("validate")
  .description("Validate cards and markdown in the box")
  .argument("[path]", "Path to validate (file or directory)")
  .option("--all", "Validate all files in the box")
  .option("--json", "Output results as JSON")
  .option("--committed", "Also check that git working tree is clean")
  .action(
    async (
      targetPath: string | undefined,
      options: { all?: boolean; json?: boolean; committed?: boolean }
    ) => {
      try {
        const boxRoot = await requireBoxRoot();
        const loader = await createLoader(boxRoot);

        let cardSummary: LintSummary | null = null;
        let mdSummary: MarkdownLintSummary | null = null;
        let attachErrors: AttachLintError[] = [];

        if (options.all || !targetPath) {
          cardSummary = await lintAll(loader);
          const mdFiles = await findMarkdownFiles(boxRoot);
          if (mdFiles.length > 0) {
            mdSummary = await lintMarkdownFiles(mdFiles);
          }
          attachErrors = await lintAttachLayout(boxRoot);
        } else {
          const fullPath = path.isAbsolute(targetPath)
            ? targetPath
            : path.join(process.cwd(), targetPath);

          if (isCardFile(fullPath)) {
            cardSummary = await lintCards(loader, [fullPath]);
          } else if (isMarkdownFile(fullPath)) {
            mdSummary = await lintMarkdownFiles([fullPath]);
          } else {
            console.error("Error: Path must be a card file (*.card) or markdown file (*.md)");
            process.exit(1);
          }
        }

        if (options.json) {
          console.log(JSON.stringify({ cards: cardSummary, markdown: mdSummary, attach: attachErrors }, null, 2));
        } else {
          if (cardSummary !== null) {
            const output = formatLintResults(cardSummary, { colors: true });
            if (output) console.log(output);
            console.log(
              `\nValidated ${cardSummary.filesChecked} card(s): ` +
              `${cardSummary.filesChecked - cardSummary.filesWithErrors} valid, ` +
              `${cardSummary.filesWithErrors} with issues`
            );
          }
          if (mdSummary !== null) {
            const output = formatMarkdownResults(mdSummary, { colors: true });
            if (output) console.log(`\n${output}`);
            console.log(
              `\nValidated ${mdSummary.filesChecked} markdown file(s): ` +
              `${mdSummary.filesChecked - mdSummary.filesWithErrors} valid, ` +
              `${mdSummary.filesWithErrors} with issues`
            );
          }
          if (attachErrors.length > 0) {
            const output = formatAttachLintErrors(attachErrors, { colors: true });
            console.log(`\n${output}`);
            console.log(`\nAttach layout: ${attachErrors.length} issue(s)`);
          }
        }

        if (options.committed) {
          const status = await getStatus(boxRoot);
          if (!status.clean) {
            const dirty = [...status.staged, ...status.modified, ...status.untracked];
            console.error("\nGit working tree is not clean:");
            for (const file of dirty) {
              console.error(`  ${file}`);
            }
            process.exit(1);
          }
          if (!options.json) {
            console.log("Git working tree is clean.");
          }
        }

        const totalErrors =
          (cardSummary !== null ? cardSummary.totalErrors : 0) +
          (mdSummary !== null ? mdSummary.totalErrors : 0) +
          attachErrors.length;
        if (totalErrors > 0) {
          process.exit(1);
        }
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    }
  );
