/**
 * The pure decision behind the scroll controller's resize reconcile
 * (`InteractiveChat-scroll.ts`). Extracted so the branch that decides whether a
 * resize is *genuinely new content below the reader* — the signal that lights
 * the scroll-to-bottom "new messages" badge — is unit-checkable without a DOM
 * (layout behavior itself still needs the manual procedure in
 * docs/chat-scroll-testing.md).
 *
 * The load-bearing distinction: content prepended at the *top* (older history
 * loaded on scroll-up) grows the scroll content just like a bottom append does,
 * but must NOT flag unseen — the reader hasn't missed anything, they pulled in
 * old messages. A captured prepend is threaded in as `prepend`, and it wins over
 * every other branch so a top-insertion never reads as new-content-below.
 */

/** One resize-observer cycle, reduced to the facts the decision turns on. */
export interface ReconcileInputs {
  /** Which observer fired: the content element grew, or the scroller box resized. */
  source: "content" | "scroller";
  /** The scroll content got taller than last reconcile (beyond the epsilon). */
  grew: boolean;
  /** The view is currently following the bottom. */
  pinned: boolean;
  /** A captured older-history prepend landed this cycle (content grew with a
   *  pending prepend snapshot) — the growth is above the viewport, not new. */
  prepend: boolean;
  /** A live, connected scroll anchor shifted on screen — existing content above
   *  the reader reflowed (a late-decoding image/embed/card), not new content. */
  anchorMoved: boolean;
}

/** What the reconcile should do with this cycle. */
export type ReconcileAction =
  /** Hold the reader's position across the prepend, then re-anchor. */
  | "hold-prepend"
  /** Following the bottom — snap back to it. */
  | "follow-bottom"
  /** Compensate the shifted anchor so the reading position stays put. */
  | "hold-anchor"
  /** Genuinely new content arrived below a scrolled-up reader. */
  | "flag-unseen"
  /** Nothing to do. */
  | "none";

/**
 * Decide the reconcile action from one cycle's facts. Order encodes precedence:
 * a prepend of older history is held first (a top-insertion is never "new"),
 * then following the bottom, then compensating an above-reader reflow; only a
 * *content* grow that is none of those counts as unseen new content.
 */
export function decideReconcile(inputs: ReconcileInputs): ReconcileAction {
  if (inputs.prepend) return "hold-prepend";
  if (inputs.pinned) return "follow-bottom";
  if (inputs.anchorMoved) return "hold-anchor";
  if (inputs.source === "content" && inputs.grew) return "flag-unseen";
  return "none";
}
