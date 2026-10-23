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
import { Markdown } from "./Markdown/body";
import { Text } from "./ui/Text";
import { CapturedPageMeta, frozenSnapshotUrl } from "./CapturedPageMeta";
import { type RendererProps } from "../file-type-registry";
import { isRecord } from "@shared/is-record";

export function CommentaryView({ data, onNavigate }: RendererProps) {
  const frontmatter = data.frontmatter ?? {};
  const title = frontmatter["title"];
  const body = data.body;

  // Captured-page metadata: the annotated page's URL (`about.href`), the
  // capture date (`about.retrieved`), and an in-box frozen snapshot.
  // Rendered as a header.
  const about = frontmatter["about"];
  const captured = isRecord(about) ? about["retrieved"] : undefined;
  const frozen = frontmatter["frozen"];
  const sourceUrl = isRecord(about) && typeof about["href"] === "string" && about["href"] !== "" ? about["href"] : null;
  const frozenUrl = frozenSnapshotUrl(data.path, frozen);
  const capturedAt = typeof captured === "string" && captured !== "" ? captured : null;

  const onJumpToQuote = useCallback((quoteText: string): Promise<boolean> => {
    const exact = quoteText.trim();
    if (exact === "" || frozenUrl === null) return Promise.resolve(false);
    window.open(`${frozenUrl}#:~:text=${encodeURIComponent(exact)}`, "_blank", "noreferrer");
    return Promise.resolve(true);
  }, [frozenUrl]);

  return (
    <div className="p-4">
      {typeof title === "string" && title !== "" ? (
        <Text as="h1" size="lg" weight="semibold" className="mb-1">{title}</Text>
      ) : null}
      <CapturedPageMeta sourceUrl={sourceUrl} frozenUrl={frozenUrl} capturedAt={capturedAt} />
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
