/**
 * The geometry behind the pointer's ring — the pure half, so it can be
 * doctested under plain Node. The drawing lives in
 * `components/ui/ControlRing.tsx`, where appearance belongs (frontend.md).
 *
 * The ring is an overlay drawn *around* the target's border box, so it must not
 * cover the control it points at: it is inflated by {@link RING_PADDING} and
 * carries `pointer-events: none`. No mask, no popover, no modal layer.
 */

import type { ScanRect } from "./types.js";

/** How far outside the target's border box the ring sits, in CSS pixels. */
export const RING_PADDING = 4;

/** How long the ring stays up before it removes itself. */
export const RING_DURATION_MS = 2000;

/** The overlay's box, in viewport coordinates (`position: fixed`). */
export interface RingBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Inflate a target's border box by `padding` on every side. A degenerate rect —
 * a zero-height inline control, say — still yields a visible ring rather than
 * collapsing to nothing.
 */
export function ringBox(rect: ScanRect, padding: number): RingBox {
  return {
    top: rect.top - padding,
    left: rect.left - padding,
    width: Math.max(rect.width, 0) + padding * 2,
    height: Math.max(rect.height, 0) + padding * 2,
  };
}

/**
 * Whether the whole box is inside the viewport. Fully, not partly: a control
 * half off the bottom edge is one the user cannot properly see, which is exactly
 * the case `point` scrolls for.
 */
export function isRectInViewport(rect: ScanRect, viewport: { width: number; height: number }): boolean {
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.top + rect.height <= viewport.height &&
    rect.left + rect.width <= viewport.width
  );
}
