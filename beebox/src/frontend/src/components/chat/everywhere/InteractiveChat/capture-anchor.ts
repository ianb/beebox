/**
 * What the chat list anchors while it waits for a capture to arrive.
 *
 * Done in capture anchors like a send: the capture's message goes to the top
 * of the viewport. A typed send's message is in the list when its signal
 * fires; a capture's is not. The overlay closes first, the pending capture
 * bubble appears a render later, and the box delivers the message itself
 * seconds after that (20s to 50s in a 2026-10-16 trace). So Done starts a
 * wait that anchors the new bubble when it appears, then the new user message
 * when it arrives, which ends the wait.
 *
 * "New" is by identity against what the list held at Done, not by count:
 * loading older history adds user messages above, and must not look like the
 * arrival, and a bubble still on screen from an earlier capture is not this
 * one. Only a capture message counts as the arrival; a message typed in
 * another tab meanwhile does not end the wait. A reader who scrolls the chat
 * themselves after the bubble is anchored is left where they are. That is
 * read from their input (wheel, touch, scroll keys, a scrollbar drag), not from the scroll
 * position: the position also moves when the bubble leaves and the blank
 * space under it passes to the message above, and the scroller's "at bottom"
 * measures above that blank space, so neither tells a reader's scroll apart.
 * Pure, so the decisions are doctested; `use-capture-anchor.ts` does the DOM part.
 */


/** The list as the wait sees it. */
export interface CaptureAnchorView {
  /** The newest user message that is a delivered capture. */
  newestCapture: string | null;
  /** The capture bubbles' ids, in render order. */
  bubbleIds: readonly string[];
  /** The reader has scrolled the chat themselves since the bubble was anchored. */
  readerScrolled: boolean;
}

export interface CaptureAnchorWait {
  /** The newest capture message at Done; any other newest one is the arrival. */
  capture: string | null;
  /** Bubbles already on screen at Done. */
  bubbles: ReadonlySet<string>;
  bubbleAnchored: boolean;
}

/** `bubble` carries the new bubble's index among the rendered bubbles. */
export type CaptureAnchorStep = { anchor: "none" } | { anchor: "user" } | { anchor: "bubble"; index: number };

/** Begin waiting, given the list as it was when Done sealed. */
export function startCaptureWait(atDone: Pick<CaptureAnchorView, "newestCapture" | "bubbleIds">): CaptureAnchorWait {
  return { capture: atDone.newestCapture, bubbles: new Set(atDone.bubbleIds), bubbleAnchored: false };
}

/** Decide what to anchor for the list as it is now; `wait` is null once the wait is over. */
export function stepCaptureWait(wait: CaptureAnchorWait, now: CaptureAnchorView): { wait: CaptureAnchorWait | null; step: CaptureAnchorStep } {
  if (now.newestCapture !== null && now.newestCapture !== wait.capture) {
    // They moved off the bubble we put at the top: they chose to read elsewhere.
    if (wait.bubbleAnchored && now.readerScrolled) return { wait: null, step: { anchor: "none" } };
    return { wait: null, step: { anchor: "user" } };
  }
  if (wait.bubbleAnchored) return { wait, step: { anchor: "none" } };
  const index = now.bubbleIds.findIndex((id) => !wait.bubbles.has(id));
  if (index === -1) return { wait, step: { anchor: "none" } };
  return { wait: { ...wait, bubbleAnchored: true }, step: { anchor: "bubble", index } };
}
