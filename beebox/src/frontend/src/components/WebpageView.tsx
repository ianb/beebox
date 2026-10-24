/**
 * WebpageView — renderer for `webpage` cards (a captured external page).
 *
 * The card *is* the page: its markdown body is the readable rendering, shown
 * here as the primary document. Capture provenance (original URL and capture
 * time from the one `sources` entry, frozen snapshot) renders as a header. Commentary *about* the page
 * lives in the card's `.attach/` scope as `.commentary.card` files; this view
 * discovers them and renders the remarks inline, with each `{% source %}` chip
 * jumping to its verbatim span in the page body above.
 */

import { useCallback, useRef } from "react";
import { Markdown } from "./Markdown/body";
import { Text } from "./ui/Text";
import { CapturedPageMeta, frozenSnapshotUrl } from "./CapturedPageMeta";
import { type RendererProps } from "../file-type-registry";
import { findQuoteRange, highlightRange, scrollRangeIntoView } from "../lib/selection/quote-anchor";
import { AttachedCommentary, type JumpToQuote } from "./AttachedCommentary";
import { isRecord } from "@shared/is-record";
import { nonEmptyString } from "@shared/optional-string";

export function WebpageView({ data, onNavigate }: RendererProps) {
  const frontmatter = data.frontmatter ?? {};
  const title = frontmatter["title"];
  const body = data.body;

  // Capture provenance (frontmatter): the original URL and capture time (the
  // one `sources` entry's `href` and `retrieved`), and the in-box frozen
  // snapshot (served sandboxed through /api/files).
  const captured = capturedPage(frontmatter["sources"]);
  const frozen = frontmatter["frozen"];
  const sourceUrl = captured.href;
  const frozenUrl = frozenSnapshotUrl(data.path, frozen);
  const capturedAt = captured.retrieved;

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

  return (
    <div className="p-4">
      {typeof title === "string" && title !== "" ? (
        <Text as="h1" size="lg" weight="semibold" className="mb-1">{title}</Text>
      ) : null}
      <CapturedPageMeta sourceUrl={sourceUrl} frozenUrl={frozenUrl} capturedAt={capturedAt} />

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

/** The captured page's URL and capture time, from the card's one `sources` entry; null where absent or malformed. */
function capturedPage(sources: unknown): { href: string | null; retrieved: string | null } {
  const entry: unknown = Array.isArray(sources) ? sources[0] : undefined;
  if (!isRecord(entry)) return { href: null, retrieved: null };
  return { href: nonEmptyString(entry["href"]), retrieved: nonEmptyString(entry["retrieved"]) };
}
