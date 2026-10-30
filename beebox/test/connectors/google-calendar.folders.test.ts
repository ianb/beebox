// # Google Calendar connector: calendar cards and their folders
//
// Each synced calendar is a `<Name>.calendar.card` in `_content/calendar/`, and
// its events live in the card's attach folder. The folder decides which
// calendar a new local event goes to. This file covers card creation and
// re-stamping, the files that sit outside any folder, the cases where a
// calendar has no usable card, and the refusal to sync while the folder
// migration is unfinished.

import { after, test } from "tap";
import "@ianbicking/tap-check/tap";
import { join } from "node:path";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { initBox } from "../../src/core/box/structure/core.js";
import { createFakeGoogleCalendar } from "../../src/services/google-calendar/core.js";
import type { CalendarEvent, CalendarListEntry, GoogleCalendarService } from "../../src/services/google-calendar/core.js";
import { createGoogleCalendarConnector } from "../../src/connectors/google-calendar/connector.js";
import { loadCalendarState } from "../../src/connectors/google-calendar/state.js";

const NOW = () => new Date("2026-06-15T12:00:00Z");

const FAMILY: CalendarListEntry = { id: "family@group", summary: "Family", accessRole: "owner" };
const SCHOOL: CalendarListEntry = { id: "school@group", summary: "School", accessRole: "reader" };

const boxes: TmpBox[] = [];
after(async () => {
  try {
    await Promise.all(boxes.map((box) => box.cleanup()));
  } catch (error) {
    console.error("teardown failed:", error);
    process.exitCode = 1;
  }
});

async function newBox(calendars: string[]): Promise<TmpBox> {
  const box = await makeTmpBox({ git: true });
  boxes.push(box);
  await initBox(box.root);
  await box.seed("_config/connectors/google-calendar.json", JSON.stringify({ calendars }, null, 2));
  box.commitAll("init box");
  return box;
}

/**
 * The shipped fake returns one event list for every calendar, so an inserted
 * event would come back from every calendar's next pull. This one records
 * which calendar each insert went to and keeps it out of later pulls.
 */
function calendarsWith(entries: CalendarListEntry[], events: CalendarEvent[]): GoogleCalendarService & { inserts: string[]; entries: CalendarListEntry[] } {
  // Copies, so a test that renames a calendar does not rename it for the next.
  const inner = createFakeGoogleCalendar({ calendars: entries.map((e) => ({ ...e })), events });
  const inserts: string[] = [];
  let next = 1;
  return {
    ...inner,
    inserts,
    entries: inner.calendars,
    async insertEvent(calendarId, event) {
      inserts.push(`${calendarId}: ${event.summary ?? ""}`);
      return { ...event, id: `new${String(next++)}`, status: "confirmed" };
    },
  };
}

const localIcs = (uid: string, { summary, extra }: { summary: string; extra?: string }): string =>
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\n" +
  `UID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART;VALUE=DATE:20260620\r\nDTEND;VALUE=DATE:20260621\r\n` +
  `${extra ?? ""}END:VEVENT\r\nEND:VCALENDAR\r\n`;

const sync = async (box: TmpBox, calendar: GoogleCalendarService) =>
  createGoogleCalendarConnector(box.root, { calendar, now: NOW }).sync();

const calRoot = (box: TmpBox) => join(box.root, "_content/calendar");

const listing = async (box: TmpBox) => (await readdir(calRoot(box))).filter((f) => f !== ".gitkeep").toSorted();

// ## The first sync makes one card per calendar, and the folder is the calendar
//
// The cards are named from the Google names. A file dropped into a calendar's
// folder is pushed to that calendar, with no X-BBX-CALENDAR-ID in it. The two
// folders may hold files of the same name: each folder's tracked set is its own.
void test("the first sync makes one card per calendar, and the folder is the calendar", async (t) => {
  const box = await newBox(["family@group", "school@group"]);
  const calendar = calendarsWith([FAMILY, SCHOOL], []);
  await sync(box, calendar);

  t.check(await listing(box), [
    "Family.attach", "Family.calendar.card", "School.attach", "School.calendar.card",
  ]);
  t.check(await readFile(join(calRoot(box), "Family.calendar.card"), "utf-8"),
    "---\ntitle: Family\ngoogle-calendar:\n  id: family@group\n  access: owner\n  syncing: true\n---\n");

  await box.seed("_content/calendar/Family.attach/dentist.ics", localIcs("u1", { summary: "Dentist" }));
  await box.seed("_content/calendar/School.attach/dentist.ics", localIcs("u2", { summary: "Dentist" }));
  const pushed = await sync(box, calendar);
  t.check({ pushed: pushed.pushed, inserts: calendar.inserts }, {
    pushed: ["_content/calendar/Family.attach/dentist.ics", "_content/calendar/School.attach/dentist.ics"],
    inserts: ["family@group: Dentist", "school@group: Dentist"],
  });
  // A third run pushes nothing: both files are now tracked, each in its own calendar.
  const quiet = await sync(box, calendar);
  t.check({ success: quiet.success, inserts: calendar.inserts.length }, { success: true, inserts: 2 });
});

