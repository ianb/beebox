/**
 * Pair reconciliation and bundling for scan-mode pages.
 *
 * Reconcile per-page analyses across overlapping batches into one resolved
 * page each (with a final mutual-agreement pair), then group resolved pages
 * into photo bundles, orphan backs, unsure pages, and blank pages.
 */

import { assertNever, invariant } from "../../lib/invariant.js";
import type { ScanPageAnalysis } from "./scan-import-gemini.js";

export interface ResolvedPage {
  index: number;
  analysis: ScanPageAnalysis;
  /** Final partner page index after pair reconciliation, or null. */
  pairedWith: number | null;
  /** Multiple analyses existed and disagreed on something. Worth flagging. */
  conflict: boolean;
}

/**
 * Reconcile per-page analyses across overlapping batches and resolve final
 * pair assignments.
 *
 * For each page:
 *  - If it appeared in only one batch, that analysis wins.
 *  - If it appeared in two, prefer the analysis that named a partner; if
 *    both did, prefer the one whose claim is mutual with the partner's
 *    other-batch claim.
 *
 * For pairing: only finalize a pair when both pages name each other (mutual
 * agreement). Otherwise the pages stay singletons / orphans.
 */
export function resolveScanPages(
  pageAnalyses: Map<number, ScanPageAnalysis[]>,
  totalPages: number
): ResolvedPage[] {
  const picked: ScanPageAnalysis[] = Array.from({ length: totalPages });
  const conflicts: boolean[] = Array.from({ length: totalPages }, () => false);

  for (let i = 0; i < totalPages; i++) {
    picked[i] = pickAnalysis(pageAnalyses.get(i), { index: i, conflicts, pageAnalyses });
  }

  // Reconcile pairs: only mutual claims survive.
  const resolved: ResolvedPage[] = [];
  for (const [i, analysis] of picked.entries()) {
    let pairedWith: number | null = null;
    const claim = analysis.paired_with_index;
    if (claim !== null && claim >= 0 && claim < totalPages) {
      const partner = picked[claim];
      if (partner && partner.paired_with_index === i) {
        pairedWith = claim;
      } else {
        // Partner didn't reciprocate — treat as orphan, flag for conflict.
        conflicts[i] = true;
      }
    }
    const conflict = conflicts[i];
    invariant(conflict !== undefined, "conflicts is initialized with one entry per page index");
    resolved.push({ index: i, analysis, pairedWith, conflict });
  }
  return resolved;
}

/** Is `claim` reciprocated by ANY analysis of the claimed partner page? */
function claimReciprocated(
  claim: number | null,
  { index, pageAnalyses }: { index: number; pageAnalyses: Map<number, ScanPageAnalysis[]> }
): boolean {
  if (claim === null) return false;
  const partnerAnalyses = pageAnalyses.get(claim);
  if (!partnerAnalyses) return false;
  return partnerAnalyses.some((partner) => partner.paired_with_index === index);
}

/**
 * Choose the winning analysis for one page, recording a conflict when two
 * overlapping batches disagree. Mutates `conflicts[i]` as a side effect.
 * Preference order: a pair claim the partner reciprocates (in either batch)
 * beats an unreciprocated one; any claim beats none; ties take the second
 * batch, which saw a wider forward context.
 */
function pickAnalysis(
  analyses: ScanPageAnalysis[] | undefined,
  {
    index: i,
    conflicts,
    pageAnalyses,
  }: { index: number; conflicts: boolean[]; pageAnalyses: Map<number, ScanPageAnalysis[]> }
): ScanPageAnalysis {
  if (!analyses || analyses.length === 0) {
    return makeMissingAnalysis(i);
  }
  if (analyses.length === 1) {
    const [only] = analyses;
    invariant(only !== undefined, "checked analyses.length === 1 above");
    return only;
  }
  const [a, b] = analyses;
  invariant(a !== undefined && b !== undefined, "checked analyses.length >= 2 above");
  if (a.kind !== b.kind || a.paired_with_index !== b.paired_with_index) {
    conflicts[i] = true;
  }
  // Prefer the analysis whose pair claim is mutual with the partner's own
  // claim — the comment always promised this; overlap-heavy batching (small
  // Claude batches, overlap-preserving splits) makes it actually matter.
  const aMutual = claimReciprocated(a.paired_with_index, { index: i, pageAnalyses });
  const bMutual = claimReciprocated(b.paired_with_index, { index: i, pageAnalyses });
  if (aMutual !== bMutual) {
    return aMutual ? a : b;
  }
  // Prefer the analysis that named a partner.
  if (a.paired_with_index !== null && b.paired_with_index === null) {
    return a;
  }
  if (b.paired_with_index !== null && a.paired_with_index === null) {
    return b;
  }
  // Both named (or both null) — take the second batch, which saw a wider
  // forward context. Arbitrary but consistent.
  return b;
}

