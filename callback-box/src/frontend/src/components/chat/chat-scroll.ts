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
 * How long a prepend snapshot stays armed. A load-older that errors, is
 * cancelled, or returns nothing renderable never produces the growth that
 * consumes the snapshot — and an unbounded one would make the *next* unrelated
 * growth (a reply arriving minutes later) restore a stale gap and jump the
 * reader. The snapshot belongs to one in-flight request; it expires with it.
 */
const PREPEND_SNAPSHOT_MS = 10000;
/**
 * How long the open-thread hold outlives the transcript's first render. The
 * caller can only report "the history is in the DOM" from an effect, which
 * runs *before* the ResizeObserver cycle that measures it — and markdown and
 * embeds keep resizing for a beat after that. The hold therefore lapses on a
 * timer rather than on the report.
 */
const OPEN_SETTLE_MS = 400;
/**
 * The most the hold waits for the transcript's images before that timer
 * starts. An `<img>` reserves no height until its bytes land (the chat has no
 * dimension metadata to reserve with), so on a real box the last turn grows by
 * up to a screenful well after the first render; a hold that lapsed before
 * then stranded the reader an image's height above the bottom of a thread they
 * had just opened. `settleOpen` waits for the images in and around the viewport
 * to load or fail, bounded by this cap: a fetch that retries for longer (see
 * use-image-retry) is not something a thread opened onto a live stream should
 * be followed for. The reader's own action ends the hold at any time.
 */
const OPEN_IMAGES_MAX_MS = 8000;

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
  // shift at all. Every item wrapper carries `data-role` for this — matched at
  // the two depths the wrappers actually live at, never `[data-role]` anywhere,
  // so a rendered card or markdown block that happens to carry the attribute
  // deeper inside a message can never become the ruler.
  const items = content.querySelectorAll(":scope > [data-role], :scope > * > [data-role]");
  const children: ArrayLike<Element> = items.length > 0 ? items : content.children;
  let last: Element | null = null;
  for (const child of Array.from(children)) {
    const r = child.getBoundingClientRect();
    if (r.top >= scTop - 1) return { el: child, top: r.top - scTop };
    last = child;
  }
  // Everything starts above the top edge — the viewport sits inside one very
  // tall message. The final item is still a usable ruler for growth above it,
  // with the known limit that growth *inside* it moves the reader's view
  // without moving its top, which is exactly what the choice above avoids
  // everywhere else. There is no better ruler when no item starts on screen.
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
    // `prevFromBottom` is the last value measured before this resize was
    // observed. If the resize also clamped `scrollTop` and the browser
    // delivered that scroll event before the ResizeObserver callback, the
    // snapshot is already the clamped one — but a clamp lands AT the bottom, so
    // what is preserved is 0 and the reader ends up at the bottom. That is the
    // bounded worst case of the ordering, and only for a reader who was already
    // within the resize delta of the bottom.
    writeTop(el.scrollHeight - el.clientHeight - prevFromBottom, "instant");
  } else if (action === "hold-anchor") {
    writeTop(el.scrollTop + anchorDelta, "instant");
  } else if (action === "flag-unseen") {
    setUnseen(true);
  }
}

/**
 * Resolves once every image inside the scroller that is still loading and is
 * within a viewport's height of the visible area has loaded or failed. Images
 * further away are not waited for — lazy ones never load until scrolled to,
 * and their growth is above the reader, which the anchor compensation handles.
 */
async function pendingNearbyImages(scroller: HTMLDivElement, content: HTMLDivElement | null): Promise<void> {
  if (!content) return;
  const box = scroller.getBoundingClientRect();
  const margin = scroller.clientHeight;
  const waits: Promise<void>[] = [];
  for (const img of Array.from(content.querySelectorAll("img"))) {
    if (img.complete) continue;
    const r = img.getBoundingClientRect();
    if (r.bottom < box.top - margin || r.top > box.bottom + margin) continue;
    waits.push(new Promise<void>((resolve) => {
      const done = (): void => {
        img.removeEventListener("load", done);
        img.removeEventListener("error", done);
        resolve();
      };
      img.addEventListener("load", done);
      img.addEventListener("error", done);
    }));
  }
  await Promise.all(waits);
}

/**
 * Arm the end of the open-thread hold: the cap first (its handle doubles as
 * the "a settle is in flight" marker), then the short lapse once `until`
 * resolves — unless the hold ended or a newer thread opened meanwhile.
 */
