// # Lightbox gesture reducer
//
// The pure mode machine behind the lightbox gesture surface:
// `reduceGesture(state, event) → { state, actions }`. The controller feeds it
// semantic events (points already container-centered; release velocity/
// displacement measured) and executes the returned actions. Testing it here makes
// every transition deterministic instead of device-only.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  initialGestureState,
  reduceGesture,
} from "../../../src/lib/lightbox-gesture-controller/lightbox-gesture-reducer.js";

// ## Pending classification: dismiss vs pan vs horizontal passthrough
//
// A pointer down is `pending` (unclassified) and captured; a small move stays
// pending:
void test("A pointer down is pending (unclassified) and captured; a small move stays pen...", async (t) => {
  // doctest:L22
  let r = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  t.check([r.state.mode, JSON.stringify(r.actions)].join(" "), "pending [{\"type\":\"capturePointer\",\"pointerId\":1}]");

  // doctest:L26
  r = reduceGesture(r.state, { type: "pointermove", pointerId: 1, point: { x: 5, y: 5 }, time: 16, atFit: true, canSwipe: false });
  t.check([r.state.mode, JSON.stringify(r.actions)].join(" "), "pending []");
});

// A vertical drag at fit becomes a dismiss:
void test("A vertical drag at fit becomes a dismiss:", async (t) => {
  // doctest:L34
  let r = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  r = reduceGesture(r.state, { type: "pointermove", pointerId: 1, point: { x: 0, y: 20 }, time: 16, atFit: true, canSwipe: false });
  t.check([r.state.mode, JSON.stringify(r.actions)].join(" "), "dismissing [{\"type\":\"beginDismiss\"}]");
});

// While zoomed, dismiss is disabled — any-axis drag pans instead (a vertical drag
// does NOT dismiss):
void test("While zoomed, dismiss is disabled — any-axis drag pans instead (a vertical dr...", async (t) => {
  // doctest:L44
  let r = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  r = reduceGesture(r.state, { type: "pointermove", pointerId: 1, point: { x: 0, y: 20 }, time: 16, atFit: false, canSwipe: false });
  t.check([r.state.mode, JSON.stringify(r.actions)].join(" "), "panning [{\"type\":\"beginPan\"}]");
});

// A horizontal drag at fit is prev/next navigation:
void test("A horizontal drag at fit is prev/next navigation:", async (t) => {
  // doctest:L53
  let r = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  r = reduceGesture(r.state, { type: "pointermove", pointerId: 1, point: { x: 30, y: 0 }, time: 16, atFit: true, canSwipe: true });
  t.check([r.state.mode, JSON.stringify(r.actions)].join(" "), "swiping [{\"type\":\"beginSwipe\"}]");
});

// With a lone image there is no neighbour to swipe to, so the same drag releases
// the pointer and does nothing (mode back to idle, pointer dropped) rather than
// starting a gesture that could only ever snap back:
void test("With a lone image there is no neighbour to swipe to, so the same drag release...", async (t) => {
  // doctest:L64
  let r = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  r = reduceGesture(r.state, { type: "pointermove", pointerId: 1, point: { x: 30, y: 0 }, time: 16, atFit: true, canSwipe: false });
  t.check([r.state.mode, JSON.stringify(r.actions), JSON.stringify(r.state.pointers)].join(" "), "idle [{\"type\":\"releasePointer\",\"pointerId\":1}] {}");
});

// Zoomed, a horizontal drag pans instead — swipe is a fit-scale gesture only, so
// panning a zoomed photo never changes image out from under you:
void test("Zoomed, a horizontal drag pans instead — swipe is a fit-scale gesture only, s...", async (t) => {
  // doctest:L74
  let r = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  r = reduceGesture(r.state, { type: "pointermove", pointerId: 1, point: { x: 30, y: 0 }, time: 16, atFit: false, canSwipe: true });
  t.check([r.state.mode, JSON.stringify(r.actions)].join(" "), "panning [{\"type\":\"beginPan\"}]");
});