// ## The card follows Google, and keeps what a person wrote
//
// A rename in Google changes `title` only (the file name stays), and a calendar
// taken out of the sync set says `syncing: false`. The body and any field a
// person added are left alone.
void test("the card follows Google and keeps what a person wrote", async (t) => {
  const box = await newBox(["family@group"]);
  const calendar = calendarsWith([FAMILY], []);
  await sync(box, calendar);

  const card = join(calRoot(box), "Family.calendar.card");
  await writeFile(card, (await readFile(card, "utf-8")).replace("---\n", "---\ncontains: Juni's swim meets\n") + "Shared with Tomas.\n");
  const entry = calendar.entries[0];
  if (entry) entry.summary = "Marlowe Family";
  await box.seed("_config/connectors/google-calendar.json", JSON.stringify({ calendars: [] }, null, 2));
  await sync(box, calendar);

  t.check(await readFile(card, "utf-8"),
    "---\ncontains: Juni's swim meets\ntitle: Marlowe Family\ngoogle-calendar:\n  id: family@group\n  access: owner\n  syncing: false\n---\nShared with Tomas.\n");
});

// ## Files outside a calendar folder, or naming another calendar, wait for a person
//
// A file directly in `_content/calendar/` belongs to no calendar. A file whose
// X-BBX-CALENDAR-ID names a different calendar than its folder is ambiguous.
// Both are reported on the sync and neither is pushed or moved.
void test("files outside a calendar folder, or naming another calendar, are reported and not pushed", async (t) => {
  const box = await newBox(["family@group", "school@group"]);
  const calendar = calendarsWith([FAMILY, SCHOOL], []);
  await sync(box, calendar);
  await box.seed("_content/calendar/loose.ics", localIcs("u1", { summary: "Loose" }));
  await box.seed("_content/calendar/Family.attach/mixed.ics", localIcs("u2", { summary: "Mixed", extra: "X-BBX-CALENDAR-ID:school@group\r\n" }));

  const result = await sync(box, calendar);
  t.check({ success: result.success, error: result.error, inserts: calendar.inserts }, {
    success: false,
    error: "Calendar sync failed for (none) _content/calendar/loose.ics (local-push, local: not in a calendar folder; move it into the attach folder of the calendar it belongs to), " +
      "family@group _content/calendar/Family.attach/mixed.ics (local-push, local: X-BBX-CALENDAR-ID names another calendar; move the file to that calendar's folder or remove the line)",
    inserts: [],
  });
});

// ## A calendar without a usable card is skipped and named
//
// Two cards claiming one calendar: neither is used until one is removed. A card
// deleted while its calendar's events are still tracked: the card is not
// re-created empty, since the tracked files would then be missing with nothing to
// fetch them again. Either way the other calendars still sync.
void test("a calendar with two cards, or whose card was deleted, is skipped and named", async (t) => {
  const box = await newBox(["family@group", "school@group"]);
  const events: CalendarEvent[] = [{
    id: "evt-1", status: "confirmed", summary: "Swim meet",
    start: { dateTime: "2026-06-10T09:00:00Z" }, end: { dateTime: "2026-06-10T10:00:00Z" },
  }];
  const calendar = calendarsWith([FAMILY, SCHOOL], events);
  await sync(box, calendar);

  const family = join(calRoot(box), "Family.calendar.card");
  await writeFile(join(calRoot(box), "Copy.calendar.card"), await readFile(family, "utf-8"));
  await rm(join(calRoot(box), "School.calendar.card"));
  const result = await sync(box, calendar);

  t.check({
    success: result.success,
    error: result.error,
    files: await listing(box),
    tracked: Object.keys((await loadCalendarState(box.root)).eventFiles).toSorted(),
  }, {
    success: false,
    error: "Calendar sync failed for family@group _content/calendar/Family.calendar.card (stale-cleanup, local: two calendar cards name this calendar; it is not synced until one is removed), " +
      "school@group (stale-cleanup, local: no calendar card for 1 tracked events; restore the card or remove the calendar in settings)",
    files: ["Copy.calendar.card", "Family.attach", "Family.calendar.card", "School.attach"],
    tracked: ["evt-1 family@group", "evt-1 school@group"],
  });
});

// ## An unfinished folder migration blocks the sync
//
// While the migration's journal exists, some files may be moved while the index
// still names their old place. A sync would read them as new local events and
// insert them into Google, so it refuses and says what to run.
void test("an unfinished folder migration blocks the sync", async (t) => {
  const box = await newBox(["family@group"]);
  await box.seed("_bookkeeping/connectors/google-calendar-migration.json", "{}");
  const calendar = calendarsWith([FAMILY], []);
  t.check(await sync(box, calendar), {
    success: false, created: [], updated: [],
    error: "Calendar sync refused: the calendar-folders migration is unfinished (run bbx engine migrate)",
  });
});
