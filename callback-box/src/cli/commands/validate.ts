/**
 * cb validate - Validate cards and markdown against schemas/rules
 */

import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import { formatLintResults, type LintSummary } from "../../cards/index.js";
import {
  listStagedMarkdown,
  lintMarkdownFiles,
  boxWideLinkWarnings,
  formatMarkdownResults,
  type MarkdownLintSummary,
} from "./validate-markdown.js";
import { requireBoxRoot, isCardFile, isMarkdownFile, isViewFile } from "../lib/paths.js";
import { listBoxCardFiles, listBoxMarkdownFiles, listBoxViewFiles } from "../../core/list-cards.js";
import { collectViewRefWarnings } from "../../core/view-refs.js";
import { getStatus } from "../../lib/git.js";
import { lintAttachLayout, type AttachLintError } from "../../lib/attach-lint.js";
import { lintCardsDispatch } from "../../core/card-lint.js";
import { lintAllClaudeMd } from "../../core/claude-md-lint.js";
import { buildLoadContext } from "../../core/load-context.js";
import { checkExternalUrls, formatUrlReport, type UrlCheckMode } from "../../core/external-url-check.js";
import { loadValidationIgnore, type ValidationIgnore } from "../../core/validation-ignore.js";
import type { LoadCardContext } from "../../core/card-io.js";
import { getBoxShape, findLegacySchemaFiles, describeLegacySchemaFiles } from "../lib/box-shape.js";

const execFileP = promisify(execFile);

/**
 * Whether to emit ANSI color. `cb` run interactively by a human is the rare
 * case where color matters; the common case is output being piped or pasted,
 * where escape codes are noise. So: color only for a real terminal, and never
 * when NO_COLOR is set. No flag — the environment decides.
 */
export function useColor(): boolean {
  return process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
}

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
  // `--relative` reports paths relative to cwd (and scoped to it) instead of
  // the repo root — needed because a v2 box's `boxRoot` (`content/`) isn't
  // the repo root (the package root is; see "THE TRAP" in
  // `../../core/install-validation-hooks.js`). A no-op for a legacy box,
  // where the two already coincide.
  const { stdout } = await execFileP(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "--relative"],
    { cwd: boxRoot, maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout
    .split("\n")
    .filter((line) => line.endsWith(".card") && !isTrashedCard(line))
    .map((rel) => path.join(boxRoot, rel));
}

function formatAttachLintErrors(errors: AttachLintError[], { colors }: { colors: boolean }): string {
  if (errors.length === 0) return "";
  const ESC = "";
  const red = colors ? (s: string) => `${ESC}[31m${s}${ESC}[0m` : (s: string) => s;
  return errors
    .map((e) => `${red("error")}  ${e.path}  [${e.rule}] ${e.message}`)
    .join("\n");
}

interface CollectedResults {
  cardSummary: LintSummary | null;
  mdSummary: MarkdownLintSummary | null;
  attachErrors: AttachLintError[];
  /** Soft, non-blocking size warnings for oversized CLAUDE.md files. */
  claudeMdWarnings: string[];
  /** Broken `cardRef="…"` refs in box-authored views (warning-only). */
  viewWarnings: string[];
}

interface ValidationResults extends CollectedResults {
  /**
   * A v2 box with stray `*.ts` files under the legacy `config/schemas/`
   * location — blocking, since the loader and validate hook can't otherwise
   * catch a misplaced schema (see `findLegacySchemaFiles`). Box-wide, not
   * per-file, so it's checked once and merged in regardless of scope
   * (`--all`/`--staged`/explicit paths), rather than threaded through each
   * `collect*Results` variant.
   */
  legacySchemaErrors: string[];
}

/**
 * Check for schemas left in the pre-package `config/schemas/` location on a
 * v2 box. Returns a one-element (or empty) array of formatted error strings —
 * an array so it composes with `countTotalErrors`/`printTextResults` like the
 * other result buckets, even though there's only ever one message.
 */
async function checkLegacySchemaPath(boxRoot: string): Promise<string[]> {
  const shape = await getBoxShape(boxRoot);
  const files = await findLegacySchemaFiles(shape);
  return files.length > 0 ? [describeLegacySchemaFiles(shape, files)] : [];
}

/**
 * Pick the URL-check scope from the options. `--since <ref>` (used by the
 * post-commit trigger) wins; then `--all` (full box sweep); then `--staged`;
 * otherwise the default working-tree-vs-HEAD diff.
 */
function urlCheckMode(options: { all?: boolean; staged?: boolean; urlsSince?: string }): UrlCheckMode {
  if (typeof options.urlsSince === "string") return { kind: "since", ref: options.urlsSince };
  if (options.all) return { kind: "all" };
  if (options.staged) return { kind: "staged" };
  return { kind: "working" };
}

