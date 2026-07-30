/**
 * The `--canonical` half of `cb validate`: scope guarding, the two-bucket
 * report formatting, and the `--fix` entry point. Split out of `validate.ts`
 * for the same reason `validate-markdown.ts` was — the command file stays a
 * dispatcher, not a grab bag.
 *
 * Detection lives in `core/canonical-refs.ts`, normalization in
 * `core/canonicalize-refs.ts`; this module is only CLI surface.
 */

import { countNonCanonicalRefs, type LintSummary } from "../../cards/index.js";
import { formatCanonicalSummary } from "../../core/canonical-refs.js";
import { canonicalizeBox, formatCanonicalizeReport } from "../../core/canonicalize-refs.js";
import { loadValidationIgnore } from "../../core/validation-ignore.js";
import { requireBoxRoot } from "../../lib/paths.js";

/** The three surfaces the canonical report draws its two buckets from. */
export interface CanonicalBuckets {
  /** Card lint results, carrying `type: "canonical"` warnings when the check ran. */
  cardSummary: LintSummary | null;
  /** Non-canonical `cardRef=` findings in box-authored views. */
  viewWarnings: string[];
  /** Non-canonical `[text](path)` findings in `.md` dossiers. */
  dossierWarnings: string[];
}

/**
 * The two counts, reported distinctly: card refs (frontmatter, body Markdoc
 * `ref=`, body links, view `cardRef=`) and `.md` dossier links. Different
 * surfaces with different fixers — collapsing them would hide which one a box's
 * drift lives in.
 */
export function canonicalCounts(buckets: CanonicalBuckets): { refs: number; dossierLinks: number } {
  const cardRefs = buckets.cardSummary === null ? 0 : countNonCanonicalRefs(buckets.cardSummary);
  return {
    refs: cardRefs + buckets.viewWarnings.length,
    dossierLinks: buckets.dossierWarnings.length,
  };
}

/**
 * The view/dossier findings (card findings already printed under their own file
 * headers by the card formatter) followed by the two-bucket summary line.
 */
export function formatCanonicalReport(
  buckets: CanonicalBuckets,
  { colors }: { colors: boolean }
): string {
  const findings = [...buckets.viewWarnings, ...buckets.dossierWarnings];
  const summary = formatCanonicalSummary(canonicalCounts(buckets), { colors });
  return findings.length === 0 ? summary : `${findings.join("\n")}\n\n${summary}`;
}

/**
 * `--canonical` walks the whole box, so it can't ride along with a scope that
 * validates a subset or exits early. Erroring beats half-working: a `--staged
 * --canonical` that silently reported nothing would read as "this box is
 * clean".
 */
export function rejectUnsupportedCanonicalScope(input: {
  canonical: boolean;
  options: { staged?: boolean; hook?: boolean; links?: boolean; urls?: boolean; urlsSince?: string; fix?: boolean };
  targetPaths: string[];
}): void {
  const { canonical, options, targetPaths } = input;
  if (!canonical) {
    if (options.fix === true) {
      console.error("Error: --fix only applies to --canonical (run `cb validate --canonical --fix`)");
      process.exit(1);
    }
    return;
  }
  const conflicts: string[] = [];
  if (options.staged === true) conflicts.push("--staged");
  if (options.hook === true) conflicts.push("--hook");
  if (options.links === true) conflicts.push("--links");
  if (options.urls === true || typeof options.urlsSince === "string") conflicts.push("--urls");
  if (targetPaths.length > 0) conflicts.push("explicit paths");
  if (conflicts.length === 0) return;
  console.error(
    `Error: --canonical is a whole-box check and does not combine with ${conflicts.join(", ")}. ` +
    "Run `cb validate --canonical` on its own (add --fix to rewrite)."
  );
  process.exit(1);
}

/** `cb validate --canonical --fix`: normalize the box, print the tally, exit. */
export async function runCanonicalFix({ json }: { json: boolean }): Promise<never> {
  const boxRoot = await requireBoxRoot();
  const ignore = await loadValidationIgnore(boxRoot);
  const report = await canonicalizeBox(boxRoot, { ignore });
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatCanonicalizeReport(report));
  process.exit(0);
}
