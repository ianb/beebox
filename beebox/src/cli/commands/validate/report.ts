/**
 * `bbx validate` reporting: the text report, the error count, the canonical
 * buckets, and the `--committed` clean-tree check. Split from command.ts for
 * its line budget.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { formatLintResults } from "../../../exports/cards.js";
import { formatMarkdownResults } from "../../validate-markdown.js";
import { formatAttachLintErrors } from "../../../lib/attach-lint.js";
import { formatProminenceLintWarnings } from "../../../core/lint-prominence/core.js";
import { formatCanonicalReport, type CanonicalBuckets } from "./canonical.js";
import { getStatus } from "../../../lib/git/core/operations.js";
import { errnoCode } from "../../../shared/error-guards.js";
import type { ValidationResults } from "./command.js";

export function canonicalBuckets(results: ValidationResults): CanonicalBuckets {
  return {
    cardSummary: results.cardSummary,
    viewWarnings: results.canonicalViewWarnings,
    dossierWarnings: results.canonicalDossierWarnings,
  };
}

/** Print human-readable card/markdown/attach/legacy-schema-path results to stdout. */
export function printTextResults(results: ValidationResults): void {
  const { cardSummary, mdSummary, attachErrors, instructionFileWarnings, viewWarnings, legacySchemaErrors, rootStrayErrors, reservedSegmentErrors, presentationErrors, legacyInstructionErrors } = results;
  if (cardSummary !== null) {
    const output = formatLintResults(cardSummary);
    if (output) console.log(output);
  }
  if (mdSummary !== null) {
    const output = formatMarkdownResults(mdSummary);
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
    const output = formatAttachLintErrors(attachErrors);
    console.log(`\n${output}`);
    console.log(`\nAttach layout: ${attachErrors.length} issue(s)`);
  }
  if (results.prominenceWarnings !== undefined && results.prominenceWarnings.length > 0) {
    console.log(`\n${formatProminenceLintWarnings(results.prominenceWarnings)}`);
  }
  if (results.boxSchemaFields !== undefined && results.boxSchemaFields.length > 0) {
    console.log(`\nBox-local schemas declare reserved field names (rename them with a field map and \`bbx migrate-fields\`; see the box schema doc):\n${results.boxSchemaFields.map((w) => `  ${w}`).join("\n")}`);
  }
  if (instructionFileWarnings.length > 0) {
    console.log(`\n${instructionFileWarnings.join("\n")}`);
  }
  if (viewWarnings.length > 0) {
    console.log(`\n${viewWarnings.join("\n")}`);
  }
  const boxWideErrors = [...legacySchemaErrors, ...rootStrayErrors, ...reservedSegmentErrors, ...presentationErrors, ...legacyInstructionErrors, ...results.systemCardErrors];
  if (boxWideErrors.length > 0) console.log(`\n${boxWideErrors.join("\n")}`);
  if (results.canonical) {
    console.log(`\n${formatCanonicalReport(canonicalBuckets(results))}`);
  }
}

/**
 * Verify the git working tree is clean. Exits 1 (printing the dirty files) if
 * not. Prints a confirmation line in non-JSON mode when clean.
 */
export async function checkCommitted(boxRoot: string, { json }: { json: boolean }): Promise<void> {
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

export function countTotalErrors({ cardSummary, mdSummary, attachErrors, legacySchemaErrors, rootStrayErrors, reservedSegmentErrors, presentationErrors, legacyInstructionErrors, systemCardErrors }: ValidationResults): number {
  return (
    (cardSummary !== null ? cardSummary.totalErrors : 0) +
    (mdSummary !== null ? mdSummary.totalErrors : 0) +
    attachErrors.length +
    legacySchemaErrors.length +
    rootStrayErrors.length +
    reservedSegmentErrors.length +
    presentationErrors.length + legacyInstructionErrors.length + systemCardErrors.length
  );
}

/**
 * The post-commit hook's background URL check (`bbx validate --urls`) writes
 * its report to `.beebox/url-check.log`, where nothing else reads it. Show
 * its broken links on the next validate so the agent that cited them sees it.
 */
export async function printLastUrlCheck(boxRoot: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(path.join(boxRoot, ".beebox", "url-check.log"), "utf8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return;
    throw e;
  }
  if (!/^broken\b/m.test(text)) return;
  console.log(`\nThe URL check of the last commit found broken links (.beebox/url-check.log):\n${text.trimEnd()}`);
}
