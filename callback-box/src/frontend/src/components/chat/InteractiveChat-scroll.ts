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
 *    write and is ignored. A genuine upward scroll disengages when a real
 *    wheel/touch/key input fired recently, OR when it lands well above the
 *    bottom — a scrollbar-thumb drag fires no input events but is still the
 *    user, while the layout-driven scrolls the intent gate must ignore
 *    (mobile keyboard dismiss clamping scrollTop down) land AT the bottom.
 *    The pure rules live in `decideScroll` (scroll-reconcile.ts).
 *  - While detached, the reading-position anchor's recorded offset is kept in
 *    step with user scrolling inside the scroll handler itself (not just the
 *    paused-scroll recapture), so a stream chunk landing mid-fling measures
 *    only genuine reflow — never the user's own scrolling — and momentum is
 *    never "corrected" back to the disengage point.
 *  - A generous near-bottom margin re-engages following; never exact equality
 *    (sub-pixel/retina rounding makes `=== 0` unreachable — assistant-ui PR
 *    #4141 is the cautionary tale).
 *  - `behavior: "instant"` while following; smooth scrolling janks per chunk
 *    and isn't cancelable on Safari. The button passes "smooth" on click.
 *
 * Testing: after changing this, run the manual procedure in
 * docs/chat-scroll-testing.md (bin/browse; layout behavior can't be doctested).
 */

import { useRef, useState, useCallback, useEffect } from "react";
import type { MutableRefObject } from "react";
import { decideReconcile, decideScroll } from "./scroll-reconcile";

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

interface ScrollerHandlers {
  onScroll: () => void;
  onIntent: () => void;
  onKeyIntent: (e: KeyboardEvent) => void;
}

function addScrollerListeners(el: HTMLDivElement, h: ScrollerHandlers): void {
  el.addEventListener("scroll", h.onScroll, { passive: true });
  el.addEventListener("wheel", h.onIntent, { passive: true });
  el.addEventListener("touchmove", h.onIntent, { passive: true });
  el.addEventListener("keydown", h.onKeyIntent);
}

function removeScrollerListeners(el: HTMLDivElement, h: ScrollerHandlers): void {
  el.removeEventListener("scroll", h.onScroll);
  el.removeEventListener("wheel", h.onIntent);
  el.removeEventListener("touchmove", h.onIntent);
  el.removeEventListener("keydown", h.onKeyIntent);
}

// The topmost child still (partly) visible in the scroller, with its offset
// from the viewport top — the anchor used to hold a detached view steady when
// content above it changes size.
function topVisibleChild(scroller: HTMLDivElement | null, content: HTMLDivElement | null): { el: Element; top: number } | null {
  if (!scroller || !content) return null;
  const scTop = scroller.getBoundingClientRect().top;
  for (const child of content.children) {
    const r = child.getBoundingClientRect();
    if (r.bottom > scTop + 1) return { el: child, top: r.top - scTop };
  }
  return null;
}

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

// A boolean flag kept in a ref (the source of truth, read synchronously in
// event handlers) with a state mirror that drives rendering of the button.
function useMirroredFlag(initial: boolean): { ref: MutableRefObject<boolean>; value: boolean; set: (v: boolean) => void } {
  const ref = useRef(initial);
  const [value, setValue] = useState(initial);
  const set = useCallback((v: boolean) => {
    ref.current = v;
    setValue((prev) => (prev === v ? prev : v));
  }, []);
  return { ref, value, set };
}

export function useStickToBottom(): StickToBottom {
  const scrollerElRef = useRef<HTMLDivElement | null>(null);
  const contentElRef = useRef<HTMLDivElement | null>(null);

  const { ref: pinnedRef, value: isPinned, set: setPinned } = useMirroredFlag(true);
  const { value: hasUnseenContent, set: setUnseen } = useMirroredFlag(false);

  const lastScrollTopRef = useRef(0);
  const lastUserIntentAtRef = useRef(0);
  const lastProgrammaticTopRef = useRef(-1);
  const prevScrollHeightRef = useRef(0);
  // When set, the next content growth is a prepend (older messages loaded
  // above); holds the pre-prepend (scrollHeight - scrollTop) gap to preserve.
  const prependGapRef = useRef<number | null>(null);
  // While detached, the topmost still-visible child and its offset from the
  // viewport top, so content resizing *above* the viewport (a late-loading
  // image / embed / card) can be compensated instead of shoving the view down.
  const anchorRef = useRef<{ el: Element; top: number } | null>(null);
  const anchorTimerRef = useRef<number | null>(null);
  const observersRef = useRef<{ content: ResizeObserver | null; scroller: ResizeObserver | null }>({
    content: null,
    scroller: null,
  });

  // Target of an in-flight `behavior: "smooth"` write (the button's return-to-
  // bottom). Its intermediate animation frames arrive as ordinary scroll events
  // below the target and must be swallowed as programmatic, not read as the
  // user scrolling up.
  const smoothTargetRef = useRef<number | null>(null);

  // Write scrollTop directly to a known offset and remember it, so the scroll
  // event it triggers is recognized as ours.
  const writeTop = useCallback((top: number, behavior: ScrollBehavior) => {
    const el = scrollerElRef.current;
    if (!el) return;
    lastProgrammaticTopRef.current = top;
    smoothTargetRef.current = behavior === "smooth" ? top : null;
    el.scrollTo({ top, behavior });
    // For a smooth write this is the (unchanged) start position — the animation
    // frames update it as they're swallowed below.
    lastScrollTopRef.current = el.scrollTop;
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

  // Refresh the anchor (only meaningful while detached) shortly after the
  // user pauses scrolling, so a resize that lands while they read is corrected.
  const scheduleAnchorCapture = useCallback(() => {
    if (anchorTimerRef.current !== null) window.clearTimeout(anchorTimerRef.current);
    anchorTimerRef.current = window.setTimeout(() => {
      anchorRef.current = pinnedRef.current ? null : topVisibleChild(scrollerElRef.current, contentElRef.current);
    }, 80);
  }, [pinnedRef]);

  const handleScroll = useCallback(() => {
    const el = scrollerElRef.current;
    if (!el) return;
    const top = el.scrollTop;
    // Our own programmatic write — don't reinterpret it as user intent.
    if (Math.abs(top - lastProgrammaticTopRef.current) <= PROGRAMMATIC_EPSILON) {
      smoothTargetRef.current = null;
      lastScrollTopRef.current = top;
      return;
    }
    const recentIntent = performance.now() - lastUserIntentAtRef.current < USER_INTENT_WINDOW_MS;
    // Frames of our own smooth animation: still moving toward the target with
    // no fresh user input — ours. A genuine input, or movement away from the
    // target, means the user took over (or the animation was superseded).
    const smoothTarget = smoothTargetRef.current;
    const towardSmooth = smoothTarget !== null && Math.abs(smoothTarget - top) < Math.abs(smoothTarget - lastScrollTopRef.current);
    if (towardSmooth && !recentIntent) {
      lastScrollTopRef.current = top;
      return;
    }
    smoothTargetRef.current = null;
    // Keep the detached anchor's recorded offset in step with the scroll
    // itself, so a resize landing mid-scroll measures only genuine reflow.
    // Without this, a momentum fling (scroll events but no touchmove, so the
    // debounced recapture never runs) leaves the anchor frozen at the
    // disengage point, and every stream chunk "corrects" the user's own
    // scrolling by yanking them back there — the mid-stream scroll sawtooth.
    const liveAnchor = anchorRef.current;
    if (!pinnedRef.current && liveAnchor) liveAnchor.top += lastScrollTopRef.current - top;
    // The disengage/re-engage rules (scrollbar drags, clamps, the near-bottom
    // margin) live in the pure `decideScroll` — see its doc comment.
    // fromBottom uses the smaller of the live and last-reconciled scrollHeight:
    // a clamp's scroll event can be raced by stream growth landing before this
    // handler runs, and measuring against the grown height would misread that
    // clamp as an intent-less scroll-up far from the bottom (a "drag").
    // Not-yet-reconciled growth is exactly the raced amount, so exclude it.
    const action = decideScroll({
      scrolledUp: top < lastScrollTopRef.current - PROGRAMMATIC_EPSILON,
      recentIntent,
      fromBottom: Math.min(el.scrollHeight, prevScrollHeightRef.current) - top - el.clientHeight,
      nearBottomPx: NEAR_BOTTOM_PX,
    });
    if (action === "disengage") {
      setPinned(false);
      anchorRef.current = topVisibleChild(el, contentElRef.current);
    } else if (action === "re-engage") {
      setPinned(true);
      setUnseen(false);
      anchorRef.current = null;
    }
    if (!pinnedRef.current) scheduleAnchorCapture();
    lastScrollTopRef.current = top;
  }, [pinnedRef, setPinned, setUnseen, scheduleAnchorCapture]);

  // Both ResizeObservers funnel here. The pure `decideReconcile` classifies the
  // cycle; this function measures the DOM facts it needs and applies the
  // resulting scroll effect. `source` distinguishes a content-height change
  // (may be new content worth flagging) from a scroller-box change (chrome below
  // the list resizing — reposition only, never "unseen").
  const reconcile = useCallback((source: "content" | "scroller") => {
    const el = scrollerElRef.current;
    if (!el) return;

    const grew = el.scrollHeight > prevScrollHeightRef.current + PROGRAMMATIC_EPSILON;
    // A prepend only "lands" once content actually grew — a zero-growth content
    // reconcile in the load-older window (e.g. the button's "Loading…" label
    // swap) must not consume the snapshot and leave the real insertion
    // unguarded.
    const prepend = source === "content" && prependGapRef.current !== null && grew;

    // Measure the anchor's on-screen shift (only meaningful while detached with
    // a live anchor, and irrelevant to a prepend which is handled wholesale).
    // Safari has no native scroll anchoring, so we compensate ourselves.
    let anchorDelta = 0;
    const anchor = anchorRef.current;
    if (!prepend && !pinnedRef.current && anchor && anchor.el.isConnected) {
      const newTop = anchor.el.getBoundingClientRect().top - el.getBoundingClientRect().top;
      anchorDelta = newTop - anchor.top;
    }

    const action = decideReconcile({ source, grew, pinned: pinnedRef.current, prepend, anchorMoved: Math.abs(anchorDelta) > 1 });
    prevScrollHeightRef.current = el.scrollHeight;

    if (action === "hold-prepend") {
      // Restore the captured bottom-gap so inserting older messages above
      // doesn't move the view, then re-anchor to a now-visible message: the
      // older block (with its late-decoding images/embeds) is above the
      // viewport, so subsequent growth there compensates against this anchor
      // instead of being misread as new content below (the false-"new messages"
      // bug this path fixes).
      const gap = prependGapRef.current ?? 0;
      prependGapRef.current = null;
      writeTop(el.scrollHeight - gap, "instant");
      anchorRef.current = topVisibleChild(el, contentElRef.current);
    } else if (action === "follow-bottom") {
      writeToBottom("instant");
    } else if (action === "hold-anchor") {
      // Existing content above reflowed — compensate; not new, don't flag.
      writeTop(el.scrollTop + anchorDelta, "instant");
    } else if (action === "flag-unseen") {
      setUnseen(true);
    }
  }, [pinnedRef, writeTop, writeToBottom, setUnseen]);

  const scrollerRef = useCallback((el: HTMLDivElement | null) => {
    const handlers: ScrollerHandlers = { onScroll: handleScroll, onIntent: markUserIntent, onKeyIntent: handleKeyIntent };
    const prev = scrollerElRef.current;
    if (prev) {
      removeScrollerListeners(prev, handlers);
      if (observersRef.current.scroller) observersRef.current.scroller.disconnect();
    }
    scrollerElRef.current = el;
    if (el) {
      lastScrollTopRef.current = el.scrollTop;
      prevScrollHeightRef.current = el.scrollHeight;
      addScrollerListeners(el, handlers);
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
      if (anchorTimerRef.current !== null) window.clearTimeout(anchorTimerRef.current);
    };
  }, []);

  return { scrollerRef, contentRef, isPinned, hasUnseenContent, scrollToBottom, captureForPrepend };
}
