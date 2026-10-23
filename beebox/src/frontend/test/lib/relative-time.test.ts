// # Ago and duration labels
//
// `formatAgo` says how old a stamp is, `agoOnClock` does the same for a
// timestamp on the box or browser clock, and `formatDuration` says how long
// something took. Every expected value below derives from a fixed clock.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { formatAgo, agoOnClock, formatDuration } from "../../src/lib/relative-time.js";
import { setBoxClockShift } from "../../src/lib/box-clock.js";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Local noon, so the local calendar date is the same in any time zone.
const NOW = new Date(2026, 9, 23, 12).getTime();

// ## "ago" under a week
//
// Under a minute is "just now"; after that each unit floors. A stamp from the
// future (a box clock running behind this one) also reads "just now", never
// "-3m ago".
void test("formatAgo floors to the largest unit and clamps the future", async (t) => {
  const ago = (ms: number) => formatAgo(NOW - ms, NOW);
  t.check(
    [0, 59 * SEC, MIN, 90 * SEC, 59 * MIN, HOUR, 25 * HOUR, 6 * DAY + 23 * HOUR].map(ago).join(" / "),
    "just now / just now / 1m ago / 1m ago / 59m ago / 1h ago / 1d ago / 6d ago",
  );
  t.check(ago(-3 * MIN), "just now");
});

// ## A date from a week on
//
// The year appears only when it differs from the current one.
void test("formatAgo gives a date from seven days, with the year when it differs", async (t) => {
  t.check(formatAgo(new Date(2026, 8, 15, 12).getTime(), NOW), "Sep 15");
  t.check(formatAgo(NOW - 7 * DAY, NOW), "Oct 16");
  t.check(formatAgo(new Date(2025, 8, 15, 12).getTime(), NOW), "Sep 15, 2025");
});

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

// ## Durations
//
// Under a second in milliseconds, under ten with one decimal (no ".0"), under
// a minute in whole seconds, then the two largest units without a zero tail.
void test("formatDuration picks one rule per magnitude", async (t) => {
  t.check(
    [850, 1200, 5000, 45_000, 59_999, MIN, 3 * MIN + 20 * SEC, 3 * MIN, HOUR + 5 * MIN + 9 * SEC, HOUR, 2 * DAY + 3 * HOUR + 4 * MIN].map(formatDuration).join(" / "),
    "850ms / 1.2s / 5s / 45s / 59s / 1m / 3m 20s / 3m / 1h 5m / 1h / 2d 3h",
  );
  t.check([0, -5, Number.NaN].map(formatDuration).join(" / "), "0ms / 0ms / 0ms");
});
