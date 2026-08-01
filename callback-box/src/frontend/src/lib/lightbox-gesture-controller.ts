/**
 * Gesture orchestrator for the lightbox: owns the mode machine, turns raw
 * pointer events into reducer events, and executes the reducer's actions
 * against a {@link LightboxRenderTarget} (which owns the transform, the
 * dismiss/swipe offsets, and the rAF springs). All decision logic is pure and
 * lives in `lightbox-gesture-reducer.ts`, `lightbox-gesture-math.ts`, and
 * `lightbox-transform.ts`; where the fingers are lives in
 * `lightbox-pointer-tracker.ts`. This class is the imperative glue the hook
 * drives.
 *
 * Points are container-centered before the reducer sees them, so a `toggleZoom`
 * anchor is directly usable as a transform anchor.
 */

import { isAtFit, type Point } from "./lightbox-gesture-math.js";
import {
  initialGestureState,
  reduceGesture,
  type GestureAction,
  type GestureEvent,
  type GestureState,
} from "./lightbox-gesture-reducer.js";
import { LightboxPointerTracker } from "./lightbox-pointer-tracker.js";
import { LightboxRenderTarget, type LightboxElements } from "./lightbox-render-target.js";
import { computePan, computePinch, type PanBase, type PinchBase } from "./lightbox-transform.js";

export class LightboxGestureController {
  private readonly els: LightboxElements;
  private readonly render: LightboxRenderTarget;
  private readonly onClose: () => void;
  private readonly onNavigate: (step: -1 | 1) => void;
  private readonly canSwipe: () => boolean;

  private gesture: GestureState = initialGestureState;
  private readonly pointers: LightboxPointerTracker;
  private panBase: PanBase | null = null;
  private pinchBase: PinchBase | null = null;
  private dismissBaseY = 0;
  private dismissPointerStartY = 0;
  private swipeBaseX = 0;
  private swipePointerStartX = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor({
    elements,
    onClose,
    onNavigate,
    canSwipe,
  }: {
    elements: LightboxElements;
    onClose: () => void;
    onNavigate: (step: -1 | 1) => void;
    canSwipe: () => boolean;
  }) {
    this.els = elements;
    this.render = new LightboxRenderTarget(elements);
    this.pointers = new LightboxPointerTracker(elements.wrapper);
    this.onClose = onClose;
    this.onNavigate = onNavigate;
    this.canSwipe = canSwipe;
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
    this.pointers.dropAll();
    this.gesture = initialGestureState;
    this.panBase = null;
    this.pinchBase = null;
    this.render.reset();
  }

  private dispatch(event: GestureEvent): GestureAction[] {
    const outcome = reduceGesture(this.gesture, event);
    this.gesture = outcome.state;
    for (const action of outcome.actions) this.runAction(action);
    this.settleStrayOffsets(outcome.actions);
    return outcome.actions;
  }

  /**
   * Invariant: outside a dismiss or swipe (and outside `pending`, where a
   * frozen offset is deliberately adoptable, and `settling`, where a spring
   * already owns it), the figure carries neither offset. An interrupted
   * snap-back whose gesture then went elsewhere (pinch from pending, a swipe
   * promoted out) would otherwise leave the figure stuck part-way off —
   * faded for a dismiss, or slid off-screen for a swipe.
   */
  private settleStrayOffsets(actions: GestureAction[]): void {
    const { mode } = this.gesture;
    if (mode !== "idle" && mode !== "panning" && mode !== "pinching") return;
    if (actions.some((a) => a.type === "close")) return;
    const springdone = () => this.dispatch({ type: "springdone" });
    if (this.render.getDismissY() !== 0 && !this.render.isDismissSettling()) {
      this.render.springDismiss({ velocity: 0, onDone: springdone });
    }
    if (this.render.getSwipeX() !== 0 && !this.render.isSwipeSettling()) {
      this.render.springSwipe({ to: 0, velocity: 0, onDone: springdone });
    }
  }

  private releaseVelocity(): Point {
    return this.pointers.releaseVelocity();
  }

