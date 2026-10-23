// # Box clock
//
// A walk fixture's box can sit days ahead of the browser. Dates shown to the
// person add the gap the server reported; with no gap the app reads the
// browser's clock as it always did.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { applyBoxClockReply, beginBoxClockSync, boxNow, setBoxClockShift } from "../../src/lib/box-clock.js";
import { localIsoDate, startPrefix } from "../../src/components/todo/item-logic.js";

const DAY_MS = 86_400_000;

void test("with no gap the box clock is the browser's clock", async (t) => {
  setBoxClockShift(0);
  t.check(Math.round((boxNow() - Date.now()) / 1000), 0);
});

void test("a reported gap moves the box clock, and zero moves it back", async (t) => {
  setBoxClockShift(7 * DAY_MS);
  const ahead = boxNow() - Date.now();
  setBoxClockShift(0);
  const back = boxNow() - Date.now();
  t.check({ ahead: Math.round(ahead / DAY_MS), back: Math.round(back / DAY_MS) }, { ahead: 7, back: 0 });
});

// ## A displayed date follows the box clock
//
// A todo starting a week from the browser's today reads "later" on a real
// box and "since" once the box is eight days ahead.

void test("the todo start prefix reads the box date", async (t) => {
  const start = localIsoDate(new Date(Date.now() + 7 * DAY_MS));
  const prefix = () => startPrefix({ plateState: null, startIso: start });
  setBoxClockShift(0);
  const real = prefix();
  setBoxClockShift(8 * DAY_MS);
  const shifted = prefix();
  setBoxClockShift(0);
  t.check({ real, shifted }, { real: "later ·", shifted: "since" });
});

// ## Switching boxes drops the previous box's gap
//
// A window that moves from a walk box to a real box must not keep reading the
// walk box's shift, and the walk box's late reply must not restore it.

void test("a box change resets the gap and ignores the previous box's reply", async (t) => {
  setBoxClockShift(0);
  const walk = beginBoxClockSync();
  applyBoxClockReply({ epoch: walk, reportedMs: 7 * DAY_MS });
  const onWalk = Math.round((boxNow() - Date.now()) / DAY_MS);
  const real = beginBoxClockSync();
  const afterSwitch = Math.round((boxNow() - Date.now()) / DAY_MS);
  applyBoxClockReply({ epoch: walk, reportedMs: 7 * DAY_MS });
  const afterStaleReply = Math.round((boxNow() - Date.now()) / DAY_MS);
  applyBoxClockReply({ epoch: real, reportedMs: 0 });
  t.check({ onWalk, afterSwitch, afterStaleReply }, { onWalk: 7, afterSwitch: 0, afterStaleReply: 0 });
});
