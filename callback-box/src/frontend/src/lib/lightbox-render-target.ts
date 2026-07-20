/**
 * The DOM-writing half of the lightbox gesture layer: owns the current
 * transform, the dismiss offset, the measured frame (image fit size + overlay
 * viewport), the container center, and the rAF springs, and writes them
 * straight to the wrapper / figure / root elements. The controller
 * (`lightbox-gesture-controller.ts`) drives it; all numeric decisions stay in
 * the pure modules.
 *
 * Two independent spring slots: the transform spring (wrapper settle) and the
 * dismiss spring (figure offset). They animate different elements and must not
 * cancel each other — a pinch promoted out of a dismiss runs both at once.
 */

import {
  dismissProgress,
  isAtFit,
  scaleAboutPoint,
  snapToFit,
  toContainerCentered,
  ZOOM_SCALE,
  type Point,
  type Transform,
} from "./lightbox-gesture-math.js";
import { animateSpring, SPRING_OMEGA, type SpringHandle } from "./lightbox-spring.js";
import { clampTransformToBounds, settleTarget, type Frame } from "./lightbox-transform.js";

const BASE_BACKDROP_OPACITY = 0.7;
const ZOOM_TRANSITION_MS = 200;

export interface LightboxElements {
  root: HTMLElement;
  figure: HTMLElement;
  wrapper: HTMLElement;
  img: HTMLImageElement;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function springTiming(): Parameters<typeof animateSpring>[0]["timing"] {
  // Wrap raf/cancelRaf in arrows: passing requestAnimationFrame unbound and
  // calling it as `timing.raf(cb)` sets `this` to the timing object, which
  // throws "Illegal invocation" — synchronously, from the first spring frame.
  return {
    now: () => performance.now(),
    raf: (cb) => requestAnimationFrame(cb),
    cancelRaf: (h) => cancelAnimationFrame(h),
  };
}

export class LightboxRenderTarget {
  private readonly els: LightboxElements;
  private transform: Transform = { scale: 1, x: 0, y: 0 };
  private dismissY = 0;
  private frame: Frame = { fit: { width: 0, height: 0 }, container: { width: 0, height: 0 } };
  private containerCenter: Point = { x: 0, y: 0 };
  private transformSpring: SpringHandle | null = null;
  private dismissSpring: SpringHandle | null = null;
  /** The active settle's completion callback, kept so a mid-flight re-measure
   *  can restart the spring toward the new bounds with the same completion. */
  private settleOnDone: (() => void) | null = null;

  constructor(elements: LightboxElements) {
    this.els = elements;
  }

  getTransform(): Transform {
    return this.transform;
  }

  getDismissY(): number {
    return this.dismissY;
  }

  getFrame(): Frame {
    return this.frame;
  }

  getViewportHeight(): number {
    return this.frame.container.height;
  }

  isDismissSettling(): boolean {
    return this.dismissSpring !== null;
  }

  toCentered(clientX: number, clientY: number): Point {
    return toContainerCentered({ x: clientX, y: clientY }, this.containerCenter);
  }

  setTransform(transform: Transform): void {
    this.transform = transform;
    this.writeTransform();
  }

  setDismissY(dismissY: number): void {
    this.dismissY = dismissY;
    this.writeDismiss();
  }

  private writeTransform(): void {
    const { scale, x, y } = this.transform;
    this.els.wrapper.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  }

  private writeDismiss(): void {
    const progress = dismissProgress(this.dismissY, this.frame.container.height);
    this.els.figure.style.transform = `translateY(${this.dismissY}px)`;
    this.els.figure.style.opacity = String(1 - progress);
    this.els.root.style.backgroundColor = `rgba(0, 0, 0, ${BASE_BACKDROP_OPACITY * (1 - progress)})`;
  }

  restoreBackdrop(): void {
    this.dismissY = 0;
    this.els.figure.style.transform = "translateY(0px)";
    this.els.figure.style.opacity = "1";
    this.els.root.style.backgroundColor = "";
  }

  reset(): void {
    this.cancelSprings();
    this.transform = { scale: 1, x: 0, y: 0 };
    this.clearTransition();
    this.writeTransform();
    this.restoreBackdrop();
  }