/**
 * The external-URL pass (`cb validate --urls`). Network-dependent and therefore
 * fully separate from the sync card/markdown lint: it never runs in the
 * PostToolUse / pre-commit hooks. Warning-style — exits 1 only on a hard-broken
 * URL when invoked directly, which is safe because nothing in the commit path
 * calls it. Always exits the process.
 */
async function runUrlCheck(
  options: { all?: boolean; staged?: boolean; urlsSince?: string; json?: boolean }
): Promise<never> {
  const boxRoot = await requireBoxRoot();
  const report = await checkExternalUrls(boxRoot, { mode: urlCheckMode(options), now: new Date().toISOString() });
  if (options.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const text = formatUrlReport(report, { colors: useColor() });
    console.log(text ?? `Checked ${String(report.checked)} external URL(s); none broken.`);
  }
  process.exit(report.broken.length > 0 ? 1 : 0);
}

interface CollectArgs {
  boxRoot: string;
  ctx: LoadCardContext;
  resolved: string[];
  json: boolean;
  /**
   * The box's `config/cb-validate.ignore` matcher. Applied to the *implicit*
   * scans (`--all`, `--staged`); an explicit `cb validate <path>` bypasses it,
   * mirroring how `isTrashedCard` skips only implicit scans.
   */
  ignore: ValidationIgnore;
}

/**
 * Pick the validation scope from the options and run it. Mirrors the original
 * staged / all-or-empty / explicit-paths branch order exactly.
 */
async function collectResults(
  options: { staged?: boolean; all?: boolean; json?: boolean },
  args: CollectArgs
): Promise<CollectedResults> {
  if (options.staged) return collectStagedResults(args);
  if (options.all || args.resolved.length === 0) return collectAllResults(args);
  return collectExplicitResults(args);
}

/** Validate the union of git-staged cards/markdown and any explicit paths given. */
async function collectStagedResults({ boxRoot, ctx, resolved, json, ignore }: CollectArgs): Promise<CollectedResults> {
  const cards = [...(await listStagedCards(boxRoot)).filter((p) => !ignore.isIgnored(p)), ...resolved.filter(isCardFile)];
  const mdFiles = [...(await listStagedMarkdown(boxRoot)).filter((p) => !ignore.isIgnored(p)), ...resolved.filter(isMarkdownFile)];
  if (cards.length === 0 && mdFiles.length === 0 && !json) {
    console.log("No staged cards or markdown to validate.");
  }
  const cardSummary = cards.length > 0 ? await lintCardsDispatch(cards, { boxRoot, ctx }) : null;
  const mdSummary = mdFiles.length > 0 ? await lintMarkdownFiles(mdFiles, { boxRoot }) : null;
  const viewWarnings = await collectViewRefWarnings(resolved.filter(isViewFile), boxRoot);
  return { cardSummary, mdSummary, attachErrors: [], claudeMdWarnings: [], viewWarnings };
}

/** Validate every card, markdown file, view, and attach layout in the box. */
async function collectAllResults({ boxRoot, ctx, ignore }: CollectArgs): Promise<CollectedResults> {
  const cardPaths = (await listBoxCardFiles(boxRoot)).filter((p) => !isTrashedCard(p) && !ignore.isIgnored(p));
  const cardSummary = await lintCardsDispatch(cardPaths, { boxRoot, ctx });
  const mdFiles = (await listBoxMarkdownFiles(boxRoot)).filter((p) => !ignore.isIgnored(p));
  const mdSummary = mdFiles.length > 0 ? await lintMarkdownFiles(mdFiles, { boxRoot }) : null;
  const attachErrors = await lintAttachLayout(boxRoot);
  const claudeMdWarnings = await lintAllClaudeMd(boxRoot);
  const viewWarnings = await collectViewRefWarnings(await listBoxViewFiles(boxRoot), boxRoot);
  return { cardSummary, mdSummary, attachErrors, claudeMdWarnings, viewWarnings };
}

/** Validate an explicit list of card/markdown paths; exit 1 on unknown types. */
async function collectExplicitResults({ boxRoot, ctx, resolved }: CollectArgs): Promise<CollectedResults> {
  const cardPaths = resolved.filter(isCardFile);
  const mdPaths = resolved.filter(isMarkdownFile);
  const unknown = resolved.filter((p) => !isCardFile(p) && !isMarkdownFile(p));
  if (unknown.length > 0) {
    console.error(`Error: not a card or markdown file: ${unknown.join(", ")}`);
    process.exit(1);
  }
  const cardSummary = cardPaths.length > 0 ? await lintCardsDispatch(cardPaths, { boxRoot, ctx }) : null;
  const mdSummary = mdPaths.length > 0 ? await lintMarkdownFiles(mdPaths, { boxRoot }) : null;
  const viewWarnings = await collectViewRefWarnings(resolved.filter(isViewFile), boxRoot);
  return { cardSummary, mdSummary, attachErrors: [], claudeMdWarnings: [], viewWarnings };
}

