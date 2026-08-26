/**
 * The single scroll controller for the chat message list.
 *
 * Model (docs/plans/chat-scroll-model.md): **the controller writes `scrollTop`
 * only in response to a discrete user action, plus geometric compensations for
 * changes the reader cannot see. Content growth below the reader never
 * scrolls.** Writes, exhaustively:
 *
 *  1. `openThread()` → hold the bottom on every growth until `settleOpen()`
 *     says the first history render landed (or the reader scrolls away —
 *     scrollTop moving *up*. Being off the bottom is not leaving: the event
 *     for the hold's own write arrives a frame later, and content that grew
 *     in between leaves it reading off the bottom with scrollTop exactly
 *     where the write put it — the 92px-then-abandoned open the 2026-08-26
 *     field trace recorded).
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
 * The quiet period that ends the open-thread hold: this long with no content
 * growth after the transcript's images have loaded. The caller can only report
 * "the history is in the DOM" from an effect, which runs *before* the
 * ResizeObserver cycle that measures it; markdown and embeds keep resizing for
 * a beat after that; and a cached image is `complete` before it is decoded
 * and laid out — the 2026-08-26 field trace shows 38 cached images growing
 * the transcript 404px per frame for 500ms after every one reported complete.
 * Growth therefore re-arms the timer; only silence lets it fire.
 */
const OPEN_SETTLE_MS = 400;
/**
 * The most the hold lasts after the first render, whatever keeps growing. An
 * `<img>` reserves no height until its bytes land (the chat has no dimension
 * metadata to reserve with), so the hold waits for the transcript's images,
 * but a fetch that retries for longer (see use-image-retry) and a thread
 * opened onto a live stream are not followed past this. The reader's own
 * action ends the hold at any time.
 */
const OPEN_MAX_MS = 8000;

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
 * Resolves once every image inside the scroller that is still loading has
 * loaded or failed — every eager one, and the lazy ones within a viewport's
 * height of the visible area (a lazy image further away never loads until
 * scrolled to, and waiting for it would only run out the cap). Growth
 * anywhere in the transcript matters while the hold is on: a 450px-tall
 * viewport sits inside one tall last turn, whose images are neither "above
 * the anchor" nor "below the reader" — the 3635px-off-the-bottom open the
 * 2026-08-26 field trace recorded, with 38 images arriving over two seconds.
 */
