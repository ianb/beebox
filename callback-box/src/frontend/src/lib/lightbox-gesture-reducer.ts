/**
 * Pure mode machine for the lightbox gesture surface — no DOM imports.
 * `reduceGesture(state, event) → { state, actions }`. The controller feeds it
 * semantic events (points already container-centered; velocity/displacement
 * measured) and executes the returned {@link GestureAction}s. Every transition
 * lives here so the machine is doctestable without a DOM. Modes: `idle`,
 * `pending` (down, unclassified), `dismissing`, `panning`, `pinching`,
 * `settling`. See `test/frontend/lightbox-gesture-reducer.doctest.md`.
 */

import {
  CLICK_SUPPRESS_MS,
  classifyAxis,
  isDoubleTap,
  movedEnough,
  shouldDismiss,
  type Point,
  type PointerSample,
} from "./lightbox-gesture-math.js";

export type GestureMode = "idle" | "pending" | "dismissing" | "panning" | "pinching" | "settling";

interface TrackedPointer {
  start: PointerSample;
  current: PointerSample;
}

export interface GestureState {
  mode: GestureMode;
  pointers: Record<number, TrackedPointer>;
  pinchIds: readonly [number, number] | null;
  lastTap: PointerSample | null;
  /** Absolute time (ms) until which a trailing `detail > 0` click is eaten. */
  suppressClickUntil: number | null;
}

export type GestureEvent =
  | { type: "pointerdown"; pointerId: number; point: Point; time: number }
  | { type: "pointermove"; pointerId: number; point: Point; time: number; atFit: boolean }
  | { type: "pointerup"; pointerId: number; point: Point; time: number; velocityY: number; displacementY: number; viewportHeight: number }
  | { type: "pointercancel"; pointerId: number; time: number }
  | { type: "springdone" }
  | { type: "click"; detail: number; time: number }
  | { type: "reset" };

export type GestureAction =
  | { type: "capturePointer"; pointerId: number }
  | { type: "releasePointer"; pointerId: number }
  | { type: "cancelSpring" }
  | { type: "beginDismiss" }
  | { type: "beginPan" }
  | { type: "beginPinch"; pointerIds: readonly [number, number] }
  | { type: "demotePinchToPan"; pointerId: number }
  | { type: "settleDismiss" }
  | { type: "settlePan" }
  | { type: "settleToFit" }
  | { type: "close" }
  | { type: "toggleZoom"; anchor: Point }
  | { type: "suppressClick" };

export interface GestureResult {
  state: GestureState;
  actions: GestureAction[];
}

export const initialGestureState: GestureState = {
  mode: "idle",
  pointers: {},
  pinchIds: null,
  lastTap: null,
  suppressClickUntil: null,
};

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
    case "dismissing": {
      // Second pointer promotes to a pinch. A dismiss in flight springs its
      // (independent) figure offset back while the pinch takes over the wrapper.
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
      actions.push({ type: "capturePointer", pointerId });
      actions.push({ type: "beginPinch", pointerIds: pinchIds });
      return result(
        {
          ...state,
          mode: "pinching",
          pointers: { ...state.pointers, [pointerId]: tracked },
          pinchIds,
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

  if (!event.atFit) {
    return result({ ...state, mode: "panning", pointers }, [{ type: "beginPan" }]);
  }
  if (classifyAxis(dx, dy) === "vertical") {
    return result({ ...state, mode: "dismissing", pointers }, [{ type: "beginDismiss" }]);
  }
  // Horizontal at fit: reserved for future prev/next nav — release, no action.
  return result(
    { ...state, mode: "idle", pointers: withoutPointer(state.pointers, event.pointerId) },
    [{ type: "releasePointer", pointerId: event.pointerId }],
  );
}

interface ReleaseInput {
  pointerId: number;
  time: number;
  snapBackOnly: boolean;
  velocityY: number;
  displacementY: number;
  viewportHeight: number;
  point: Point | null;
}

function onTrackedRelease(state: GestureState, input: ReleaseInput): GestureResult {
  const { pointerId, time, snapBackOnly, velocityY, displacementY, viewportHeight, point } = input;
  const pointers = withoutPointer(state.pointers, pointerId);

  switch (state.mode) {
    case "pending": {
      const tracked = state.pointers[pointerId];
      const base: GestureState = { ...state, mode: "idle", pointers, pinchIds: null };
      const release: GestureAction[] = [{ type: "releasePointer", pointerId }];
      if (snapBackOnly || !tracked || !point) return result({ ...base, lastTap: null }, release);
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
      if (!snapBackOnly && shouldDismiss({ velocityY, displacementY, viewportHeight })) {
        return result({ ...state, mode: "idle", pointers, pinchIds: null }, [{ type: "close" }, { type: "releasePointer", pointerId }]);
      }
      return result(
        { ...state, mode: "settling", pointers, suppressClickUntil: suppressWindow(time) },
        [{ type: "settleDismiss" }, { type: "releasePointer", pointerId }],
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
        velocityY: event.velocityY,
        displacementY: event.displacementY,
        viewportHeight: event.viewportHeight,
        point: event.point,
      });
    case "pointercancel":
      return onTrackedRelease(state, {
        pointerId: event.pointerId,
        time: event.time,
        snapBackOnly: true,
        velocityY: 0,
        displacementY: 0,
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
