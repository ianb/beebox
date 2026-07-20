/**
 * Gesture orchestrator for the lightbox: owns the live pointer map and the mode
 * machine, turns raw pointer events into reducer events, and executes the
 * reducer's actions against a {@link LightboxRenderTarget} (which owns the
 * transform, dismiss offset, and rAF springs). All decision logic is pure and
 * lives in `lightbox-gesture-reducer.ts`, `lightbox-gesture-math.ts`, and
 * `lightbox-transform.ts`; this class is the imperative glue the hook drives.
 *
 * Points are container-centered before the reducer sees them, so a `toggleZoom`
 * anchor is directly usable as a transform anchor.
 */

import {
  estimateVelocity,
  isAtFit,
  type Point,
  type PointerSample,
} from "./lightbox-gesture-math.js";
import {
  initialGestureState,
  reduceGesture,
  type GestureAction,
  type GestureEvent,
  type GestureState,
} from "./lightbox-gesture-reducer.js";
import { LightboxRenderTarget, type LightboxElements } from "./lightbox-render-target.js";
import { computePan, computePinch, type PanBase, type PinchBase } from "./lightbox-transform.js";

const VELOCITY_SAMPLE_LIMIT = 8;
/** Max |velocity| carried into a spring (px/s) — ~3 screen-heights/second. */
const MAX_SPRING_VELOCITY_PX_PER_S = 3000;

export class LightboxGestureController {
  private readonly els: LightboxElements;
  private readonly render: LightboxRenderTarget;
  private readonly onClose: () => void;

  private gesture: GestureState = initialGestureState;
  private readonly pointers = new Map<number, PointerSample[]>();
  private panBase: PanBase | null = null;
  private pinchBase: PinchBase | null = null;
  private dismissBaseY = 0;
  private dismissPointerStartY = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor({ elements, onClose }: { elements: LightboxElements; onClose: () => void }) {
    this.els = elements;
    this.render = new LightboxRenderTarget(elements);
    this.onClose = onClose;
  }

  attach(): () => void {
    const { wrapper, root, img } = this.els;
    this.resizeObserver = new ResizeObserver(() => this.render.measure());
    this.resizeObserver.observe(wrapper);
    img.addEventListener("load", this.onMeasure);
    window.visualViewport?.addEventListener("resize", this.onMeasure);
    wrapper.addEventListener("pointerdown", this.onPointerDown);
    wrapper.addEventListener("pointermove", this.onPointerMove, { passive: false });
    wrapper.addEventListener("pointerup", this.onPointerUp);
    wrapper.addEventListener("pointercancel", this.onPointerCancel);
    wrapper.addEventListener("lostpointercapture", this.onPointerCancel);
    root.addEventListener("click", this.onClickCapture, { capture: true });
    this.render.measure();
    return () => this.detach();
  }

  private detach(): void {
    const { wrapper, root, img } = this.els;
    this.render.cancelSprings();
    this.resizeObserver?.disconnect();
    img.removeEventListener("load", this.onMeasure);
    window.visualViewport?.removeEventListener("resize", this.onMeasure);
    wrapper.removeEventListener("pointerdown", this.onPointerDown);
    wrapper.removeEventListener("pointermove", this.onPointerMove);
    wrapper.removeEventListener("pointerup", this.onPointerUp);
    wrapper.removeEventListener("pointercancel", this.onPointerCancel);
    wrapper.removeEventListener("lostpointercapture", this.onPointerCancel);
    root.removeEventListener("click", this.onClickCapture, { capture: true });
  }

  /** Reset contract: a src swap reuses the component; wipe all gesture state. */
  reset(): void {
    this.pointers.clear();
    this.gesture = initialGestureState;
    this.panBase = null;
    this.pinchBase = null;
    this.render.reset();
  }

  private latest(id: number): PointerSample | undefined {
    const samples = this.pointers.get(id);
    return samples?.[samples.length - 1];
  }

  private pinnedPointer(): number {
    return [...this.pointers.keys()][0] ?? -1;
  }

