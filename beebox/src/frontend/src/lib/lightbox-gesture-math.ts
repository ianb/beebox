/**
 * Pure gesture math for the image lightbox — no DOM imports.
 *
 * The lightbox tracks a single {@link Transform} (`scale`, `x`, `y`) applied to
 * a wrapper as `translate3d(x, y, 0) scale(scale)` with `transform-origin:
 * center`. All math here works in **container-centered coordinates**: a
 * pointer's `clientX/Y` is converted via {@link toContainerCentered} against
 * the wrapper's untransformed layout-box center (captured at gesture start)
 * before any use. In that space the keep-a-point-fixed identity
 * `t' = p − (p − t)·(s'/s)` holds for both double-tap and pinch.
 *
 * Every function is pure and doctested in
 * `test/frontend/lightbox-gesture-math.doctest.md`.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

/** A pointer position stamped with its event time (ms). */
export interface PointerSample {
  point: Point;
  time: number;
}

/** Minimum pointer travel (px) before a `pending` gesture is classified. */
const MOVE_THRESHOLD_PX = 10;
/** Max delay (ms) between two taps for a double-tap. */
const DOUBLE_TAP_MS = 300;
/** Max distance (px) between two taps for a double-tap. */
const DOUBLE_TAP_DISTANCE_PX = 30;
/** "At fit scale" epsilon — after float math, never compare `scale === 1`. */
const FIT_EPSILON = 0.01;
/** Flick speed (px/ms) at or above which a dismiss drag closes the lightbox. */
const DISMISS_VELOCITY_PX_PER_MS = 0.5;
/** Fraction of viewport height a dismiss drag must cross to close on release. */
const DISMISS_DISPLACEMENT_RATIO = 0.3;
/** Fraction of viewport height over which a dismiss drag fades fully. */
const DISMISS_FADE_RATIO = 0.4;
/** Flick speed (px/ms) at or above which a swipe changes image on release. */
const SWIPE_VELOCITY_PX_PER_MS = 0.4;
/** Fraction of viewport width a swipe must cross to navigate on release. */
const SWIPE_DISPLACEMENT_RATIO = 0.25;
/**
 * Gap (px) between adjacent images in the swipe strip. The peers are parked
 * `viewportWidth + SWIPE_GUTTER_PX` away and a committed swipe springs exactly
 * that far, so the incoming image lands dead centre — the two MUST agree, or
 * the new image settles off-centre and jumps when the index swap resets the
 * transform.
 */
export const SWIPE_GUTTER_PX = 32;
/** Target scale a double-tap zooms to (and back from). */
export const ZOOM_SCALE = 2.5;
/** Hard ceiling on scale (pinch and double-tap). */
const MAX_SCALE = 4;
/** Live-pinch floor (below fit) before the epsilon snap-back on release. */
const MIN_PINCH_SCALE = 0.85;
/** Window (ms) within which a completed drag's trailing click is suppressed. */
export const CLICK_SUPPRESS_MS = 500;
/** Samples used for last-samples velocity (not whole-gesture average). */
const VELOCITY_SAMPLE_COUNT = 5;

/** Convert a client-space point to container-centered coordinates. */
export function toContainerCentered(clientPoint: Point, center: Point): Point {
  return { x: clientPoint.x - center.x, y: clientPoint.y - center.y };
}

/** Euclidean distance between two points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Midpoint of two points. */
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * New transform when scale changes to `nextScale` anchored at `anchor`
 * (container-centered), keeping the anchor point visually fixed:
 * `t' = p − (p − t)·(s'/s)`.
 */
export function scaleAboutPoint(
  transform: Transform,
  { anchor, nextScale }: { anchor: Point; nextScale: number },
): Transform {
  const ratio = nextScale / transform.scale;
  return {
    scale: nextScale,
    x: anchor.x - (anchor.x - transform.x) * ratio,
    y: anchor.y - (anchor.y - transform.y) * ratio,
  };
}

/** Clamp `scale` into the live-gesture band `[MIN_PINCH_SCALE, MAX_SCALE]`. */
export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_PINCH_SCALE, scale));
}

/**
 * Half the maximum in-bounds pan offset for one axis:
 * `max(0, (fitSize·scale − containerSize) / 2)`. Zero when the scaled image is
 * no larger than the container (nothing to pan into).
 */
export function panBound({
  fitSize,
  scale,
  containerSize,
}: {
  fitSize: number;
  scale: number;
  containerSize: number;
}): number {
  return Math.max(0, (fitSize * scale - containerSize) / 2);
}

