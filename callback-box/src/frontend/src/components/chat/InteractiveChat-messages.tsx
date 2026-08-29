/**
 * The chat message list shell: owns the scroll container, the single scroll
 * controller (chat-scroll.ts), the send anchor and its last-turn spacer, the
 * floating scroll-to-bottom button, and the load-older prepend anchoring. Renders the
 * messages in normal DOM order — no virtualization; the loaded window is
 * bounded by HISTORY_TAIL + explicit "load older" pagination, capped at
 * MAX_RETAINED_MESSAGES. Per-item
 * rendering and data-array assembly live in InteractiveChat-message-items.tsx.
 */

import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, memo } from "react";
import { ChatOpeners } from "./ChatOpeners";
import { useParams } from "@tanstack/react-router";
import type { SessionEntry, SessionContentBlock } from "../../api";
import { extractChatImages, type MessageGroup, type OnZoomView, type ReplaySpeechOptions } from "./ChatMessages";
import type { ModelMarker } from "./InteractiveChat-helpers";
import { useChatScroll } from "./chat-scroll";
import {
  buildDataItems,
  dataItemKey,
  renderDataItem,
  type DataItem,
  type RenderItemContext,
  type SpeechPlaybackState,
} from "./InteractiveChat-message-items";
import { MAX_RETAINED_MESSAGES } from "../../machines/chat-types";
import type { CaptureBubbleModel, CaptureVerbs } from "./capture-bubble";
import type { AudioOverlayStore } from "./audio-overlay-store";

interface LiveTurnState { turnId: string | null; uuid: string | null }

/**
 * The uuid of the group that should carry the live-turn key, given the previous
 * render's state. While streaming it's the provisional group's synthetic uuid;
 * at the moment streaming ends we bind to the *finalized* group's real uuid (the
 * last non-marker item, when it's an assistant) and hold it until the next turn.
 *
 * Binding to a specific group — not "whichever assistant is newest" — is what
 * stops a background/queued turn that appends later from stealing the key (which
 * would remount the real turn and mis-key the new one). A no-response turn
 * finalizes to no assistant group, so nothing stays live (the provisional simply
 * unmounts). Pure: the caller commits the result via set-state-during-render.
 */
function nextLiveTargetUuid(opts: { prev: LiveTurnState; data: DataItem[]; liveTurnId: string | null; streamingShown: boolean }): string | null {
  const { prev, data, liveTurnId, streamingShown } = opts;
  const provisionalUuid = liveTurnId ? `live-${liveTurnId}` : null;
  if (streamingShown) return provisionalUuid;
  if (prev.turnId !== liveTurnId) return null;
  // First non-streaming render after the turn streamed: bind to the finalized
  // group (skip trailing markers; null if the turn produced no assistant group).
  if (provisionalUuid && prev.uuid === provisionalUuid) {
    for (const d of data.toReversed()) {
      if (d.kind === "marker") continue;
      return d.kind === "group" && d.group.type === "assistant" ? (d.group.entries[0]?.uuid ?? null) : null;
    }
    return null;
  }
  return prev.uuid;
}

function LoadOlderHeader({ hasOlder, loadingOlder, onLoadOlder }: {
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
}) {
  if (!hasOlder) return null;
  return (
    <div className="text-center py-2">
      <button
        id="cb-chat-load-older"
        onClick={onLoadOlder}
        disabled={loadingOlder}
        className="text-sm text-primary hover:text-primary/80 disabled:text-warm-400"
      >
        {loadingOlder ? "Loading..." : "Show earlier messages"}
      </button>
    </div>
  );
}

/**
 * Floating "jump to latest" affordance. Visible whenever the view is away from
 * the bottom — nothing follows the bottom on its own, so this is how a reader
 * gets back to the newest content; it takes its accent (and a small dot) when
 * content arrived below them, per the controller's hasUnseenContent.
 */
function ScrollToBottomButton({ emphasized, onClick }: { emphasized: boolean; onClick: () => void }) {
  return (
    <button
      id="cb-chat-scroll-latest"
      type="button"
      onClick={onClick}
      aria-label="Scroll to latest messages"
      className={`absolute right-4 bottom-4 z-10 rounded-full p-2 shadow-md backdrop-blur-sm transition-colors ${
        emphasized
          ? "bg-primary text-white hover:bg-primary-dark"
          : "bg-warm-100/90 text-warm-600 hover:bg-warm-200"
      }`}
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
      {emphasized ? (
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent ring-2 ring-warm-50" />
      ) : null}
    </button>
  );
}

