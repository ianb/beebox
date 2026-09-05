/**
 * The send-anchor ease — the one user-initiated scroll write in the chat
 * scroll model that animates. Split from chat-scroll.ts for its line budget.
 */

import type { MutableRefObject } from "react";
import { recordScrollTrace } from "../../lib/scroll-diagnostics";

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
  onCancel: () => void;
  cancelRef: MutableRefObject<(() => void) | null>;
}): void {
  const { el, target, onDone, onCancel, cancelRef } = opts;
  recordScrollTrace("write", { top: -1, b: "anchor-ease" });
  const deadline = performance.now() + 400;
  let lastWritten = el.scrollTop;
  let frame = 0;
  const stop = (finish: boolean): void => {
    recordScrollTrace("ease-stop", { finish, top: el.scrollTop });
    cancelAnimationFrame(frame);
    if (cancelRef.current === cancel) cancelRef.current = null;
    if (finish) onDone();
    else onCancel();
  };
  const cancel = (): void => { stop(false); };
  cancelRef.current?.();
  cancelRef.current = cancel;
  const step = (): void => {
    if (!target.isConnected || Math.abs(el.scrollTop - Math.min(lastWritten, Math.max(0, el.scrollHeight - el.clientHeight))) > 4) {
      recordScrollTrace("ease-interrupted", { expected: lastWritten, actual: el.scrollTop });
      stop(false); return;
    }
    const remaining = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
    if (Math.abs(remaining) < 1 || performance.now() > deadline) {
      const from = el.scrollTop;
      el.scrollTop += remaining;
      recordScrollTrace("ease-write", { from, want: from + remaining, to: el.scrollTop, max: el.scrollHeight - el.clientHeight, final: true });
      stop(true);
      return;
    }
    const from = el.scrollTop;
    el.scrollTop += remaining * 0.35;
    recordScrollTrace("ease-write", { from, want: from + remaining * 0.35, to: el.scrollTop, max: el.scrollHeight - el.clientHeight, final: false });
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
  onCancel: () => void;
  cancelRef: MutableRefObject<(() => void) | null>;
}): void {
  const { el, target, writeInstant, onDone, onCancel, cancelRef } = opts;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const offset = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
    writeInstant(el.scrollTop + offset);
    onDone();
    return;
  }
  animateAnchorToTop({ el, target, onDone, onCancel, cancelRef });
}