  private runAction(action: GestureAction): void {
    switch (action.type) {
      case "capturePointer":
        this.pointers.capture(action.pointerId);
        return;
      case "releasePointer":
        this.pointers.drop(action.pointerId);
        return;
      case "cancelSpring":
        this.render.cancelSprings();
        return;
      case "beginDismiss": {
        const p = this.pointers.latest(this.pointers.pinned());
        this.dismissBaseY = this.render.getDismissY();
        this.dismissPointerStartY = p ? p.point.y : 0;
        return;
      }
      case "beginSwipe": {
        const p = this.pointers.latest(this.pointers.pinned());
        this.swipeBaseX = this.render.getSwipeX();
        this.swipePointerStartX = p ? p.point.x : 0;
        return;
      }
      case "beginPan":
        this.render.clearTransition();
        this.panBase = { transform: this.render.getTransform(), pointerStart: this.pointers.pinnedPoint() };
        return;
      case "beginPinch": {
        this.render.clearTransition();
        const [a, b] = action.pointerIds;
        const pa = this.pointers.latest(a);
        const pb = this.pointers.latest(b);
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
        this.panBase = { transform: this.render.getTransform(), pointerStart: this.pointers.pointOf(action.pointerId) };
        return;
      case "settleDismiss":
        this.render.springDismiss({
          velocity: this.releaseVelocity().y,
          onDone: () => this.dispatch({ type: "springdone" }),
        });
        return;
      case "settleSwipe":
        this.render.springSwipe({
          to: 0,
          velocity: this.releaseVelocity().x,
          onDone: () => this.dispatch({ type: "springdone" }),
        });
        return;
      case "commitSwipe": {
        // Fly the figure out the way the finger went (step +1 = next = the
        // image leaves to the LEFT) and only then change image: at that point
        // the incoming peer already sits dead centre, so the React swap that
        // follows exchanges identical pixels rather than flashing.
        const { step } = action;
        this.render.springSwipe({
          to: -step * this.render.getViewportWidth(),
          velocity: this.releaseVelocity().x,
          onDone: () => {
            this.onNavigate(step);
            this.dispatch({ type: "springdone" });
          },
        });
        return;
      }
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

  private applyActiveFrame(): void {
    switch (this.gesture.mode) {
      case "panning":
        if (this.panBase) {
          this.render.setTransform(
            computePan({ base: this.panBase, pointer: this.pointers.pinnedPoint(), frame: this.render.getFrame() }),
          );
        }
        return;
      case "pinching": {
        if (!this.pinchBase || !this.gesture.pinchIds) return;
        const [a, b] = this.gesture.pinchIds;
        const pa = this.pointers.latest(a);
        const pb = this.pointers.latest(b);
        if (pa && pb) {
          this.render.setTransform(computePinch({ base: this.pinchBase, pointers: [pa.point, pb.point] }));
        }
        return;
      }
      case "dismissing": {
        const p = this.pointers.latest(this.pointers.pinned());
        if (p) this.render.setDismissY(this.dismissBaseY + (p.point.y - this.dismissPointerStartY));
        return;
      }
      case "swiping": {
        const p = this.pointers.latest(this.pointers.pinned());
        if (p) this.render.setSwipeX(this.swipeBaseX + (p.point.x - this.swipePointerStartX));
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
    this.pointers.start(e.pointerId, { point, time: e.timeStamp });
    this.dispatch({ type: "pointerdown", pointerId: e.pointerId, point, time: e.timeStamp });
    // Map ownership follows reducer acceptance: a pointer the reducer chose
    // not to track (e.g. a third finger during a pinch) must not linger in the
    // map, or pinnedPointer() later baselines gestures on a dead touch.
    if (!(e.pointerId in this.gesture.pointers)) this.pointers.drop(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const point = this.render.toCentered(e.clientX, e.clientY);
    this.pointers.push(e.pointerId, { point, time: e.timeStamp });
    if (this.gesture.mode === "pending") {
      this.dispatch({
        type: "pointermove",
        pointerId: e.pointerId,
        point,
        time: e.timeStamp,
        atFit: isAtFit(this.render.getTransform().scale),
        canSwipe: this.canSwipe(),
      });
    }
    this.applyActiveFrame();
    const { mode } = this.gesture;
    if (mode !== "idle" && mode !== "pending" && e.cancelable) e.preventDefault();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const point = this.render.toCentered(e.clientX, e.clientY);
    // Fold the release position in BEFORE deciding: with coalesced events the
    // last big delta can arrive only on pointerup, and it must count toward
    // velocity and the dismiss displacement.
    this.pointers.push(e.pointerId, { point, time: e.timeStamp });
    this.applyActiveFrame();
    this.dispatch({
      type: "pointerup",
      pointerId: e.pointerId,
      point,
      time: e.timeStamp,
      velocity: this.pointers.velocityOf(e.pointerId),
      dismissOffset: this.render.getDismissY(),
      swipeOffset: this.render.getSwipeX(),
      viewportWidth: this.render.getViewportWidth(),
      viewportHeight: this.render.getViewportHeight(),
    });
    // Safety net alongside the reducer's releasePointer action: no pointerup
    // path may leave its pointer in the map.
    if (!(e.pointerId in this.gesture.pointers)) this.pointers.drop(e.pointerId);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.dispatch({ type: "pointercancel", pointerId: e.pointerId, time: e.timeStamp });
    if (!(e.pointerId in this.gesture.pointers)) this.pointers.drop(e.pointerId);
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
