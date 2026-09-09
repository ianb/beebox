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
import type { QuoteTreatment } from "@shared/quote-treatment";
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
          const target: ViewTarget = { path: from, viewer: null, params: {}, viewState: null };
          linkCtx.onNavigate(target, { label: displayName });
        }}
        className="bbx-theme-link"
      >
        {displayName}
      </button>
    );
  }
  return <span>{from}</span>;
}

interface QuoteProps {
  from?: string;
  treatment?: QuoteTreatment;
  children?: ReactNode;
}

export function makeQuoteComponents(linkCtx: QuoteLinkContext): {
  QuoteInline: (props: QuoteProps) => ReactNode;
  QuoteBlock: (props: QuoteProps) => ReactNode;
} {
  function QuoteInline({ from, treatment, children }: QuoteProps) {
    return (
      <span className="bbx-quote bbx-quote-inline" data-from={from} data-treatment={treatment}>
        <span className="bbx-quote-mark">{"“"}</span>
        {children}
        <span className="bbx-quote-mark">{"”"}</span>
        {from !== undefined && from !== "" ? (
          <span className="bbx-quote-attribution">
            {" — "}
            <Attribution from={from} linkCtx={linkCtx} />
          </span>
        ) : null}
      </span>
    );
  }

  function QuoteBlock({ from, treatment, children }: QuoteProps) {
    return (
      <figure className="bbx-quote bbx-quote-block" data-from={from} data-treatment={treatment}>
        <blockquote className="bbx-quote-body">{children}</blockquote>
        {from !== undefined && from !== "" ? (
          <figcaption className="bbx-quote-attribution">
            {"— "}
            <Attribution from={from} linkCtx={linkCtx} />
          </figcaption>
        ) : null}
      </figure>
    );
  }

  return { QuoteInline, QuoteBlock };
}
