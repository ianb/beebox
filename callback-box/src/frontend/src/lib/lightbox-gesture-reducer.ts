/**
 * Pure mode machine for the lightbox gesture surface — no DOM imports.
 * `reduceGesture(state, event) → { state, actions }`. The controller feeds it
 * semantic events (points already container-centered; velocity/displacement
 * measured) and executes the returned {@link GestureAction}s. Every transition
 * lives here so the machine is doctestable without a DOM. Modes: `idle`,
 * `pending` (down, unclassified), `dismissing`, `swiping`, `panning`,
 * `pinching`, `settling`. See `test/frontend/lightbox-gesture-reducer.doctest.md`.
 *
 * The shapes the transitions move between live in `lightbox-gesture-types.ts`
 * and are re-exported here, so consumers have one import site for the machine.
 */

import {
  CLICK_SUPPRESS_MS,
  classifyAxis,
  isDoubleTap,
  isTap,
  movedEnough,
  shouldDismiss,
  swipeStep,
  type Point,
  type PointerSample,
} from "./lightbox-gesture-math.js";
import { initialGestureState, type GestureAction, type GestureEvent, type GestureResult, type GestureState, type TrackedPointer } from "./lightbox-gesture-types.js";

export {
  initialGestureState,
  type GestureAction,
  type GestureEvent,
  type GestureMode,
  type GestureResult,
  type GestureState,
} from "./lightbox-gesture-types.js";

function trackedIds(pointers: Record<number, TrackedPointer>): number[] {
  return Object.keys(pointers).map(Number);
}

function withoutPointer(
  pointers: Record<number, TrackedPointer>,
  pointerId: number,
): Record<number, TrackedPointer> {
  const next: Record<number, TrackedPointer> = {};
  for (const id of trackedIds(pointers)) {
    const pointer = pointers[id];
    if (id !== pointerId && pointer) next[id] = pointer;
  }
  return next;
}

function result(state: GestureState, actions: GestureAction[]): GestureResult {
  return { state, actions };
}

function suppressWindow(time: number): number {
  return time + CLICK_SUPPRESS_MS;
}

function onPointerDown(state: GestureState, event: Extract<GestureEvent, { type: "pointerdown" }>): GestureResult {
  const { pointerId, point, time } = event;
  const sample: PointerSample = { point, time };
  const tracked: TrackedPointer = { start: sample, current: sample };

  switch (state.mode) {
    case "idle":
    case "settling": {
      const actions: GestureAction[] = [];
      if (state.mode === "settling") actions.push({ type: "cancelSpring" });
      actions.push({ type: "capturePointer", pointerId });
      return result(
        { ...state, mode: "pending", pointers: { [pointerId]: tracked } },
        actions,
      );
    }
    case "pending":
    case "panning":
    case "dismissing":
    case "swiping": {
      // Second pointer promotes to a pinch. A dismiss or swipe in flight
      // springs its (independent) figure offset back while the pinch takes
      // over the wrapper.
      const existing = trackedIds(state.pointers);
      const first = existing[0];
      if (first === undefined) {
        // Defensive: no first pointer to pair with — start fresh as pending.
        return result(
          { ...state, mode: "pending", pointers: { [pointerId]: tracked } },
          [{ type: "capturePointer", pointerId }],
        );
      }
      const pinchIds: readonly [number, number] = [first, pointerId];
      const actions: GestureAction[] = [];
      if (state.mode === "dismissing") actions.push({ type: "settleDismiss" });
      if (state.mode === "swiping") actions.push({ type: "settleSwipe" });
      actions.push({ type: "capturePointer", pointerId });
      actions.push({ type: "beginPinch", pointerIds: pinchIds });
      return result(
        {
          ...state,
          mode: "pinching",
          pointers: { ...state.pointers, [pointerId]: tracked },
          pinchIds,
          // A pinch is not a tap; without this, tap → quick pinch → tap could
          // pair across the pinch as a double-tap.
          lastTap: null,
        },
        actions,
      );
    }
    case "pinching":
      // Third pointer: ignored — not tracked, pinch continues on the first two.
      return result(state, []);
  }
}

function onPointerMove(state: GestureState, event: Extract<GestureEvent, { type: "pointermove" }>): GestureResult {
  const tracked = state.pointers[event.pointerId];
  if (!tracked) return result(state, []);
  const updated: TrackedPointer = { start: tracked.start, current: { point: event.point, time: event.time } };
  const pointers = { ...state.pointers, [event.pointerId]: updated };

  if (state.mode !== "pending") {
    // Continuous pan/pinch/dismiss tracking is the hook's job; just record.
    return result({ ...state, pointers }, []);
  }

  const dx = event.point.x - tracked.start.point.x;
  const dy = event.point.y - tracked.start.point.y;
  if (!movedEnough(dx, dy)) return result({ ...state, pointers }, []);

  // Any classified drag voids tap history — tap → short drag → tap must not
  // pair across the drag as a double-tap.
  if (!event.atFit) {
    return result({ ...state, mode: "panning", pointers, lastTap: null }, [{ type: "beginPan" }]);
  }
  if (classifyAxis(dx, dy) === "vertical") {
    return result({ ...state, mode: "dismissing", pointers, lastTap: null }, [{ type: "beginDismiss" }]);
  }
  // Horizontal at fit is prev/next navigation — but only with somewhere to go.
  if (event.canSwipe) {
    return result({ ...state, mode: "swiping", pointers, lastTap: null }, [{ type: "beginSwipe" }]);
  }
  // A lone image has no neighbour to swipe to: release, no action.
  return result(
    { ...state, mode: "idle", pointers: withoutPointer(state.pointers, event.pointerId), lastTap: null },
    [{ type: "releasePointer", pointerId: event.pointerId }],
  );
}

