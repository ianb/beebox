/** CSS owns viewport resizing synchronously; React never mirrors its height. */
const REDUCTION = "--chat-send-spacer-reduction";
export const SEND_SPACER_MIN_HEIGHT = `max(0px, calc(100cqh - var(${REDUCTION}, 0px)))`;

const positions = new WeakMap<HTMLDivElement, number>();

/** Capture only settled geometry, never the half-mutated DOM in a null ref. */
export function captureSpacerPosition(scroller: HTMLDivElement): void {
  positions.set(scroller, scroller.scrollTop);
}

/** Preserve the legal scroll range when finalization replaces or reorders
 * the item carrying the spacer. React invokes this ref before paint. */
export function transferSendSpacer(scroller: HTMLDivElement, opts: {
  live: HTMLDivElement | null;
  writeTop: (top: number, behavior: ScrollBehavior) => void;
}): void {
  const { live, writeTop } = opts;
  const previousTop = positions.get(scroller);
  const wrapper = live?.parentElement;
  if (!live || !wrapper || previousTop === undefined) return;
  const origin = scroller.scrollTop - scroller.getBoundingClientRect().top;
  const wrapperTop = wrapper.getBoundingClientRect().top + origin;
  const naturalBottom = live.getBoundingClientRect().bottom + origin;
  // If the content being read vanished, preserve remaining content rather
  // than a viewport entirely inside empty spacer. Partly visible text stays put.
  const target = previousTop >= naturalBottom
    ? Math.max(wrapperTop, naturalBottom - scroller.clientHeight) : previousTop;
  const shortage = target - (scroller.scrollHeight - scroller.clientHeight);
  if (shortage <= 0) {
    if (target !== previousTop) writeTop(target, "instant");
    return;
  }
  const minimum = Number.parseFloat(getComputedStyle(wrapper).minHeight);
  const reduction = Number.parseFloat(scroller.style.getPropertyValue(REDUCTION)) || 0;
  // The natural content may already exceed its minimum. Cover that difference
  // as well as the shortage so the restored minimum really extends the range.
  const restore = Math.max(0, wrapper.clientHeight - minimum) + Math.ceil(shortage) + 1;
  scroller.style.setProperty(REDUCTION, `${reduction - restore}px`);
  writeTop(target, "instant");
}

const pendingTrims = new WeakMap<HTMLDivElement, number>();

export function resetSendSpacer(scroller: HTMLDivElement): void {
  const pending = pendingTrims.get(scroller);
  if (pending !== undefined) cancelAnimationFrame(pending);
  pendingTrims.delete(scroller);
  scroller.style.removeProperty(REDUCTION);
}

/** Remove only room below the viewport. Never write scrollTop or shrink the
 * legal range past the current position. Keep the reduction on the scroller
 * so streamed/finalized nodes and later appended groups inherit it. */
export function trimSendSpacer(scroller: HTMLDivElement, live: HTMLDivElement | null): void {
  if (!live || pendingTrims.has(scroller)) return;
  // Changing an observed ancestor inside ResizeObserver leaves undelivered
  // notifications. A frame later is safe: removal is entirely offscreen.
  pendingTrims.set(scroller, requestAnimationFrame(() => {
    pendingTrims.delete(scroller);
    if (scroller.isConnected && scroller.contains(live) && live.hasAttribute("data-chat-live-turn-content")) trimNow(scroller, live);
  }));
}

function trimNow(scroller: HTMLDivElement, live: HTMLDivElement): void {
  const wrapper = live.parentElement;
  if (!wrapper) return;
  const blank = Math.max(0, wrapper.clientHeight - live.offsetHeight);
  const minimum = Number.parseFloat(getComputedStyle(wrapper).minHeight);
  const spare = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  // Leave a pixel for scrollHeight rounding; fractional removal can clamp.
  const remove = Math.min(blank, minimum, Math.max(0, Math.floor(spare) - 1));
  if (remove < 1) return;
  const previous = Number.parseFloat(scroller.style.getPropertyValue(REDUCTION)) || 0;
  scroller.style.setProperty(REDUCTION, `${previous + remove}px`);
}
