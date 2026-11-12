// # Ago and duration labels
//
// `formatAgoMs` says how old something is from an elapsed time (CLI and
// health text), `formatAgo` does the same for a stamp and gives a date from a
// week on (web lists), and `formatDuration` says how long something took.
// Every expected value below derives from a fixed clock.
// See `src/shared/relative-time.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { formatAgo, formatAgoMs, formatClock, formatDuration, formatTimePassed } from "../../src/shared/relative-time.js";

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

// ## Ago without a date
//
// CLI and health text never switch to a date; a missing elapsed time reads
// "just now" rather than "NaNd ago".
void test("formatAgoMs keeps counting days and treats a non-number as just now", async (t) => {
  t.check([30 * DAY, 400 * DAY, Number.NaN].map(formatAgoMs), ["30d ago", "400d ago", "just now"]);
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

// ## A running clock
//
// Minutes are not padded and seconds always are; an hour or more adds an
// hours field with padded minutes. Fractions of a second floor. A negative or
// non-finite value has no reading and gives a dash, never a plausible "0:00".
void test("formatClock writes M:SS, then H:MM:SS from an hour", async (t) => {
  t.check(
    [0, 7 * SEC, 59_999, MIN, 3 * MIN + 20 * SEC, 59 * MIN + 59 * SEC, HOUR, HOUR + 5 * MIN + 9 * SEC, 26 * HOUR].map(formatClock).join(" / "),
    "0:00 / 0:07 / 0:59 / 1:00 / 3:20 / 59:59 / 1:00:00 / 1:05:09 / 26:00:00",
  );
  t.check([-5, Number.NaN, Infinity, -Infinity].map(formatClock).join(" / "), "— / — / — / —");
});

// ## Time passed
//
// The agent sees nothing under six hours, then the same text as a duration.
// A non-finite gap comes from a bad stamp and also gives nothing, never "0ms".
void test("formatTimePassed is null under six hours and a duration after", async (t) => {
  t.check([5 * HOUR + 59 * MIN, 0, -HOUR].map(formatTimePassed), [null, null, null]);
  t.check([Number.NaN, Infinity, -Infinity].map(formatTimePassed), [null, null, null]);
  t.check([6 * HOUR, 7 * HOUR + 30 * MIN, DAY, 2 * DAY + 3 * HOUR].map(formatTimePassed), ["6h", "7h 30m", "1d", "2d 3h"]);
});