// ## Swipe decision on release
//
// A far-enough drag commits, flying the figure out and stepping the index. The
// step is signed against the drag: dragging LEFT (negative offset) advances:
void test("A far-enough drag commits, flying the figure out and stepping the index.", async (t) => {
  // doctest:L86
  let s = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  s = reduceGesture(s.state, { type: "pointermove", pointerId: 1, point: { x: -30, y: 0 }, time: 16, atFit: true, canSwipe: true });
  const next = reduceGesture(s.state, { type: "pointerup", pointerId: 1, point: { x: -400, y: 0 }, time: 100, velocity: { x: -0.1, y: 0 }, dismissOffset: 0, swipeOffset: -400, viewportWidth: 1280, viewportHeight: 800 });
  t.check([next.state.mode, JSON.stringify(next.actions)].join(" "), "settling [{\"type\":\"commitSwipe\",\"step\":1},{\"type\":\"releasePointer\",\"pointerId\":1}]");

  // A short, slow release springs back to the current image instead:

  // doctest:L96
  const stay = reduceGesture(s.state, { type: "pointerup", pointerId: 1, point: { x: -60, y: 0 }, time: 100, velocity: { x: -0.05, y: 0 }, dismissOffset: 0, swipeOffset: -60, viewportWidth: 1280, viewportHeight: 800 });
  t.check([stay.state.mode, JSON.stringify(stay.actions)].join(" "), "settling [{\"type\":\"settleSwipe\"},{\"type\":\"releasePointer\",\"pointerId\":1}]");

  // A cancel never navigates — there is no velocity to trust, so even a
  // past-threshold offset springs back:

  // doctest:L105
  const cancelled = reduceGesture(s.state, { type: "pointercancel", pointerId: 1, time: 100 });
  t.check([cancelled.state.mode, JSON.stringify(cancelled.actions)].join(" "), "settling [{\"type\":\"settleSwipe\"},{\"type\":\"releasePointer\",\"pointerId\":1}]");

  // A second finger mid-swipe promotes to a pinch and springs the swipe offset
  // back, the same way a dismiss hands off:

  // doctest:L114
  const pinched = reduceGesture(s.state, { type: "pointerdown", pointerId: 2, point: { x: 50, y: 0 }, time: 120 });
  t.check([pinched.state.mode, JSON.stringify(pinched.actions)].join(" "), "pinching [{\"type\":\"settleSwipe\"},{\"type\":\"capturePointer\",\"pointerId\":2},{\"type\":\"beginPinch\",\"pointerIds\":[1,2]}]");
});

// ## Dismiss decision on release
//
// A fast flick closes:
void test("A fast flick closes:", async (t) => {
  // doctest:L124
  let r = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  r = reduceGesture(r.state, { type: "pointermove", pointerId: 1, point: { x: 0, y: 20 }, time: 16, atFit: true, canSwipe: false });
  const closed = reduceGesture(r.state, { type: "pointerup", pointerId: 1, point: { x: 0, y: 200 }, time: 100, velocity: { x: 0, y: 0.6 }, dismissOffset: 100, swipeOffset: 0, viewportWidth: 1280, viewportHeight: 800 });
  t.check([closed.state.mode, JSON.stringify(closed.actions)].join(" "), "idle [{\"type\":\"close\"},{\"type\":\"releasePointer\",\"pointerId\":1}]");

  // A short, slow release springs back instead:

  // doctest:L134
  const settled = reduceGesture(r.state, { type: "pointerup", pointerId: 1, point: { x: 0, y: 120 }, time: 100, velocity: { x: 0, y: 0.1 }, dismissOffset: 100, swipeOffset: 0, viewportWidth: 1280, viewportHeight: 800 });
  t.check([settled.state.mode, JSON.stringify(settled.actions)].join(" "), "settling [{\"type\":\"settleDismiss\"},{\"type\":\"releasePointer\",\"pointerId\":1}]");

  // A pointer cancel (or `lostpointercapture`) always snaps back, never closes —
  // there is no velocity to trust:

  // doctest:L143
  const cancelled = reduceGesture(r.state, { type: "pointercancel", pointerId: 1, time: 100 });
  t.check([cancelled.state.mode, JSON.stringify(cancelled.actions)].join(" "), "settling [{\"type\":\"settleDismiss\"},{\"type\":\"releasePointer\",\"pointerId\":1}]");

  // ## Second pointer promotes to pinch
  //
  // Mid-dismiss, a second finger promotes to pinch AND springs the dismiss offset
  // back (independent figure layer), re-baselining on the two pointers:

  // doctest:L154
  const pinch = reduceGesture(r.state, { type: "pointerdown", pointerId: 2, point: { x: 50, y: 0 }, time: 120 });
  t.check([pinch.state.mode, JSON.stringify(pinch.actions)].join(" "), "pinching [{\"type\":\"settleDismiss\"},{\"type\":\"capturePointer\",\"pointerId\":2},{\"type\":\"beginPinch\",\"pointerIds\":[1,2]}]");
});

