/**
 * CommentaryView — renderer for a `commentary` card opened on its own.
 *
 * Commentary is **attach-only**: it lives in a host card's `.attach/` scope and
 * its bare `{% source %}` anchors target the containing card (an extfile /
 * webpage / doc), which surfaces the remarks inline (see `AttachedCommentary`).
 * Opened directly, a commentary card shows its remarks body plus any
 * captured-page metadata header; a source chip falls back to opening the frozen
 * snapshot (when the card carries one) at the quote — there is no live target
 * pane to search when the commentary is viewed on its own.
 */

import { useCallback } from "react";
import { getApiBase } from "../api";
import { Markdown } from "./Markdown";
import { Text } from "./ui/Text";
import { FriendlyDate } from "./ui/FriendlyDate";
import { type RendererProps } from "../renderers";
import { resolveRelativePath } from "../lib/view-url";

export function CommentaryView({ data, onNavigate }: RendererProps) {
  const frontmatter = data.frontmatter ?? {};
  const title = frontmatter["title"];
  const body = data.body;

  // Captured-page metadata (set by the clerk capture flow): the original URL,
  // the capture date, and an in-box frozen snapshot. Rendered as a header.
  const source = frontmatter["source"];
  const captured = frontmatter["captured"];
  const frozen = frontmatter["frozen"];
  const sourceUrl = typeof source === "string" && source !== "" ? source : null;
  // `frozen` is a card ref stored as `{ ref: <path> }`; pull the path off it.
  const frozenPath =
    typeof frozen === "object" && frozen !== null && "ref" in frozen && typeof frozen.ref === "string"
      ? frozen.ref
      : null;
  const frozenUrl =
    frozenPath !== null && frozenPath !== ""
      ? `${getApiBase()}/files/${resolveRelativePath(data.path, frozenPath)}`
      : null;
  const capturedAt = typeof captured === "string" && captured !== "" ? captured : null;

  const onJumpToQuote = useCallback((quoteText: string): Promise<boolean> => {
    const exact = quoteText.trim();
    if (exact === "" || frozenUrl === null) return Promise.resolve(false);
    window.open(`${frozenUrl}#:~:text=${encodeURIComponent(exact)}`, "_blank", "noreferrer");
    return Promise.resolve(true);
  }, [frozenUrl]);

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
      <div className="min-w-0" data-card-section="body">
        {body !== undefined && body.trim() !== "" ? (
          <Markdown prose="block" onNavigate={onNavigate} onJumpToQuote={onJumpToQuote} basePath={data.path}>{body}</Markdown>
        ) : (
          <Text as="div" tone="subtle" className="italic">No commentary yet.</Text>
        )}
      </div>
    </div>
  );
}
