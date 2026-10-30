// # The calendar day an instant falls on in a timezone
//
// One instant is two days at once across the date line; `localDay` names the
// one the zone sees, as `YYYY-MM-DD`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { localDay } from "../../src/shared/local-day.js";

// An instant early on the 23rd in UTC is still the 22nd in Los Angeles:
void test("An instant early on the 23rd in UTC is still the 22nd in Los Angeles:", async (t) => {
  const now = new Date("2026-10-23T03:00:00Z");
  t.check({ utc: localDay(now, "UTC"), la: localDay(now, "America/Los_Angeles"), auckland: localDay(now, "Pacific/Auckland") }, {
    utc: "2026-10-23",
    la: "2026-10-22",
    auckland: "2026-10-23",
  });
});