// Mid-pan there is no dismiss to settle — just the pinch takeover:
void test("Mid-pan there is no dismiss to settle — just the pinch takeover:", async (t) => {
  // doctest:L162
  let p = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  p = reduceGesture(p.state, { type: "pointermove", pointerId: 1, point: { x: 20, y: 0 }, time: 16, atFit: false, canSwipe: false });
  const pp = reduceGesture(p.state, { type: "pointerdown", pointerId: 2, point: { x: 50, y: 0 }, time: 30 });
  t.check([pp.state.mode, JSON.stringify(pp.actions)].join(" "), "pinching [{\"type\":\"capturePointer\",\"pointerId\":2},{\"type\":\"beginPinch\",\"pointerIds\":[1,2]}]");

  // A third finger during a pinch is ignored — not tracked, pinch continues on the
  // first two:

  // doctest:L173
  const third = reduceGesture(pp.state, { type: "pointerdown", pointerId: 3, point: { x: 0, y: 0 }, time: 60 });
  t.check([third.state.mode, JSON.stringify(third.actions), Object.keys(third.state.pointers).length].join(" "), "pinching [] 2");

  // ## Pinch demotion on pointer loss (no jump)
  //
  // Lifting one of the two pinch fingers demotes to a one-finger pan, re-baselined on
  // the finger that remains (the controller re-reads the live transform, so no jump):

  // doctest:L184
  const demoted = reduceGesture(pp.state, { type: "pointerup", pointerId: 1, point: { x: 0, y: 0 }, time: 40, velocity: { x: 0, y: 0 }, dismissOffset: 0, swipeOffset: 0, viewportWidth: 1280, viewportHeight: 800 });
  t.check([demoted.state.mode, JSON.stringify(demoted.actions)].join(" "), "panning [{\"type\":\"demotePinchToPan\",\"pointerId\":2},{\"type\":\"releasePointer\",\"pointerId\":1}]");

  // Lifting the last finger then settles the pan:

  // doctest:L192
  const rest = reduceGesture(demoted.state, { type: "pointerup", pointerId: 2, point: { x: 0, y: 0 }, time: 50, velocity: { x: 0, y: 0 }, dismissOffset: 0, swipeOffset: 0, viewportWidth: 1280, viewportHeight: 800 });
  t.check([rest.state.mode, JSON.stringify(rest.actions)].join(" "), "settling [{\"type\":\"settlePan\"},{\"type\":\"releasePointer\",\"pointerId\":2}]");
});

// ## Tap and double-tap bookkeeping
//
// A lone tap records itself and does nothing else:
void test("A lone tap records itself and does nothing else:", async (t) => {
  // doctest:L202
  let tap = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  tap = reduceGesture(tap.state, { type: "pointerup", pointerId: 1, point: { x: 2, y: 2 }, time: 50, velocity: { x: 0, y: 0 }, dismissOffset: 0, swipeOffset: 0, viewportWidth: 1280, viewportHeight: 800 });
  t.check([tap.state.mode, JSON.stringify(tap.actions), JSON.stringify(tap.state.lastTap)].join(" "), "idle [{\"type\":\"releasePointer\",\"pointerId\":1}] {\"point\":{\"x\":2,\"y\":2},\"time\":50}");

  // A second tap soon after toggles zoom at the tap point, suppresses the trailing
  // click, and clears the tap history:

  // doctest:L212
  let tap2 = reduceGesture(tap.state, { type: "pointerdown", pointerId: 1, point: { x: 3, y: 3 }, time: 200 });
  tap2 = reduceGesture(tap2.state, { type: "pointerup", pointerId: 1, point: { x: 4, y: 4 }, time: 230, velocity: { x: 0, y: 0 }, dismissOffset: 0, swipeOffset: 0, viewportWidth: 1280, viewportHeight: 800 });
  t.check([tap2.state.mode, JSON.stringify(tap2.actions), JSON.stringify(tap2.state.lastTap)].join(" "), "idle [{\"type\":\"toggleZoom\",\"anchor\":{\"x\":4,\"y\":4}},{\"type\":\"suppressClick\"},{\"type\":\"releasePointer\",\"pointerId\":1}] null");
});

