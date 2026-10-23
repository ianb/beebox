// `bbx remind`'s time rules (`src/cli/commands/remind/time.ts`): `--in` adds to
// box time; an offset-less `--at` is box-zone wall time, written to the card with
// an explicit offset; a skipped or repeated wall time, an offset-less `--at` on a
// box with no zone, and a past instant are refused. The host's own zone never
// enters: the file sets TZ to a zone neither box uses.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { formatCardAt, formatClock, formatDate, formatWhen, resolveReminderTime } from "../../../../src/cli/commands/remind/time.js";

process.env.TZ = "Asia/Tokyo";
const CHICAGO = "America/Chicago";
const now = new Date("2026-10-18T14:00:00Z");

function at(value: string, zone: string | null) {
  const r = resolveReminderTime({ in: undefined, at: value, now, zone });
  return r.ok ? { at: formatCardAt(r.value, zone), echo: formatWhen(r.value, zone) } : r.error;
}

void test("--in adds to box time and echoes in the box zone", async (t) => {
  const r = resolveReminderTime({ in: "30d", at: undefined, now, zone: CHICAGO });
  t.check(r.ok ? [formatCardAt(r.value, CHICAGO), formatWhen(r.value, CHICAGO)] : r.error, ["2026-11-17T08:00:00-06:00", "Tue 2026-11-17 08:00 CST"]);
});

// The box zone, not the host's (Tokyo): 09:00 in Chicago is 15:00 UTC in November.
void test("an offset-less --at is box-zone wall time, written with its offset", async (t) => {
  t.check(at("2026-11-18T09:00", CHICAGO), { at: "2026-11-18T09:00:00-06:00", echo: "Wed 2026-11-18 09:00 CST" });
  t.check(at("2026-11-18 09:00", CHICAGO), { at: "2026-11-18T09:00:00-06:00", echo: "Wed 2026-11-18 09:00 CST" });
});

void test("an --at with an offset is that instant, shown in the box zone", async (t) => {
  t.check(at("2026-11-18T09:00+01:00", CHICAGO), { at: "2026-11-18T02:00:00-06:00", echo: "Wed 2026-11-18 02:00 CST" });
});

void test("a wall time the clocks skip or repeat is refused", async (t) => {
  t.check(resolveReminderTime({ in: undefined, at: "2027-03-14T02:30", now, zone: CHICAGO }), {
    ok: false,
    error: "--at \"2027-03-14T02:30\" does not exist in America/Chicago (the clocks skip it); add an offset",
  });
  t.check(resolveReminderTime({ in: undefined, at: "2026-11-01T01:30", now, zone: CHICAGO }), {
    ok: false,
    error: "--at \"2026-11-01T01:30\" happens twice in America/Chicago (the clocks fall back); add an offset to pick one",
  });
  // The hours next to each transition are ordinary.
  t.check(at("2027-03-14T03:30", CHICAGO), { at: "2027-03-14T03:30:00-05:00", echo: "Sun 2027-03-14 03:30 CDT" });
  t.check(at("2026-11-01T02:30", CHICAGO), { at: "2026-11-01T02:30:00-06:00", echo: "Sun 2026-11-01 02:30 CST" });
});

void test("a box with no timezone refuses an offset-less --at and echoes in UTC", async (t) => {
  t.check(at("2026-11-18T09:00", null), "This box has no timezone set, so --at \"2026-11-18T09:00\" is ambiguous; add the person's own UTC offset (Z for UTC, or ±HH:MM after the time), or set \"timezone\" in _config/box.json");
  t.check(at("2026-11-18T09:00Z", null), { at: "2026-11-18T09:00:00Z", echo: "Wed 2026-11-18 09:00 UTC" });
});

void test("malformed, impossible, past, and missing times are refused", async (t) => {
  t.check(
    [
      at("next tuesday", CHICAGO),
      at("2026-02-30T09:00", CHICAGO),
      at("2026-10-18T08:00", CHICAGO),
      resolveReminderTime({ in: "soon", at: undefined, now, zone: CHICAGO }),
      resolveReminderTime({ in: "0m", at: undefined, now, zone: CHICAGO }),
      resolveReminderTime({ in: "1d", at: "2026-11-18T09:00", now, zone: CHICAGO }),
      resolveReminderTime({ in: undefined, at: undefined, now, zone: CHICAGO }),
    ],
    [
      "--at \"next tuesday\" is not a datetime; use YYYY-MM-DDTHH:MM in the box's timezone, or add the person's UTC offset (Z for UTC, or ±HH:MM after the time)",
      "--at \"2026-02-30T09:00\" is not a real date and time; use YYYY-MM-DDTHH:MM in the box's timezone, or add the person's UTC offset (Z for UTC, or ±HH:MM after the time)",
      "Sun 2026-10-18 08:00 CDT is not in the future (now Sun 2026-10-18 09:00 CDT); pick a later time",
      { ok: false, error: "--in \"soon\" is not a duration; use a number and a unit s, m, h, d, or w (20m, 30d)" },
      { ok: false, error: "Sun 2026-10-18 09:00 CDT is not in the future (now Sun 2026-10-18 09:00 CDT); pick a later time" },
      { ok: false, error: "Give --in or --at, not both" },
      { ok: false, error: "A reminder needs a time: --in <duration> (20m, 30d) or --at <datetime> (2026-11-18T09:00); add --here for a check-in in this chat" },
    ],
  );
});

void test("the clock and date helpers use the box zone", async (t) => {
  t.check([formatClock(now, CHICAGO), formatDate(new Date("2026-10-19T03:00:00Z"), CHICAGO), formatClock(now, null)], ["09:00 CDT", "2026-10-18", "14:00 UTC"]);
});

// A field out of range is refused, not rolled into the next month or year:
// `Date.UTC(2026, 12, 18)` is 2027-01-18, which is not what was asked for.
void test("a month or offset out of range is refused", async (t) => {
  t.check([at("2026-13-18T09:00Z", CHICAGO), at("2026-11-18T09:00+15:00", CHICAGO)], [
    "--at \"2026-13-18T09:00Z\" is not a real date and time; use YYYY-MM-DDTHH:MM in the box's timezone, or add the person's UTC offset (Z for UTC, or ±HH:MM after the time)",
    "--at \"2026-11-18T09:00+15:00\" has an offset past ±14:00; use YYYY-MM-DDTHH:MM in the box's timezone, or add the person's UTC offset (Z for UTC, or ±HH:MM after the time)",
  ]);
});