function MessageListInner({
  messages, groups, modelMarkers, isStreaming, streamText, streamTools,
  debugView, currentUserEmail, currentUserName, speechPlayback, handleStopSpeech, handleSkipSpeech, handleReplaySpeech, onZoomView, snapshot,
  totalEntries, onLoadOlder, loadingOlder, sendSignal, liveTurnId, proseEnabled, pendingHqDraft,
  captureBubbles, captureVerbs, audioOverlayStore, openers, onSendOpener,
}: {
  messages: SessionEntry[];
  groups: MessageGroup[];
  modelMarkers: ModelMarker[];
  isStreaming: boolean;
  streamText: string;
  streamTools: SessionContentBlock[];
  debugView: boolean;
  currentUserEmail: string | undefined;
  currentUserName: string | undefined;
  speechPlayback: SpeechPlaybackState;
  handleStopSpeech: () => void;
  handleSkipSpeech: () => void;
  handleReplaySpeech: (options: ReplaySpeechOptions) => void;
  onZoomView: OnZoomView;
  snapshot: { matches: (state: "loading" | "idle" | "streaming" | "refreshing") => boolean };
  totalEntries: number;
  onLoadOlder: () => void;
  loadingOlder: boolean;
  /** Increments on every send — the anchor signal, not a scroll-to-bottom. */
  sendSignal: number;
  liveTurnId: string | null;
  proseEnabled: boolean;
  pendingHqDraft: string | null;
  captureBubbles: CaptureBubbleModel[];
  captureVerbs: CaptureVerbs;
  audioOverlayStore: AudioOverlayStore;
  /**
   * Suggested opening questions from the bound directory's briefing, shown on
   * the empty state of a fresh chat. Empty for an established box (the agent
   * removes them once the box is in regular use) and for a resumed session.
   */
  openers: string[];
  /** Send an opener as the person's message — the typed-and-entered path. */
  onSendOpener: (text: string) => void;
}) {
  const { boxSlug } = useParams({ strict: false });
  // Also gated on the retained-window ceiling: past it the machine drops what
  // a further page would prepend, so offering the affordance would lie.
  const hasOlder = totalEntries > messages.length && messages.length < MAX_RETAINED_MESSAGES;

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
    () => buildDataItems({ groups, modelMarkers, streamingShown, streamText, streamTools, liveTurnId, pendingHqDraft, captureBubbles, debugView }),
    [groups, modelMarkers, streamingShown, streamText, streamTools, liveTurnId, pendingHqDraft, captureBubbles, debugView],
  );

  const { scrollerRef, contentRef, liveContentRef, atBottom, hasUnseenContent, scrollToBottom, anchorToTop, captureForPrepend, openThread, settleOpen, viewportPx } = useChatScroll();

  // The content element, for the send anchor's DOM query. Held alongside (never
  // instead of) the controller's attach callback — one authority owns scroll.
  const contentElRef = useRef<HTMLDivElement | null>(null);
  const attachContent = useCallback((el: HTMLDivElement | null) => {
    contentElRef.current = el;
    contentRef(el);
  }, [contentRef]);

  // Send: put the new user message at the top of the viewport (the reply
  // streams in below it and nothing follows). A layout effect, so it runs after
  // the commit that added both the message and the last-turn spacer — one
  // write, after the shrink above and the growth below have landed.
  useLayoutEffect(() => {
    if (sendSignal === 0) return;
    const content = contentElRef.current;
    if (!content) return;
    const users = content.querySelectorAll("[data-role=\"user\"]");
    anchorToTop(users[users.length - 1] ?? null);
  }, [sendSignal, anchorToTop]);

  // Mounting this list IS opening a thread: `InteractiveChat` is keyed by
  // session (ChatPage), so a session switch remounts. Say so to the controller
  // rather than relying on the initial value of a ref inside it.
  useEffect(() => {
    openThread();
  }, [openThread]);

  // The bounded open-thread hold ends once the first history render has landed.
  const loading = snapshot.matches("loading");
  const turnLive = !snapshot.matches("idle");
  useEffect(() => {
    if (!loading && messages.length > 0) settleOpen();
  }, [loading, messages.length, settleOpen]);

  // Snapshot the anchor before older messages prepend so the controller can
  // restore the user's position once the new content lands.
  const handleLoadOlder = useCallback(() => {
    captureForPrepend();
    onLoadOlder();
  }, [captureForPrepend, onLoadOlder]);

  // Lightbox needs the full image list (across all messages). Embed it as JSON
  // so the provider can dedup against any currently-rendered images.
  const chatImagesJson = useMemo(
    () => JSON.stringify(extractChatImages(messages, { streamText, boxSlug })),
    [messages, streamText, boxSlug],
  );

  // Which group carries the live-turn key (bound to a specific group across
  // renders — see nextLiveTargetUuid). The streamed and finalized form of that
  // group share `live-${liveTurnId}` so React reconciles them in place. Tracked
  // via set-state-during-render (same pattern the prepend anchor used) so the
  // value is correct in this render with no one-frame lag.
  const [liveState, setLiveState] = useState<LiveTurnState>({ turnId: null, uuid: null });
  const liveTargetUuid = nextLiveTargetUuid({ prev: liveState, data, liveTurnId, streamingShown });
  if (liveState.turnId !== liveTurnId || liveState.uuid !== liveTargetUuid) {
    setLiveState({ turnId: liveTurnId, uuid: liveTargetUuid });
  }
  const liveKey = liveTurnId ? `live-${liveTurnId}` : null;

  // Newest assistant group's index, for the now-playing speech-highlight match.
  let lastAssistantGroupIndex = -1;
  for (const d of data.toReversed()) {
    if (d.kind === "group" && d.group.type === "assistant") {
      lastAssistantGroupIndex = d.groupIndex;
      break;
    }
  }

  const renderCtx = useMemo<RenderItemContext>(() => ({
    streamText,
    streamTools,
    debugView,
    currentUserEmail,
    currentUserName,
    speechPlayback,
    handleStopSpeech,
    handleSkipSpeech,
    handleReplaySpeech,
    onZoomView,
    proseEnabled,
    lastAssistantGroupIndex,
    captureVerbs,
    audioOverlayStore,
  }), [streamText, streamTools, debugView, currentUserEmail, currentUserName, speechPlayback, handleStopSpeech, handleSkipSpeech, handleReplaySpeech, onZoomView, proseEnabled, lastAssistantGroupIndex, captureVerbs, audioOverlayStore]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
        <ChatOpeners openers={openers} onSendOpener={onSendOpener} />
        <div className="text-warm-500 text-sm">Start a conversation with your box assistant.</div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0 w-full min-w-0 flex flex-col overflow-x-hidden">
      <div data-image-list hidden>{chatImagesJson}</div>
      {/* The scroller fills the column so wheel/touch anywhere across it
          (including the gutters) scrolls the messages; the visible content is
          centered by constraining the inner wrapper, not the scroller. */}
      <div
        ref={scrollerRef}
        data-testid="chat-scroller"
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        style={{ overflowAnchor: "none" }}
      >
        <div ref={attachContent} className="mx-auto w-full max-w-5xl">
          <LoadOlderHeader
            hasOlder={hasOlder}
            loadingOlder={loadingOlder}
            onLoadOlder={handleLoadOlder}
          />
          {/* The transcript is user content, so `cb chat ui` does not walk into
              it (lib/ui-scan/scan.ts, SCAN_BOUNDARY_ATTRIBUTE): the links,
              buttons and rendered cards inside messages are the conversation,
              not the app's chrome. The load-older header and the
              scroll-to-bottom button sit outside this wrapper and stay
              scannable. */}
          <div data-cb-scan="exclude">
            {data.map((item, index) => {
              // The live turn's group keeps one key across the streamed→finalized
              // transition so React reconciles it in place — no remount/flash.
              const natural = dataItemKey(item);
              const key = liveKey && liveTargetUuid && natural === liveTargetUuid ? liveKey : natural;
              // The last turn carries a viewport-tall min-height from the send
              // until its reply is complete, so "the user message at the top of
              // the screen" is a reachable scroll position while the reply
              // streams in. Once the turn is done the room below it is only
              // blank space; dropping it lets the browser clamp the view to the
              // real bottom — one move, at finalize, to a place that shows the
              // whole reply.
              const spacer = sendSignal > 0 && turnLive && index === data.length - 1 ? viewportPx : undefined;
              return (
                <div key={key} data-role={item.kind === "group" ? item.group.type : item.kind} style={{ minHeight: spacer }}>
                  <div ref={spacer === undefined ? undefined : liveContentRef} data-chat-live-turn-content={spacer === undefined ? undefined : ""}>
                    {renderDataItem(item, renderCtx)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {!atBottom ? (
        <ScrollToBottomButton emphasized={hasUnseenContent} onClick={() => scrollToBottom({ behavior: "smooth" })} />
      ) : null}
    </div>
  );
}

// Memoized so a composer keystroke (which re-renders the InteractiveChat root
// to update `input`) doesn't reconcile the entire loaded message history. All
// props are referentially stable across a keystroke; the list re-renders only
// when its actual inputs change (new messages, streaming, speech state, …).
export const MessageList = memo(MessageListInner);
