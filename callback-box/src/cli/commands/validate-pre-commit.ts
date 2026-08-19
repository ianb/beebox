/**
 * `cb validate --pre-commit`: everything the per-box pre-commit hook needs, in
 * ONE process.
 *
 * The hook used to invoke `cb` three times (staged validation, box-wide link
 * scan, unlisted-binary walk). Each invocation paid the full CLI startup floor
 * (~0.7s) for ~0.05–0.15s of actual work, and commit duration is also git-lock
 * hold duration for a box, so the boots dominated every commit. See
 * `docs/plans/commit-performance.md`.
 *
 * The three checks keep their individual semantics, with one deliberate change
 * each to the box-wide passes:
 *
 * - **Link scan** runs only when the staged diff deletes or renames a path.
 *   Only a delete/rename can make a link in an *unstaged* referrer newly
 *   dangle; an added or modified file can break only its own links, which the
 *   staged pass already checks. Side effect, accepted: a pre-existing dangling
 *   link stops being re-warned on every unrelated commit — `cb health` and
 *   `cb validate --links` still surface it on demand.
 * - **Unlisted binaries** are read from the index rather than the tree
 *   (`core/annex/staged-unlisted.ts`).
 */

import { formatLintResults } from "../../cards/index.js";
import { lintCardsDispatch } from "../../core/card-lint.js";
import { buildLoadContext } from "../../core/load-context.js";
import { loadValidationIgnore } from "../../core/validation-ignore.js";
import {
  describeStagedUnlistedBinaries,
  findStagedUnlistedBinaries,
} from "../../core/annex/staged-unlisted.js";
import { listStagedCards, listStagedRelPaths } from "../../lib/staged-files.js";
import {
  boxWideLinkWarnings,
  formatMarkdownResults,
  listStagedMarkdown,
  lintMarkdownFiles,
} from "./validate-markdown.js";

export interface PreCommitOutcome {
  /** Blocking findings, formatted for stdout. Empty when everything passed. */
  report: string;
  /**
   * Warn-only box-wide link findings for stderr; null when the scan was skipped
   * (no staged delete/rename) or found nothing. Never affects the exit code.
   */
  linkWarnings: string | null;
  /** Blocking errors. Non-zero means the commit must be rejected. */
  errorCount: number;
}

/**
 * Run the three commit-time checks against `boxRoot`. Silent when clean: the
 * hook runs on every commit, so "No staged cards or markdown to validate" would
 * be noise on every single one.
 */
export async function runPreCommitChecks(
  boxRoot: string,
  { colors }: { colors: boolean }
): Promise<PreCommitOutcome> {
  const ignore = await loadValidationIgnore(boxRoot);
  const cards = (await listStagedCards(boxRoot)).filter((p) => !ignore.isIgnored(p));
  const mdFiles = (await listStagedMarkdown(boxRoot)).filter((p) => !ignore.isIgnored(p));

  const sections: string[] = [];
  let errorCount = 0;

  if (cards.length > 0) {
    // Built only when there are staged cards — loading every schema is the
    // expensive half of the staged pass, and most commits have none.
    const ctx = await buildLoadContext(boxRoot);
    const summary = await lintCardsDispatch(cards, { boxRoot, ctx });
    errorCount += summary.totalErrors;
    // Only when there is something to say: `formatLintResults` otherwise emits
    // a "✓ N files checked" line, which on the commit path is one more line of
    // routine-success output on every single commit.
    if (summary.totalErrors > 0 || summary.totalWarnings > 0) {
      const output = formatLintResults(summary, { colors });
      if (output) sections.push(output);
    }
  }

  if (mdFiles.length > 0) {
    const summary = await lintMarkdownFiles(mdFiles, { boxRoot });
    errorCount += summary.totalErrors;
    const output = formatMarkdownResults(summary, { colors });
    if (output) sections.push(output);
  }

  const unlisted = await findStagedUnlistedBinaries(boxRoot);
  if (unlisted.length > 0) {
    errorCount += unlisted.length;
    sections.push(describeStagedUnlistedBinaries(unlisted));
  }

  const removals = await listStagedRelPaths(boxRoot, { diffFilter: "DR" });
  const linkWarnings = removals.length > 0 ? await boxWideLinkWarnings(boxRoot) : null;

  return { report: sections.join("\n\n"), linkWarnings, errorCount };
}

/**
 * Reject `--pre-commit` paired with another scope. Same posture as
 * `rejectUnsupportedCanonicalScope`: half-working would read as "this commit is
 * clean", so an unsupported combination errors out instead.
 */
export function rejectUnsupportedPreCommitScope(input: {
  preCommit: boolean;
  options: { staged?: boolean; hook?: boolean; links?: boolean; urls?: boolean; urlsSince?: string; canonical?: boolean; all?: boolean };
  targetPaths: string[];
}): void {
  const { preCommit, options, targetPaths } = input;
  if (!preCommit) return;
  const conflicts: string[] = [];
  if (options.staged === true) conflicts.push("--staged");
  if (options.all === true) conflicts.push("--all");
  if (options.hook === true) conflicts.push("--hook");
  if (options.links === true) conflicts.push("--links");
  if (options.canonical === true) conflicts.push("--canonical");
  if (options.urls === true || typeof options.urlsSince === "string") conflicts.push("--urls");
  if (targetPaths.length > 0) conflicts.push("explicit paths");
  if (conflicts.length === 0) return;
  console.error(
    `Error: --pre-commit is the whole commit-time suite and does not combine with ${conflicts.join(", ")}. ` +
    "Run `cb validate --pre-commit` on its own."
  );
  process.exit(1);
}
