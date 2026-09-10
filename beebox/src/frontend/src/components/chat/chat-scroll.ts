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
 *     when content above the viewport reflows; keep the bottom only if already
 *     there when the scroller box itself resizes (keyboard, composer,
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
import { easeOrSnapToTop } from "./chat-scroll-ease.js";
import { anchorChild, anchorOffset, type Anchor } from "./chat-scroll-anchor";
import { currentBottomTop } from "./chat-scroll-bottom.js";
import { armPrependSnapshot, clearTimer, movedUp } from "./chat-scroll-refs.js";
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
 * user-image thumbnail can grow when its bytes land, so the hold waits for
 * the transcript's images, but a slow fetch and a thread opened onto a live
 * stream are not followed past this. The reader's own
 * action ends the hold at any time.
 */
const OPEN_MAX_MS = 8000;

interface ScrollObservers { content: ResizeObserver | null; scroller: ResizeObserver | null; live: ResizeObserver | null }

function observeResize(opts: { refs: MutableRefObject<ScrollObservers>; key: keyof ScrollObservers; el: Element | null; onResize: () => void }): void {
  const { refs, key, el, onResize } = opts;
  refs.current[key]?.disconnect();
  refs.current[key] = null;
  if (!el) return;
  const observer = new ResizeObserver(onResize);
  observer.observe(el);
  refs.current[key] = observer;
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
    // Only reached for a real bottom gap near zero. handleScroll leaves this
    // pre-resize snapshot intact if the viewport height has already changed.
    const live = contentElRef.current?.querySelector<HTMLDivElement>("[data-chat-live-turn-content]") ?? null;
    writeTop(currentBottomTop(el, live) - prevFromBottom, "instant");
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
    this.end("open");
    this.active = true; this.gen += 1;
    recordScrollTrace("hold", { ev: "open", gen: this.gen });
  }

  settle(until: Promise<void>): void {
    if (!this.active || this.capTimer !== null) return;
    const gen = this.gen;
    recordScrollTrace("hold", { ev: "settle", gen });
    this.capTimer = window.setTimeout(() => this.end("cap"), OPEN_MAX_MS);
    void until.then(() => {
      recordScrollTrace("hold", { ev: "images-done", gen, live: this.active && this.gen === gen });
      if (this.active && this.gen === gen) this.armLapse();
    });
  }

  touch(): void { // content grew: the quiet period starts over
    if (this.lapseTimer !== null) this.armLapse();
  }

  end(why: string): void {
    if (this.active) recordScrollTrace("hold", { ev: "end", why });
    this.active = false;
    if (this.capTimer !== null) window.clearTimeout(this.capTimer);
    if (this.lapseTimer !== null) window.clearTimeout(this.lapseTimer);
    this.capTimer = null;
    this.lapseTimer = null;
  }

  private armLapse(): void {
    if (this.lapseTimer !== null) window.clearTimeout(this.lapseTimer);
    this.lapseTimer = window.setTimeout(() => this.end("quiet"), OPEN_SETTLE_MS);
  }
}

