/**
 * cb validate - Validate cards and markdown against schemas/rules
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import { formatLintResults, type LintSummary } from "../../cards/index.js";
import { lint as markdownlint } from "markdownlint/promise";
import type { LintError } from "markdownlint";
import { noViewLabelLinks, noBrokenInternalLinks } from "../../core/markdown-lint-rules.js";
import { requireBoxRoot, isCardFile, isMarkdownFile, isViewFile } from "../lib/paths.js";
import { lintViewFile } from "../../webapp/views/compiler.js";
import { listBoxCardFiles } from "../../core/list-cards.js";
import { getStatus } from "../lib/git.js";
import { lintAttachLayout, type AttachLintError } from "../../lib/attach-lint.js";
import { lintCardsDispatch } from "../../core/card-lint.js";
import { isClaudeMdFile, lintClaudeMdFile, lintAllClaudeMd } from "../../core/claude-md-lint.js";
import { buildLoadContext } from "../../core/load-context.js";
import { staleContainsWarning } from "../../core/search/contains-state.js";
import type { LoadCardContext } from "../../core/card-io.js";

const execFileP = promisify(execFile);

/**
 * Cards under `store/trash/` are by definition orphaned/discarded and
 * routinely have broken refs (their attachments and related cards have
 * been deleted). We skip them from default validation so trash drift
 * doesn't block normal commits. `cb validate <path>` on an explicit
 * trash path still validates — the skip only applies to the implicit
 * scans (--all, --staged, no-args).
 */
function isTrashedCard(boxRelOrAbs: string): boolean {
  return /(^|\/)store\/trash\//.test(boxRelOrAbs);
}

