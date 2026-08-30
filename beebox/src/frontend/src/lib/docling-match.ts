/**
 * Mapping a rendered card body back onto the pages it was extracted from.
 *
 * A pdf card's body is Docling's markdown rendering of the document; it carries
 * no page markers, and the extractor adds none. The page for a given paragraph
 * exists only in `attach/docling.json.gz`, where each text item has a
 * `prov[].page_no` (`lib/docling.ts`). This module joins the two lists.
 *
 * The join is *sequential and lossy on purpose*. The two lists are not in
 * correspondence: the markdown merges list items, drops captions, and renders
 * tables as pipe text, so plenty of blocks have no counterpart. So we match
 * forward only, skip what doesn't line up, and refuse to guess — a paragraph
 * labelled with the wrong page is worse than one labelled with none.
 *
 * Pure and DOM-free (the caller walks the DOM and hands over block texts in
 * document order), so it unit-tests in plain Node.
 */

import type { DoclingDocumentSummary } from "./docling";

/**
 * How far ahead of the last match the matcher will look for the next one. Big
 * enough to step over the items markdown dropped, small enough that one bad
 * match can't jump to a distant page.
 */
const MATCH_LOOKAHEAD = 8;

/**
 * Below this normalized length, a block is short enough to plausibly repeat
 * verbatim (a generic heading like "Notes" or "Summary") — a match against
 * such a block is only trusted when it's the sole candidate in the lookahead
 * window. At or above this length a repeat within the window is vanishingly
 * unlikely to be a coincidence, so a first hit is trusted even alongside
 * others.
 */
const MIN_CONFIDENT_MATCH_LENGTH = 24;

/** Block-level elements a rendered card body is walked for. */
export const BODY_BLOCK_SELECTOR = "h1, h2, h3, h4, h5, h6, p, li, blockquote";

/** A docling text item reduced to what the matcher needs. */
export interface PagedText {
  text: string;
  page: number;
}

/** The page-carrying text items, in reading order — the matcher's right-hand list. */
export function pagedTexts(document: DoclingDocumentSummary): PagedText[] {
  return document.items.flatMap((item) =>
    item.kind === "text" && item.page !== null ? [{ text: item.text, page: item.page }] : [],
  );
}

/**
 * Whitespace-normalized, case-folded text for comparison. The body is Docling's
 * markdown rendering of these same items, so the characters match but the
 * spacing (and, after markdown→HTML, the emphasis marks) does not.
 */
export function normalizeForMatch(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim().toLowerCase();
}

/** Does one of these texts start with the other? Either direction counts as a match. */
function isPrefixMatch(block: string, candidate: string): boolean {
  return candidate.startsWith(block) || block.startsWith(candidate);
}

/**
 * Map rendered body blocks onto docling page numbers.
 *
 * Sequential, never backtracking: each block is matched against a bounded
 * window of docling texts starting just after the previous match, and a matched
 * block advances the window past it. A block that matches nothing is skipped.
 *
 * A block that matches more than one candidate inside the window is only
 * bound to the first when the block itself is long enough
 * ({@link MIN_CONFIDENT_MATCH_LENGTH}) to make a coincidental repeat
 * implausible; a short, generic block (a heading like "Notes") with more than
 * one candidate is genuinely ambiguous about which page it names and is
 * skipped instead — mislabeling one page as another is worse than no marker.
 *
 * @param blocks Block text in document order (see {@link BODY_BLOCK_SELECTOR}).
 * @param texts The document's paged texts, in reading order.
 * @returns block index → 1-based page number, for the blocks that matched.
 */
export function matchBlocksToPages(blocks: string[], texts: PagedText[]): Map<number, number> {
  const normalized = texts.map((entry) => normalizeForMatch(entry.text));
  const matched = new Map<number, number>();
  let cursor = 0;
  for (const [blockIndex, raw] of blocks.entries()) {
    const block = normalizeForMatch(raw);
    if (block === "") continue;
    const end = Math.min(texts.length, cursor + MATCH_LOOKAHEAD);
    let hit: number | null = null;
    let candidateCount = 0;
    for (let j = cursor; j < end; j++) {
      const candidate = normalized[j];
      if (candidate === undefined || candidate === "" || !isPrefixMatch(block, candidate)) continue;
      candidateCount += 1;
      if (hit === null) hit = j;
    }
    if (hit === null) continue;
    if (candidateCount > 1 && block.length < MIN_CONFIDENT_MATCH_LENGTH) continue;
    const page = texts[hit]?.page;
    if (page !== undefined) matched.set(blockIndex, page);
    cursor = hit + 1;
  }
  return matched;
}

/**
 * Reduce a block→page map to the page *boundaries* — the first block of each
 * new page. A marker beside every paragraph is noise; a marker where the page
 * turns is the affordance ("this is where page 3 starts").
 *
 * Only forward turns are kept: a match that goes backwards is a mis-match, not
 * a page the reader re-entered, so it is dropped rather than drawn.
 */
export function pageBoundaries(matched: Map<number, number>): Array<{ block: number; page: number }> {
  const boundaries: Array<{ block: number; page: number }> = [];
  let highest = 0;
  for (const [block, page] of [...matched.entries()].toSorted((a, b) => a[0] - b[0])) {
    if (page <= highest) continue;
    boundaries.push({ block, page });
    highest = page;
  }
  return boundaries;
}
