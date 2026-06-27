/**
 * cb validate - Validate cards and markdown against schemas/rules
 */

import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import { formatLintResults, type LintSummary } from "../../cards/index.js";
import {
  findMarkdownFiles,
  listStagedMarkdown,
  lintMarkdownFiles,
  boxWideLinkWarnings,
  formatMarkdownResults,
  isLintableMarkdown,
  type MarkdownLintSummary,
} from "./validate-markdown.js";
import { requireBoxRoot, isCardFile, isMarkdownFile, isViewFile } from "../lib/paths.js";
import { lintViewFile } from "../../webapp/views/compiler.js";
import { listBoxCardFiles } from "../../core/list-cards.js";
import { getStatus } from "../lib/git.js";
import { lintAttachLayout, type AttachLintError } from "../../lib/attach-lint.js";
import { lintCardsDispatch } from "../../core/card-lint.js";
import { isClaudeMdFile, lintClaudeMdFile, lintAllClaudeMd } from "../../core/claude-md-lint.js";
import { buildLoadContext } from "../../core/load-context.js";
import { staleContainsWarning } from "../../core/search/contains-state.js";
import { refreshDerivedRules } from "../../core/refresh-derived-rules.js";
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
  // Agent/human-authored markdown: lint its links (CB001/CB002) so a hand-edit
  // that breaks a link gets the same write-time nudge cards do. CLAUDE.md is
  // handled above; .claude/ rule docs are excluded by isLintableMarkdown.
  if (isLintableMarkdown(fp)) {
    const boxRoot = await requireBoxRoot();
    const summary = await lintMarkdownFiles([fp], { boxRoot });
    if (summary.totalErrors > 0) {
      process.stderr.write(`${formatMarkdownResults(summary, { colors: false })}\n`);
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
  await refreshDerivedRules(boxRoot, fp);
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

/** Validate the union of git-staged cards/markdown and any explicit paths given. */
async function collectStagedResults({ boxRoot, ctx, resolved, json }: CollectArgs): Promise<ValidationResults> {
  const cards = [...(await listStagedCards(boxRoot)), ...resolved.filter(isCardFile)];
  const mdFiles = [...(await listStagedMarkdown(boxRoot)), ...resolved.filter(isMarkdownFile)];
  if (cards.length === 0 && mdFiles.length === 0 && !json) {
    console.log("No staged cards or markdown to validate.");
  }
  const cardSummary = cards.length > 0 ? await lintCardsDispatch(cards, { boxRoot, ctx }) : null;
  const mdSummary = mdFiles.length > 0 ? await lintMarkdownFiles(mdFiles, { boxRoot }) : null;
  return { cardSummary, mdSummary, attachErrors: [], claudeMdWarnings: [] };
}

/** Validate every card, markdown file, and attach layout in the box. */
async function collectAllResults({ boxRoot, ctx }: CollectArgs): Promise<ValidationResults> {
  const cardPaths = (await listBoxCardFiles(boxRoot)).filter((p) => !isTrashedCard(p));
  const cardSummary = await lintCardsDispatch(cardPaths, { boxRoot, ctx });
  const mdFiles = await findMarkdownFiles(boxRoot);
  const mdSummary = mdFiles.length > 0 ? await lintMarkdownFiles(mdFiles, { boxRoot }) : null;
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
  const mdSummary = mdPaths.length > 0 ? await lintMarkdownFiles(mdPaths, { boxRoot }) : null;
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
  .option("--links", "Warn-only box-wide broken-link scan (link rules only). Always exits 0 — used by the pre-commit hook to surface dangling links in unstaged referrers without blocking the commit.")
  .option("--json", "Output results as JSON")
  .option("--committed", "Also check that git working tree is clean")
  .action(
    async (
      targetPaths: string[],
      options: { all?: boolean; staged?: boolean; hook?: boolean; links?: boolean; json?: boolean; committed?: boolean }
    ) => {
      try {
        if (options.hook) {
          await runHookMode();
        }

        if (options.links) {
          const linkBoxRoot = await requireBoxRoot();
          const warnings = await boxWideLinkWarnings(linkBoxRoot);
          if (warnings !== null) process.stderr.write(`${warnings}\n`);
          process.exit(0);
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