/** Print human-readable card/markdown/attach/legacy-schema-path results to stdout. */
function printTextResults({ cardSummary, mdSummary, attachErrors, claudeMdWarnings, viewWarnings, legacySchemaErrors }: ValidationResults): void {
  const colors = useColor();
  if (cardSummary !== null) {
    const output = formatLintResults(cardSummary, { colors });
    if (output) console.log(output);
  }
  if (mdSummary !== null) {
    const output = formatMarkdownResults(mdSummary, { colors });
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
    const output = formatAttachLintErrors(attachErrors, { colors });
    console.log(`\n${output}`);
    console.log(`\nAttach layout: ${attachErrors.length} issue(s)`);
  }
  if (claudeMdWarnings.length > 0) {
    console.log(`\n${claudeMdWarnings.join("\n")}`);
  }
  if (viewWarnings.length > 0) {
    console.log(`\n${viewWarnings.join("\n")}`);
  }
  if (legacySchemaErrors.length > 0) {
    console.log(`\n${legacySchemaErrors.join("\n")}`);
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

function countTotalErrors({ cardSummary, mdSummary, attachErrors, legacySchemaErrors }: ValidationResults): number {
  return (
    (cardSummary !== null ? cardSummary.totalErrors : 0) +
    (mdSummary !== null ? mdSummary.totalErrors : 0) +
    attachErrors.length +
    legacySchemaErrors.length
  );
}

export const validateCommand = new Command("validate")
  .description("Validate cards and markdown in the box")
  .argument("[paths...]", "Files to validate (cards or markdown). Omit to validate everything; pair with --staged to validate staged cards.")
  .option("--all", "Validate all files in the box (default when no path given)")
  .option("--staged", "Validate the cards currently staged in git")
  .option("--hook", "Hook mode: read Claude Code PostToolUse JSON payload from stdin, validate the touched card. Errors go to stderr with exit code 2 so the agent sees feedback; non-card paths exit 0 silently.")
  .option("--links", "Warn-only box-wide broken-link scan (link rules only). Always exits 0 — used by the pre-commit hook to surface dangling links in unstaged referrers without blocking the commit.")
  .option("--urls", "Check EXTERNAL http(s) URLs that are new since the base version (HEAD by default). Network pass — never run in the sync hooks. Pair with --all (full box sweep), --staged, or --urls-since <ref>.")
  .option("--urls-since <ref>", "With --urls: treat URLs absent at <ref> as new (used by the non-blocking post-commit trigger, e.g. --urls-since HEAD~1).")
  .option("--json", "Output results as JSON")
  .option("--committed", "Also check that git working tree is clean")
  .action(
    async (
      targetPaths: string[],
      options: { all?: boolean; staged?: boolean; hook?: boolean; links?: boolean; urls?: boolean; urlsSince?: string; json?: boolean; committed?: boolean }
    ) => {
      try {
        if (options.hook) {
          const { runHookMode } = await import("./validate-hook.js");
          await runHookMode();
        }

        if (options.urls || typeof options.urlsSince === "string") {
          await runUrlCheck(options);
        }

        if (options.links) {
          const linkBoxRoot = await requireBoxRoot();
          const warnings = await boxWideLinkWarnings(linkBoxRoot);
          if (warnings !== null) process.stderr.write(`${warnings}\n`);
          process.exit(0);
        }

        const boxRoot = await requireBoxRoot();
        const ctx = await buildLoadContext(boxRoot);
        const ignore = await loadValidationIgnore(boxRoot);
        const json = options.json === true;

        const resolved = targetPaths.map((p) =>
          path.isAbsolute(p) ? p : path.join(process.cwd(), p)
        );

        const collected = await collectResults(options, { boxRoot, ctx, resolved, json, ignore });
        const legacySchemaErrors = await checkLegacySchemaPath(boxRoot);
        const results: ValidationResults = { ...collected, legacySchemaErrors };

        if (json) {
          const payload = {
            cards: results.cardSummary,
            markdown: results.mdSummary,
            attach: results.attachErrors,
            claudeMd: results.claudeMdWarnings,
            views: results.viewWarnings,
            legacySchemaPath: results.legacySchemaErrors,
          };
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
