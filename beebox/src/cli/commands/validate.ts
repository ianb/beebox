/**
 * bbx validate - Validate cards and markdown against schemas/rules
 */

import { Command } from "commander";
import { formatLintResults, countBrokenRefs, type LintSummary } from "../../cards/index.js";
import {
  listStagedMarkdown,
  lintMarkdownFiles,
  boxWideLinkWarnings,
  formatMarkdownResults,
  type MarkdownLintSummary,
} from "./validate-markdown.js";
import { requireBoxRoot, isCardFile, isMarkdownFile, isTrashedCard, isViewFile } from "../../lib/paths.js";
import { listStagedCards } from "../../lib/staged-files.js";
import { runPreCommitChecks, rejectUnsupportedPreCommitScope } from "./validate-pre-commit.js";
import { collectDossierCanonicalWarnings, collectViewCanonicalWarnings } from "../../core/canonical-refs.js";
import {
  canonicalCounts,
  formatCanonicalReport,
  rejectUnsupportedCanonicalScope,
  runCanonicalFix,
  type CanonicalBuckets,
} from "./validate-canonical.js";
import { listBoxCardFiles, listBoxMarkdownFiles, listBoxViewFiles } from "../../core/list-cards.js";
import { collectViewRefWarnings } from "../../core/views/refs.js";
import { getStatus } from "../../lib/git.js";
import { lintAttachLayout, formatAttachLintErrors, type AttachLintError } from "../../lib/attach-lint.js";
import { lintProminenceBudget, formatProminenceLintWarnings, type ProminenceLintWarning } from "../../core/lint-prominence.js";
import { lintCardsDispatch } from "../../core/card-lint.js";
import { lintAllClaudeMd } from "../../core/claude-md-lint.js";
import { buildLoadContext } from "../../core/load-context.js";
import { checkExternalUrls, formatUrlReport, type UrlCheckMode } from "../../core/external/url-check.js";
import { loadValidationIgnore, type ValidationIgnore } from "../../core/validation-ignore.js";
import type { LoadCardContext } from "../../core/card-io.js";
import { checkLegacySchemaPath, checkReservedSegmentErrors, checkRootStrayErrors } from "./validate-box-checks.js";
import { resolveCliTargetPath } from "../lib/cli-target-path.js";
import { errorMessage } from "../../lib/error-guards.js";

/**
 * Whether to emit ANSI color. `bbx` run interactively by a human is the rare
 * case where color matters; the common case is output being piped or pasted,
 * where escape codes are noise. So: color only for a real terminal, and never
 * when NO_COLOR is set. No flag — the environment decides.
 */
export function useColor(): boolean {
  return process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
}

interface CollectedResults {
  cardSummary: LintSummary | null;
  mdSummary: MarkdownLintSummary | null;
  attachErrors: AttachLintError[];
  /** Soft, non-blocking size warnings for oversized CLAUDE.md files. */
  claudeMdWarnings: string[];
  /** Broken `cardRef="…"` refs in box-authored views (warning-only). */
  viewWarnings: string[];
  /**
   * Non-canonical `cardRef=` refs in views — counted in the card-ref bucket of
   * the `--canonical` summary. Empty unless `--canonical` was given.
   */
  canonicalViewWarnings: string[];
  /** Non-canonical `[text](path)` links in `.md` dossiers — the second bucket. */
  canonicalDossierWarnings: string[];
  /** `prominence` budget warnings (`core/lint-prominence.ts`) — box-wide only; absent for `--staged`/explicit-path scopes. */
  prominenceWarnings?: ProminenceLintWarning[];
}

interface ValidationResults extends CollectedResults {
  /**
   * Stray `*.ts` files under the legacy `_config/schemas/` location —
   * blocking, since the loader and validate hook can't otherwise
   * catch a misplaced schema (see `findLegacySchemaFiles`). Box-wide, not
   * per-file, so it's checked once and merged in regardless of scope
   * (`--all`/`--staged`/explicit paths), rather than threaded through each
   * `collect*Results` variant.
   */
  legacySchemaErrors: string[];
  /**
   * Closed-vocabulary root check (Track C, `docs/implemented-plans/one-root-box-layout.md`):
   * every box-root entry outside `BOX_ROOT_VOCABULARY`, formatted. Same
   * box-wide, checked-once-regardless-of-scope treatment as
   * `legacySchemaErrors` above.
   */
  rootStrayErrors: string[];
  /** Below-root reserved-name check (`box-reserved-segments.ts`): entries nesting an area name below the root. Same box-wide treatment. */
  reservedSegmentErrors: string[];
  /** Whether `--canonical` asked for the canonical-form report. */
  canonical: boolean;
}

