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

// Re-pin to the bottom once the user scrolls back within this many px of it.
// Kept small: disengaging follow is direction-based (any upward scroll, see
// handleScroll), so this is only the "you're back at the bottom" tolerance —
// not a band of small scroll-ups that get yanked back.
const RE_PIN_THRESHOLD = 24;

// An upward scroll only disengages follow if a genuine user scroll input fired
// within this window. Layout-driven scrolls — the mobile soft keyboard
// dismissing on send clamps scrollTop downward, firing a phantom "scroll up" —
// carry no wheel/touch/key input, so they must not disengage.
const USER_SCROLL_WINDOW_MS = 250;

// Keys that scroll the (focusable) message list; pressing one counts as a user
// scroll so keyboard-driven scroll-up disengages follow like a wheel/touch does.
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

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
  // Whether the view is "stuck to the bottom" and should follow new content.
  // Disengaged when the user scrolls up, re-engaged when they return to the
  // bottom. Drives both the streaming tail-follow and Virtuoso's followOutput.
  const pinnedRef = useRef(true);
  const scrollerRef = useRef<HTMLElement | Window | null>(null);
  const lastScrollTopRef = useRef(0);
  const lastUserScrollAtRef = useRef(0);
  const initialScrollDoneRef = useRef(false);

  const pinToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
  }, []);

  // A wheel/touch-drag/scroll-key fired: the next upward scroll is the user's
  // doing, so it's allowed to disengage follow. Without a recent mark, an
  // upward scroll is layout-driven (keyboard dismiss, address bar, reflow) and
  // must be ignored — see USER_SCROLL_WINDOW_MS.
  const markUserScroll = useCallback(() => {
    lastUserScrollAtRef.current = performance.now();
  }, []);

  const handleKeyScroll = useCallback((e: KeyboardEvent) => {
    if (SCROLL_KEYS.has(e.key)) lastUserScrollAtRef.current = performance.now();
  }, []);

  // Maintain pinnedRef from real scroll events. Content growing *below* the
  // viewport doesn't move scrollTop, so it fires no scroll event and can't
  // disengage follow. Disengage is direction-based (any upward scroll, so no
  // band of "small scroll ups" gets fought) but gated on a recent user-scroll
  // input, so phantom upward scrolls from layout changes don't disengage.
  // Re-engage only once genuinely back at the bottom; our own pinToBottom()
  // scrolls *down*, so it re-pins rather than disengaging.
  const handleScroll = useCallback(() => {
    const target = scrollerRef.current;
    if (!(target instanceof HTMLElement)) return;
    const top = target.scrollTop;
    const fromBottom = target.scrollHeight - top - target.clientHeight;
    if (top > lastScrollTopRef.current) {
      if (fromBottom <= RE_PIN_THRESHOLD) pinnedRef.current = true;
    } else if (
      top < lastScrollTopRef.current - 2 &&
      performance.now() - lastUserScrollAtRef.current < USER_SCROLL_WINDOW_MS
    ) {
      pinnedRef.current = false;
    }
    lastScrollTopRef.current = top;
  }, []);

  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    const prev = scrollerRef.current;
    if (prev instanceof HTMLElement) {
      prev.removeEventListener("scroll", handleScroll);
      prev.removeEventListener("wheel", markUserScroll);
      prev.removeEventListener("touchmove", markUserScroll);
      prev.removeEventListener("keydown", handleKeyScroll);
    }
    scrollerRef.current = el;
    if (el instanceof HTMLElement) {
      lastScrollTopRef.current = el.scrollTop;
      el.addEventListener("scroll", handleScroll, { passive: true });
      el.addEventListener("wheel", markUserScroll, { passive: true });
      el.addEventListener("touchmove", markUserScroll, { passive: true });
      el.addEventListener("keydown", handleKeyScroll);
    }
  }, [handleScroll, markUserScroll, handleKeyScroll]);

  // Virtuoso's atBottom signal is unreliable during tail growth — it flips
  // false transiently as scrollHeight grows ahead of the follow — so we only
  // trust it to *re-engage* follow, never to disengage.
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    if (atBottom) pinnedRef.current = true;
  }, []);

  // During streaming the tail item grows without a data-length change, so
  // followOutput won't fire — re-pin imperatively while stuck to the bottom.
  useEffect(() => {
    if (!streamingShown) return;
    if (!pinnedRef.current) return;
    pinToBottom();
  }, [streamText, streamToolsLength, streamingShown, pinToBottom]);

  // Scroll to bottom when user sends a message (even if scrolled up).
  useEffect(() => {
    if (scrollToBottomTrigger > 0 && dataLength > 0) {
      pinnedRef.current = true;
      pinToBottom();
    }
  }, [scrollToBottomTrigger, dataLength, pinToBottom]);

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
    pinnedRef.current = true;
    pinToBottom();
  }, [dataLength, pinToBottom]);

  // followOutput drives Virtuoso's auto-follow on data-length changes (new
  // message items, processing toggles). Read our own pin state so it matches
  // the streaming tail-follow exactly.
  const followOutput = useCallback(() => (pinnedRef.current ? ("auto" as const) : false), []);

  return { virtuosoRef, handleAtBottomStateChange, handleScrollerRef, followOutput };
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
  // Keep the streamed bubble visible through `refreshing` too — the brief
  // fetchHistory roundtrip after a turn completes. The machine holds
  // streamText until refreshing's onDone swaps in the authoritative history
  // entry and clears the stream atomically, so showing it here closes the
  // gap where the response would otherwise vanish and pop back in complete
  // form. Gate on actual content so the STREAM_FAILED path (which clears
  // streamText before refreshing) doesn't flash an empty bubble.
  const streamingShown = snapshot.matches("streaming")
    || (snapshot.matches("refreshing") && (streamText.length > 0 || streamTools.length > 0));

  const data = useMemo<DataItem[]>(
    () => buildDataItems({ groups, modelMarkers, streamingShown, processingShown, pendingHqDraft, debugView }),
    [groups, modelMarkers, streamingShown, processingShown, pendingHqDraft, debugView],
  );

  const { virtuosoRef, handleAtBottomStateChange, handleScrollerRef, followOutput } = useChatListScroll({
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
        followOutput={followOutput}
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
