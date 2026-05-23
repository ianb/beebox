/**
 * cb validate - Validate cards and markdown against schemas/rules
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import { formatLintResults, type LintSummary, type ElementSchema } from "cardworks";
import { lint as markdownlint } from "markdownlint/promise";
import type { LintError } from "markdownlint";
import { noViewLabelLinks, noBrokenInternalLinks } from "../../core/markdown-lint-rules.js";
import { requireBoxRoot, isCardFile, isMarkdownFile } from "../lib/paths.js";
import { createLoader } from "../lib/loader.js";
import { getStatus } from "../lib/git.js";
import { lintAttachLayout, type AttachLintError } from "../../lib/attach-lint.js";
import { lintCardsDispatch } from "../../core/card-lint.js";
import { createCardSchemaMap, createSchemaRegistry } from "../../schemas/registry.js";
import type { LoadCardContext } from "../../core/card-io.js";

const execFileP = promisify(execFile);

async function listStagedCards(boxRoot: string): Promise<string[]> {
  const { stdout } = await execFileP(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { cwd: boxRoot, maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout
    .split("\n")
    .filter((line) => line.endsWith(".card"))
    .map((rel) => path.join(boxRoot, rel));
}

/**
 * Read the file path from a Claude Code PostToolUse hook payload on stdin.
 * Returns undefined if stdin isn't JSON or doesn't carry a card path —
 * the hook just exits 0 silently in that case.
 */
async function readHookFilePath(): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (raw === "") return undefined;
  try {
    const parsed = JSON.parse(raw) as { tool_input?: { file_path?: unknown } };
    const fp = parsed.tool_input?.file_path;
    return typeof fp === "string" ? fp : undefined;
  } catch {
    return undefined;
  }
}

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

async function buildLoadContext(boxRoot: string): Promise<LoadCardContext> {
  const registry = await createSchemaRegistry(boxRoot);
  const elementSchemas = new Map<string, ElementSchema>();
  for (const tag of registry.tagNames()) {
    const s = registry.get(tag);
    if (s) elementSchemas.set(tag, s as ElementSchema);
  }
  return {
    cardSchemas: createCardSchemaMap(),
    elementSchemas,
  };
}

export const validateCommand = new Command("validate")
  .description("Validate cards and markdown in the box")
  .argument("[paths...]", "Files to validate (cards or markdown). Omit to validate everything; pair with --staged to validate staged cards.")
  .option("--all", "Validate all files in the box (default when no path given)")
  .option("--staged", "Validate the cards currently staged in git")
  .option("--hook", "Hook mode: read Claude Code PostToolUse JSON payload from stdin, validate the touched card. Errors go to stderr with exit code 2 so the agent sees feedback; non-card paths exit 0 silently.")
  .option("--json", "Output results as JSON")
  .option("--committed", "Also check that git working tree is clean")
  .action(
    async (
      targetPaths: string[],
      options: { all?: boolean; staged?: boolean; hook?: boolean; json?: boolean; committed?: boolean }
    ) => {
      try {
        if (options.hook) {
          const fp = await readHookFilePath();
          if (fp === undefined || !isCardFile(fp)) {
            process.exit(0);
          }
          const boxRoot = await requireBoxRoot();
          const loader = await createLoader(boxRoot);
          const ctx = await buildLoadContext(boxRoot);
          const summary = await lintCardsDispatch([fp], { loader, ctx });
          if (summary.totalErrors > 0) {
            const output = formatLintResults(summary, { colors: false });
            process.stderr.write(`${output}\n`);
            process.exit(2);
          }
          process.exit(0);
        }

        const boxRoot = await requireBoxRoot();
        const loader = await createLoader(boxRoot);
        const ctx = await buildLoadContext(boxRoot);

        let cardSummary: LintSummary | null = null;
        let mdSummary: MarkdownLintSummary | null = null;
        let attachErrors: AttachLintError[] = [];

        const resolved = targetPaths.map((p) =>
          path.isAbsolute(p) ? p : path.join(process.cwd(), p)
        );

        if (options.staged) {
          const staged = await listStagedCards(boxRoot);
          const explicit = resolved.filter(isCardFile);
          const all = [...staged, ...explicit];
          if (all.length === 0 && !options.json) {
            console.log("No staged cards to validate.");
          }
          if (all.length > 0) {
            cardSummary = await lintCardsDispatch(all, { loader, ctx });
          }
        } else if (options.all || resolved.length === 0) {
          const cardPaths = await loader.listCards();
          cardSummary = await lintCardsDispatch(cardPaths, { loader, ctx });
          const mdFiles = await findMarkdownFiles(boxRoot);
          if (mdFiles.length > 0) {
            mdSummary = await lintMarkdownFiles(mdFiles);
          }
          attachErrors = await lintAttachLayout(boxRoot);
        } else {
          const cardPaths = resolved.filter(isCardFile);
          const mdPaths = resolved.filter(isMarkdownFile);
          const unknown = resolved.filter((p) => !isCardFile(p) && !isMarkdownFile(p));
          if (unknown.length > 0) {
            console.error(`Error: not a card or markdown file: ${unknown.join(", ")}`);
            process.exit(1);
          }
          if (cardPaths.length > 0) {
            cardSummary = await lintCardsDispatch(cardPaths, { loader, ctx });
          }
          if (mdPaths.length > 0) {
            mdSummary = await lintMarkdownFiles(mdPaths);
          }
        }

        if (options.json) {
          console.log(JSON.stringify({ cards: cardSummary, markdown: mdSummary, attach: attachErrors }, null, 2));
        } else {
          if (cardSummary !== null) {
            const output = formatLintResults(cardSummary, { colors: true });
            if (output) console.log(output);
          }
          if (mdSummary !== null) {
            const output = formatMarkdownResults(mdSummary, { colors: true });
            if (output) console.log(`\n${output}`);
            if (mdSummary.totalErrors > 0) {
              const fileWord = mdSummary.filesWithErrors === 1 ? "file" : "files";
              console.log(
                `\n${String(mdSummary.filesChecked)} markdown file${mdSummary.filesChecked === 1 ? "" : "s"} checked, ` +
                `${String(mdSummary.totalErrors)} error${mdSummary.totalErrors === 1 ? "" : "s"} in ` +
                `${String(mdSummary.filesWithErrors)} ${fileWord}`
              );
            }
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
