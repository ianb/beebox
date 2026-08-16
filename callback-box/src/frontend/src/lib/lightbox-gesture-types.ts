/**
 * The vocabulary of the lightbox gesture machine: its modes, its state, the
 * semantic events the controller feeds it, and the actions it hands back. Split
 * out from `lightbox-gesture-reducer.ts` so the transitions and the shapes they
 * move between can each be read on their own.
 *
 * Consumers import these from `lightbox-gesture-reducer.js`, which re-exports
 * the whole surface — this module is the declaration site, not a second import
 * path to remember.
 */

import type { Point, PointerSample } from "./lightbox-gesture-math.js";

export type GestureMode =
  | "idle"
  | "pending"
  | "dismissing"
  | "swiping"
  | "panning"
  | "pinching"
  | "settling";

export interface TrackedPointer {
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
  | { type: "pointermove"; pointerId: number; point: Point; time: number; atFit: boolean; canSwipe: boolean }
  | {
      type: "pointerup";
      pointerId: number;
      point: Point;
      time: number;
      velocity: Point;
      /** Live dismiss offset (figure translateY) at release. */
      dismissOffset: number;
      /** Live swipe offset (figure translateX) at release. */
      swipeOffset: number;
      viewportWidth: number;
      viewportHeight: number;
    }
  | { type: "pointercancel"; pointerId: number; time: number }
  | { type: "springdone" }
  | { type: "click"; detail: number; time: number }
  | { type: "reset" };

export type GestureAction =
  | { type: "capturePointer"; pointerId: number }
  | { type: "releasePointer"; pointerId: number }
  | { type: "cancelSpring" }
  | { type: "beginDismiss" }
  | { type: "beginSwipe" }
  | { type: "beginPan" }
  | { type: "beginPinch"; pointerIds: readonly [number, number] }
  | { type: "demotePinchToPan"; pointerId: number }
  | { type: "settleDismiss" }
  | { type: "settleSwipe" }
  /** Fly the swipe out to the neighbour and change image: `-1` prev, `+1` next. */
  | { type: "commitSwipe"; step: -1 | 1 }
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