/** Clamp `value` to `[-limit, limit]` (hard bound, used for settle targets). */
export function clampAbs(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

/**
 * iOS rubber-band resistance curve applied to overshoot magnitude `x` against
 * dimension `d`: `f(x) = (1 − 1/(x/d + 1))·d`. Monotonic, asymptotic to `d`.
 */
export function rubberBand(x: number, d: number): number {
  if (d <= 0) return 0;
  return (1 - 1 / (x / d + 1)) * d;
}

/**
 * A live pan value damped at the bound: in-bounds passes through, overshoot is
 * compressed by {@link rubberBand} against `dimension` (the container size on
 * that axis) so the finger can drag past the edge with resistance.
 */
export function rubberBandPan(
  value: number,
  { bound, dimension }: { bound: number; dimension: number },
): number {
  if (value > bound) return bound + rubberBand(value - bound, dimension);
  if (value < -bound) return -bound - rubberBand(-value - bound, dimension);
  return value;
}

/** Axis with the larger travel; ties resolve to vertical (dismiss-friendly). */
export function classifyAxis(dx: number, dy: number): "horizontal" | "vertical" {
  return Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
}

/** Whether pointer travel has crossed the classification threshold. */
export function movedEnough(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= MOVE_THRESHOLD_PX;
}

/** Whether a pointerup with this travel counts as a tap (no classification). */
export function isTap(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) < MOVE_THRESHOLD_PX;
}

/** Whether `current` follows `prev` closely enough in time and space to pair. */
export function isDoubleTap({
  prev,
  current,
}: {
  prev: PointerSample;
  current: PointerSample;
}): boolean {
  return (
    current.time - prev.time <= DOUBLE_TAP_MS &&
    distance(prev.point, current.point) <= DOUBLE_TAP_DISTANCE_PX
  );
}

/**
 * Per-axis velocity (px/ms) from the last {@link VELOCITY_SAMPLE_COUNT}
 * samples — the recent slope, not a whole-gesture average, so a flick that
 * follows a slow drag still reads as fast. Returns zero when under two samples
 * or the span has no elapsed time.
 */
export function estimateVelocity(samples: readonly PointerSample[]): Point {
  if (samples.length < 2) return { x: 0, y: 0 };
  const recent = samples.slice(-VELOCITY_SAMPLE_COUNT);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (!first || !last) return { x: 0, y: 0 };
  const dt = last.time - first.time;
  if (dt <= 0) return { x: 0, y: 0 };
  return {
    x: (last.point.x - first.point.x) / dt,
    y: (last.point.y - first.point.y) / dt,
  };
}

/**
 * Dismiss decision on release: a fast enough flick OR a far enough drag closes;
 * anything less springs back. A flick only counts when it moves AWAY from rest
 * (same sign as the displacement) — dragging down then flicking sharply back
 * toward center is a cancel, not a close.
 */
export function shouldDismiss({
  velocityY,
  displacementY,
  viewportHeight,
}: {
  velocityY: number;
  displacementY: number;
  viewportHeight: number;
}): boolean {
  const movingAway = displacementY === 0 || Math.sign(velocityY) === Math.sign(displacementY);
  return (
    (movingAway && Math.abs(velocityY) >= DISMISS_VELOCITY_PX_PER_MS) ||
    Math.abs(displacementY) >= DISMISS_DISPLACEMENT_RATIO * viewportHeight
  );
}

/**
 * Where a released horizontal swipe lands, as a step to add to the current
 * image index: `-1` previous, `+1` next, `0` spring back. Mirrors
 * {@link shouldDismiss} — a fast enough flick OR a far enough drag commits,
 * and the flick only counts when it moves AWAY from rest, so dragging right
 * then flicking sharply back toward centre is a cancel, not a navigation.
 *
 * Sign: dragging RIGHT pulls the previous image in from the left, so a
 * positive displacement is a step of `-1`. A commit-speed flick with no
 * displacement at all has no direction to commit to, and stays.
 */
export function swipeStep({
  velocityX,
  displacementX,
  viewportWidth,
}: {
  velocityX: number;
  displacementX: number;
  viewportWidth: number;
}): -1 | 0 | 1 {
  if (displacementX === 0) return 0;
  const movingAway = Math.sign(velocityX) === Math.sign(displacementX);
  const commits =
    (movingAway && Math.abs(velocityX) >= SWIPE_VELOCITY_PX_PER_MS) ||
    Math.abs(displacementX) >= SWIPE_DISPLACEMENT_RATIO * viewportWidth;
  if (!commits) return 0;
  return displacementX > 0 ? -1 : 1;
}

/** Dismiss fade progress in `[0, 1]` from the current vertical displacement. */
export function dismissProgress(displacementY: number, viewportHeight: number): number {
  if (viewportHeight <= 0) return 0;
  return Math.min(1, Math.abs(displacementY) / (viewportHeight * DISMISS_FADE_RATIO));
}

/** Whether a scale is within the fit epsilon (treat as fully fit). */
export function isAtFit(scale: number): boolean {
  return scale < 1 + FIT_EPSILON;
}

/** Snap a near-fit transform to exact fit; otherwise return it unchanged. */
export function snapToFit(transform: Transform): Transform {
  return isAtFit(transform.scale) ? { scale: 1, x: 0, y: 0 } : transform;
}