/** The canonical findings in the shape `validate-canonical.ts` formats/counts. */
function canonicalBuckets(results: ValidationResults): CanonicalBuckets {
  return {
    cardSummary: results.cardSummary,
    viewWarnings: results.canonicalViewWarnings,
    dossierWarnings: results.canonicalDossierWarnings,
  };
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
 * The external-URL pass (`bbx validate --urls`). Network-dependent and therefore
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

/**
 * `bbx validate --pre-commit`: the per-box pre-commit hook's single invocation.
 * Blocking findings go to stdout, the warn-only link scan to stderr, and only
 * the former decides the exit code. Always exits the process.
 */
async function runPreCommit(): Promise<never> {
  const boxRoot = await requireBoxRoot();
  const outcome = await runPreCommitChecks(boxRoot, { colors: useColor() });
  if (outcome.report !== "") console.log(outcome.report);
  if (outcome.linkWarnings !== null) process.stderr.write(`${outcome.linkWarnings}\n`);
  process.exit(outcome.errorCount > 0 ? 1 : 0);
}

interface CollectArgs {
  boxRoot: string;
  ctx: LoadCardContext;
  resolved: string[];
  json: boolean;
  /**
   * The box's `_config/bbx-validate.ignore` matcher. Applied to the *implicit*
   * scans (`--all`, `--staged`); an explicit `bbx validate <path>` bypasses it,
   * mirroring how `isTrashedCard` skips only implicit scans.
   */
  ignore: ValidationIgnore;
  /** `--canonical`: also report refs written in the document-relative form. */
  canonical: boolean;
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
  return { cardSummary, mdSummary, attachErrors: [], claudeMdWarnings: [], viewWarnings, ...NO_CANONICAL };
}

/** Validate every card, markdown file, view, and attach layout in the box. */
async function collectAllResults({ boxRoot, ctx, ignore, canonical }: CollectArgs): Promise<CollectedResults> {
  const cardPaths = (await listBoxCardFiles(boxRoot)).filter((p) => !isTrashedCard(p) && !ignore.isIgnored(p));
  const cardSummary = await lintCardsDispatch(cardPaths, { boxRoot, ctx, canonical });
  const mdFiles = (await listBoxMarkdownFiles(boxRoot)).filter((p) => !ignore.isIgnored(p));
  const mdSummary = mdFiles.length > 0 ? await lintMarkdownFiles(mdFiles, { boxRoot }) : null;
  const attachErrors = await lintAttachLayout(boxRoot);
  const prominenceWarnings = await lintProminenceBudget(boxRoot, ctx);
  const claudeMdWarnings = await lintAllClaudeMd(boxRoot);
  const viewPaths = await listBoxViewFiles(boxRoot);
  const viewWarnings = await collectViewRefWarnings(viewPaths, boxRoot);
  const canonicalViewWarnings = canonical ? await collectViewCanonicalWarnings(viewPaths, boxRoot) : [];
  const canonicalDossierWarnings = canonical ? await collectDossierCanonicalWarnings(mdFiles, boxRoot) : [];
  return {
    cardSummary,
    mdSummary,
    attachErrors,
    prominenceWarnings,
    claudeMdWarnings,
    viewWarnings,
    canonicalViewWarnings,
    canonicalDossierWarnings,
  };
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
  return { cardSummary, mdSummary, attachErrors: [], claudeMdWarnings: [], viewWarnings, ...NO_CANONICAL };
}

/**
 * The canonical buckets for the scopes `--canonical` doesn't support (`--staged`
 * and explicit paths, both rejected up front). Spread so those collectors still
 * return the full `CollectedResults` shape.
 */
const NO_CANONICAL = { canonicalViewWarnings: [], canonicalDossierWarnings: [] };

/** Print human-readable card/markdown/attach/legacy-schema-path results to stdout. */
function printTextResults(results: ValidationResults): void {
  const { cardSummary, mdSummary, attachErrors, claudeMdWarnings, viewWarnings, legacySchemaErrors, rootStrayErrors, reservedSegmentErrors } = results;
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
  if (results.prominenceWarnings !== undefined && results.prominenceWarnings.length > 0) {
    console.log(`\n${formatProminenceLintWarnings(results.prominenceWarnings, { colors })}`);
  }
  if (claudeMdWarnings.length > 0) {
    console.log(`\n${claudeMdWarnings.join("\n")}`);
  }
  if (viewWarnings.length > 0) {
    console.log(`\n${viewWarnings.join("\n")}`);
  }
  const boxWideErrors = [...legacySchemaErrors, ...rootStrayErrors, ...reservedSegmentErrors];
  if (boxWideErrors.length > 0) console.log(`\n${boxWideErrors.join("\n")}`);
  if (results.canonical) {
    console.log(`\n${formatCanonicalReport(canonicalBuckets(results), { colors })}`);
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

function countTotalErrors({ cardSummary, mdSummary, attachErrors, legacySchemaErrors, rootStrayErrors, reservedSegmentErrors }: ValidationResults): number {
  return (
    (cardSummary !== null ? cardSummary.totalErrors : 0) +
    (mdSummary !== null ? mdSummary.totalErrors : 0) +
    attachErrors.length +
    legacySchemaErrors.length +
    rootStrayErrors.length +
    reservedSegmentErrors.length
  );
}

export const validateCommand = new Command("validate")
  .description("Validate cards and markdown in the box")
  .argument("[paths...]", "Files to validate (cards or markdown). Omit to validate everything; pair with --staged to validate staged cards.")
  .option("--all", "Validate all files in the box (default when no path given)")
  .option("--staged", "Validate the cards currently staged in git")
  .option("--hook", "Hook mode: read Claude Code PostToolUse JSON payload from stdin, validate the touched card. Errors go to stderr with exit code 2 so the agent sees feedback; non-card paths exit 0 silently.")
  .option("--pre-commit", "The whole commit-time suite in one process: staged card/markdown validation (blocking), a box-wide link scan (warn-only, and only when the staged diff deletes or renames something), and the index-based unlisted-binary guard (blocking). Used by the per-box pre-commit hook; not combinable with another scope.")
  .option("--links", "Warn-only box-wide broken-link scan (link rules only). Always exits 0 — used by the pre-commit hook to surface dangling links in unstaged referrers without blocking the commit.")
  .option("--urls", "Check EXTERNAL http(s) URLs that are new since the base version (HEAD by default). Network pass — never run in the sync hooks. Pair with --all (full box sweep), --staged, or --urls-since <ref>.")
  .option("--urls-since <ref>", "With --urls: treat URLs absent at <ref> as new (used by the non-blocking post-commit trigger, e.g. --urls-since HEAD~1).")
  .option("--canonical", "Also report refs written in the document-relative form instead of from the box root (`/store/…`), each with the canonical rewrite. OFF by default so legacy relative refs don't bury the broken-ref signal. Whole-box only — not combinable with --staged, explicit paths, --hook, --links, or --urls.")
  .option("--fix", "With --canonical: rewrite those refs to their box-root form, in place. Only refs whose target actually exists are rewritten — plus dangling refs that were written with box-root intent and resolve from the root (repaired). A ref that resolves BOTH ways is ambiguous and left alone, as is one that resolves neither way or escapes the box.")
  .option("--json", "Output results as JSON")
  .option("--committed", "Also check that git working tree is clean")
  .action(
    async (
      targetPaths: string[],
      options: { all?: boolean; staged?: boolean; hook?: boolean; links?: boolean; preCommit?: boolean; urls?: boolean; urlsSince?: string; canonical?: boolean; fix?: boolean; json?: boolean; committed?: boolean }
    ) => {
      try {
        const canonical = options.canonical === true;
        rejectUnsupportedCanonicalScope({ canonical, options, targetPaths });
        rejectUnsupportedPreCommitScope({ preCommit: options.preCommit === true, options, targetPaths });

        if (options.preCommit === true) {
          await runPreCommit();
        }

        if (canonical && options.fix === true) {
          await runCanonicalFix({ json: options.json === true });
        }

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
          resolveCliTargetPath({ boxRoot, raw: p, relativeTo: process.cwd() })
        );

        const collected = await collectResults(options, { boxRoot, ctx, resolved, json, ignore, canonical });
        const legacySchemaErrors = await checkLegacySchemaPath(boxRoot);
        const rootStrayErrors = await checkRootStrayErrors(boxRoot);
        const results: ValidationResults = { ...collected, legacySchemaErrors, rootStrayErrors, reservedSegmentErrors: await checkReservedSegmentErrors(boxRoot), canonical };

        if (json) {
          const counts = canonicalCounts(canonicalBuckets(results));
          const payload = {
            cards: results.cardSummary,
            // Broken-reference warnings (type: "reference") called out as their
            // own count — they're the subset that accumulates silently across
            // renames/deletes and would otherwise hide inside `cards.totalWarnings`.
            brokenRefs: results.cardSummary !== null ? countBrokenRefs(results.cardSummary) : 0,
            markdown: results.mdSummary,
            attach: results.attachErrors,
            prominence: results.prominenceWarnings ?? [],
            claudeMd: results.claudeMdWarnings,
            views: results.viewWarnings,
            legacySchemaPath: results.legacySchemaErrors,
            rootStrays: results.rootStrayErrors,
            reservedSegments: results.reservedSegmentErrors,
            // The `--canonical` buckets, top-level and separate for the same
            // reason `brokenRefs` is: a relative-but-resolving ref is a
            // different signal from a broken one. Zeroed when --canonical
            // wasn't given, so consumers always find the keys.
            nonCanonicalRefs: counts.refs,
            nonCanonicalDossierLinks: counts.dossierLinks,
            canonicalViews: results.canonicalViewWarnings,
            canonicalDossierLinks: results.canonicalDossierWarnings,
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
        console.error(`Error: ${errorMessage(error)}`);
        process.exit(1);
      }
    }
  );