  measure(): void {
    this.frame = {
      fit: { width: this.els.img.clientWidth, height: this.els.img.clientHeight },
      container: {
        width: this.els.root.clientWidth,
        height: window.visualViewport?.height ?? this.els.root.clientHeight,
      },
    };
    if (this.transformSpring && this.settleOnDone) {
      // A running settle spring holds a target computed against the OLD
      // bounds (iOS toolbar collapse, rotation); restart it toward the new
      // ones or it finishes out of bounds and overwrites the clamp below.
      this.springSettle({ velocity: { x: 0, y: 0 }, onDone: this.settleOnDone });
      return;
    }
    this.transform = clampTransformToBounds(this.transform, this.frame);
    this.writeTransform();
  }

  /** Capture the wrapper's untransformed layout center (client coords). */
  captureCenter(): void {
    const rect = this.els.wrapper.getBoundingClientRect();
    this.containerCenter = {
      x: rect.left + rect.width / 2 - this.transform.x,
      y: rect.top + rect.height / 2 - this.transform.y,
    };
  }

  clearTransition(): void {
    this.els.wrapper.style.transition = "";
  }

  /**
   * If a CSS zoom transition is in flight, adopt the browser's current
   * interpolated transform as ours and freeze it — a pointer grabbing the
   * image mid-toggle must take over from the visual value, not the target
   * (which `this.transform` already holds). Call before {@link captureCenter}.
   */
  adoptInFlightZoom(): void {
    if (this.els.wrapper.style.transition === "") return;
    const computed = getComputedStyle(this.els.wrapper).transform;
    if (computed !== "" && computed !== "none") {
      const matrix = new DOMMatrix(computed);
      this.transform = { scale: matrix.m11, x: matrix.m41, y: matrix.m42 };
    }
    this.clearTransition();
    this.writeTransform();
  }

  cancelSprings(): void {
    this.transformSpring?.cancel();
    this.transformSpring = null;
    this.settleOnDone = null;
    this.dismissSpring?.cancel();
    this.dismissSpring = null;
  }

  /** CSS-transition zoom toggle: fit ↔ ZOOM_SCALE anchored at `anchor`. */
  toggleZoom(anchor: Point): void {
    this.transformSpring?.cancel();
    this.transformSpring = null;
    this.transform = isAtFit(this.transform.scale)
      ? clampTransformToBounds(scaleAboutPoint(this.transform, { anchor, nextScale: ZOOM_SCALE }), this.frame)
      : { scale: 1, x: 0, y: 0 };
    this.els.wrapper.style.transition = prefersReducedMotion()
      ? "none"
      : `transform ${ZOOM_TRANSITION_MS}ms ease-out`;
    this.writeTransform();
  }

  /**
   * Spring the transform to its settle target (fit or clamped-in-bounds),
   * carrying the release velocity (px/s per axis) into the spring.
   */
  springSettle({ velocity, onDone }: { velocity: Point; onDone: () => void }): void {
    this.transformSpring?.cancel();
    this.settleOnDone = onDone;
    this.clearTransition();
    const from = this.transform;
    const target = settleTarget(from, this.frame);
    this.transformSpring = animateSpring({
      channels: [
        { from: from.x, to: target.x, velocity: velocity.x },
        { from: from.y, to: target.y, velocity: velocity.y },
        { from: from.scale, to: target.scale, velocity: 0 },
      ],
      omega: SPRING_OMEGA,
      reducedMotion: prefersReducedMotion(),
      timing: springTiming(),
      onFrame: ([x, y, scale]) => {
        this.transform = { scale: scale ?? target.scale, x: x ?? target.x, y: y ?? target.y };
        this.writeTransform();
      },
      onDone: () => {
        this.transform = snapToFit(this.transform);
        this.writeTransform();
        this.transformSpring = null;
        this.settleOnDone = null;
        onDone();
      },
    });
  }

  /** Spring the dismiss offset back to zero, carrying release velocity (px/s). */
  springDismiss({ velocity, onDone }: { velocity: number; onDone: () => void }): void {
    this.dismissSpring?.cancel();
    this.dismissSpring = animateSpring({
      channels: [{ from: this.dismissY, to: 0, velocity }],
      omega: SPRING_OMEGA,
      reducedMotion: prefersReducedMotion(),
      timing: springTiming(),
      onFrame: ([y]) => {
        this.dismissY = y ?? 0;
        this.writeDismiss();
      },
      onDone: () => {
        this.restoreBackdrop();
        this.dismissSpring = null;
        onDone();
      },
    });
  }
}
