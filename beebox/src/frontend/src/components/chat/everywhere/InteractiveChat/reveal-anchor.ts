/**
 * Land a chat-search deep link: `/chat?session=<id>&m=<entry uuid>` opens the
 * conversation at the matching message.
 *
 * The scroll itself goes through the controller's `anchorToTop` — the same
 * discrete-action path a send uses — so the "exactly one thing controls
 * scroll" invariant holds (frontend chat CLAUDE.md).
 *
 * Arming: `MessageList` is keyed by the conversation, so a SESSION switch
 * remounts and arms on mount — but a search-result click for the chat you
 * are already viewing changes only the `m` param, with no remount. The param
 * is therefore watched: a NEW anchor value re-arms the reveal; the value just
 * handled never re-arms (a later history refresh never re-scrolls).
 *
 * When the anchor is older than the loaded window, this pages older history
 * until the entry renders, then reveals it. A paging attempt that completes
 * without the window growing means the history fetch failed (the machine
 * surfaces its own error toast): give up rather than retry in a loop. When
 * the transcript is exhausted without the anchor (hand-edited url, entry
 * removed by compaction), the chat simply stays where the open put it — no
 * error, the result row has already named the chat.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
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
  // eslint-disable-next-line no-restricted-syntax -- `strict: false` collapses the search type across every route; this hook only ever runs under the chat route, whose schema carries an optional `m` string.
  const search = useSearch({ strict: false }) as { m?: string };
  const anchorParam = typeof search.m === "string" && search.m !== "" ? search.m : null;

  const [pending, setPending] = useState<string | null>(anchorParam);
  /** The last anchor revealed or given up on — the same value never re-arms. */
  const [lastHandled, setLastHandled] = useState<string | null>(null);
  /** Window size when the latest page request went out, to detect a failed fetch. */
  const pagedFromCountRef = useRef<number | null>(null);

  // A NEW anchor in the URL re-arms the reveal: a result click for the chat
  // already open changes only `m`, with no remount to re-run the initializer.
  useEffect(() => {
    if (anchorParam === null || anchorParam === lastHandled || anchorParam === pending) return;
    setPending(anchorParam);
    pagedFromCountRef.current = null;
  }, [anchorParam, lastHandled, pending]);

  useEffect(() => {
    if (pending === null) return;
    if (loading || messageCount === 0) return;
    if (!ANCHOR_SHAPE.test(pending)) {
      setPending(null);
      setLastHandled(pending);
      return;
    }
    const content = contentElRef.current;
    if (content === null) return;
    const target = content.querySelector(`[data-entry-uuids~="${pending}"]`);
    if (target !== null) {
      anchorToTop(target);
      setPending(null);
      setLastHandled(pending);
      return;
    }
    // The anchor may live before the loaded window: page older history in.
    // The effect re-runs as the window grows; give up when the transcript is
    // exhausted, or when a page request came back without the window growing
    // (the fetch failed — the machine already surfaced its error).
    if (hasOlder && !loadingOlder) {
      if (pagedFromCountRef.current === messageCount) {
        setPending(null);
        setLastHandled(pending);
        return;
      }
      pagedFromCountRef.current = messageCount;
      onLoadOlder();
    } else if (!hasOlder) {
      setPending(null);
      setLastHandled(pending);
    }
  }, [pending, loading, messageCount, hasOlder, loadingOlder, onLoadOlder, anchorToTop, contentElRef]);
}
