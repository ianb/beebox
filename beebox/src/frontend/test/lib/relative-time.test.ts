// # Ago on a named clock
//
// `agoOnClock` says how old a timestamp is on the box or browser clock. The
// formatting itself is tested in `beebox/test/shared/relative-time.test.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { agoOnClock } from "../../src/lib/relative-time.js";
import { setBoxClockShift } from "../../src/lib/box-clock.js";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ## A timestamp on a named clock
//
// `real` is the browser's clock, `box` adds the gap the server reported. A
// string that does not parse comes back as written.
void test("agoOnClock reads the named clock", async (t) => {
  setBoxClockShift(0);
  const real = Date.now();
  t.check(agoOnClock(real - 5 * MIN, "real"), "5m ago");
  t.check(agoOnClock(new Date(real - 3 * HOUR - MIN).toISOString(), "real"), "3h ago");
  setBoxClockShift(DAY);
  const stamp = new Date(real).toISOString();
  const box = agoOnClock(stamp, "box");
  const onReal = agoOnClock(stamp, "real");
  setBoxClockShift(0);
  t.check({ box, onReal }, { box: "1d ago", onReal: "just now" });
});

void test("agoOnClock returns an unparseable string as written", async (t) => {
  t.check(agoOnClock("not a date", "real"), "not a date");
});
