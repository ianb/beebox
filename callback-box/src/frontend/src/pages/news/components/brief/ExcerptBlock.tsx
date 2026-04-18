/**
 * ExcerptBlock - Quoted text from a source.
 * Uses a div instead of blockquote to avoid prose styling adding quotes.
 */

import type { Excerpt } from "./types";
import { ExternalLink } from "../../../../components/ui/ExternalLink";

export function ExcerptBlock({ excerpt }: { excerpt: Excerpt }) {
  return (
    <div className="my-2 pl-3 border-l-2 border-warm-400 text-warm-700 text-sm">
      <p>{excerpt.text}</p>
      <p className="mt-1 text-xs text-warm-600">
        — {excerpt.link ? (
          <ExternalLink href={excerpt.link}>{excerpt.source}</ExternalLink>
        ) : excerpt.source}
      </p>
    </div>
  );
}