export interface ChatScroll {
  /** Attach to the scroll container (the `overflow-y:auto` element). */
  scrollerRef: (el: HTMLDivElement | null) => void;
  /** Attach to the inner content wrapper (the element whose height grows). */
  contentRef: (el: HTMLDivElement | null) => void;
  /** Attach to the live turn's natural-height content inside its spacer. */
  liveContentRef: (el: HTMLDivElement | null) => void;
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

function anchorChange({ anchor, el, prepend }: { anchor: Anchor | null; el: HTMLDivElement; prepend: boolean }): { live: number | null; anchorDelta: number } {
  const live = prepend ? null : anchorOffset(anchor, el);
  return { live, anchorDelta: anchor && live !== null ? live - anchor.top : 0 };
}

/** All subscriptions/timers owned by one mounted controller. */
function scrollCleanup(resources: {
  observers: ScrollObservers; timers: MutableRefObject<number | null>[];
  hold: OpenHold; ease: MutableRefObject<(() => void) | null>;
}): () => void {
  return () => {
    for (const observer of Object.values(resources.observers)) observer?.disconnect();
    for (const timer of resources.timers) clearTimer(timer);
    resources.ease.current?.();
    resources.hold.end("unmount");
  };
}

export function useChatScroll(): ChatScroll {
  const scrollerElRef = useRef<HTMLDivElement | null>(null);
  const contentElRef = useRef<HTMLDivElement | null>(null);
  const liveContentElRef = useRef<HTMLDivElement | null>(null);
  const { ref: atBottomRef, value: atBottom, set: setAtBottomFlag } = useMirroredFlag(true);
  const { value: hasUnseenContent, set: setUnseen } = useMirroredFlag(false);

  const prevScrollHeightRef = useRef(0);
  const prevClientWidthRef = useRef(0), prevClientHeightRef = useRef(0);
  const prevFromBottomRef = useRef(0);
  const prevScrollTopRef = useRef(0);
  const prependGapRef = useRef<number | null>(null);
  const prependTimerRef = useRef<number | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const anchorTimerRef = useRef<number | null>(null);
  const openHoldRef = useRef(new OpenHold());
  const observersRef = useRef<ScrollObservers>({
    content: null,
    scroller: null,
    live: null,
  });

  const measure = useCallback((el: HTMLDivElement) => {
    const fromBottom = currentBottomTop(el, liveContentElRef.current) - el.scrollTop;
    // Growth is noticed here, not only in reconcile: a scroll event (the
    // previous write's) can precede the resize callback in the same frame, and
    // it re-measures first — so per-frame growth never reads as `grew` there.
    if (el.scrollHeight > prevScrollHeightRef.current + GROWTH_EPSILON) openHoldRef.current.touch();
    prevFromBottomRef.current = fromBottom;
    prevScrollHeightRef.current = el.scrollHeight;
    prevClientWidthRef.current = el.clientWidth;
    prevClientHeightRef.current = el.clientHeight;
    const at = fromBottom <= AT_BOTTOM_PX;
    setAtBottomFlag(at);
    if (at) setUnseen(false);
    return Math.max(0, fromBottom);
  }, [setAtBottomFlag, setUnseen]);

  const anchorEaseCancelRef = useRef<(() => void) | null>(null);
  const writeTop = useCallback((top: number, behavior: ScrollBehavior) => {
    const el = scrollerElRef.current;
    if (!el) return;
    anchorEaseCancelRef.current?.(); // any other write supersedes the send ease
    recordScrollTrace("write", { top: Math.round(top), b: behavior });
    el.scrollTo({ top, behavior });
  }, []);

  const writeToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = scrollerElRef.current;
    if (el) writeTop(currentBottomTop(el, liveContentElRef.current), behavior);
  }, [writeTop]);

  const endOpenPhase = useCallback((why: string) => openHoldRef.current.end(why), []);

  const scrollToBottom = useCallback((opts?: { behavior?: ScrollBehavior }) => {
    const el = scrollerElRef.current;
    endOpenPhase("button");
    setUnseen(false);
    writeToBottom(opts && opts.behavior ? opts.behavior : "instant");
    if (el) measure(el);
  }, [endOpenPhase, setUnseen, writeToBottom, measure]);

  const anchorToTop = useCallback((target: Element | null) => {
    const el = scrollerElRef.current;
    if (!el || !target) return;
    endOpenPhase("send");
    setUnseen(false);
    // The one user-initiated jump gets the quick ease (chat-scroll-ease.ts);
    // compensation writes stay instant — animating them fights the RO loop.
    const onDone = (): void => { anchorRef.current = anchorChild(el, contentElRef.current); measure(el); };
    const writeInstant = (top: number): void => { writeTop(top, "instant"); };
    easeOrSnapToTop({ el, target, writeInstant, cancelRef: anchorEaseCancelRef, onDone, onCancel: () => { anchorRef.current = null; } });
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
    // Leave the pre-resize snapshot intact until reconciliation; a browser
    // clamp may dispatch scroll before ResizeObserver. Content coordinates
    // already exclude ordinary scrolling, so never rebase the anchor here.
    const boxResized = el.clientWidth !== prevClientWidthRef.current || el.clientHeight !== prevClientHeightRef.current;
    const fromBottom = !boxResized
      ? measure(el) : prevFromBottomRef.current;
    if (openHoldRef.current.active && movedUp(el, prevScrollTopRef) && fromBottom > AT_BOTTOM_PX) endOpenPhase("scrolled-up");
    recordScrollTrace("scroll", { top: Math.round(el.scrollTop), fb: Math.round(fromBottom), at: atBottomRef.current, open: openHoldRef.current.active });
    // Capture a reader-controlled position now; the delayed pass follows
    // momentum. A box resize retains its pre-resize anchor through the clamp.
    if (!boxResized) anchorRef.current = anchorChild(el, contentElRef.current);
    scheduleAnchorRecapture();
  }, [measure, atBottomRef, endOpenPhase, scheduleAnchorRecapture]);

  const reconcile = useCallback((source: "content" | "scroller") => {
    const el = scrollerElRef.current;
    if (!el) return;
    const prevFromBottom = prevFromBottomRef.current;
    const grew = el.scrollHeight > prevScrollHeightRef.current + GROWTH_EPSILON;
    const prepend = source === "content" && prependGapRef.current !== null && grew;

    const anchor = anchorRef.current;
    const { live, anchorDelta } = anchorChange({ anchor, el, prepend });

    const action = decideReconcile({
      source: el.clientHeight !== prevClientHeightRef.current ? "scroller" : source,
      grew,
      prepend,
      anchorMoved: Math.abs(anchorDelta) > 1,
      atBottomAfter: prevFromBottom + Math.max(0, el.scrollHeight - prevScrollHeightRef.current) <= AT_BOTTOM_PX,
      atBottomBefore: Math.abs(prevFromBottom) <= AT_BOTTOM_PX,
      openPhase: openHoldRef.current.active,
    });
    recordScrollTrace("reconcile", { src: source, grew, ad: Math.round(anchorDelta), act: action, sh: el.scrollHeight, ch: el.clientHeight, st: Math.round(el.scrollTop) });
    // The send ease is an explicit navigation operation, with its own target
    // measured each frame. Resize callbacks may measure but cannot supersede it.
    if (!anchorEaseCancelRef.current) {
      applyReconcileAction(action, { el, anchorDelta, prevFromBottom, prependGapRef, anchorRef, contentElRef, writeTop, setUnseen });
      if (anchor && live !== null) anchor.top = live;
      else anchorRef.current = anchorChild(el, contentElRef.current);
    } else if (prepend) {
      prependGapRef.current = null; // Navigation owns this growth; do not replay it later.
    }
    measure(el);
  }, [writeTop, setUnseen, measure]);

  const scrollerRef = useCallback((el: HTMLDivElement | null) => {
    const prev = scrollerElRef.current;
    if (prev) prev.removeEventListener("scroll", handleScroll);
    if (observersRef.current.scroller) observersRef.current.scroller.disconnect();
    scrollerElRef.current = el;
    if (el) {
      prevScrollHeightRef.current = el.scrollHeight;
      prevClientWidthRef.current = el.clientWidth;
      prevClientHeightRef.current = el.clientHeight;
      prevFromBottomRef.current = currentBottomTop(el, liveContentElRef.current) - el.scrollTop;
        el.addEventListener("scroll", handleScroll, { passive: true });
      const ro = new ResizeObserver(() => reconcile("scroller"));
      ro.observe(el);
      observersRef.current.scroller = ro;
    }
  }, [handleScroll, reconcile]);

  const contentRef = useCallback((el: HTMLDivElement | null) => {
    contentElRef.current = el;
    observeResize({ refs: observersRef, key: "content", el, onResize: () => reconcile("content") });
  }, [reconcile]);

  const liveContentRef = useCallback((el: HTMLDivElement | null) => {
    liveContentElRef.current = el;
    observeResize({ refs: observersRef, key: "live", el, onResize: () => reconcile("content") });
  }, [reconcile]);

  useEffect(() => scrollCleanup({
    observers: observersRef.current, timers: [anchorTimerRef, prependTimerRef],
    hold: openHoldRef.current, ease: anchorEaseCancelRef,
  }), []);

  return {
    scrollerRef, contentRef, liveContentRef, atBottom, hasUnseenContent, scrollToBottom,
    anchorToTop, captureForPrepend, openThread, settleOpen,
  };
}
