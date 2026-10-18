// # FriendlyDate — date-only strings are calendar days, not instants
//
// `new Date("2026-08-14")` parses as UTC midnight, so formatting it in the
// browser's zone renders the *previous* day anywhere behind UTC — a todo due
// `2026-08-14` showed as "due Aug 13, 2026" on the Plate in US timezones.
// `formatOptions` pins date-only values to UTC (and drops the time) so the day
// shown is the day written; full timestamps keep local-zone formatting.

import { test } from "tap";
import "agent-doctest/tap";
import { formatOptions } from "../../../src/components/ui/FriendlyDate.js";

// A date-only string formats in UTC regardless of `mode`, so the rendered day
// matches the written day in every runner timezone:
void test("A date-only string formats in UTC regardless of mode, so the rendered day mat...", async (t) => {
  // doctest:L17
  t.check(formatOptions({ iso: "2026-08-14", mode: "date" }).timeZone, "UTC");

  // doctest:L20
  t.check(new Date("2026-08-14").toLocaleString("en-US", formatOptions({ iso: "2026-08-14", mode: "date" })), "Aug 14, 2026");

  // doctest:L23
  await t.checkText(formatOptions({ iso: "2026-08-14" }).timeStyle === undefined, "true");
});

// Full timestamps are instants and keep the viewer's local zone (no `timeZone`
// pin), with time shown unless `mode: "date"`:
void test("Full timestamps are instants and keep the viewer's local zone (no timeZone pi...", async (t) => {
  // doctest:L31
  const full = formatOptions({ iso: "2026-08-14T10:00:00Z" });
  t.check([String(full.timeZone), String(full.timeStyle)].join(" "), "undefined short");

  // doctest:L35
  await t.checkText(formatOptions({ iso: "2026-08-14T10:00:00Z", mode: "date" }).timeStyle === undefined, "true");
});
