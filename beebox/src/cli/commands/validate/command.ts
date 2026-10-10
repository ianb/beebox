/**
 * bbx validate - Validate cards and markdown against schemas/rules
 */
import { typeFromFilename } from "../../../core/card-io.js";
import { isSystemCardType } from "../../../shared/system-card-paths.js";
import { checkSystemCards, checkStagedSystemCards } from "../../../core/system-cards.js";


import { Command } from "commander";
import { countBrokenRefs, type LintSummary } from "../../../exports/cards.js";
import {
  listStagedMarkdown,
  lintMarkdownFiles,
  boxWideLinkWarnings,
  type MarkdownLintSummary,
} from "../../validate-markdown.js";
import { requireBoxRoot, isCardFile, isMarkdownFile, isTrashedCard, isViewFile } from "../../../lib/paths/core.js";
import { listStagedCards } from "../../../lib/staged-files.js";
import { runPreCommitChecks, rejectUnsupportedPreCommitScope } from "./pre-commit.js";
import { collectDossierCanonicalWarnings, collectViewCanonicalWarnings } from "../../../core/canonical-refs.js";
import { canonicalCounts, rejectUnsupportedCanonicalScope, runCanonicalFix } from "./canonical.js";
import { listBoxCardFiles, listBoxMarkdownFiles, listBoxViewFiles } from "../../../core/list-cards.js";
import { collectViewRefWarnings } from "../../../core/views/refs.js";
import { lintAttachLayout, type AttachLintError } from "../../../lib/attach-lint.js";
import { lintProminenceBudget, type ProminenceLintWarning } from "../../../core/lint-prominence/core.js";
import { lintCardsDispatch } from "../../../core/card-lint/core/lint-cards.js";
import { lintAllClaudeMd } from "../../../core/claude-md-lint.js";
import { buildLoadContext } from "../../../core/load-context.js";
import { checkExternalUrls, formatUrlReport, type UrlCheckMode } from "../../../core/external/url-check/core.js";
import { loadValidationIgnore, type ValidationIgnore } from "../../../core/validation-ignore.js";
import type { LoadCardContext } from "../../../core/card-io.js";
import { checkLegacyInstructionErrors, checkLegacySchemaPath, checkPresentationErrors, checkReservedSegmentErrors, checkRootStrayErrors, boxSchemaFieldWarnings } from "./box-checks.js";
import { resolveCliTargetPath } from "../../lib/cli-target-path.js";
import { canonicalBuckets, checkCommitted, countTotalErrors, printTextResults, useColor } from "./report.js";
import { errorMessage } from "../../../shared/error-guards.js";


export interface CollectedResults {
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
  /** Box-local schemas declaring a reserved field name (`cards/reserved-fields.ts`) — box-wide only. */
  boxSchemaFields?: string[];
}

export interface ValidationResults extends CollectedResults {
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
  /** Invalid card/chrome presentation configuration from `_config/box.json`. */
  presentationErrors: string[];
  /** Legacy instruction files (`CLAUDE.md` and kin) in a box converted to `AGENTS.md`. Same box-wide treatment. */
  legacyInstructionErrors: string[];
  systemCardErrors: string[];
  /** Whether `--canonical` asked for the canonical-form report. */
  canonical: boolean;
}

/** The canonical findings in the shape `validate-canonical.ts` formats/counts. */

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
async function collectStagedResults({ boxRoot, ctx, resolved, ignore }: CollectArgs): Promise<CollectedResults> {
  const cards = [...(await listStagedCards(boxRoot)).filter((p) => !ignore.isIgnored(p) && !isSystemCardType(typeFromFilename(p) ?? "")), ...resolved.filter(isCardFile)];
  const mdFiles = [...(await listStagedMarkdown(boxRoot)).filter((p) => !ignore.isIgnored(p)), ...resolved.filter(isMarkdownFile)];
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
  const boxSchemaFields = await boxSchemaFieldWarnings(boxRoot);
  return {
    cardSummary,
    mdSummary,
    attachErrors,
    prominenceWarnings,
    boxSchemaFields,
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

export const validateCommand = new Command("validate")
  .description("Validate cards and markdown in the box")
  .argument("[paths...]", "Files to validate (cards or markdown). Omit to validate everything; pair with --staged to validate staged cards.")
  .option("--all", "Validate all files in the box (default when no path given)")
  .option("--staged", "Validate the cards currently staged in git")
  .option("--hook", "Hook mode: read a PostToolUse JSON payload from stdin and validate touched files. Warnings use exit 0 with JSON additionalContext on stdout; errors use exit 2 with stderr.")
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
          const { runHookMode } = await import("../../validate-hook/command.js");
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
        const reservedSegmentErrors = await checkReservedSegmentErrors(boxRoot);
        const presentationErrors = await checkPresentationErrors(boxRoot);
        const legacyInstructionErrors = await checkLegacyInstructionErrors(boxRoot);
        const systemCardErrors = options.staged ? await checkStagedSystemCards(boxRoot) : await checkSystemCards(boxRoot);
        const results: ValidationResults = { ...collected, systemCardErrors, legacySchemaErrors, rootStrayErrors, reservedSegmentErrors, presentationErrors, legacyInstructionErrors, canonical };

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
            boxSchemaFields: results.boxSchemaFields ?? [],
            claudeMd: results.claudeMdWarnings,
            views: results.viewWarnings,
            legacySchemaPath: results.legacySchemaErrors,
            rootStrays: results.rootStrayErrors,
            reservedSegments: results.reservedSegmentErrors,
            presentation: results.presentationErrors,
            legacyInstructionFiles: results.legacyInstructionErrors,
            systemCards: results.systemCardErrors,
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
