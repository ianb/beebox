/**
 * The single scroll controller for the chat message list.
 *
 * Model (docs/plans/chat-scroll-model.md): **the controller writes `scrollTop`
 * only in response to a discrete user action, plus geometric compensations for
 * changes the reader cannot see. Content growth below the reader never
 * scrolls.** Writes, exhaustively:
 *
 *  1. `openThread()` → hold the bottom on every growth until `settleOpen()`
 *     says the first history render landed (or the reader scrolls away).
 *  2. `anchorToTop(el)` → on send, put the new user message at the top of the
 *     viewport. The reply streams in below it; nothing follows it.
 *  3. `scrollToBottom()` → the floating button.
 *  4. Compensations, all "measure delta, write delta" on a resize: restore the
 *     captured gap across an older-history prepend; hold the top-visible anchor
 *     when content above the viewport reflows; preserve the previous
 *     `fromBottom` when the scroller box itself resizes (keyboard, composer,
 *     banners). The pure dispatcher is `decideReconcile` (scroll-reconcile.ts).
 *
 * The controller therefore keeps *geometry* state only — previous
 * `scrollHeight`, previous `fromBottom`, one anchor — and no *intent* state: it
 * never asks whether a scroll event was the user's, because nothing it does
 * depends on the answer. That question (an epsilon around the last write, a
 * 250ms input window, wheel/touch/key listeners) is what the previous
 * `useStickToBottom` needed in order to follow the bottom, and it could only be
 * verified on the devices whose scroll events it was guessing about.
 * `atBottom` (within 24px, recomputed on every scroll and every resize) drives
 * the button's visibility; `hasUnseenContent` its accent.
 *
 * Testing: `/dev/chat-scroll` runs the scenario table against this hook; the
 * browser procedure is docs/chat-scroll-testing.md.
 */

import { useRef, useState, useCallback, useEffect } from "react";
import type { MutableRefObject } from "react";
import { decideReconcile, type ReconcileAction } from "./scroll-reconcile";
import { recordScrollTrace } from "../../lib/scroll-diagnostics";

/** Distance from the bottom that still counts as "at the bottom". Never exact
 *  equality — sub-pixel/retina rounding makes `=== 0` unreachable. */
const AT_BOTTOM_PX = 24;
/** Growth smaller than this is rounding, not content. */
const GROWTH_EPSILON = 1;
/** Re-pick the top-visible anchor this long after scrolling pauses. */
const ANCHOR_RECAPTURE_MS = 80;
/**
 * How long the open-thread hold outlives `settleOpen()`. The caller can only
 * report "the history is in the DOM" from an effect, which runs *before* the
 * ResizeObserver cycle that measures it — and markdown, images and embeds keep
 * resizing for a beat after that. The hold therefore lapses on a timer rather
 * than on the report, and it is a fixed window, not one that growth can extend:
 * a thread opened onto a live stream must not follow it forever.
 */
const OPEN_SETTLE_MS = 400;

interface Anchor { el: Element; top: number }

/**
 * The anchor that holds the view steady when content above it resizes: the
 * first child that *starts* at or below the scroller's top edge, with its
 * offset from that edge.
 *
 * Not the topmost partly-visible child, which is the tempting choice and the
 * wrong one: an image decoding inside that child grows it downward without
 * moving its own top, so the anchor measures zero shift while everything the
 * reader is looking at slides down. Anchoring to the first child that begins in
 * the viewport puts every such growth *above* the anchor, where it is measured
 * and compensated.
 */
function anchorChild(scroller: HTMLDivElement | null, content: HTMLDivElement | null): Anchor | null {
  if (!scroller || !content) return null;
  const scTop = scroller.getBoundingClientRect().top;
  // The turns, not the content wrapper's immediate children: in the chat those
  // are two boxes (the load-older header and the scan-boundary wrapper holding
  // every message), and a ruler that spans the whole transcript measures no
  // shift at all. Every item wrapper carries `data-role` for this.
  const items = content.querySelectorAll("[data-role]");
  const children: ArrayLike<Element> = items.length > 0 ? items : content.children;
  let last: Element | null = null;
  for (const child of Array.from(children)) {
    const r = child.getBoundingClientRect();
    if (r.top >= scTop - 1) return { el: child, top: r.top - scTop };
    last = child;
  }
  // Everything starts above the top edge (one very tall last message): the
  // final child is still a usable ruler for growth happening above it.
  if (!last) return null;
  return { el: last, top: last.getBoundingClientRect().top - scTop };
}

