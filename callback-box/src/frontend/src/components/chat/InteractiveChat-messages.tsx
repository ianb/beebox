/**
 * The virtualized message list shell for InteractiveChat: owns the Virtuoso
 * instance, the prepend-anchor bookkeeping, and the scroll-following
 * effects. The per-item rendering and data-array assembly live in
 * InteractiveChat-message-items.tsx.
 */

import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, type ReactNode, type CSSProperties } from "react";
import { useParams } from "@tanstack/react-router";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { SessionEntry, SessionContentBlock } from "../../api";
import { extractChatImages, type MessageGroup, type OnZoomView, type ReplaySpeechOptions } from "../ChatMessages";
import type { ModelMarker } from "./InteractiveChat-helpers";
import {
  buildDataItems,
  dataItemKey,
  renderDataItem,
  type DataItem,
  type RenderItemContext,
  type SpeechPlaybackState,
} from "./InteractiveChat-message-items";

const VIRTUOSO_INITIAL_FIRST_INDEX = 1_000_000_000;

// Distance from the bottom (px) within which streaming chunks still
// auto-follow. Sized to cover the height of a few text deltas — a real
// scroll-up by the user clears the threshold easily.
const AUTO_FOLLOW_THRESHOLD = 200;

// Virtuoso requires Header/Footer components to be stable references; if a
// new component identity is passed each render they remount. We keep them
// module-level and pass dynamic data via the `context` prop instead.
interface ChatListContext {
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  earlierCount: number;
}

function LoadOlderHeader({ context }: { context?: ChatListContext }) {
  if (!context || !context.hasOlder) return null;
  const handleClick = context.onLoadOlder;
  return (
    <div className="text-center py-2">
      <button
        onClick={handleClick}
        disabled={context.loadingOlder}
        className="text-sm text-primary hover:text-primary/80 disabled:text-warm-400"
      >
        {context.loadingOlder ? "Loading..." : `Show ${context.earlierCount} earlier messages`}
      </button>
    </div>
  );
}

// Virtuoso's scroller fills the full width of the chat column so wheel/touch
// events anywhere across it (including the left/right gutters) scroll the
// messages. The visible content is kept centered at the same max-width as the
// header and composer by constraining the inner list, not the scroller.
const CenteredList = forwardRef<HTMLDivElement, { children?: ReactNode; style?: CSSProperties }>(
  function CenteredList({ children, style }, ref) {
    return (
      <div ref={ref} style={style} className="mx-auto w-full max-w-5xl">
        {children}
      </div>
    );
  },
);

/**
 * Wire up Virtuoso's three scroll behaviors: follow growing stream tail,
 * jump to bottom on send, and jump to bottom on first data populate. Returns
 * the refs + the at-bottom handler to attach to the Virtuoso instance.
 */
function useChatListScroll(opts: {
  streamingShown: boolean;
  streamText: string;
  streamToolsLength: number;
  scrollToBottomTrigger: number;
  dataLength: number;
}) {
  const { streamingShown, streamText, streamToolsLength, scrollToBottomTrigger, dataLength } = opts;
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);
  const scrollerRef = useRef<HTMLElement | Window | null>(null);
  const initialScrollDoneRef = useRef(false);

  const handleAtBottomStateChange = useCallback((b: boolean) => {
    atBottomRef.current = b;
  }, []);

  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    scrollerRef.current = el;
  }, []);

  // During streaming, the tail item's height grows without changing data
  // length — followOutput won't fire — so re-pin to bottom imperatively.
  // We can't gate on `atBottomRef` here: each chunk grows scrollHeight
  // before this effect runs, transiently flipping atBottom to false, so
  // the gate skips the scroll and we fall progressively further behind.
  // Read the live DOM position instead — if we were near the bottom when
  // the chunk arrived, follow it; if the user has scrolled up by more
  // than a chunk's worth, leave them alone.
  useEffect(() => {
    if (!streamingShown) return;
    const el = scrollerRef.current;
    if (!el || el === window) return;
    const target = el as HTMLElement;
    const fromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (fromBottom > AUTO_FOLLOW_THRESHOLD) return;
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
  }, [streamText, streamToolsLength, streamingShown]);

  // Scroll to bottom when user sends a message (even if scrolled up).
  useEffect(() => {
    if (scrollToBottomTrigger > 0 && dataLength > 0) {
      virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
    }
  }, [scrollToBottomTrigger, dataLength]);

  // First time data populates after mount, jump to the latest message.
  // The Virtuoso `initialTopMostItemIndex` prop is captured on virtuoso's
  // own mount; if the parent renders the placeholder until history arrives
  // (the common case for an existing chat), Virtuoso's first commit sees
  // empty data and the later data populate doesn't re-trigger the initial
  // index. Doing it imperatively here covers that path.
  useEffect(() => {
    if (initialScrollDoneRef.current) return;
    if (dataLength === 0) return;
    initialScrollDoneRef.current = true;
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
  }, [dataLength]);

  return { virtuosoRef, scrollerRef, handleAtBottomStateChange, handleScrollerRef };
}