  private pushSample(id: number, sample: PointerSample): void {
    const samples = this.pointers.get(id);
    if (!samples) return;
    samples.push(sample);
    if (samples.length > VELOCITY_SAMPLE_LIMIT) samples.shift();
  }

  private dispatch(event: GestureEvent): GestureAction[] {
    const outcome = reduceGesture(this.gesture, event);
    this.gesture = outcome.state;
    for (const action of outcome.actions) this.runAction(action);
    this.settleStrayDismiss(outcome.actions);
    return outcome.actions;
  }

  /**
   * Invariant: outside a dismiss (and outside `pending`, where a frozen offset
   * is deliberately adoptable, and `settling`, where a spring already owns it),
   * the figure carries no dismiss offset. An interrupted dismiss snap-back
   * whose gesture then went elsewhere (horizontal release, pinch from pending)
   * would otherwise leave the figure stuck part-way off and faded.
   */
  private settleStrayDismiss(actions: GestureAction[]): void {
    const { mode } = this.gesture;
    if (mode !== "idle" && mode !== "panning" && mode !== "pinching") return;
    if (actions.some((a) => a.type === "close")) return;
    if (this.render.getDismissY() === 0 || this.render.isDismissSettling()) return;
    this.render.springDismiss({ velocity: 0, onDone: () => this.dispatch({ type: "springdone" }) });
  }

  private releaseVelocity(): Point {
    const samples = this.pointers.get(this.pinnedPointer()) ?? [];
    const perMs = estimateVelocity(samples);
    // Clamp the carried spring velocity: jittery samples (near-zero dt) can
    // estimate absurd speeds, and an unbounded kick sends the spring on a
    // wild excursion before it decays.
    const cap = MAX_SPRING_VELOCITY_PX_PER_S;
    return {
      x: Math.max(-cap, Math.min(cap, perMs.x * 1000)),
      y: Math.max(-cap, Math.min(cap, perMs.y * 1000)),
    };
  }

  private runAction(action: GestureAction): void {
    switch (action.type) {
      case "capturePointer":
        try {
          this.els.wrapper.setPointerCapture(action.pointerId);
        } catch (_e) {
          /* ignore: capture can throw for a departed pointer; uncaptured tracking still works */
        }
        return;
      case "releasePointer":
        this.pointers.delete(action.pointerId);
        try {
          this.els.wrapper.releasePointerCapture(action.pointerId);
        } catch (_e) {
          /* ignore: releasing an already-lost pointer is harmless */
        }
        return;
      case "cancelSpring":
        this.render.cancelSprings();
        return;
      case "beginDismiss": {
        const p = this.latest(this.pinnedPointer());
        this.dismissBaseY = this.render.getDismissY();
        this.dismissPointerStartY = p ? p.point.y : 0;
        return;
      }
      case "beginPan":
        this.render.clearTransition();
        this.panBase = { transform: this.render.getTransform(), pointerStart: this.pinnedPoint() };
        return;
      case "beginPinch": {
        this.render.clearTransition();
        const [a, b] = action.pointerIds;
        const pa = this.latest(a);
        const pb = this.latest(b);
        if (pa && pb) {
          this.pinchBase = {
            distance: Math.hypot(pa.point.x - pb.point.x, pa.point.y - pb.point.y),
            midpoint: { x: (pa.point.x + pb.point.x) / 2, y: (pa.point.y + pb.point.y) / 2 },
            transform: this.render.getTransform(),
          };
        }
        return;
      }
      case "demotePinchToPan":
        this.panBase = { transform: this.render.getTransform(), pointerStart: this.pointOf(action.pointerId) };
        return;
      case "settleDismiss":
        this.render.springDismiss({
          velocity: this.releaseVelocity().y,
          onDone: () => this.dispatch({ type: "springdone" }),
        });
        return;
      case "settlePan":
        this.render.springSettle({
          velocity: this.releaseVelocity(),
          onDone: () => this.dispatch({ type: "springdone" }),
        });
        return;
      case "settleToFit":
        this.render.springSettle({
          velocity: { x: 0, y: 0 },
          onDone: () => this.dispatch({ type: "springdone" }),
        });
        return;
      case "close":
        this.onClose();
        return;
      case "toggleZoom":
        this.render.toggleZoom(action.anchor);
        return;
      case "suppressClick":
        /* consumed in onClickCapture; nothing imperative to do here */
        return;
    }
  }