async function listStagedCards(boxRoot: string): Promise<string[]> {
  const { stdout } = await execFileP(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { cwd: boxRoot, maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout
    .split("\n")
    .filter((line) => line.endsWith(".card") && !isTrashedCard(line))
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
  } catch (_e) {
    // stdin wasn't valid JSON: per this helper's contract the hook just exits 0
    // silently when there's no parseable payload, so the parse error is expected
    // and carries nothing actionable.
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

interface ValidationResults {
  cardSummary: LintSummary | null;
  mdSummary: MarkdownLintSummary | null;
  attachErrors: AttachLintError[];
  /** Soft, non-blocking size warnings for oversized CLAUDE.md files. */
  claudeMdWarnings: string[];
}

/**
 * Hook mode: read the touched card path from stdin, validate it, and exit.
 * Non-card paths exit 0 silently; errors AND warnings exit 2 so the agent
 * sees feedback (the hook is a nudge, not a gate — pre-commit blocks only
 * on errors). This always exits the process and never returns.
 */
async function runHookMode(): Promise<never> {
  const fp = await readHookFilePath();
  if (fp === undefined) {
    process.exit(0);
  }
  // CLAUDE.md gets only the soft size lint (it isn't a card and isn't markdown-
  // validity-checked); a too-large one is surfaced as a warning, never blocked.
  if (isClaudeMdFile(fp)) {
    const boxRoot = await requireBoxRoot();
    const warning = await lintClaudeMdFile(boxRoot, fp);
    if (warning !== null) {
      process.stderr.write(`${warning}\n`);
      process.exit(2);
    }
    process.exit(0);
  }
  // Agent-authored view: compile-check it (syntax/JSX/imports). Like cards,
  // a compile failure exits 2 so the agent sees the nudge; no box root needed
  // (compileView takes the absolute path).
  if (isViewFile(fp)) {
    const err = await lintViewFile(fp);
    if (err !== null) {
      process.stderr.write(`View compile error for ${fp}:\n${err}\n`);
      process.exit(2);
    }
    process.exit(0);
  }
  if (!isCardFile(fp)) {
    process.exit(0);
  }
  const boxRoot = await requireBoxRoot();
  const ctx = await buildLoadContext(boxRoot);
  const summary = await lintCardsDispatch([fp], { boxRoot, ctx });
  const stale = await staleContainsWarning(boxRoot, {
    relPath: path.relative(boxRoot, fp),
    ctx,
  });
  if (summary.totalErrors > 0 || summary.totalWarnings > 0 || stale !== null) {
    const parts: string[] = [];
    if (summary.totalErrors > 0 || summary.totalWarnings > 0) {
      parts.push(formatLintResults(summary, { colors: false }));
    }
    if (stale !== null) parts.push(stale);
    process.stderr.write(`${parts.join("\n")}\n`);
    process.exit(2);
  }
  process.exit(0);
}

interface CollectArgs {
  boxRoot: string;
  ctx: LoadCardContext;
  resolved: string[];
  json: boolean;
}

/**
 * Pick the validation scope from the options and run it. Mirrors the original
 * staged / all-or-empty / explicit-paths branch order exactly.
 */
async function collectResults(
  options: { staged?: boolean; all?: boolean; json?: boolean },
  args: CollectArgs
): Promise<ValidationResults> {
  if (options.staged) return collectStagedResults(args);
  if (options.all || args.resolved.length === 0) return collectAllResults(args);
  return collectExplicitResults(args);
}

/** Validate the union of git-staged cards and any explicit card paths given. */
async function collectStagedResults({ boxRoot, ctx, resolved, json }: CollectArgs): Promise<ValidationResults> {
  const staged = await listStagedCards(boxRoot);
  const explicit = resolved.filter(isCardFile);
  const all = [...staged, ...explicit];
  if (all.length === 0 && !json) {
    console.log("No staged cards to validate.");
  }
  const cardSummary = all.length > 0 ? await lintCardsDispatch(all, { boxRoot, ctx }) : null;
  return { cardSummary, mdSummary: null, attachErrors: [], claudeMdWarnings: [] };
}

/** Validate every card, markdown file, and attach layout in the box. */
async function collectAllResults({ boxRoot, ctx }: CollectArgs): Promise<ValidationResults> {
  const cardPaths = (await listBoxCardFiles(boxRoot)).filter((p) => !isTrashedCard(p));
  const cardSummary = await lintCardsDispatch(cardPaths, { boxRoot, ctx });
  const mdFiles = await findMarkdownFiles(boxRoot);
  const mdSummary = mdFiles.length > 0 ? await lintMarkdownFiles(mdFiles) : null;
  const attachErrors = await lintAttachLayout(boxRoot);
  const claudeMdWarnings = await lintAllClaudeMd(boxRoot);
  return { cardSummary, mdSummary, attachErrors, claudeMdWarnings };
}

/** Validate an explicit list of card/markdown paths; exit 1 on unknown types. */
async function collectExplicitResults({ boxRoot, ctx, resolved }: CollectArgs): Promise<ValidationResults> {
  const cardPaths = resolved.filter(isCardFile);
  const mdPaths = resolved.filter(isMarkdownFile);
  const unknown = resolved.filter((p) => !isCardFile(p) && !isMarkdownFile(p));
  if (unknown.length > 0) {
    console.error(`Error: not a card or markdown file: ${unknown.join(", ")}`);
    process.exit(1);
  }
  const cardSummary = cardPaths.length > 0 ? await lintCardsDispatch(cardPaths, { boxRoot, ctx }) : null;
  const mdSummary = mdPaths.length > 0 ? await lintMarkdownFiles(mdPaths) : null;
  return { cardSummary, mdSummary, attachErrors: [], claudeMdWarnings: [] };
}

/** Print human-readable card/markdown/attach results to stdout. */
function printTextResults({ cardSummary, mdSummary, attachErrors, claudeMdWarnings }: ValidationResults): void {
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
  if (claudeMdWarnings.length > 0) {
    console.log(`\n${claudeMdWarnings.join("\n")}`);
  }
}

/**
 * Verify the git working tree is clean. Exits 1 (printing the dirty files) if
 * not. Prints a confirmation line in non-JSON mode when clean.
 */
async function checkCommitted(boxRoot: string, { json }: { json: boolean }): Promise<void> {
  const status = await getStatus(boxRoot);
  if (!status.clean) {
    const dirty = [...status.staged, ...status.modified, ...status.untracked];
    console.error("\nGit working tree is not clean:");
    for (const file of dirty) {
      console.error(`  ${file}`);
    }
    process.exit(1);
  }
  if (!json) {
    console.log("Git working tree is clean.");
  }
}

function countTotalErrors({ cardSummary, mdSummary, attachErrors }: ValidationResults): number {
  return (
    (cardSummary !== null ? cardSummary.totalErrors : 0) +
    (mdSummary !== null ? mdSummary.totalErrors : 0) +
    attachErrors.length
  );
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
          await runHookMode();
        }

        const boxRoot = await requireBoxRoot();
        const ctx = await buildLoadContext(boxRoot);
        const json = options.json === true;

        const resolved = targetPaths.map((p) =>
          path.isAbsolute(p) ? p : path.join(process.cwd(), p)
        );

        const results = await collectResults(options, { boxRoot, ctx, resolved, json });

        if (json) {
          const payload = { cards: results.cardSummary, markdown: results.mdSummary, attach: results.attachErrors, claudeMd: results.claudeMdWarnings };
          console.log(JSON.stringify(payload, null, 2));
        } else {
          printTextResults(results);
        }

        if (options.committed) {
          await checkCommitted(boxRoot, { json });
        }

        if (countTotalErrors(results) > 0) {
          process.exit(1);
        }
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    }
  );
