/**
 * Where an anchored layer (a menu panel, a popover, a floating button) goes,
 * as a pure function of the anchor's box, the layer's size and the visible
 * viewport. `components/ui/AnchoredLayer.tsx` measures and calls it.
 *
 * Vertical: the layer goes on the preferred side when that side has room for
 * `min(content height, 12rem)`; otherwise it goes on the side with more room.
 * Its `maxHeight` is the room on the chosen side. 8rem is a preference, not a
 * floor: when neither side has `min(content height, 8rem)`, the layer goes to
 * the top of the visible viewport with the whole viewport height, and scrolls.
 * Containment always wins: the layer never extends outside the viewport, and
 * `maxHeight` is never negative.
 *
 * Horizontal: the layer's edge is aligned to the anchor per `align`; when the
 * layer would cross the viewport edge on that side and fits on the other, it
 * is aligned the other way; then the box is clamped inside the viewport.
 *
 * A point anchor is a zero-size box, so a point near the bottom-right corner
 * gets a layer that opens up and to the left.
 */

export type AnchorAlign = "left" | "right";
export type AnchorVertical = "below" | "above";

/** A box in viewport (client) coordinates. */
export interface AnchorBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The visible part of the layout viewport (shrinks under the iOS keyboard). */
export interface VisibleViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlacementInput {
  anchor: AnchorBox;
  /** The layer's natural size: its full content height, unclamped. */
  size: { width: number; height: number };
  viewport: VisibleViewport;
  align: AnchorAlign;
  vertical: AnchorVertical;
  /** Space between the anchor and the layer, in px. */
  gap: number;
  /** Space kept between the layer and the viewport edge, in px. */
  margin: number;
  /** The root font size in px, for the 8rem and 12rem thresholds. */
  rem: number;
}

export interface Placement {
  /** Which rule placed it: one side of the anchor, or the top of the viewport. */
  side: AnchorVertical | "viewport-top";
  top: number;
  left: number;
  maxHeight: number;
  maxWidth: number;
}

const PREFERRED_HEIGHT_REM = 12;
const USEFUL_HEIGHT_REM = 8;

function verticalPlacement(input: PlacementInput): Pick<Placement, "side" | "top" | "maxHeight"> {
  const { anchor, size, viewport, vertical, gap, margin, rem } = input;
  const floor = viewport.top + margin;
  const ceiling = viewport.top + viewport.height - margin;
  // An anchor outside the visible viewport (under the iOS keyboard) is
  // clamped to it first, so the layer never leaves the viewport.
  const belowEdge = Math.max(floor, Math.min(anchor.bottom + gap, ceiling));
  const aboveEdge = Math.min(ceiling, Math.max(anchor.top - gap, floor));
  const room = { below: ceiling - belowEdge, above: aboveEdge - floor };
  const other: AnchorVertical = vertical === "below" ? "above" : "below";
  const wanted = Math.min(size.height, PREFERRED_HEIGHT_REM * rem);
  const side = room[vertical] >= wanted || room[vertical] >= room[other] ? vertical : other;
  if (room[side] < Math.min(size.height, USEFUL_HEIGHT_REM * rem)) {
    return { side: "viewport-top", top: floor, maxHeight: Math.max(0, ceiling - floor) };
  }
  const maxHeight = Math.max(0, room[side]);
  const height = Math.min(size.height, maxHeight);
  const top = side === "below" ? belowEdge : aboveEdge - height;
  return { side, top, maxHeight };
}

function horizontalPlacement(input: PlacementInput): Pick<Placement, "left" | "maxWidth"> {
  const { anchor, size, viewport, align, margin } = input;
  const maxWidth = Math.max(0, viewport.width - margin * 2);
  const width = Math.min(size.width, maxWidth);
  const min = viewport.left + margin;
  const max = viewport.left + viewport.width - margin - width;
  const aligned = (edge: AnchorAlign): number => (edge === "right" ? anchor.right - width : anchor.left);
  const fits = (left: number): boolean => left >= min && left <= max;
  const preferred = aligned(align);
  const flipped = aligned(align === "right" ? "left" : "right");
  const left = fits(preferred) || !fits(flipped) ? preferred : flipped;
  return { left: Math.max(min, Math.min(left, max)), maxWidth };
}

export function placeAnchored(input: PlacementInput): Placement {
  return { ...verticalPlacement(input), ...horizontalPlacement(input) };
}