export function VirtualizedMessageList({
  messages, groups, modelMarkers, isStreaming, streamText, streamTools, processingShown,
  debugView, currentUserEmail, speechPlayback, handleStopSpeech, handleSkipSpeech, handleReplaySpeech, onZoomView, snapshot,
  totalEntries, onLoadOlder, loadingOlder, scrollToBottomTrigger, proseEnabled, pendingHqDraft,
}: {
  messages: SessionEntry[];
  groups: MessageGroup[];
  modelMarkers: ModelMarker[];
  isStreaming: boolean;
  streamText: string;
  streamTools: SessionContentBlock[];
  processingShown: boolean;
  debugView: boolean;
  currentUserEmail: string | undefined;
  speechPlayback: SpeechPlaybackState;
  handleStopSpeech: () => void;
  handleSkipSpeech: () => void;
  handleReplaySpeech: (options: ReplaySpeechOptions) => void;
  onZoomView: OnZoomView;
  snapshot: { matches: (state: "loading" | "idle" | "streaming" | "refreshing") => boolean };
  totalEntries: number;
  onLoadOlder: () => void;
  loadingOlder: boolean;
  scrollToBottomTrigger: number;
  proseEnabled: boolean;
  pendingHqDraft: string | null;
}) {
  const { boxSlug } = useParams({ strict: false });
  const hasOlder = totalEntries > messages.length;
  const streamingShown = snapshot.matches("streaming");

  const data = useMemo<DataItem[]>(
    () => buildDataItems({ groups, modelMarkers, streamingShown, processingShown, pendingHqDraft }),
    [groups, modelMarkers, streamingShown, processingShown, pendingHqDraft],
  );

  const { virtuosoRef, handleAtBottomStateChange, handleScrollerRef } = useChatListScroll({
    streamingShown,
    streamText,
    streamToolsLength: streamTools.length,
    scrollToBottomTrigger,
    dataLength: data.length,
  });

  // Track first-data-key across renders. When older messages prepend, the
  // key shifts from data[0] to data[N], and we decrement firstItemIndex by
  // N so virtuoso preserves the user's visual scroll anchor (no jump on
  // "load older"). See virtuoso "Prepending Items" pattern.
  // Updated synchronously during render (set-state-during-render pattern)
  // so the new firstItemIndex is committed in the same paint as the new
  // data — avoids a one-frame flash with a stale anchor.
  const [firstItemIndex, setFirstItemIndex] = useState(VIRTUOSO_INITIAL_FIRST_INDEX);
  const [trackedFirstKey, setTrackedFirstKey] = useState<string | undefined>();
  const newFirstKey = data.length > 0 ? dataItemKey(data[0]) : undefined;
  if (newFirstKey !== trackedFirstKey) {
    if (trackedFirstKey !== undefined && newFirstKey !== undefined) {
      const idx = data.findIndex((d) => dataItemKey(d) === trackedFirstKey);
      if (idx > 0) setFirstItemIndex((prev) => prev - idx);
    }
    setTrackedFirstKey(newFirstKey);
  }

  // Lightbox needs the full image list (across all messages, not just the
  // virtualizer's mounted slice). Embed it as JSON so the provider can
  // dedup against any currently-rendered images.
  const chatImagesJson = useMemo(
    () => JSON.stringify(extractChatImages(messages, { streamText, boxSlug })),
    [messages, streamText, boxSlug],
  );

  const headerContext = useMemo<ChatListContext>(() => ({
    hasOlder,
    loadingOlder,
    onLoadOlder,
    earlierCount: totalEntries - messages.length,
  }), [hasOlder, loadingOlder, onLoadOlder, totalEntries, messages.length]);

  const lastAssistantGroupIndex = groups.findLastIndex((g) => g.type === "assistant");

  const renderCtx = useMemo<RenderItemContext>(() => ({
    streamText,
    streamTools,
    debugView,
    currentUserEmail,
    speechPlayback,
    handleStopSpeech,
    handleSkipSpeech,
    handleReplaySpeech,
    onZoomView,
    proseEnabled,
    lastAssistantGroupIndex,
  }), [streamText, streamTools, debugView, currentUserEmail, speechPlayback, handleStopSpeech, handleSkipSpeech, handleReplaySpeech, onZoomView, proseEnabled, lastAssistantGroupIndex]);

  const renderItem = useCallback(
    (_: number, item: DataItem) => renderDataItem(item, renderCtx),
    [renderCtx],
  );

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center text-warm-500 text-sm">
        Start a conversation with your box assistant.
      </div>
    );
  }

  return (
    <div className="flex-1 w-full min-w-0 flex flex-col overflow-x-hidden">
      <div data-image-list hidden>{chatImagesJson}</div>
      <Virtuoso<DataItem, ChatListContext>
        ref={virtuosoRef}
        scrollerRef={handleScrollerRef}
        className="flex-1"
        data={data}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={Math.max(0, data.length - 1)}
        followOutput={(atBottom) => (atBottom ? "auto" : false)}
        atBottomStateChange={handleAtBottomStateChange}
        atBottomThreshold={80}
        computeItemKey={(_, item) => dataItemKey(item)}
        context={headerContext}
        components={{ Header: LoadOlderHeader, List: CenteredList }}
        itemContent={renderItem}
      />
    </div>
  );
}