/** The anchor's live offset from the scroller's top edge, or null if it is gone. */
function anchorOffset(anchor: Anchor | null, scroller: HTMLDivElement): number | null {
  if (!anchor || !anchor.el.isConnected) return null;
  return anchor.el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

/**
 * Applies what the reconcile decided. Every branch is a measured delta —
 * "the content above you moved by N, so move the view by N". Module-level (it
 * has no state of its own, just the refs and writers the hook already holds)
 * so the hook body stays inside its line budget.
 */
function applyReconcileAction(action: ReconcileAction, opts: {
  el: HTMLDivElement;
  anchorDelta: number;
  prevFromBottom: number;
  prependGapRef: MutableRefObject<number | null>;
  anchorRef: MutableRefObject<Anchor | null>;
  contentElRef: MutableRefObject<HTMLDivElement | null>;
  writeTop: (top: number, behavior: ScrollBehavior) => void;
  setUnseen: (v: boolean) => void;
}): void {
  const { el, anchorDelta, prevFromBottom, prependGapRef, anchorRef, contentElRef, writeTop, setUnseen } = opts;
  if (action === "hold-prepend") {
    // Restore the captured bottom gap so inserting older messages above does
    // not move the view, then re-anchor to a now-visible message: the older
    // block (with its late-decoding images) is above the viewport, so its later
    // growth compensates against this anchor instead of reading as new content
    // below (the false-"new messages" badge this path fixes).
    const gap = prependGapRef.current ?? 0;
    prependGapRef.current = null;
    writeTop(el.scrollHeight - gap, "instant");
    anchorRef.current = anchorChild(el, contentElRef.current);
  } else if (action === "open-bottom") {
    writeTop(el.scrollHeight - el.clientHeight, "instant");
  } else if (action === "hold-from-bottom") {
    writeTop(el.scrollHeight - el.clientHeight - prevFromBottom, "instant");
  } else if (action === "hold-anchor") {
    writeTop(el.scrollTop + anchorDelta, "instant");
  } else if (action === "flag-unseen") {
    setUnseen(true);
  }
}

export interface ChatScroll {
  /** Attach to the scroll container (the `overflow-y:auto` element). */
  scrollerRef: (el: HTMLDivElement | null) => void;
  /** Attach to the inner content wrapper (the element whose height grows). */
  contentRef: (el: HTMLDivElement | null) => void;
  /** The view is within `AT_BOTTOM_PX` of the bottom. Drives the button. */
  atBottom: boolean;
  /** Content arrived below a reader who is not at the bottom — button accent. */
  hasUnseenContent: boolean;
  /** Scroll to the bottom (the button, and the open-thread hold). */
  scrollToBottom: (opts?: { behavior?: ScrollBehavior }) => void;
  /** Put `el` at the top of the viewport — the send anchor. Call from a layout
   *  effect, after the new user message and its spacer are in the DOM. */
  anchorToTop: (el: Element | null) => void;
  /** Snapshot the bottom gap immediately before older messages are prepended,
   *  so the growth they cause restores the reader's position. */
  captureForPrepend: () => void;
  /** Begin the bounded open-thread phase (hold the bottom as content lands). */
  openThread: () => void;
  /** The first history render has landed — the hold lapses shortly after. */
  settleOpen: () => void;
  /** The scroller's clientHeight, for the last turn's min-height spacer. */
  viewportPx: number;
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

export function useChatScroll(): ChatScroll {
  const scrollerElRef = useRef<HTMLDivElement | null>(null);
  const contentElRef = useRef<HTMLDivElement | null>(null);

  const { ref: atBottomRef, value: atBottom, set: setAtBottomFlag } = useMirroredFlag(true);
  const { value: hasUnseenContent, set: setUnseen } = useMirroredFlag(false);
  const [viewportPx, setViewportPx] = useState(0);

  const prevScrollHeightRef = useRef(0);
  const prevFromBottomRef = useRef(0);
  // Set while older messages are being loaded: the pre-prepend
  // (scrollHeight - scrollTop) gap to restore once the insertion lands.
  const prependGapRef = useRef<number | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const anchorTimerRef = useRef<number | null>(null);
  const openPhaseRef = useRef(true);
  const openTimerRef = useRef<number | null>(null);
  const observersRef = useRef<{ content: ResizeObserver | null; scroller: ResizeObserver | null }>({
    content: null,
    scroller: null,
  });

  // Recompute the derived geometry from the DOM. Called after every scroll
  // event and at the end of every reconcile, so `atBottom` is never a guess.
  const measure = useCallback((el: HTMLDivElement) => {
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    prevFromBottomRef.current = fromBottom;
    prevScrollHeightRef.current = el.scrollHeight;
    const at = fromBottom <= AT_BOTTOM_PX;
    setAtBottomFlag(at);
    if (at) setUnseen(false);
    return fromBottom;
  }, [setAtBottomFlag, setUnseen]);

  const writeTop = useCallback((top: number, behavior: ScrollBehavior) => {
    const el = scrollerElRef.current;
    if (!el) return;
    recordScrollTrace("write", { top: Math.round(top), b: behavior });
    el.scrollTo({ top, behavior });
  }, []);

  const writeToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = scrollerElRef.current;
    if (el) writeTop(el.scrollHeight - el.clientHeight, behavior);
  }, [writeTop]);

  const endOpenPhase = useCallback(() => {
    openPhaseRef.current = false;
    if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  }, []);

  const scrollToBottom = useCallback((opts?: { behavior?: ScrollBehavior }) => {
    const el = scrollerElRef.current;
    endOpenPhase();
    setUnseen(false);
    writeToBottom(opts && opts.behavior ? opts.behavior : "instant");
    if (el) measure(el);
  }, [endOpenPhase, setUnseen, writeToBottom, measure]);

  const anchorToTop = useCallback((target: Element | null) => {
    const el = scrollerElRef.current;
    if (!el || !target) return;
    endOpenPhase();
    setUnseen(false);
    const offset = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
    writeTop(el.scrollTop + offset, "instant");
    anchorRef.current = anchorChild(el, contentElRef.current);
    measure(el);
  }, [endOpenPhase, setUnseen, writeTop, measure]);

  const captureForPrepend = useCallback(() => {
    const el = scrollerElRef.current;
    if (el) prependGapRef.current = el.scrollHeight - el.scrollTop;
  }, []);

  const openThread = useCallback(() => {
    endOpenPhase();
    openPhaseRef.current = true;
    writeToBottom("instant");
  }, [endOpenPhase, writeToBottom]);

  const settleOpen = useCallback(() => {
    if (!openPhaseRef.current || openTimerRef.current !== null) return;
    openTimerRef.current = window.setTimeout(endOpenPhase, OPEN_SETTLE_MS);
  }, [endOpenPhase]);

  // Re-pick the anchor once scrolling pauses: the previous one has usually
  // scrolled out of view, and the compensations only work against a child that
  // is still at the top of the viewport.
  const scheduleAnchorRecapture = useCallback(() => {
    if (anchorTimerRef.current !== null) window.clearTimeout(anchorTimerRef.current);
    anchorTimerRef.current = window.setTimeout(() => {
      anchorRef.current = anchorChild(scrollerElRef.current, contentElRef.current);
    }, ANCHOR_RECAPTURE_MS);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollerElRef.current;
    if (!el) return;
    // Re-measure the anchor's offset from the DOM on every scroll event, ours
    // or the user's: a resize landing mid-fling then measures only genuine
    // reflow, never the movement the reader just made (the mid-stream sawtooth
    // this replaces guessed at with an input-intent window instead).
    const anchor = anchorRef.current;
    const live = anchorOffset(anchor, el);
    if (anchor && live !== null) anchor.top = live;
    const fromBottom = measure(el);
    // A reader who scrolls away while the thread is still loading has taken
    // over; the open-phase hold is theirs to end.
    if (openPhaseRef.current && fromBottom > AT_BOTTOM_PX) endOpenPhase();
    recordScrollTrace("scroll", { top: Math.round(el.scrollTop), fb: Math.round(fromBottom), at: atBottomRef.current, open: openPhaseRef.current });
    scheduleAnchorRecapture();
  }, [measure, atBottomRef, endOpenPhase, scheduleAnchorRecapture]);

  // Both ResizeObservers funnel here: the pure `decideReconcile` classifies the
  // cycle, this measures the DOM facts it needs and applies the compensation.
  const reconcile = useCallback((source: "content" | "scroller") => {
    const el = scrollerElRef.current;
    if (!el) return;
    const prevFromBottom = prevFromBottomRef.current;
    const grew = el.scrollHeight > prevScrollHeightRef.current + GROWTH_EPSILON;
    // A prepend only "lands" once content actually grew — a zero-growth content
    // cycle in the load-older window (the button's "Loading…" label swap) must
    // not consume the snapshot and leave the real insertion unguarded.
    const prepend = source === "content" && prependGapRef.current !== null && grew;

    let anchorDelta = 0;
    const anchor = anchorRef.current;
    const live = prepend || source === "scroller" ? null : anchorOffset(anchor, el);
    if (anchor && live !== null) anchorDelta = live - anchor.top;

    const action = decideReconcile({
      source,
      grew,
      prepend,
      anchorMoved: Math.abs(anchorDelta) > 1,
      atBottom: atBottomRef.current,
      openPhase: openPhaseRef.current,
    });
    recordScrollTrace("reconcile", { src: source, grew, ad: Math.round(anchorDelta), act: action, sh: el.scrollHeight, ch: el.clientHeight, st: Math.round(el.scrollTop) });
    applyReconcileAction(action, { el, anchorDelta, prevFromBottom, prependGapRef, anchorRef, contentElRef, writeTop, setUnseen });
    if (source === "scroller") setViewportPx(el.clientHeight);
    measure(el);
  }, [atBottomRef, writeTop, setUnseen, measure]);

  const scrollerRef = useCallback((el: HTMLDivElement | null) => {
    const prev = scrollerElRef.current;
    if (prev) prev.removeEventListener("scroll", handleScroll);
    if (observersRef.current.scroller) observersRef.current.scroller.disconnect();
    scrollerElRef.current = el;
    if (el) {
      prevScrollHeightRef.current = el.scrollHeight;
      prevFromBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight;
      setViewportPx(el.clientHeight);
      el.addEventListener("scroll", handleScroll, { passive: true });
      const ro = new ResizeObserver(() => reconcile("scroller"));
      ro.observe(el);
      observersRef.current.scroller = ro;
    }
  }, [handleScroll, reconcile]);

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
      if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
    };
  }, []);

  return {
    scrollerRef, contentRef, atBottom, hasUnseenContent, scrollToBottom,
    anchorToTop, captureForPrepend, openThread, settleOpen, viewportPx,
  };
}
