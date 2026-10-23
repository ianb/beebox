// # Elapsed-time labels
//
// Two surfaces have to say how old something is: a recovered dictation draft
// ("captured 3 min ago") and a stuck capture chip in chat, whose whole defect was
// that it looked identical whether it failed ten seconds or three weeks ago. Both
// take elapsed milliseconds, so the caller owns the clock and these stay
// deterministic.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { formatElapsed, formatAgo, compactAgo } from "../../src/lib/relative-time.js";
import { setBoxClockShift } from "../../src/lib/box-clock.js";

// ## The magnitude, without a preposition
//
// `formatElapsed` is what a caption embeds mid-sentence ("still preparing —
// 3 min"). It never returns "0 min": a duration being displayed at all is at
// least a moment long, and "0 min" reads as a bug.
void test("formatElapsed is what a caption embeds mid-sentence (\"still preparing — 3 min\").", async (t) => {
  t.check([0, 10_000, 60_000, 3 * 60_000].map(formatElapsed).join(" / "), "1 min / 1 min / 1 min / 3 min");
});

// Hours and days, with singular/plural days:
void test("Hours and days, with singular/plural days:", async (t) => {
  t.check([60 * 60_000, 3 * 60 * 60_000, 24 * 60 * 60_000, 48 * 60 * 60_000].map(formatElapsed).join(" / "), "1 hr / 3 hr / 1 day / 2 days");
});

// ## "ago", with a quiet zone for the recent past
//
// `formatAgo` adds the preposition — and below 45 seconds says "just now"
// instead, because a freshly-failed capture reporting "1 min ago" is precision
// the clock hasn't earned yet:
void test("formatAgo adds the preposition — and below 45 seconds says \"just now\" instead...", async (t) => {
  t.check([0, 10_000, 44_000].map(formatAgo).join(" / "), "just now / just now / just now");

  t.check([60_000, 3 * 60 * 60_000, 16 * 24 * 60 * 60_000].map(formatAgo).join(" / "), "1 min ago / 3 hr ago / 16 days ago");
});

// ## Compact stamps for dashboards
//
// `compactAgo` takes a timestamp (ISO string or epoch ms) and reads the clock
// itself: `real` is the browser's, `box` adds the gap the server reported.
void test("compactAgo picks the largest whole unit", async (t) => {
  setBoxClockShift(0);
  const ago = (ms: number): number => Date.now() - ms;
  t.check(
    [5_000, 90_000, 3 * 3_600_000 + 60_000, 2 * 86_400_000 + 60_000].map((ms) => compactAgo(ago(ms), "real")).join(" / "),
    "5s ago / 1m ago / 3h ago / 2d ago",
  );
  t.check(compactAgo(new Date(ago(90_000)).toISOString(), "real"), "1m ago");
});

void test("compactAgo on the box clock counts from the box's now", async (t) => {
  setBoxClockShift(86_400_000);
  const stamp = new Date(Date.now()).toISOString();
  const box = compactAgo(stamp, "box");
  const real = compactAgo(stamp, "real");
  setBoxClockShift(0);
  t.check({ box, real }, { box: "1d ago", real: "0s ago" });
});