// A release whose total travel crossed the drag threshold is NOT a tap, even if
// no move event ever classified it (a coalesced gesture can deliver its big
// delta only at pointerup):
void test("A release whose total travel crossed the drag threshold is NOT a tap, even if...", async (t) => {
  // doctest:L223
  let bigUp = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  bigUp = reduceGesture(bigUp.state, { type: "pointerup", pointerId: 1, point: { x: 0, y: 40 }, time: 30, velocity: { x: 0, y: 0 }, dismissOffset: 0, swipeOffset: 0, viewportWidth: 1280, viewportHeight: 800 });
  t.check([bigUp.state.mode, JSON.stringify(bigUp.state.lastTap)].join(" "), "idle null");
});

// A tap followed by a quick drag does not pair with a tap after it — any
// classified drag (or a pinch promotion) voids the tap history:
void test("A tap followed by a quick drag does not pair with a tap after it — any classi...", async (t) => {
  // doctest:L233
  let td = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  td = reduceGesture(td.state, { type: "pointerup", pointerId: 1, point: { x: 0, y: 0 }, time: 30, velocity: { x: 0, y: 0 }, dismissOffset: 0, swipeOffset: 0, viewportWidth: 1280, viewportHeight: 800 });
  td = reduceGesture(td.state, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 60 });
  td = reduceGesture(td.state, { type: "pointermove", pointerId: 1, point: { x: 0, y: 30 }, time: 80, atFit: true, canSwipe: false });
  t.check(td.state.lastTap, null);
});

// ## Drag-followed-by-click suppression
//
// A completed drag arms a suppression window. A real pointer click (`detail > 0`)
// inside it is consumed and the window cleared:
void test("A completed drag arms a suppression window.", async (t) => {
  // doctest:L247
  let r = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  r = reduceGesture(r.state, { type: "pointermove", pointerId: 1, point: { x: 0, y: 20 }, time: 16, atFit: true, canSwipe: false });
  const settled = reduceGesture(r.state, { type: "pointerup", pointerId: 1, point: { x: 0, y: 120 }, time: 100, velocity: { x: 0, y: 0.1 }, dismissOffset: 100, swipeOffset: 0, viewportWidth: 1280, viewportHeight: 800 });
  const eaten = reduceGesture(settled.state, { type: "click", detail: 1, time: 200 });
  await t.checkText([JSON.stringify(eaten.actions), JSON.stringify(eaten.state.suppressClickUntil)].join(" "), "[{\"type\":\"suppressClick\"}] null");

  // A keyboard/AT activation (`detail === 0`) always passes through and leaves the
  // window intact for the real click still to come:

  // doctest:L259
  const keyboard = reduceGesture(settled.state, { type: "click", detail: 0, time: 200 });
  await t.checkText([JSON.stringify(keyboard.actions), JSON.stringify(keyboard.state.suppressClickUntil)].join(" "), "[] 600");

  // A click after the window expires passes through and clears the stale window:

  // doctest:L267
  const late = reduceGesture(settled.state, { type: "click", detail: 1, time: 700 });
  await t.checkText([JSON.stringify(late.actions), JSON.stringify(late.state.suppressClickUntil)].join(" "), "[] null");
});

// ## Reset on image change
//
// `reset` wipes everything back to the initial state (and cancels any spring), so
// transforms never leak from one image to the next:
void test("reset wipes everything back to the initial state (and cancels any spring), so...", async (t) => {
  // doctest:L278
  let p = reduceGesture(initialGestureState, { type: "pointerdown", pointerId: 1, point: { x: 0, y: 0 }, time: 0 });
  p = reduceGesture(p.state, { type: "pointermove", pointerId: 1, point: { x: 20, y: 0 }, time: 16, atFit: false, canSwipe: false });
  const reset = reduceGesture(p.state, { type: "reset" });
  await t.checkText([JSON.stringify(reset.state), JSON.stringify(reset.actions)].join(" "), "{\"mode\":\"idle\",\"pointers\":{},\"pinchIds\":null,\"lastTap\":null,\"suppressClickUntil\":null} [{\"type\":\"cancelSpring\"}]");
});