function makeMissingAnalysis(index: number): ScanPageAnalysis {
  return {
    index,
    kind: "unsure",
    paired_with_index: null,
    description: "",
    title: "",
    rotation: 0,
    subject_bbox: null,
    has_text: false,
    text_blocks: [],
    date_hint: null,
    flag_for_review: true,
    flag_reason: "Page analysis missing — vision batch failed",
  };
}

export interface PhotoBundle {
  photoIndex: number;
  backIndex: number | null;
  photo: ScanPageAnalysis;
  back: ScanPageAnalysis | null;
  flagForReview: boolean;
  flagReasons: string[];
}

export interface OrphanBack {
  index: number;
  analysis: ScanPageAnalysis;
}

export interface BundleResult {
  bundles: PhotoBundle[];
  orphanBacks: OrphanBack[];
  unsurePages: ResolvedPage[];
  blankPages: number[];
}

/**
 * Group resolved pages into photo bundles (photo + optional back), orphan
 * backs (text-bearing pages with no matching photo), unsure pages (need
 * human review), and blank pages (drop).
 */
export function bundleResolvedPages(resolved: ResolvedPage[]): BundleResult {
  const used = new Set<number>();
  const bundles: PhotoBundle[] = [];
  const orphanBacks: OrphanBack[] = [];
  const unsurePages: ResolvedPage[] = [];
  const blankPages: number[] = [];

  for (const page of resolved) {
    if (used.has(page.index)) continue;
    const a = page.analysis;
    used.add(page.index);
    switch (a.kind) {
      case "blank":
        blankPages.push(page.index);
        continue;
      case "unsure":
        unsurePages.push(page);
        continue;
      case "photo":
        bundles.push(buildPhotoBundle(page, { resolved, used }));
        continue;
      case "back":
        // A back not consumed by any photo — orphan.
        orphanBacks.push({ index: page.index, analysis: a });
        continue;
      default:
        assertNever(a.kind);
    }
  }

  return { bundles, orphanBacks, unsurePages, blankPages };
}

/**
 * Build a photo bundle for a photo page, consuming its reciprocated back (if
 * any) by marking it `used`. Collects review flags from both pages.
 */
function buildPhotoBundle(
  page: ResolvedPage,
  { resolved, used }: { resolved: ResolvedPage[]; used: Set<number> }
): PhotoBundle {
  const a = page.analysis;
  const flagReasons: string[] = [];
  if (a.flag_for_review && a.flag_reason) flagReasons.push(a.flag_reason);
  if (page.conflict) flagReasons.push("Overlapping batches disagreed on this page");
  let back: ScanPageAnalysis | null = null;
  let backIndex: number | null = null;
  if (page.pairedWith !== null) {
    const partner = resolved[page.pairedWith];
    if (partner && partner.analysis.kind === "back" && !used.has(partner.index)) {
      back = partner.analysis;
      backIndex = partner.index;
      used.add(partner.index);
      if (partner.analysis.flag_for_review && partner.analysis.flag_reason) {
        flagReasons.push(`Back: ${partner.analysis.flag_reason}`);
      }
      if (partner.conflict) flagReasons.push("Overlapping batches disagreed on the back");
    }
  }
  return {
    photoIndex: page.index,
    backIndex,
    photo: a,
    back,
    flagForReview: flagReasons.length > 0,
    flagReasons,
  };
}
