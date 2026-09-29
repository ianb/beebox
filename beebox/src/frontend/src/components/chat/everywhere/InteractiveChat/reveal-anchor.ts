/**
 * Land a chat-search deep link: `/chat?session=<id>&m=<entry uuid>` opens the
 * conversation at the matching message.
 *
 * One-shot per session mount (`MessageList` is keyed by conversation, so a
 * session switch remounts and re-arms; a later history refresh never
 * re-scrolls). The scroll itself goes through the controller's
 * `anchorToTop` — the same discrete-action path a send uses — so the
 * "exactly one thing controls scroll" invariant holds (frontend chat
 * CLAUDE.md).
 *
 * When the anchor is older than the loaded window, this pages older history
 * until the entry renders, then reveals it; when the transcript is
 * exhausted without it (hand-edited url, entry removed by compaction), the
 * chat simply stays where the open put it — no error, the result row has
 * already named the chat.
 */

import { useEffect, useRef, type RefObject } from "react";
import { useSearch } from "@tanstack/react-router";

/** Entry uuids are alphanumeric-and-dash (Claude uuids, Codex item ids) — anything else can't match and must not reach querySelector. */
const ANCHOR_SHAPE = /^[\dA-Za-z-]+$/;

export function useRevealAnchor(options: {
  /** True while the initial history window is still loading. */
  loading: boolean;
  messageCount: number;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  anchorToTop: (target: Element | null) => void;
  contentElRef: RefObject<HTMLDivElement | null>;
}): void {
  const { loading, messageCount, hasOlder, loadingOlder, onLoadOlder, anchorToTop, contentElRef } = options;
  // Captured once per mount: the param is one-shot like `companion`, and a
  // plain object read keeps this off the re-render path.
  // eslint-disable-next-line no-restricted-syntax -- `strict: false` collapses the search type across every route; this hook only ever runs under the chat route, whose schema carries an optional `m` string.
  const search = useSearch({ strict: false }) as { m?: string };
  const pendingRef = useRef<string | null>(
    typeof search.m === "string" && search.m !== "" ? search.m : null,
  );

  useEffect(() => {
    const anchor = pendingRef.current;
    if (anchor === null) return;
    if (loading || messageCount === 0) return;
    if (!ANCHOR_SHAPE.test(anchor)) {
      pendingRef.current = null;
      return;
    }
    const content = contentElRef.current;
    if (content === null) return;
    const target = content.querySelector(`[data-entry-uuids~="${anchor}"]`);
    if (target !== null) {
      anchorToTop(target);
      pendingRef.current = null;
      return;
    }
    // The anchor may live before the loaded window: page older history in.
    // The effect re-runs as the window grows; give up only when the
    // transcript itself is exhausted.
    if (hasOlder && !loadingOlder) onLoadOlder();
    else if (!hasOlder) pendingRef.current = null;
  }, [loading, messageCount, hasOlder, loadingOlder, onLoadOlder, anchorToTop, contentElRef]);
}
