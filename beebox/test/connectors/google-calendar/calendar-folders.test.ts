// `bbx calendar`'s events come from every calendar card's folder, labeled with
// that card's calendar. The card, not the file, says which calendar it is:
// files synced before the product rename carry their calendar properties
// under another prefix, and a reader calendar's name must still show.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { loadBoxEvents } from "../../../src/connectors/google-calendar/calendar-folders.js";
import { createCalendarTemplate } from "../../../src/schemas/calendar.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

void test("events are labeled with their folder's calendar card", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.seed("_content/calendar/School.calendar.card", createCalendarTemplate({ name: "School", id: "school@group", access: "reader", syncing: true }));
  // No calendar properties at all, as an old file reads to the current parser.
  await box.seed("_content/calendar/School.attach/2026-11-03_Open_house_a1b2c3d4.ics",
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Open house\r\nDTSTART:20261103T180000Z\r\nDTEND:20261103T190000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
  const events = await loadBoxEvents(box.root, { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-08T00:00:00Z") });
  t.check(events.map((e) => ({ summary: e.summary, calendarId: e.calendarId, calendarName: e.calendarName, calendarRole: e.calendarRole })), [
    { summary: "Open house", calendarId: "school@group", calendarName: "School", calendarRole: "reader" },
  ]);
});
