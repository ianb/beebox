/**
 * Quote-anchor jumping — shared by the commentary and webpage views.
 *
 * A `{% source %}` chip carries the verbatim span it annotates. Clicking it
 * jumps to that span in the rendered page using Chrome's text-fragment matching
 * algorithm (text-fragments-polyfill), highlighting it non-destructively via
 * the CSS Custom Highlight API so it never fights React's ownership of the DOM.
 */

import { processTextFragmentDirective } from "text-fragments-polyfill/text-fragment-utils";

/** Named highlight for the span a source chip jumped to (see index.css). */
export const QUOTE_HIGHLIGHT = "cb-quote-anchor";

/**
 * Find the range of `exact` within `root` via text-fragment matching, or null.
 */
export function findQuoteRange(root: HTMLElement, exact: string): Range | null {
  const range = processTextFragmentDirective({ textStart: exact }, document, root)[0];
  return range === undefined ? null : range;
}

/**
 * Highlight a matched range non-destructively via the CSS Custom Highlight API
 * — no DOM mutation. No-op where the API is unavailable.
 */
export function highlightRange(range: Range): void {
  if (typeof Highlight === "undefined" || !("highlights" in CSS)) return;
  CSS.highlights.set(QUOTE_HIGHLIGHT, new Highlight(range));
}

export function scrollRangeIntoView(range: Range): void {
  const start = range.startContainer;
  const el = start.nodeType === Node.TEXT_NODE ? start.parentElement : (start as Element);
  if (el !== null) el.scrollIntoView({ block: "center", behavior: "smooth" });
}
