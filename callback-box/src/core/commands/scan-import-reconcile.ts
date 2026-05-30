/**
 * Pair reconciliation and bundling for scan-mode pages.
 *
 * Reconcile per-page analyses across overlapping batches into one resolved
 * page each (with a final mutual-agreement pair), then group resolved pages
 * into photo bundles, orphan backs, unsure pages, and blank pages.
 */

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
    picked[i] = pickAnalysis(pageAnalyses.get(i), { index: i, conflicts });
  }

  // Reconcile pairs: only mutual claims survive.
  const resolved: ResolvedPage[] = [];
  for (let i = 0; i < totalPages; i++) {
    const analysis = picked[i]!;
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
    resolved.push({ index: i, analysis, pairedWith, conflict: conflicts[i]! });
  }
  return resolved;
}

/**
 * Choose the winning analysis for one page, recording a conflict when two
 * overlapping batches disagree. Mutates `conflicts[i]` as a side effect.
 */
function pickAnalysis(
  analyses: ScanPageAnalysis[] | undefined,
  { index: i, conflicts }: { index: number; conflicts: boolean[] }
): ScanPageAnalysis {
  if (!analyses || analyses.length === 0) {
    return makeMissingAnalysis(i);
  }
  if (analyses.length === 1) {
    return analyses[0]!;
  }
  const a = analyses[0]!;
  const b = analyses[1]!;
  if (a.kind !== b.kind || a.paired_with_index !== b.paired_with_index) {
    conflicts[i] = true;
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
    flag_reason: "Page analysis missing — Gemini batch failed",
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
    if (a.kind === "blank") {
      used.add(page.index);
      blankPages.push(page.index);
      continue;
    }
    if (a.kind === "unsure") {
      used.add(page.index);
      unsurePages.push(page);
      continue;
    }
    if (a.kind === "photo") {
      used.add(page.index);
      bundles.push(buildPhotoBundle(page, { resolved, used }));
      continue;
    }
    if (a.kind === "back") {
      // A back not consumed by any photo — orphan.
      used.add(page.index);
      orphanBacks.push({ index: page.index, analysis: a });
      continue;
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
