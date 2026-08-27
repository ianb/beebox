/**
 * The send-anchor ease — the one user-initiated scroll write in the chat
 * scroll model that animates. Split from chat-scroll.ts for its line budget.
 */

import type { MutableRefObject } from "react";
import type { Anchor } from "./chat-scroll.js";

/** The anchor's live offset from the scroller's top edge, or null if it is gone. */
export function anchorOffset(anchor: Anchor | null, scroller: HTMLDivElement): number | null {
  if (!anchor || !anchor.el.isConnected) return null;
  return anchor.el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

/**
 * Quick eased scroll that brings `target`'s top to the scroller's top.
 *
 * Not `behavior: "smooth"`: the browser picks the duration (floaty for long
 * distances) and cannot be re-aimed while content below is still growing. This
 * converges on the element each frame — move 35% of what remains — so growth
 * during the ease is absorbed, and it settles in roughly 200ms. Stops when the
 * remainder is sub-pixel, when it times out, or when someone else moved the
 * scroller (another write, or the reader grabbing it) — detected as scrollTop
 * deviating from the last position this loop wrote.
 */
function animateAnchorToTop(opts: {
  el: HTMLDivElement;
  target: Element;
  onDone: () => void;
  cancelRef: MutableRefObject<(() => void) | null>;
}): void {
  const { el, target, onDone, cancelRef } = opts;
  const deadline = performance.now() + 400;
  let lastWritten = el.scrollTop;
  let frame = 0;
  const stop = (finish: boolean): void => {
    cancelAnimationFrame(frame);
    if (cancelRef.current === cancel) cancelRef.current = null;
    if (finish) onDone();
  };
  const cancel = (): void => { stop(false); };
  cancelRef.current?.();
  cancelRef.current = cancel;
  const step = (): void => {
    if (Math.abs(el.scrollTop - lastWritten) > 4) { stop(false); return; }
    const remaining = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
    if (Math.abs(remaining) < 1 || performance.now() > deadline) {
      el.scrollTop += remaining;
      stop(true);
      return;
    }
    el.scrollTop += remaining * 0.35;
    lastWritten = el.scrollTop;
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

/**
 * Bring `target`'s top to the scroller's top: quick ease, or an instant snap
 * under `prefers-reduced-motion`. `writeInstant` is the hook's traced write;
 * `onDone` re-anchors and re-measures once the position is final.
 */
export function easeOrSnapToTop(opts: {
  el: HTMLDivElement;
  target: Element;
  writeInstant: (top: number) => void;
  onDone: () => void;
  cancelRef: MutableRefObject<(() => void) | null>;
}): void {
  const { el, target, writeInstant, onDone, cancelRef } = opts;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const offset = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
    writeInstant(el.scrollTop + offset);
    onDone();
    return;
  }
  animateAnchorToTop({ el, target, onDone, cancelRef });
}
