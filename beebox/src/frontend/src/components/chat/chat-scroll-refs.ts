import type { MutableRefObject } from "react";

export function movedUp(el: HTMLDivElement, prevTop: MutableRefObject<number>): boolean {
  const up = el.scrollTop < prevTop.current - 1;
  prevTop.current = el.scrollTop;
  return up;
}

export function clearTimer(ref: MutableRefObject<number | null>): void {
  if (ref.current !== null) window.clearTimeout(ref.current);
  ref.current = null;
}

export function armPrependSnapshot(el: HTMLDivElement, refs: {
  gap: MutableRefObject<number | null>;
  timer: MutableRefObject<number | null>;
}): void {
  refs.gap.current = el.scrollHeight - el.scrollTop;
  clearTimer(refs.timer);
  refs.timer.current = window.setTimeout(() => {
    refs.gap.current = null;
    refs.timer.current = null;
  }, 10000);
}