interface ReleaseInput {
  pointerId: number;
  time: number;
  snapBackOnly: boolean;
  velocity: Point;
  dismissOffset: number;
  swipeOffset: number;
  viewportWidth: number;
  viewportHeight: number;
  point: Point | null;
}

function onTrackedRelease(state: GestureState, input: ReleaseInput): GestureResult {
  const { pointerId, time, snapBackOnly, velocity, dismissOffset, swipeOffset } = input;
  const { viewportWidth, viewportHeight, point } = input;
  const pointers = withoutPointer(state.pointers, pointerId);

  switch (state.mode) {
    case "pending": {
      const tracked = state.pointers[pointerId];
      const base: GestureState = { ...state, mode: "idle", pointers, pinchIds: null };
      const release: GestureAction[] = [{ type: "releasePointer", pointerId }];
      if (snapBackOnly || !tracked || !point) return result({ ...base, lastTap: null }, release);
      // The release position counts toward tap-vs-drag: a coalesced gesture
      // whose big delta arrives only at pointerup must not read as a tap.
      const dxUp = point.x - tracked.start.point.x;
      const dyUp = point.y - tracked.start.point.y;
      if (!isTap(dxUp, dyUp)) return result({ ...base, lastTap: null }, release);
      const sample: PointerSample = { point, time };
      if (state.lastTap && isDoubleTap({ prev: state.lastTap, current: sample })) {
        return result(
          { ...base, lastTap: null, suppressClickUntil: suppressWindow(time) },
          [{ type: "toggleZoom", anchor: point }, { type: "suppressClick" }, ...release],
        );
      }
      return result({ ...base, lastTap: sample }, release);
    }
    case "dismissing": {
      if (
        !snapBackOnly &&
        shouldDismiss({ velocityY: velocity.y, displacementY: dismissOffset, viewportHeight })
      ) {
        return result({ ...state, mode: "idle", pointers, pinchIds: null }, [{ type: "close" }, { type: "releasePointer", pointerId }]);
      }
      return result(
        { ...state, mode: "settling", pointers, suppressClickUntil: suppressWindow(time) },
        [{ type: "settleDismiss" }, { type: "releasePointer", pointerId }],
      );
    }
    case "swiping": {
      // A cancel has no velocity to trust, so it always springs back.
      const step = snapBackOnly
        ? 0
        : swipeStep({ velocityX: velocity.x, displacementX: swipeOffset, viewportWidth });
      return result(
        { ...state, mode: "settling", pointers, suppressClickUntil: suppressWindow(time) },
        [
          step === 0 ? { type: "settleSwipe" } : { type: "commitSwipe", step },
          { type: "releasePointer", pointerId },
        ],
      );
    }
    case "panning":
      return result(
        { ...state, mode: "settling", pointers, suppressClickUntil: suppressWindow(time) },
        [{ type: "settlePan" }, { type: "releasePointer", pointerId }],
      );
    case "pinching": {
      if (!state.pinchIds || !state.pinchIds.includes(pointerId)) {
        // Untracked third pointer released — no-op.
        return result(state, []);
      }
      const remaining = trackedIds(pointers);
      const other = remaining[0];
      if (other !== undefined) {
        return result(
          { ...state, mode: "panning", pointers, pinchIds: null },
          [{ type: "demotePinchToPan", pointerId: other }, { type: "releasePointer", pointerId }],
        );
      }
      return result(
        { ...state, mode: "settling", pointers, pinchIds: null, suppressClickUntil: suppressWindow(time) },
        [{ type: "settleToFit" }, { type: "releasePointer", pointerId }],
      );
    }
    case "idle":
    case "settling":
      return result({ ...state, pointers }, [{ type: "releasePointer", pointerId }]);
  }
}

function onClick(state: GestureState, event: Extract<GestureEvent, { type: "click" }>): GestureResult {
  if (
    state.suppressClickUntil !== null &&
    event.time <= state.suppressClickUntil &&
    event.detail > 0
  ) {
    return result({ ...state, suppressClickUntil: null }, [{ type: "suppressClick" }]);
  }
  // Expired or keyboard/AT activation (detail === 0): let it through, and clear
  // a stale window so it can't eat a genuinely later click.
  if (state.suppressClickUntil !== null && event.time > state.suppressClickUntil) {
    return result({ ...state, suppressClickUntil: null }, []);
  }
  return result(state, []);
}

/** The pure gesture mode reducer. */
export function reduceGesture(state: GestureState, event: GestureEvent): GestureResult {
  switch (event.type) {
    case "pointerdown":
      return onPointerDown(state, event);
    case "pointermove":
      return onPointerMove(state, event);
    case "pointerup":
      return onTrackedRelease(state, {
        pointerId: event.pointerId,
        time: event.time,
        snapBackOnly: false,
        velocity: event.velocity,
        dismissOffset: event.dismissOffset,
        swipeOffset: event.swipeOffset,
        viewportWidth: event.viewportWidth,
        viewportHeight: event.viewportHeight,
        point: event.point,
      });
    case "pointercancel":
      return onTrackedRelease(state, {
        pointerId: event.pointerId,
        time: event.time,
        snapBackOnly: true,
        velocity: { x: 0, y: 0 },
        dismissOffset: 0,
        swipeOffset: 0,
        viewportWidth: 0,
        viewportHeight: 0,
        point: null,
      });
    case "springdone":
      return state.mode === "settling"
        ? result({ ...state, mode: "idle", pinchIds: null }, [])
        : result(state, []);
    case "click":
      return onClick(state, event);
    case "reset":
      return result(initialGestureState, [{ type: "cancelSpring" }]);
  }
}
