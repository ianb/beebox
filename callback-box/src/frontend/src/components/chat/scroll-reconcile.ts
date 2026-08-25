/**
 * The pure decision behind the chat scroll controller's resize reconcile
 * (`chat-scroll.ts`). The controller writes `scrollTop` only in response to a
 * discrete user action (open a thread, send, press the button) plus geometric
 * compensations for changes the reader did not cause; this function is the
 * dispatcher for the compensations, extracted so the precedence between them
 * is unit-checkable without a DOM (the layout itself still needs the browser
 * procedure in docs/chat-scroll-testing.md).
 *
 * There is no follow-the-bottom branch and no "was that scroll the user's"
 * question: content growth below the reader never scrolls. What is left is
 * four measured facts and the order they win in.
 */

/** One resize-observer cycle, reduced to the facts the decision turns on. */
export interface ReconcileInputs {
  /** Which observer fired: the content element resized, or the scroller box did. */
  source: "content" | "scroller";
  /** The scroll content got taller than last reconcile (beyond the epsilon). */
  grew: boolean;
  /** A captured older-history prepend landed this cycle (content grew with a
   *  pending prepend snapshot) — the growth is above the viewport, not new. */
  prepend: boolean;
  /** A live, connected scroll anchor shifted on screen — existing content above
   *  the reader reflowed (a late-decoding image/embed/card), not new content. */
  anchorMoved: boolean;
  /** The view was within the at-bottom margin before this cycle's change. */
  atBottom: boolean;
  /** The thread is still in its bounded open phase: keep the bottom on every
   *  growth until the first history render has landed. */
  openPhase: boolean;
}

/** What the reconcile should do with this cycle. */
export type ReconcileAction =
  /** Hold the reader's position across the prepend, then re-anchor. */
  | "hold-prepend"
  /** Opening the thread — the bottom is where the reader starts. */
  | "open-bottom"
  /** The scroller box resized (keyboard, composer, banner) — preserve the
   *  distance from the bottom the reader had before it. */
  | "hold-from-bottom"
  /** Compensate the shifted anchor so the reading position stays put. */
  | "hold-anchor"
  /** Content arrived below a reader who is not at the bottom — light the badge. */
  | "flag-unseen"
  /** Nothing to do — in particular, growth below a reader at the bottom. */
  | "none";

/**
 * Decide the reconcile action from one cycle's facts. Order encodes precedence:
 * a prepend of older history is held first (a top-insertion is never "new"),
 * then the bounded open phase, then a scroller-box resize (a change in the
 * viewport, not the content), then an above-reader reflow; only a *content*
 * grow that is none of those, landing below a reader who is not at the bottom,
 * counts as unseen.
 */
export function decideReconcile(inputs: ReconcileInputs): ReconcileAction {
  if (inputs.prepend) return "hold-prepend";
  if (inputs.openPhase) return "open-bottom";
  if (inputs.source === "scroller") return "hold-from-bottom";
  if (inputs.anchorMoved) return "hold-anchor";
  if (inputs.grew && !inputs.atBottom) return "flag-unseen";
  return "none";
}
