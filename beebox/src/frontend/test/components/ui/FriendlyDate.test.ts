// # FriendlyDate — date-only strings are calendar days, not instants
//
// `new Date("2026-08-14")` parses as UTC midnight, so formatting it in the
// browser's zone renders the *previous* day anywhere behind UTC — a todo due
// `2026-08-14` showed as "due Aug 13, 2026" on the Plate in US timezones.
// `formatOptions` pins date-only values to UTC (and drops the time) so the day
// shown is the day written; full timestamps keep local-zone formatting.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { formatOptions, friendlyDate } from "../../../src/components/ui/FriendlyDate.js";

// A date-only string formats in UTC regardless of `mode`, so the rendered day
// matches the written day in every runner timezone:
void test("A date-only string formats in UTC regardless of mode, so the rendered day mat...", async (t) => {
  t.check(formatOptions({ iso: "2026-08-14", mode: "date" }), { dateStyle: "medium", timeZone: "UTC" });

  t.check(new Date("2026-08-14").toLocaleString("en-US", formatOptions({ iso: "2026-08-14", mode: "date" })), "Aug 14, 2026");

  t.check(formatOptions({ iso: "2026-08-14" }), { dateStyle: "medium", timeZone: "UTC" });
});

// Full timestamps are instants and keep the viewer's local zone (no `timeZone`
// pin), with time shown unless `mode: "date"`:
void test("Full timestamps are instants and keep the viewer's local zone (no timeZone pi...", async (t) => {
  const full = formatOptions({ iso: "2026-08-14T10:00:00Z" });
  t.check(full, { dateStyle: "medium", timeStyle: "short" });

  t.check(formatOptions({ iso: "2026-08-14T10:00:00Z", mode: "date" }), { dateStyle: "medium" });
});

// `friendlyDate` is the text the component shows, for sentences and titles. It
// takes epoch milliseconds too, and an unparseable value comes back as written
// instead of "Invalid Date":
void test("friendlyDate formats strings and epochs, and returns bad input as written", async (t) => {
  t.check(friendlyDate("2026-08-14", "date"), "Aug 14, 2026");
  t.check(friendlyDate("2026-08-14"), "Aug 14, 2026");
  t.check(friendlyDate(Date.UTC(2026, 7, 14, 12)), friendlyDate(new Date(Date.UTC(2026, 7, 14, 12)).toISOString()));
  t.check(friendlyDate("sometime"), "sometime");
});
