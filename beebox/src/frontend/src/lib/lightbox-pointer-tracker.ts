/**
 * The lightbox's live pointer registry: which pointers are down, a bounded
 * trail of samples per pointer for velocity, and ownership of the browser's
 * pointer *capture* for each. Split out of
 * `lightbox-gesture-controller.ts` — the controller decides what a gesture
 * means, this decides where the fingers are.
 *
 * Capture and the map are moved together on purpose: every path that forgets
 * a pointer must also release its capture, and keeping the two in one place
 * is what makes `drop` idempotent and safe to call from the reducer's
 * `releasePointer` action, the pointerup safety net, and `reset` alike.
 */

import { estimateVelocity, type Point, type PointerSample } from "./lightbox-gesture-math.js";

const VELOCITY_SAMPLE_LIMIT = 8;
/** Max |velocity| carried into a spring (px/s) — ~3 screen-heights/second. */
const MAX_SPRING_VELOCITY_PX_PER_S = 3000;

export class LightboxPointerTracker {
  private readonly surface: HTMLElement;
  private readonly trails = new Map<number, PointerSample[]>();

  constructor(surface: HTMLElement) {
    this.surface = surface;
  }

  has(pointerId: number): boolean {
    return this.trails.has(pointerId);
  }

  ids(): number[] {
    return [...this.trails.keys()];
  }

  /** Begin tracking a pointer, seeding its trail with the down sample. */
  start(pointerId: number, sample: PointerSample): void {
    this.trails.set(pointerId, [sample]);
  }

  /** Append a sample, keeping only the most recent {@link VELOCITY_SAMPLE_LIMIT}. */
  push(pointerId: number, sample: PointerSample): void {
    const trail = this.trails.get(pointerId);
    if (!trail) return;
    trail.push(sample);
    if (trail.length > VELOCITY_SAMPLE_LIMIT) trail.shift();
  }

  /** Forget a pointer AND release its capture. Idempotent. */
  drop(pointerId: number): void {
    this.trails.delete(pointerId);
    try {
      this.surface.releasePointerCapture(pointerId);
    } catch (_e) {
      /* ignore: releasing an already-lost pointer is harmless */
    }
  }

  dropAll(): void {
    for (const id of this.ids()) this.drop(id);
  }

  capture(pointerId: number): void {
    try {
      this.surface.setPointerCapture(pointerId);
    } catch (_e) {
      /* ignore: capture can throw for a departed pointer; uncaptured tracking still works */
    }
  }

  latest(pointerId: number): PointerSample | undefined {
    const trail = this.trails.get(pointerId);
    return trail?.[trail.length - 1];
  }

  /** The pointer a one-finger gesture is baselined on: the first still down. */
  pinned(): number {
    return this.ids()[0] ?? -1;
  }

  pointOf(pointerId: number): Point {
    return this.latest(pointerId)?.point ?? { x: 0, y: 0 };
  }

  pinnedPoint(): Point {
    return this.pointOf(this.pinned());
  }

  /**
   * Release velocity (px/s per axis) for the pinned pointer, clamped: jittery
   * samples (near-zero dt) can estimate absurd speeds, and an unbounded kick
   * sends the spring on a wild excursion before it decays.
   */
  releaseVelocity(): Point {
    const perMs = estimateVelocity(this.trails.get(this.pinned()) ?? []);
    const cap = MAX_SPRING_VELOCITY_PX_PER_S;
    const clamp = (v: number): number => Math.max(-cap, Math.min(cap, v * 1000));
    return { x: clamp(perMs.x), y: clamp(perMs.y) };
  }

  /** Velocity for a specific pointer's own trail (unclamped, px/ms). */
  velocityOf(pointerId: number): Point {
    return estimateVelocity(this.trails.get(pointerId) ?? []);
  }
}
