/**
 * The single scroll controller for the chat message list. Owns one scroll
 * container and decides, on its own, whether to follow the growing bottom
 * (streaming, new messages, async-loading embeds) or leave a user who has
 * scrolled up alone. Replaces the previous react-virtuoso `followOutput` +
 * hand-rolled pin layer, which fought each other (see the removed
 * VirtualizedMessageList history).
 *
 * Design (mirrors the proven parts of stackblitz-labs/use-stick-to-bottom,
 * reimplemented in-repo so we own the mobile-Safari path):
 *
 *  - ResizeObserver on BOTH the content element and the scroller. Content
 *    growth (a stream chunk, a finalized message, an image decoding) re-pins
 *    when we're following. The scroller observer is the load-bearing extra the
 *    library lacks: chrome *below* the list (status banners, attachments,
 *    selections, recovered dictation, mobile composer row) are flex siblings
 *    that change the scroller's clientHeight WITHOUT changing content height,
 *    so a content-only observer silently drifts off the bottom.
 *  - User vs. programmatic scroll is told apart by recording the scrollTop we
 *    last wrote; an incoming scroll within a pixel or two of that is our own
 *    write and is ignored. A genuine upward scroll only disengages when a real
 *    wheel/touch/key input fired recently — layout-driven scrolls (mobile
 *    keyboard dismiss clamping scrollTop down) carry no such input.
 *  - A generous near-bottom margin re-engages following; never exact equality
 *    (sub-pixel/retina rounding makes `=== 0` unreachable — assistant-ui PR
 *    #4141 is the cautionary tale).
 *  - `behavior: "instant"` while following; smooth scrolling janks per chunk
 *    and isn't cancelable on Safari. The button passes "smooth" on click.
 */

import { useRef, useState, useCallback, useEffect } from "react";

// Re-engage following once the user scrolls back within this many px of the
// bottom. Generous on purpose, and never exact equality.
const NEAR_BOTTOM_PX = 70;

// Treat an incoming scrollTop within this many px of our last programmatic
// write as our own scroll, not the user's. Also the dead-band below which an
// upward delta doesn't count as a deliberate scroll-up.
const PROGRAMMATIC_EPSILON = 2;

// An upward scroll only disengages following if a genuine user input
// (wheel/touch/scroll-key) fired within this window. Without it, layout-driven
// scrolls — the mobile soft keyboard dismissing clamps scrollTop downward,
// firing a phantom "scroll up" — would wrongly stop the follow.
const USER_INTENT_WINDOW_MS = 250;

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

export interface StickToBottom {
  /** Attach to the scroll container (the `overflow-y:auto` element). */
  scrollerRef: (el: HTMLDivElement | null) => void;
  /** Attach to the inner content wrapper (the element whose height grows). */
  contentRef: (el: HTMLDivElement | null) => void;
  /** Whether the view is following the bottom. */
  isPinned: boolean;
  /** Content grew while the user was scrolled away — drives the button accent. */
  hasUnseenContent: boolean;
  /** Scroll to the bottom and re-engage following. */
  scrollToBottom: (opts?: { behavior?: ScrollBehavior }) => void;
  /**
   * Snapshot the scroll position immediately before older messages are
   * prepended, so the next content growth restores the user's anchor instead
   * of jumping. Manual equivalent of the removed Virtuoso `firstItemIndex`.
   */
  captureForPrepend: () => void;
}

