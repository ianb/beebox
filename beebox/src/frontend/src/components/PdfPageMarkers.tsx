/**
 * Page-boundary markers in the gutter of a pdf card's extracted text.
 *
 * The card body carries no page breaks — the mapping lives in the card's
 * `attach/docling.json.gz` (`lib/docling-match.ts` joins the two). This draws
 * the result: a small "p. N" button beside the first block of each new page,
 * which selects that page in the strip above.
 *
 * Absolutely positioned over the body rather than injected into it. The body is
 * Markdoc output that React owns; measuring it and drawing beside it keeps this
 * a read-only overlay, so a re-render of the document can never fight the
 * markers (the same reason quote anchors highlight via the CSS Highlight API
 * instead of wrapping nodes).
 */

import { Text } from "./ui/Text";

/** One marker: the page it names, and its vertical offset within the body box. */
export interface PageMarker {
  page: number;
  /** Pixels from the top of the positioned body container. */
  top: number;
}

export interface PdfPageMarkersProps {
  markers: PageMarker[];
  /** Which page is currently selected in the strip, so its marker reads as active. */
  activePage: number | null;
  onSelect: (page: number) => void;
}

export function PdfPageMarkers({ markers, activePage, onSelect }: PdfPageMarkersProps) {
  if (markers.length === 0) return null;
  return (
    // aria-hidden: every marker duplicates a control the page strip already
    // offers, so to a screen reader this layer is decoration over the text.
    <div aria-hidden="true" className="absolute left-0 top-0 w-12 h-full pointer-events-none">
      {markers.map(({ page, top }) => (
        <button
          key={page}
          type="button"
          tabIndex={-1}
          onClick={() => { onSelect(page); }}
          style={{ top: `${String(top)}px` }}
          className={`absolute left-0 pointer-events-auto rounded px-1 py-0.5 border transition-colors ${
            page === activePage
              ? "border-accent bg-accent-50 text-accent-dark"
              : "border-transparent text-warm-400 hover:border-warm-300 hover:text-warm-600"
          }`}
        >
          <Text size="xs" mono>p.&nbsp;{page}</Text>
        </button>
      ))}
    </div>
  );
}
