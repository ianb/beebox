/**
 * Scroll activity for companion-pane cards: the topmost visible heading of the card's
 * content, logged once scrolling has settled and only when it changed. Raw
 * positions are never reported, and content without headings reports nothing.
 */

import { useCallback, useEffect, useRef } from "react";
import { realTimers, type ActivityTimers } from "./queue";
import { useActivityLogger } from "./scope";

/** Scrolling counts as settled after this long without movement. */
export const SETTLE_MS = 1_000;
const HEADING_CAP = 120;

/** A heading's vertical extent, in the same coordinates as the viewport. */
export interface HeadingBox { text: string; top: number; bottom: number }

/** The first heading (document order) with any part inside the viewport; null when none shows. */
export function topmostVisibleHeading(headings: readonly HeadingBox[], viewport: { top: number; bottom: number }): string | null {
  for (const heading of headings) {
    const text = heading.text.replace(/\s+/g, " ").trim();
    if (text === "" || heading.bottom <= viewport.top || heading.top >= viewport.bottom) continue;
    return text.length > HEADING_CAP ? `${text.slice(0, HEADING_CAP - 1)}…` : text;
  }
  return null;
}

/** Read `container`'s h1-h4 and viewport from the DOM. */
export function topmostHeadingIn(container: HTMLElement): string | null {
  const view = container.getBoundingClientRect();
  const boxes = [...container.querySelectorAll("h1, h2, h3, h4")].map((node) => {
    const rect = node.getBoundingClientRect();
    return { text: node.textContent, top: rect.top, bottom: rect.bottom };
  });
  return topmostVisibleHeading(boxes, view);
}

export interface HeadingScrollTracker {
  /** Note a scroll; `read` finds the heading when scrolling settles. */
  scrolled: (read: () => string | null) => void;
  dispose: () => void;
}

/** Calls `onHeading` when scrolling has settled on a heading other than the last one reported. */
export function createHeadingScrollTracker(opts: { timers: ActivityTimers; onHeading: (heading: string) => void }): HeadingScrollTracker {
  let cancel: (() => void) | null = null;
  let last: string | null = null;
  return {
    scrolled(read) {
      cancel?.();
      cancel = opts.timers.after(SETTLE_MS, () => {
        cancel = null;
        const heading = read();
        if (heading === null || heading === last) return;
        last = heading;
        opts.onHeading(heading);
      });
    },
    dispose() { cancel?.(); cancel = null; },
  };
}

/** Returns the scroll handler body for a companion-pane card's scroller: logs `scrolled` with the settled topmost heading. */
export function useHeadingScrollLog(card: string): (container: HTMLElement) => void {
  const log = useActivityLogger();
  const latest = useRef({ log, card });
  const tracker = useRef<HeadingScrollTracker | null>(null);
  useEffect(() => { latest.current = { log, card }; }, [log, card]);
  useEffect(() => {
    const created = createHeadingScrollTracker({
      timers: realTimers,
      onHeading: (heading) => { latest.current.log({ card: latest.current.card, kind: "scrolled", detail: heading }); },
    });
    tracker.current = created;
    return () => { created.dispose(); tracker.current = null; };
  }, []);
  return useCallback((container) => { tracker.current?.scrolled(() => topmostHeadingIn(container)); }, []);
}
