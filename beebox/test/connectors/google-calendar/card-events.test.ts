// The calendar card page's events: one folder's files in a range. A single
// event outside the range is left out (loading only expands recurrence within
// it), a recurring series is expanded, and a file that does not parse is named
// rather than silently dropped, so the page never shows "No events" over an
// incomplete read.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { join } from "node:path";
import { loadCardEvents } from "../../../src/connectors/google-calendar/card-events.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const ics = (summary: string, lines: string): string =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${summary}\r\nSUMMARY:${summary}\r\n${lines}END:VEVENT\r\nEND:VCALENDAR\r\n`;

void test("events in range, recurrence expanded, unreadable files named", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const dir = "_content/calendar/Family.attach";
  await box.seed(`${dir}/a.ics`, ics("Dentist", "DTSTART:20261105T150000Z\r\nDTEND:20261105T160000Z\r\nLOCATION:Lakeview Dental\r\n"));
  await box.seed(`${dir}/b.ics`, ics("Far off", "DTSTART:20261220T150000Z\r\nDTEND:20261220T160000Z\r\n"));
  await box.seed(`${dir}/c.ics`, ics("Swim", "DTSTART:20261030T163000Z\r\nDTEND:20261030T180000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\n"));
  await box.seed(`${dir}/d.ics`, "not a calendar\n");

  t.check(await loadCardEvents(join(box.root, dir), { from: new Date("2026-10-29T00:00:00Z"), to: new Date("2026-11-28T00:00:00Z") }), {
    events: [
      { start: "2026-10-30T16:30:00.000Z", end: "2026-10-30T18:00:00.000Z", allDay: false, summary: "Swim", location: undefined, file: "c.ics" },
      { start: "2026-11-05T15:00:00.000Z", end: "2026-11-05T16:00:00.000Z", allDay: false, summary: "Dentist", location: "Lakeview Dental", file: "a.ics" },
      { start: "2026-11-06T16:30:00.000Z", end: "2026-11-06T18:00:00.000Z", allDay: false, summary: "Swim", location: undefined, file: "c.ics" },
      { start: "2026-11-13T16:30:00.000Z", end: "2026-11-13T18:00:00.000Z", allDay: false, summary: "Swim", location: undefined, file: "c.ics" },
    ],
    unreadable: ["d.ics"],
  });
});