  private pinnedPoint(): Point {
    return this.pointOf(this.pinnedPointer());
  }

  private pointOf(id: number): Point {
    return this.latest(id)?.point ?? { x: 0, y: 0 };
  }

  private applyActiveFrame(): void {
    switch (this.gesture.mode) {
      case "panning":
        if (this.panBase) {
          this.render.setTransform(
            computePan({ base: this.panBase, pointer: this.pinnedPoint(), frame: this.render.getFrame() }),
          );
        }
        return;
      case "pinching": {
        if (!this.pinchBase || !this.gesture.pinchIds) return;
        const [a, b] = this.gesture.pinchIds;
        const pa = this.latest(a);
        const pb = this.latest(b);
        if (pa && pb) {
          this.render.setTransform(computePinch({ base: this.pinchBase, pointers: [pa.point, pb.point] }));
        }
        return;
      }
      case "dismissing": {
        const p = this.latest(this.pinnedPointer());
        if (p) this.render.setDismissY(this.dismissBaseY + (p.point.y - this.dismissPointerStartY));
        return;
      }
      case "idle":
      case "pending":
      case "settling":
        return;
    }
  }

  private onMeasure = (): void => this.render.measure();

  private onPointerDown = (e: PointerEvent): void => {
    // A grab during the double-tap CSS transition must take over from the
    // visual (interpolated) transform, not the already-set target.
    this.render.adoptInFlightZoom();
    if (this.gesture.mode === "idle" || this.gesture.mode === "settling") {
      // Cancel ALL springs here, not just on the reducer's settling-mode
      // cancelSpring action: the stray-dismiss invariant spring runs while
      // mode is idle, and left alive it would fight the new gesture's writes
      // every frame. Cancelling freezes the current values for adoption.
      this.render.cancelSprings();
      this.render.captureCenter();
    }
    const point = this.render.toCentered(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, [{ point, time: e.timeStamp }]);
    this.dispatch({ type: "pointerdown", pointerId: e.pointerId, point, time: e.timeStamp });
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const point = this.render.toCentered(e.clientX, e.clientY);
    this.pushSample(e.pointerId, { point, time: e.timeStamp });
    if (this.gesture.mode === "pending") {
      this.dispatch({
        type: "pointermove",
        pointerId: e.pointerId,
        point,
        time: e.timeStamp,
        atFit: isAtFit(this.render.getTransform().scale),
      });
    }
    this.applyActiveFrame();
    const { mode } = this.gesture;
    if (mode !== "idle" && mode !== "pending" && e.cancelable) e.preventDefault();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const point = this.render.toCentered(e.clientX, e.clientY);
    const velocity = estimateVelocity(this.pointers.get(e.pointerId) ?? []);
    this.dispatch({
      type: "pointerup",
      pointerId: e.pointerId,
      point,
      time: e.timeStamp,
      velocityY: velocity.y,
      displacementY: this.render.getDismissY(),
      viewportHeight: this.render.getViewportHeight(),
    });
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.dispatch({ type: "pointercancel", pointerId: e.pointerId, time: e.timeStamp });
  };

  private onClickCapture = (e: MouseEvent): void => {
    const actions = this.dispatch({ type: "click", detail: e.detail, time: e.timeStamp });
    // Only eat the click when the reducer actually consumed the suppression
    // window (not when it merely expired), and only for clicks on the gesture
    // surface — pointer capture retargets a drag's trailing click to the
    // wrapper, so clicks on the controls/arrows are never suppressed.
    const onSurface = e.target instanceof Node && this.els.wrapper.contains(e.target);
    if (onSurface && actions.some((a) => a.type === "suppressClick")) {
      e.stopPropagation();
      e.preventDefault();
    }
  };
}
