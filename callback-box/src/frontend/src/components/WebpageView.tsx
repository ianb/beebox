/**
 * WebpageView — renderer for `webpage` cards (a captured external page).
 *
 * The card *is* the page: its markdown body is the readable rendering, shown
 * here as the primary document. Capture provenance (original URL, frozen
 * snapshot, capture date) renders as a header. Commentary *about* the page
 * lives in the card's `.attach/` scope as `.commentary.card` files; this view
 * discovers them and renders the remarks inline, with each `{% source %}` chip
 * jumping to its verbatim span in the page body above.
 */

import { useCallback, useRef } from "react";
import { Markdown } from "./Markdown";
import { Text } from "./ui/Text";
import { FriendlyDate } from "./ui/FriendlyDate";
import { apiRawFileUrl, getApiBase } from "../api";
import { type RendererProps } from "../renderers";
import { resolveRelativePath } from "../lib/view-url";
import { findQuoteRange, highlightRange, scrollRangeIntoView } from "../lib/selection/quote-anchor";
import { AttachedCommentary, type JumpToQuote } from "./AttachedCommentary";

export function WebpageView({ data, onNavigate }: RendererProps) {
  const frontmatter = data.frontmatter ?? {};
  const title = frontmatter["title"];
  const body = data.body;

  // Capture provenance (frontmatter): the original URL, the capture date, and
  // the in-box frozen snapshot (served sandboxed through /api/files).
  const source = frontmatter["source"];
  const captured = frontmatter["captured"];
  const frozen = frontmatter["frozen"];
  const sourceUrl = typeof source === "string" && source !== "" ? source : null;
  // `frozen` is a card ref stored as `{ ref: <path> }`; pull the path off it.
  const frozenPath =
    typeof frozen === "object" && frozen !== null && "ref" in frozen && typeof frozen.ref === "string"
      ? frozen.ref
      : null;
  // A `frozen` ref that escapes the box root resolves to null and is treated as
  // absent — no snapshot link, rather than a link to a clamped-to-root file.
  // The broken ref itself is reported where refs are checked (`cb validate`),
  // not re-reported on every render here.
  const frozenRelative =
    frozenPath !== null && frozenPath !== "" ? resolveRelativePath(data.path, frozenPath) : null;
  const frozenUrl = frozenRelative === null ? null : apiRawFileUrl(getApiBase(), frozenRelative);
  const capturedAt = typeof captured === "string" && captured !== "" ? captured : null;

  // A source chip jumps to its verbatim span in the page body (matched in-pane
  // and highlighted via the CSS Custom Highlight API); failing that, it opens
  // the frozen snapshot at the quote via a native `#:~:text=` fragment.
  const pageBodyRef = useRef<HTMLDivElement>(null);
  const onJumpToQuote = useCallback<JumpToQuote>(
    (quoteText) => {
      const exact = quoteText.trim();
      if (exact === "") return Promise.resolve(false);
      const root = pageBodyRef.current;
      if (root !== null) {
        const range = findQuoteRange(root, exact);
        if (range !== null) {
          highlightRange(range);
          scrollRangeIntoView(range);
          return Promise.resolve(true);
        }
      }
      if (frozenUrl !== null) {
        window.open(`${frozenUrl}#:~:text=${encodeURIComponent(exact)}`, "_blank", "noreferrer");
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    },
    [frozenUrl],
  );

  const meta =
    sourceUrl !== null || frozenUrl !== null ? (
      <Text as="div" size="sm" tone="subtle" className="mb-3">
        {sourceUrl !== null ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer" className="underline">Original page</a>
        ) : null}
        {frozenUrl !== null ? (
          <>
            {sourceUrl !== null ? " · " : ""}
            <a href={frozenUrl} target="_blank" rel="noreferrer" className="underline">Frozen snapshot ↗</a>
          </>
        ) : null}
        {capturedAt !== null ? <> · captured <FriendlyDate iso={capturedAt} /></> : null}
      </Text>
    ) : null;

  return (
    <div className="p-4">
      {typeof title === "string" && title !== "" ? (
        <Text as="h1" size="lg" weight="semibold" className="mb-1">{title}</Text>
      ) : null}
      {meta}

      {/* Commentary leads — the boxholder's remarks, with chips that jump down
          into the page body below. */}
      <AttachedCommentary cardPath={data.path} onNavigate={onNavigate} onJumpToQuote={onJumpToQuote} />

      <div className="min-w-0" data-card-section="body" ref={pageBodyRef}>
        {body !== undefined && body.trim() !== "" ? (
          <Markdown prose="block" onNavigate={onNavigate} basePath={data.path}>{body}</Markdown>
        ) : (
          <Text as="div" tone="subtle" className="italic">This page has no readable content.</Text>
        )}
      </div>
    </div>
  );
}