export function useStickToBottom(): StickToBottom {
  const scrollerElRef = useRef<HTMLDivElement | null>(null);
  const contentElRef = useRef<HTMLDivElement | null>(null);

  // Refs are the source of truth (read synchronously in event handlers); the
  // state mirrors drive rendering of the button.
  const pinnedRef = useRef(true);
  const [isPinned, setIsPinned] = useState(true);
  const unseenRef = useRef(false);
  const [hasUnseenContent, setHasUnseenContent] = useState(false);

  const lastScrollTopRef = useRef(0);
  const lastUserIntentAtRef = useRef(0);
  const lastProgrammaticTopRef = useRef(-1);
  const prevScrollHeightRef = useRef(0);
  // When set, the next content growth is a prepend (older messages loaded
  // above); holds the pre-prepend (scrollHeight - scrollTop) gap to preserve.
  const prependGapRef = useRef<number | null>(null);
  const observersRef = useRef<{ content: ResizeObserver | null; scroller: ResizeObserver | null }>({
    content: null,
    scroller: null,
  });

  const setPinned = useCallback((v: boolean) => {
    pinnedRef.current = v;
    setIsPinned((prev) => (prev === v ? prev : v));
  }, []);

  const setUnseen = useCallback((v: boolean) => {
    unseenRef.current = v;
    setHasUnseenContent((prev) => (prev === v ? prev : v));
  }, []);

  // Write scrollTop directly to a known offset and remember it, so the scroll
  // event it triggers is recognized as ours.
  const writeTop = useCallback((top: number, behavior: ScrollBehavior) => {
    const el = scrollerElRef.current;
    if (!el) return;
    lastProgrammaticTopRef.current = top;
    el.scrollTo({ top, behavior });
    lastScrollTopRef.current = top;
  }, []);

  const writeToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = scrollerElRef.current;
    if (!el) return;
    writeTop(el.scrollHeight - el.clientHeight, behavior);
  }, [writeTop]);

  const scrollToBottom = useCallback((opts?: { behavior?: ScrollBehavior }) => {
    const behavior = opts && opts.behavior ? opts.behavior : "instant";
    setPinned(true);
    setUnseen(false);
    writeToBottom(behavior);
  }, [setPinned, setUnseen, writeToBottom]);

  const captureForPrepend = useCallback(() => {
    const el = scrollerElRef.current;
    if (el) prependGapRef.current = el.scrollHeight - el.scrollTop;
  }, []);

  const markUserIntent = useCallback(() => {
    lastUserIntentAtRef.current = performance.now();
  }, []);

  const handleKeyIntent = useCallback((e: KeyboardEvent) => {
    if (SCROLL_KEYS.has(e.key)) lastUserIntentAtRef.current = performance.now();
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollerElRef.current;
    if (!el) return;
    const top = el.scrollTop;
    // Our own programmatic write — don't reinterpret it as user intent.
    if (Math.abs(top - lastProgrammaticTopRef.current) <= PROGRAMMATIC_EPSILON) {
      lastScrollTopRef.current = top;
      return;
    }
    const fromBottom = el.scrollHeight - top - el.clientHeight;
    const scrolledUp = top < lastScrollTopRef.current - PROGRAMMATIC_EPSILON;
    const recentIntent = performance.now() - lastUserIntentAtRef.current < USER_INTENT_WINDOW_MS;
    if (scrolledUp && recentIntent) {
      setPinned(false);
    } else if (fromBottom <= NEAR_BOTTOM_PX) {
      setPinned(true);
      setUnseen(false);
    }
    lastScrollTopRef.current = top;
  }, [setPinned, setUnseen]);

  // Both ResizeObservers funnel here. `source` distinguishes a content-height
  // change (may be new content worth flagging) from a scroller-box change
  // (chrome below the list resizing — reposition only, never "unseen").
  const reconcile = useCallback((source: "content" | "scroller") => {
    const el = scrollerElRef.current;
    if (!el) return;

    // A prepend takes precedence: restore the captured bottom-gap so inserting
    // older messages above doesn't move the user's view.
    if (source === "content" && prependGapRef.current !== null) {
      const gap = prependGapRef.current;
      prependGapRef.current = null;
      prevScrollHeightRef.current = el.scrollHeight;
      writeTop(el.scrollHeight - gap, "instant");
      return;
    }

    const grew = el.scrollHeight > prevScrollHeightRef.current + PROGRAMMATIC_EPSILON;
    prevScrollHeightRef.current = el.scrollHeight;

    if (pinnedRef.current) {
      writeToBottom("instant");
      return;
    }
    // Detached: the browser holds scrollTop, so bottom growth and chrome
    // resizes leave the view stable on their own. Just flag genuinely new
    // content so the button can signal it.
    if (source === "content" && grew) setUnseen(true);
  }, [writeTop, writeToBottom, setUnseen]);

  const scrollerRef = useCallback((el: HTMLDivElement | null) => {
    const prev = scrollerElRef.current;
    if (prev) {
      prev.removeEventListener("scroll", handleScroll);
      prev.removeEventListener("wheel", markUserIntent);
      prev.removeEventListener("touchmove", markUserIntent);
      prev.removeEventListener("keydown", handleKeyIntent);
      if (observersRef.current.scroller) observersRef.current.scroller.disconnect();
    }
    scrollerElRef.current = el;
    if (el) {
      lastScrollTopRef.current = el.scrollTop;
      prevScrollHeightRef.current = el.scrollHeight;
      el.addEventListener("scroll", handleScroll, { passive: true });
      el.addEventListener("wheel", markUserIntent, { passive: true });
      el.addEventListener("touchmove", markUserIntent, { passive: true });
      el.addEventListener("keydown", handleKeyIntent);
      const ro = new ResizeObserver(() => reconcile("scroller"));
      ro.observe(el);
      observersRef.current.scroller = ro;
    }
  }, [handleScroll, markUserIntent, handleKeyIntent, reconcile]);

  const contentRef = useCallback((el: HTMLDivElement | null) => {
    if (observersRef.current.content) observersRef.current.content.disconnect();
    contentElRef.current = el;
    if (el) {
      const ro = new ResizeObserver(() => reconcile("content"));
      ro.observe(el);
      observersRef.current.content = ro;
    }
  }, [reconcile]);

  useEffect(() => {
    const observers = observersRef.current;
    return () => {
      if (observers.content) observers.content.disconnect();
      if (observers.scroller) observers.scroller.disconnect();
    };
  }, []);

  return { scrollerRef, contentRef, isPinned, hasUnseenContent, scrollToBottom, captureForPrepend };
}
