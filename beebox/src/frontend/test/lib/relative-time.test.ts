// # Elapsed-time labels
//
// Two surfaces have to say how old something is: a recovered dictation draft
// ("captured 3 min ago") and a stuck capture chip in chat, whose whole defect was
// that it looked identical whether it failed ten seconds or three weeks ago. Both
// take elapsed milliseconds, so the caller owns the clock and these stay
// deterministic.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { formatElapsed, formatAgo } from "../../src/lib/relative-time.js";

// ## The magnitude, without a preposition
//
// `formatElapsed` is what a caption embeds mid-sentence ("still preparing —
// 3 min"). It never returns "0 min": a duration being displayed at all is at
// least a moment long, and "0 min" reads as a bug.
void test("formatElapsed is what a caption embeds mid-sentence (\"still preparing — 3 min\").", async (t) => {
  // doctest:L20
  t.check([0, 10_000, 60_000, 3 * 60_000].map(formatElapsed).join(" / "), "1 min / 1 min / 1 min / 3 min");
});

// Hours and days, with singular/plural days:
void test("Hours and days, with singular/plural days:", async (t) => {
  // doctest:L27
  t.check([60 * 60_000, 3 * 60 * 60_000, 24 * 60 * 60_000, 48 * 60 * 60_000].map(formatElapsed).join(" / "), "1 hr / 3 hr / 1 day / 2 days");
});

// ## "ago", with a quiet zone for the recent past
//
// `formatAgo` adds the preposition — and below 45 seconds says "just now"
// instead, because a freshly-failed capture reporting "1 min ago" is precision
// the clock hasn't earned yet:
void test("formatAgo adds the preposition — and below 45 seconds says \"just now\" instead...", async (t) => {
  // doctest:L38
  t.check([0, 10_000, 44_000].map(formatAgo).join(" / "), "just now / just now / just now");

  // doctest:L41
  t.check([60_000, 3 * 60 * 60_000, 16 * 24 * 60 * 60_000].map(formatAgo).join(" / "), "1 min ago / 3 hr ago / 16 days ago");
});
