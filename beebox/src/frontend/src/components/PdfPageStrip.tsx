/**
 * Horizontal strip of an extracted document's page renders.
 *
 * Presentational: the caller (PdfCardView) lists the card's attach
 * scope and hands over already-resolved image URLs. Each thumbnail opens in the
 * shared lightbox, so prev/next paging through the document comes for free.
 *
 * `activePage` (from a `?page=3` param) rings the matching thumbnail and
 * scrolls it into view — how a link into a specific page of a document lands.
 */

import { useEffect, useRef } from "react";
import { cn } from "../lib/cn";
import type { DocumentPage } from "../lib/pdf-card";
import { Image } from "./ui/Image";
import { Text } from "./ui/Text";

export interface PdfPageStripProps {
  pages: DocumentPage[];
  /** Page to highlight and scroll to, or null for none. */
  activePage: number | null;
}

/** DOM id of a page thumbnail — the anchor a `#page-3` link targets. */
function pageAnchorId(page: number): string {
  return `page-${page}`;
}

export function PdfPageStrip({ pages, activePage }: PdfPageStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activePage === null) return;
    const target = stripRef.current?.querySelector(`[data-page="${activePage}"]`);
    if (!(target instanceof HTMLElement)) return;
    target.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activePage, pages.length]);

  if (pages.length === 0) return null;

  return (
    <div ref={stripRef} className="flex gap-3 overflow-x-auto pb-2">
      {pages.map(({ page, src }) => (
        <figure
          key={page}
          id={pageAnchorId(page)}
          data-page={page}
          className={cn(
            "flex-shrink-0 flex flex-col items-center gap-1 p-1 rounded",
            page === activePage ? "ring-2 ring-accent" : "",
          )}
        >
          <Image src={src} alt={`Page ${page}`} size="sm" bordered lightbox loading="lazy" />
          <figcaption>
            <Text size="xs" tone="muted">Page {page}</Text>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
