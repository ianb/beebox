/**
 * `bbx validate` reporting: the text report, the error count, the canonical
 * buckets, and the `--committed` clean-tree check. Split from command.ts for
 * its line budget.
 */

import { formatLintResults } from "../../../exports/cards.js";
import { formatMarkdownResults } from "../../validate-markdown.js";
import { formatAttachLintErrors } from "../../../lib/attach-lint.js";
import { formatProminenceLintWarnings } from "../../../core/lint-prominence/core.js";
import { formatCanonicalReport, type CanonicalBuckets } from "./canonical.js";
import { getStatus } from "../../../lib/git/core/operations.js";
import type { ValidationResults } from "./command.js";

/**
 * Color only for a real terminal, and never under NO_COLOR: the common case
 * is output being piped or pasted, where escape codes are noise.
 */
export const useColor = (): boolean => process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

export function canonicalBuckets(results: ValidationResults): CanonicalBuckets {
  return {
    cardSummary: results.cardSummary,
    viewWarnings: results.canonicalViewWarnings,
    dossierWarnings: results.canonicalDossierWarnings,
  };
}

/** Print human-readable card/markdown/attach/legacy-schema-path results to stdout. */
export function printTextResults(results: ValidationResults): void {
  const { cardSummary, mdSummary, attachErrors, claudeMdWarnings, viewWarnings, legacySchemaErrors, rootStrayErrors, reservedSegmentErrors, presentationErrors } = results;
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
  if (results.boxSchemaFields !== undefined && results.boxSchemaFields.length > 0) {
    console.log(`\nBox-local schemas declare reserved field names (rename them with a field map and \`bbx migrate-fields\`; see the box schema doc):\n${results.boxSchemaFields.map((w) => `  ${w}`).join("\n")}`);
  }
  if (claudeMdWarnings.length > 0) {
    console.log(`\n${claudeMdWarnings.join("\n")}`);
  }
  if (viewWarnings.length > 0) {
    console.log(`\n${viewWarnings.join("\n")}`);
  }
  const boxWideErrors = [...legacySchemaErrors, ...rootStrayErrors, ...reservedSegmentErrors, ...presentationErrors, ...results.systemCardErrors];
  if (boxWideErrors.length > 0) console.log(`\n${boxWideErrors.join("\n")}`);
  if (results.canonical) {
    console.log(`\n${formatCanonicalReport(canonicalBuckets(results), { colors })}`);
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

export function countTotalErrors({ cardSummary, mdSummary, attachErrors, legacySchemaErrors, rootStrayErrors, reservedSegmentErrors, presentationErrors, systemCardErrors }: ValidationResults): number {
  return (
    (cardSummary !== null ? cardSummary.totalErrors : 0) +
    (mdSummary !== null ? mdSummary.totalErrors : 0) +
    attachErrors.length +
    legacySchemaErrors.length +
    rootStrayErrors.length +
    reservedSegmentErrors.length +
    presentationErrors.length + systemCardErrors.length
  );
}
