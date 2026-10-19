// # Schedule cadence descriptions
//
// `describeCadence` turns a scheduled-script's timing fields into one
// human-readable sentence for the dashboard and `bbx scheduled`. The raw
// expression stays available elsewhere (tooltips, the card itself).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { describeCadence, type ScheduleCadenceInput } from "../../../src/core/schedule/describe.js";

function cadence(overrides: Partial<ScheduleCadenceInput>): string {
  return describeCadence({
    cron: undefined,
    at: undefined,
    rrule: undefined,
    until: undefined,
    notBefore: undefined,
    onWakeup: false,
    once: false,
    ...overrides,
  });
}

// ## Cron schedules
//
// The shapes real boxes use today:
void test("The shapes real boxes use today:", async (t) => {
  t.check(cadence({ cron: "0 4 * * *", notBefore: "20h" }), "At 4:00 AM, at most once every 20 hours");

  t.check(cadence({ cron: "*/15 * * * *", onWakeup: true, notBefore: "10m" }), "Every 15 minutes and on wakeup, at most once every 10 minutes");

  t.check(cadence({ cron: "0 6,18 * * *", onWakeup: true, notBefore: "4h" }), "At 6:00 AM and 6:00 PM and on wakeup, at most once every 4 hours");
});

// `not-before` is a floor on the interval between runs, so it always reads
// "at most once every N" — never "at least". A one-unit duration drops the
// number:
void test("not-before is a floor on the interval between runs, so it always reads \"at mo...", async (t) => {
  t.check(cadence({ cron: "0 * * * *", notBefore: "1h" }), "Every hour, at most once every hour");
});

// ## Wakeup-only and bare schedules
void test("Wakeup-only and bare schedules", async (t) => {
  t.check(cadence({ onWakeup: true, notBefore: "5m" }), "On wakeup, at most once every 5 minutes");

  t.check(cadence({}), "No schedule");
});

// ## One-shot, rrule, and bounds
//
// `at` schedules fire a single time; `once` on a recurring schedule means the
// card is removed after its first successful run.
void test("at schedules fire a single time; once on a recurring schedule means the card...", async (t) => {
  t.check(cadence({ at: "2026-09-01T14:30:00" }), "Once at Sep 1, 2026, 2:30 PM");

  t.check(cadence({ at: "2026-09-01T14:30:00", onWakeup: true }), "Once at Sep 1, 2026, 2:30 PM; also on each wakeup");

  t.check(cadence({ cron: "0 8 * * *", once: true }), "At 8:00 AM, once");

  t.check(cadence({ rrule: "FREQ=WEEKLY;BYDAY=MO,FR" }), "Every week on Monday, Friday");

  t.check(cadence({ cron: "0 12 * * *", until: "2026-12-31T00:00:00" }), "At 12:00 PM, until Dec 31, 2026, 12:00 AM");
});

// ## Malformed input falls back to the raw expression
//
// Display code never throws on a bad card — the raw string is still more
// useful than an error.
void test("Display code never throws on a bad card — the raw string is still more useful...", async (t) => {
  t.check(cadence({ cron: "not a cron" }), "cron not a cron");

  t.check(cadence({ rrule: "FREQ=NONSENSE" }), "rrule FREQ=NONSENSE");

  t.check(cadence({ at: "garbage-date" }), "Once at garbage-date");
});