function armOpenSettle(wait: { until: Promise<void> | undefined; scroller: HTMLDivElement | null; content: HTMLDivElement | null }, refs: {
  phase: MutableRefObject<boolean>;
  gen: MutableRefObject<number>;
  timer: MutableRefObject<number | null>;
  end: () => void;
}): void {
  const { end } = refs;
  const until = wait.until ?? (wait.scroller ? pendingNearbyImages(wait.scroller, wait.content) : Promise.resolve());
  const gen = refs.gen.current;
  refs.timer.current = window.setTimeout(end, OPEN_IMAGES_MAX_MS);
  void until.then(() => {
    if (!refs.phase.current || refs.gen.current !== gen) return;
    clearTimer(refs.timer);
    refs.timer.current = window.setTimeout(end, OPEN_SETTLE_MS);
  });
}

/** A `window.setTimeout` handle held in a ref, cleared idempotently. */
function clearTimer(ref: MutableRefObject<number | null>): void {
  if (ref.current !== null) window.clearTimeout(ref.current);
  ref.current = null;
}

/**
 * Record the bottom gap to restore once the older-history page lands, and arm
 * its expiry (see PREPEND_SNAPSHOT_MS).
 */
function armPrependSnapshot(el: HTMLDivElement, refs: { gap: MutableRefObject<number | null>; timer: MutableRefObject<number | null> }): void {
  refs.gap.current = el.scrollHeight - el.scrollTop;
  clearTimer(refs.timer);
  refs.timer.current = window.setTimeout(() => {
    refs.gap.current = null;
    refs.timer.current = null;
  }, PREPEND_SNAPSHOT_MS);
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
  /** The first history render has landed — the hold lapses shortly after the
   *  nearby images have loaded (or `until`, when the caller knows better). */
  settleOpen: (opts?: { until?: Promise<void> }) => void;
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
  const prependTimerRef = useRef<number | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const anchorTimerRef = useRef<number | null>(null);
  const openPhaseRef = useRef(true);
  const openGenRef = useRef(0); // bumped per openThread(): a stale settle must not end the new hold
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
    clearTimer(openTimerRef);
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
    if (el) armPrependSnapshot(el, { gap: prependGapRef, timer: prependTimerRef });
  }, []);

  const openThread = useCallback(() => {
    endOpenPhase();
    openPhaseRef.current = true; openGenRef.current += 1;
    writeToBottom("instant");
  }, [endOpenPhase, writeToBottom]);

  const settleOpen = useCallback((opts?: { until?: Promise<void> }) => {
    if (!openPhaseRef.current || openTimerRef.current !== null) return;
    armOpenSettle({ until: opts?.until, scroller: scrollerElRef.current, content: contentElRef.current }, { phase: openPhaseRef, gen: openGenRef, timer: openTimerRef, end: endOpenPhase });
  }, [endOpenPhase]);

  // Re-pick the anchor once scrolling pauses: the previous one has usually
  // scrolled out of view, and the compensations only work against a child that
  // is still at the top of the viewport.
  const scheduleAnchorRecapture = useCallback(() => {
    clearTimer(anchorTimerRef);
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
      // Where the reader lands if nothing is written: the pre-cycle gap plus
      // whatever the content grew by (a scroller resize is compensated, so its
      // pre-cycle state stands).
      atBottomAfter: prevFromBottom + Math.max(0, el.scrollHeight - prevScrollHeightRef.current) <= AT_BOTTOM_PX,
      openPhase: openPhaseRef.current,
    });
    recordScrollTrace("reconcile", { src: source, grew, ad: Math.round(anchorDelta), act: action, sh: el.scrollHeight, ch: el.clientHeight, st: Math.round(el.scrollTop) });
    applyReconcileAction(action, { el, anchorDelta, prevFromBottom, prependGapRef, anchorRef, contentElRef, writeTop, setUnseen });
    if (source === "scroller") setViewportPx(el.clientHeight);
    measure(el);
  }, [writeTop, setUnseen, measure]);

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
    const timers = [anchorTimerRef, openTimerRef, prependTimerRef];
    return () => {
      if (observers.content) observers.content.disconnect();
      if (observers.scroller) observers.scroller.disconnect();
      for (const timer of timers) clearTimer(timer);
    };
  }, []);

  return {
    scrollerRef, contentRef, atBottom, hasUnseenContent, scrollToBottom,
    anchorToTop, captureForPrepend, openThread, settleOpen, viewportPx,
  };
}
