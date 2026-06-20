/**
 * Discover and render `.commentary.card` files living in a host card's
 * `.attach/` scope, as a bordered "Commentary" block. Each `{% source %}` chip
 * jumps to its verbatim span in the host's rendered content via the supplied
 * `onJumpToQuote`. Shared by the webpage and extfile views — both surface
 * attached commentary above their document.
 */

import { attachDirFor } from "@shared/attach-path";
import { trpc } from "../lib/trpc";
import { Markdown } from "./Markdown";
import { Text } from "./ui/Text";
import { type NavigateHint, type ViewTarget } from "../lib/view-url";

export type JumpToQuote = (quoteText: string) => Promise<boolean>;

/** One commentary card's remarks, fetched from the host's attach scope. */
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

/**
 * The bordered "Commentary" block for a host card. Discovers `.commentary.card`
 * files in the host's attach scope (a missing scope browses to an empty result,
 * so no commentary renders nothing) and renders each. Returns null when there is
 * no commentary, so callers can place it unconditionally.
 */
export function AttachedCommentary({
  cardPath,
  onNavigate,
  onJumpToQuote,
}: {
  cardPath: string;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  onJumpToQuote: JumpToQuote;
}) {
  const attachDir = attachDirFor(cardPath);
  const { data: browse } = trpc.status.browse.useQuery({ path: attachDir });
  const commentaryPaths = (browse?.cards ?? [])
    .filter((c) => c.type === "commentary")
    .map((c) => c.relativePath);
  if (commentaryPaths.length === 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md border border-warm-200 p-3">
      <Text as="div" size="xs" tone="subtle" className="font-medium uppercase tracking-wide">
        Commentary
      </Text>
      {commentaryPaths.map((path) => (
        <CommentaryRemarks key={path} cardPath={path} onNavigate={onNavigate} onJumpToQuote={onJumpToQuote} />
      ))}
    </div>
  );
}