async function pendingImages(scroller: HTMLDivElement, content: HTMLDivElement | null): Promise<void> {
  if (!content) return;
  const box = scroller.getBoundingClientRect();
  const margin = scroller.clientHeight;
  const waits: Promise<void>[] = [];
  for (const img of Array.from(content.querySelectorAll("img"))) {
    if (img.complete) continue;
    const r = img.getBoundingClientRect();
    if (img.loading === "lazy" && (r.bottom < box.top - margin || r.top > box.bottom + margin)) continue;
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
 * The bounded open-thread hold (rule 1). `open()` starts it; `settle()` says
 * the first render landed and arms its end: a cap (OPEN_MAX_MS) at once, and
 * the quiet-period timer once the images have loaded; `touch()` on every
 * growth restarts the quiet period; `end()` on the reader's action. A settle
 * whose image wait resolves after the thread it belonged to was replaced
 * (`gen`) must not end the new one's hold.
 */
class OpenHold {
  active = true;
  private gen = 0;
  private capTimer: number | null = null;
  private lapseTimer: number | null = null;

  open(): void {
    this.end();
    this.active = true;
    this.gen += 1;
  }

  settle(until: Promise<void>): void {
    if (!this.active || this.capTimer !== null) return;
    const gen = this.gen;
    this.capTimer = window.setTimeout(() => this.end(), OPEN_MAX_MS);
    void until.then(() => {
      if (this.active && this.gen === gen) this.armLapse();
    });
  }

  /** Content grew while the hold is on: the quiet period starts over. */
  touch(): void {
    if (this.lapseTimer !== null) this.armLapse();
  }

  end(): void {
    this.active = false;
    if (this.capTimer !== null) window.clearTimeout(this.capTimer);
    if (this.lapseTimer !== null) window.clearTimeout(this.lapseTimer);
    this.capTimer = null;
    this.lapseTimer = null;
  }

  private armLapse(): void {
    if (this.lapseTimer !== null) window.clearTimeout(this.lapseTimer);
    this.lapseTimer = window.setTimeout(() => this.end(), OPEN_SETTLE_MS);
  }
}

/** Re-read the anchor's offset from the DOM (see `handleScroll`). */
function refreshAnchorTop(anchor: Anchor | null, scroller: HTMLDivElement): void {
  const live = anchorOffset(anchor, scroller);
  if (anchor && live !== null) anchor.top = live;
}

/** Did scrollTop move up since the last look? Records the current value.
 *  Scrolling away is this, never merely being off the bottom — see rule 1. */
function movedUp(el: HTMLDivElement, prevTop: MutableRefObject<number>): boolean {
  const up = el.scrollTop < prevTop.current - 1;
  prevTop.current = el.scrollTop;
  return up;
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
   *  transcript's images have loaded (or `until`, when the caller knows better). */
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
  const prevScrollTopRef = useRef(0);
  // While older messages load: the pre-prepend gap to restore once they land.
  const prependGapRef = useRef<number | null>(null);
  const prependTimerRef = useRef<number | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const anchorTimerRef = useRef<number | null>(null);
  const openHoldRef = useRef(new OpenHold());
  const observersRef = useRef<{ content: ResizeObserver | null; scroller: ResizeObserver | null }>({
    content: null,
    scroller: null,
  });

  // Derived geometry, re-read after every scroll and reconcile: never a guess.
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

  const endOpenPhase = useCallback(() => openHoldRef.current.end(), []);

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
    openHoldRef.current.open();
    writeToBottom("instant");
  }, [writeToBottom]);

  const settleOpen = useCallback((opts?: { until?: Promise<void> }) => {
    const el = scrollerElRef.current;
    openHoldRef.current.settle(opts?.until ?? (el ? pendingImages(el, contentElRef.current) : Promise.resolve()));
  }, []);

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
    refreshAnchorTop(anchorRef.current, el);
    const fromBottom = measure(el);
    if (openHoldRef.current.active && movedUp(el, prevScrollTopRef) && fromBottom > AT_BOTTOM_PX) endOpenPhase();
    recordScrollTrace("scroll", { top: Math.round(el.scrollTop), fb: Math.round(fromBottom), at: atBottomRef.current, open: openHoldRef.current.active });
    scheduleAnchorRecapture();
  }, [measure, atBottomRef, endOpenPhase, scheduleAnchorRecapture]);

  // Both ResizeObservers funnel here: the pure `decideReconcile` classifies the
  // cycle, this measures the DOM facts it needs and applies the compensation.
  const reconcile = useCallback((source: "content" | "scroller") => {
    const el = scrollerElRef.current;
    if (!el) return;
    const prevFromBottom = prevFromBottomRef.current;
    const grew = el.scrollHeight > prevScrollHeightRef.current + GROWTH_EPSILON;
    if (grew) openHoldRef.current.touch();
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
      openPhase: openHoldRef.current.active,
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
    const timers = [anchorTimerRef, prependTimerRef];
    const hold = openHoldRef.current;
    return () => {
      if (observers.content) observers.content.disconnect();
      if (observers.scroller) observers.scroller.disconnect();
      for (const timer of timers) clearTimer(timer);
      hold.end();
    };
  }, []);

  return {
    scrollerRef, contentRef, atBottom, hasUnseenContent, scrollToBottom,
    anchorToTop, captureForPrepend, openThread, settleOpen, viewportPx,
  };
}
