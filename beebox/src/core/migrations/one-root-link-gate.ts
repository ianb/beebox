/**
 * The hard link gate — Track E step 6 (`docs/plans/one-root-box-layout.md`).
 * Normal `bbx validate` treats a broken ref as a WARNING (`card-lint.ts`'s
 * `lintFrontmatterCard`; box-wide markdown link scan in
 * `validate-markdown.ts`'s `boxWideLinkWarnings`) — legitimate moves/archives
 * make broken refs common enough that erroring on every one would block
 * routine commits. The migration is different: every ref in the box was just
 * rewritten in one shot, so ANY dangling ref left afterward means the
 * rewriter (`one-root-ref-rewrite.ts`) missed a form. Refusing to commit is
 * the backstop for that miss.
 *
 * Reuses the same box-wide scanners `bbx validate` uses — the "error mode" is
 * just this module's own decision to treat their (normally warning-level)
 * findings as fatal, not a separate checker. A symlinked card/doc the
 * migration deliberately left byte-untouched (Finding 1, round 4 hardening)
 * is excluded from both the card and markdown scans at their SOURCE
 * (`markdown-lint-rules.ts`'s `noBrokenInternalLinks` skips a symlinked leaf
 * outright; a `.card` file's ref problems are warning-only regardless), so
 * this module needs no special-casing of its own for that case.
 */

import { lintCardsDispatch, type LintDispatchOptions } from "../card-lint.js";
import { countBrokenRefs } from "../../cards/lint-format.js";
import { listBoxCardFiles, listBoxViewFiles } from "../list-cards.js";
import { buildLoadContext } from "../load-context.js";
import { boxWideLinkWarnings } from "../../cli/commands/validate-markdown.js";
import { collectViewRefWarnings } from "../views/refs.js";

export interface OneRootLinkGateResult {
  ok: boolean;
  /** Human-readable report of every broken ref found, empty when `ok`. */
  report: string;
}

/**
 * Scan the whole box for broken refs (cards' frontmatter/body refs, and
 * `.md` dossiers' inline links) and fail closed on any hit.
 */
export async function runOneRootLinkGate(boxRoot: string): Promise<OneRootLinkGateResult> {
  const ctx = await buildLoadContext(boxRoot);
  const cardPaths = await listBoxCardFiles(boxRoot);
  const options: LintDispatchOptions = { boxRoot, ctx };
  const cardSummary = await lintCardsDispatch(cardPaths, options);
  const brokenCardRefs = countBrokenRefs(cardSummary);

  const mdReport = await boxWideLinkWarnings(boxRoot);

  const viewPaths = await listBoxViewFiles(boxRoot);
  const viewWarnings = await collectViewRefWarnings(viewPaths, boxRoot);

  if (brokenCardRefs === 0 && mdReport === null && viewWarnings.length === 0) {
    return { ok: true, report: "" };
  }

  const lines: string[] = [
    "one-root migration: hard link gate found broken references after the ref rewrite — refusing to commit.",
  ];
  if (brokenCardRefs > 0) {
    lines.push(`${String(brokenCardRefs)} broken card reference(s):`);
    for (const result of cardSummary.results) {
      for (const warning of result.warnings) {
        if (warning.type === "reference") lines.push(`  ${result.path}: ${warning.message}`);
      }
    }
  }
  if (mdReport !== null) {
    lines.push("Broken markdown links:");
    lines.push(mdReport);
  }
  if (viewWarnings.length > 0) {
    lines.push(`${String(viewWarnings.length)} broken view reference(s):`);
    for (const warning of viewWarnings) lines.push(`  ${warning}`);
  }
  return { ok: false, report: lines.join("\n") };
}
