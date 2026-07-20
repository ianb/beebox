/**
 * Pure transform composition for the lightbox — how a live pan, live pinch, or
 * a settle target is derived from the gesture baselines and the measured
 * geometry. Built on the primitives in `lightbox-gesture-math.ts`; no DOM.
 * Doctested alongside the primitives.
 */

import {
  clampAbs,
  clampScale,
  distance,
  isAtFit,
  midpoint,
  panBound,
  rubberBandPan,
  scaleAboutPoint,
  type Point,
  type Transform,
} from "./lightbox-gesture-math.js";

export interface Size {
  width: number;
  height: number;
}

/**
 * The measured geometry pan bounds are computed against: `fit` is the image's
 * laid-out (fit) size, `container` the overlay viewport. Bounds use the
 * container — an image whose scaled size still fits the viewport on an axis
 * stays centered on that axis, and one that overflows pans until its edge
 * meets the viewport edge (not the smaller fit frame).
 */
export interface Frame {
  fit: Size;
  container: Size;
}

/** Baseline captured when a one-finger pan begins. */
export interface PanBase {
  transform: Transform;
  pointerStart: Point;
}

/** Baseline captured when a two-finger pinch begins. */
export interface PinchBase {
  distance: number;
  midpoint: Point;
  transform: Transform;
}

function axisBound(frame: Frame, { axis, scale }: { axis: "width" | "height"; scale: number }): number {
  return panBound({ fitSize: frame.fit[axis], scale, containerSize: frame.container[axis] });
}

/** Clamp a transform's translate to the in-bounds range for its scale. */
export function clampTransformToBounds(transform: Transform, frame: Frame): Transform {
  return {
    scale: transform.scale,
    x: clampAbs(transform.x, axisBound(frame, { axis: "width", scale: transform.scale })),
    y: clampAbs(transform.y, axisBound(frame, { axis: "height", scale: transform.scale })),
  };
}

/**
 * Where a released gesture springs to: exact fit when within the epsilon band,
 * otherwise the current scale with translate clamped back into bounds.
 */
export function settleTarget(transform: Transform, frame: Frame): Transform {
  return isAtFit(transform.scale) ? { scale: 1, x: 0, y: 0 } : clampTransformToBounds(transform, frame);
}

/**
 * Live one-finger pan: base translate plus the finger delta, with overshoot
 * past the bound compressed by the iOS rubber-band curve (springs back on
 * release).
 */
export function computePan({
  base,
  pointer,
  frame,
}: {
  base: PanBase;
  pointer: Point;
  frame: Frame;
}): Transform {
  const { scale } = base.transform;
  const nextX = base.transform.x + (pointer.x - base.pointerStart.x);
  const nextY = base.transform.y + (pointer.y - base.pointerStart.y);
  return {
    scale,
    x: rubberBandPan(nextX, { bound: axisBound(frame, { axis: "width", scale }), dimension: frame.container.width }),
    y: rubberBandPan(nextY, { bound: axisBound(frame, { axis: "height", scale }), dimension: frame.container.height }),
  };
}

/**
 * Live two-finger pinch: scale about the baseline midpoint by the distance
 * ratio (clamped to the live band), then translate by the midpoint drift so the
 * gesture also pans.
 */
export function computePinch({
  base,
  pointers,
}: {
  base: PinchBase;
  pointers: readonly [Point, Point];
}): Transform {
  const [pa, pb] = pointers;
  const ratio = distance(pa, pb) / base.distance;
  const scaled = scaleAboutPoint(base.transform, {
    anchor: base.midpoint,
    nextScale: clampScale(base.transform.scale * ratio),
  });
  const mid = midpoint(pa, pb);
  return {
    scale: scaled.scale,
    x: scaled.x + (mid.x - base.midpoint.x),
    y: scaled.y + (mid.y - base.midpoint.y),
  };
}
