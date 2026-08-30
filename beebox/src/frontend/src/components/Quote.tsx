/**
 * Quote tag — verbatim words from a named person.
 *
 * Distinct from a plain Markdown blockquote: a `quote` carries provenance.
 * The styling reads as "this is exactly what they said," not "indented
 * aside." When an agent writes a doc, anything outside a `quote` is its
 * own synthesis/paraphrase; what's inside is reproduced word-for-word.
 *
 * Two shapes, decided by the Markdoc transform from `node.inline`:
 *  - QuoteInline — fits mid-sentence. Curly quotation marks around the
 *    span; attribution suffix (— Name) when `from` is provided.
 *  - QuoteBlock — figure with a styled blockquote and a figcaption for
 *    attribution.
 *
 * The `from` attribute may be either a display name (`from="Dana"`) or a
 * person-card ref (`from="people/dana"`). Refs become navigation links via
 * the surrounding link context; bare names render as plain text.
 */

import type { ReactNode } from "react";
import { isPersonRef, speakerDisplay } from "../lib/selection/quote-extract";
import type { NavigateHint, ViewTarget } from "../lib/view-url";

interface QuoteLinkContext {
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
}

function Attribution({
  from,
  linkCtx,
}: {
  from: string;
  linkCtx: QuoteLinkContext;
}): ReactNode {
  if (isPersonRef(from)) {
    const displayName = speakerDisplay(from);
    return (
      <button
        type="button"
        onClick={() => {
          const target: ViewTarget = { path: from, viewer: null, params: {} };
          linkCtx.onNavigate(target, { label: displayName });
        }}
        className="not-italic text-warm-600 hover:text-warm-800 underline-offset-2 hover:underline cursor-pointer"
      >
        {displayName}
      </button>
    );
  }
  return <span className="not-italic text-warm-600">{from}</span>;
}

export function makeQuoteComponents(linkCtx: QuoteLinkContext): {
  QuoteInline: (props: { from?: string; children?: ReactNode }) => ReactNode;
  QuoteBlock: (props: { from?: string; children?: ReactNode }) => ReactNode;
} {
  function QuoteInline({ from, children }: { from?: string; children?: ReactNode }) {
    return (
      <span className="text-primary-dark italic font-serif" data-from={from}>
        <span className="text-primary/60 not-italic font-sans">{"“"}</span>
        {children}
        <span className="text-primary/60 not-italic font-sans">{"”"}</span>
        {from !== undefined && from !== "" ? (
          <span className="not-italic font-sans text-warm-500 text-xs ml-1">
            {" — "}
            <Attribution from={from} linkCtx={linkCtx} />
          </span>
        ) : null}
      </span>
    );
  }

  function QuoteBlock({ from, children }: { from?: string; children?: ReactNode }) {
    return (
      <figure
        className="my-3 border-l-4 border-primary/40 bg-primary/5 pl-4 pr-3 py-2 rounded-r"
        data-from={from}
      >
        <blockquote className="text-primary-dark italic font-serif [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
          {children}
        </blockquote>
        {from !== undefined && from !== "" ? (
          <figcaption className="text-xs font-sans text-warm-600 mt-1 not-italic">
            {"— "}
            <Attribution from={from} linkCtx={linkCtx} />
          </figcaption>
        ) : null}
      </figure>
    );
  }

  return { QuoteInline, QuoteBlock };
}
