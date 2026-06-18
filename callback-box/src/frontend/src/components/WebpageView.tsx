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
import { trpc } from "../lib/trpc";
import { Markdown } from "./Markdown";
import { Text } from "./ui/Text";
import { FriendlyDate } from "./ui/FriendlyDate";
import { getApiBase } from "../api";
import { type RendererProps } from "../renderers";
import { resolveRelativePath, type NavigateHint, type ViewTarget } from "../lib/view-url";
import { findQuoteRange, highlightRange, scrollRangeIntoView } from "../lib/quote-anchor";
import { attachDirFor } from "@shared/attach-path";

type JumpToQuote = (quoteText: string) => Promise<boolean>;

/** One commentary card's remarks, fetched from the page's attach scope. */
function CommentaryRemarks({
  cardPath,
  onNavigate,
  onJumpToQuote,
}: {
  cardPath: string;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  onJumpToQuote: JumpToQuote;
}) {
  const { data, isLoading, error } = trpc.card.get.useQuery({ path: cardPath });
  if (isLoading) {
    return <Text as="div" tone="subtle" className="italic">Loading commentary…</Text>;
  }
  if (error !== null) {
    return <Text as="div" tone="danger">Couldn’t load commentary.</Text>;
  }
  const body = data?.body;
  if (body === undefined || body.trim() === "") {
    return <Text as="div" tone="subtle" className="italic">No commentary yet.</Text>;
  }
  return (
    <div data-card-section="body">
      <Markdown prose="block" onNavigate={onNavigate} onJumpToQuote={onJumpToQuote} basePath={cardPath}>
        {body}
      </Markdown>
    </div>
  );
}

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
  const frozenUrl =
    typeof frozen === "string" && frozen !== ""
      ? `${getApiBase()}/files/${resolveRelativePath(data.path, frozen)}`
      : null;
  const capturedAt = typeof captured === "string" && captured !== "" ? captured : null;

  // Discover commentary in the page's attach scope. A missing scope browses to
  // an empty result (the route swallows readdir errors), so no commentary just
  // renders nothing.
  const attachDir = attachDirFor(data.path);
  const { data: browse } = trpc.status.browse.useQuery({ path: attachDir });
  const commentaryPaths = (browse?.cards ?? [])
    .filter((c) => c.type === "commentary")
    .map((c) => c.relativePath);

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

      {commentaryPaths.length > 0 ? (
        // Commentary leads — the boxholder's remarks, with chips that jump down
        // into the page body below.
        <div className="mb-4 flex flex-col gap-3 rounded-md border border-warm-200 p-3">
          <Text as="div" size="xs" tone="subtle" className="font-medium uppercase tracking-wide">
            Commentary
          </Text>
          {commentaryPaths.map((cardPath) => (
            <CommentaryRemarks
              key={cardPath}
              cardPath={cardPath}
              onNavigate={onNavigate}
              onJumpToQuote={onJumpToQuote}
            />
          ))}
        </div>
      ) : null}

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
