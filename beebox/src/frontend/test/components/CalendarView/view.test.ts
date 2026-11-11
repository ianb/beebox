// # CalendarView — the window and the day groups are calendar days
//
// A calendar card lists the next 30 days of events, grouped by day
// (`src/components/CalendarView/view.tsx`). The window starts at the start of
// today in the viewer's zone. An all-day event is its calendar day in every
// zone; a timed event falls on the day its start is in the viewer's zone.

import "../../helpers/temporal-global.js";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { byDay, upcomingWindow } from "../../../src/components/CalendarView/view.js";

// The query runs from the start of today to the start of the day 30 days on,
// each in the viewer's zone, across the DST change on Nov 1:
void test("The window runs from the start of today for 30 days, in the viewer's zone", async (t) => {
  const window = upcomingWindow(Temporal.ZonedDateTime.from("2026-10-20T15:30[America/New_York]"));
  t.check(
    { first: window.first.toString(), last: window.last.toString(), from: window.from.toString(), to: window.to.toString(), timeZone: window.timeZone },
    { first: "2026-10-20", last: "2026-11-19", from: "2026-10-20T04:00:00Z", to: "2026-11-19T05:00:00Z", timeZone: "America/New_York" },
  );
});

// An all-day event stays on its date in every zone. A timed event at 02:00
// UTC on Nov 6 is still Nov 5 in Los Angeles, so it joins Nov 5's group there
// and Nov 6's in Tokyo:
void test("Events group by calendar day: all-day by its date, timed by the viewer's zone", async (t) => {
  const events = [
    { start: "2026-11-05", allDay: true, summary: "Holiday", file: "a.ics" },
    { start: "2026-11-06T02:00:00.000Z", allDay: false, summary: "Call", file: "b.ics" },
    { start: "2026-11-06", allDay: true, summary: "Trip", file: "c.ics" },
  ];
  const groups = (tz: string) => byDay(events, tz).map(([label, list]) => [label, list.map((event) => event.summary)]);
  t.check(groups("America/Los_Angeles"), [["Thu, Nov 5", ["Holiday", "Call"]], ["Fri, Nov 6", ["Trip"]]]);
  t.check(groups("Asia/Tokyo"), [["Thu, Nov 5", ["Holiday"]], ["Fri, Nov 6", ["Call", "Trip"]]]);
});
