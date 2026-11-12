// # FriendlyDate — date-only strings are calendar days, not instants
//
// `new Date("2026-08-14")` parses as UTC midnight, so formatting it in the
// browser's zone rendered the *previous* day anywhere behind UTC — a todo due
// `2026-08-14` showed as "due Aug 13, 2026" on the Plate in US timezones.
// `friendlyDate` formats a date-only value at its UTC midnight in UTC, so the
// day shown is the day written in every zone; full timestamps are instants
// and keep local-zone formatting. Each check runs in a zone named by `TZ`, so
// the result does not depend on the runner's zone.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { friendlyDate } from "../../../src/components/ui/FriendlyDate.js";

/** `fn`'s result with the process in time zone `tz`. */
function inZone<T>(tz: string, fn: () => T): T {
  const before = process.env["TZ"];
  process.env["TZ"] = tz;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env["TZ"];
    else process.env["TZ"] = before;
  }
}

/**
 * How `Date` shows `value` with date and time in the current zone: what
 * `friendlyDate` must show for an instant.
 * The space before "AM" differs between ICU versions, so the expected text
 * comes from the runtime rather than a literal.
 */
function dateShown(value: string | number): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// A date-only string is the same day in every zone, with no time, regardless
// of `mode`:
void test("A date-only string is the same day in every zone, with no time", async (t) => {
  t.check(
    ["America/Los_Angeles", "UTC", "Pacific/Kiritimati"].map((tz) => inZone(tz, () => [friendlyDate("2026-08-14", "date"), friendlyDate("2026-08-14")])),
    [["Aug 14, 2026", "Aug 14, 2026"], ["Aug 14, 2026", "Aug 14, 2026"], ["Aug 14, 2026", "Aug 14, 2026"]],
  );
});

// Full timestamps are instants, shown in the viewer's zone as `Date` showed
// them, with the time unless `mode` is "date". 03:00 UTC is still the 13th in
// Los Angeles:
void test("Full timestamps are instants, shown in the viewer's zone", async (t) => {
  const iso = "2026-08-14T03:00:00Z";
  t.check(inZone("America/Los_Angeles", () => friendlyDate(iso, "date")), "Aug 13, 2026");
  for (const tz of ["America/Los_Angeles", "UTC", "Asia/Kolkata"]) {
    t.check(inZone(tz, () => friendlyDate(iso)), inZone(tz, () => dateShown(iso)));
  }
  t.check(inZone("UTC", () => dateShown(iso).replace(/\s/gu, " ")), "Aug 14, 2026, 3:00 AM");
});

// `friendlyDate` is the text the component shows, for sentences and titles. It
// takes epoch milliseconds too, and an unparseable value — including a
// date-only string that names no day — comes back as written instead of
// "Invalid Date":
void test("friendlyDate formats strings and epochs, and returns bad input as written", async (t) => {
  const epoch = Date.UTC(2026, 7, 14, 12);
  t.check(friendlyDate(epoch), friendlyDate(new Date(epoch).toISOString()));
  t.check(inZone("UTC", () => friendlyDate(epoch)), inZone("UTC", () => dateShown(epoch)));
  t.check([friendlyDate("sometime"), friendlyDate("2026-02-30"), friendlyDate(Number.NaN)], ["sometime", "2026-02-30", "NaN"]);
});

// "time" shows an instant's time alone, in the viewer's zone, and a date-only
// value (which has no time) its day:
void test("friendlyDate time mode shows the time of an instant and the day of a date-only value", async (t) => {
  const iso = "2026-08-14T03:00:00Z";
  t.check(inZone("America/Los_Angeles", () => friendlyDate(iso, "time").replace(/\s/gu, " ")), "8:00 PM");
  t.check(inZone("Asia/Kolkata", () => friendlyDate(iso, "time").replace(/\s/gu, " ")), "8:30 AM");
  t.check(inZone("Pacific/Kiritimati", () => friendlyDate("2026-08-14", "time")), "Aug 14, 2026");
});
