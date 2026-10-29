// # `calendar-folders-2026-10`: the flat calendar becomes one folder per card
//
// Before, every event was `_content/calendar/{date}_{shortId}.ics`. After, each
// calendar is a `<Name>.calendar.card` with its events in `<Name>.attach/`,
// named `{date}_{title}_{shortId}.ics`. File contents do not change, so a
// recorded hash still matches and a pending local edit stays pending.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { join } from "node:path";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { planCalendarFolders, type CalendarFoldersInput } from "../../../src/scripts/migrate/calendar-folders/plan.js";
import { runCalendarFolders } from "../../../src/scripts/migrate/calendar-folders/run.js";
import { loadCalendarState } from "../../../src/connectors/google-calendar/state.js";
import { contentHash } from "../../../src/lib/content-hash.js";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";

const ics = (summary: string, { start, calendarId }: { start: string; calendarId?: string }): string =>
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Bee Box//EN\r\nBEGIN:VEVENT\r\n" +
  `UID:x\r\nSUMMARY:${summary}\r\nDTSTART;VALUE=DATE:${start}\r\n` +
  (calendarId === undefined ? "" : `X-BBX-CALENDAR-ID:${calendarId}\r\n`) +
  "END:VEVENT\r\nEND:VCALENDAR\r\n";

const input = (over: Partial<CalendarFoldersInput>): CalendarFoldersInput => ({
  index: {}, topFiles: new Map(), strandedFiles: new Map(), cards: new Map(), existing: new Set(),
  calendars: ["primary", "school@group"], names: { primary: "Priya Marlowe", "school@group": "School" },
  roles: { primary: "owner", "school@group": "reader" },
  ...over,
});

// The date and short id come from the old name and the event id, the title
// from SUMMARY; a calendar-hash suffix from the old flat layout is dropped. A
// pushed local event still under its own name takes the date from DTSTART.
void test("tracked files move into their calendar's folder under the readable name", (t) => {
  const plan = planCalendarFolders(input({
    index: {
      "abcdefghswim0001 primary": { filename: "2026-06-25_swim0001.ics", calendarId: "primary", contentHash: "h1" },
      "zzzzzzzzopen0002 school@group": { filename: "2026-07-02_open0002_4ea140.ics", calendarId: "school@group" },
      "evt-new-1 primary": { filename: "annotated.ics", calendarId: "primary", pendingSince: "2026-06-01T00:00:00.000Z" },
    },
    topFiles: new Map([
      ["2026-06-25_swim0001.ics", ics("Juni's swim meet!", { start: "20260625" })],
      ["2026-07-02_open0002_4ea140.ics", ics("Open house", { start: "20260702" })],
      ["annotated.ics", ics("Book the hall", { start: "20260801" })],
    ]),
  }));
  t.check(plan, {
    kind: "migrate",
    cards: [
      { stem: "Priya_Marlowe", id: "primary", name: "Priya Marlowe", access: "owner", syncing: true },
      { stem: "School", id: "school@group", name: "School", access: "reader", syncing: true },
    ],
    moves: [
      { from: "2026-06-25_swim0001.ics", to: "Priya_Marlowe.attach/2026-06-25_Junis_swim_meet_swim0001.ics" },
      { from: "2026-07-02_open0002_4ea140.ics", to: "School.attach/2026-07-02_Open_house_open0002.ics" },
      { from: "annotated.ics", to: "Priya_Marlowe.attach/2026-08-01_Book_the_hall_vt-new-1.ics" },
    ],
    index: {
      "abcdefghswim0001 primary": { filename: "2026-06-25_Junis_swim_meet_swim0001.ics", calendarId: "primary", contentHash: "h1" },
      "zzzzzzzzopen0002 school@group": { filename: "2026-07-02_Open_house_open0002.ics", calendarId: "school@group" },
      "evt-new-1 primary": { filename: "2026-08-01_Book_the_hall_vt-new-1.ics", calendarId: "primary", pendingSince: "2026-06-01T00:00:00.000Z" },
    },
    leftAlone: [],
  });
  t.end();
});

// Untracked files are local events not yet pushed: they go to the calendar the
// file names, else to the first configured calendar, as the old push did. A
// legacy entry takes the calendar its file names. Stranded files move only
// when they name a calendar.
void test("untracked, legacy, and stranded files go to the calendar they name", (t) => {
  const plan = planCalendarFolders(input({
    index: { "oldevent0003 (legacy)": "2026-06-01_ent0003.ics" },
    topFiles: new Map([
      ["2026-06-01_ent0003.ics", ics("Concert", { start: "20260601", calendarId: "school@group" })],
      ["new.ics", ics("Dentist", { start: "20260610" })],
    ]),
    strandedFiles: new Map([
      ["kept.ics", ics("Kept", { start: "20260501", calendarId: "school@group" })],
      ["anon.ics", ics("Anon", { start: "20260502" })],
    ]),
    cards: new Map([["school@group", "School"]]),
  }));
  t.check(plan, {
    kind: "migrate",
    cards: [{ stem: "Priya_Marlowe", id: "primary", name: "Priya Marlowe", access: "owner", syncing: true }],
    moves: [
      { from: "2026-06-01_ent0003.ics", to: "School.attach/2026-06-01_Concert_vent0003.ics" },
      { from: "new.ics", to: "Priya_Marlowe.attach/new.ics" },
      { from: "stranded/kept.ics", to: "School.attach/stranded/kept.ics" },
    ],
    index: { "oldevent0003 school@group": { filename: "2026-06-01_Concert_vent0003.ics", calendarId: "school@group" } },
    leftAlone: ["stranded/anon.ics"],
  });
  t.end();
});

// A plan that would put a file on top of another, or cannot place one, writes
// nothing. A box with no top-level `.ics` (and no stranded file naming a
// calendar) is already current.
void test("an occupied destination or an unplaceable file stops the plan; a converted box is current", (t) => {
  t.check(planCalendarFolders(input({
    index: { "abcdefghswim0001 primary": { filename: "2026-06-25_swim0001.ics", calendarId: "primary" } },
    topFiles: new Map([["2026-06-25_swim0001.ics", ics("Swim", { start: "20260625" })]]),
    existing: new Set(["Priya_Marlowe.attach", "Priya_Marlowe.attach/2026-06-25_Swim_swim0001.ics"]),
    cards: new Map([["primary", "Priya_Marlowe"]]),
  })), {
    kind: "error",
    reasons: ["2026-06-25_swim0001.ics: destination Priya_Marlowe.attach/2026-06-25_Swim_swim0001.ics is already taken"],
  });
  t.check(planCalendarFolders(input({
    index: { "oldevent0003 (legacy)": "2026-06-01_ent0003.ics" },
    topFiles: new Map([["2026-06-01_ent0003.ics", ics("Concert", { start: "20260601" })]]),
  })), { kind: "error", reasons: ["2026-06-01_ent0003.ics: tracked with no calendar, and the file names none"] });
  t.check(planCalendarFolders(input({ strandedFiles: new Map([["anon.ics", ics("Anon", { start: "20260502" })]]) })), { kind: "current" });
  t.end();
});

async function flatBox(): Promise<{ box: TmpBox; edited: string }> {
  const box = await makeTmpBox({ git: true });
  const written = ics("Swim meet", { start: "20260625" });
  const edited = ics("Swim meet (moved to Tuesday)", { start: "20260625" });
  await box.seed("_config/connectors/google-calendar.json", JSON.stringify({
    calendars: ["primary"], calendarNames: { primary: "Family" }, calendarRoles: { primary: "owner" },
  }));
  // The file holds an edit Google has not taken yet: its bytes differ from the recorded hash.
  await box.seed("_content/calendar/2026-06-25_swim0001.ics", edited);
  await box.seed("_bookkeeping/connectors/google-calendar-state.json", JSON.stringify({
    version: 2, syncTokens: {},
    eventFiles: {
      "abcdefghswim0001 primary": {
        filename: "2026-06-25_swim0001.ics", calendarId: "primary",
        contentHash: contentHash(written), pendingSince: "2026-06-20T00:00:00.000Z",
      },
    },
  }));
  return { box, edited };
}

void test("apply moves the files, keeps a pending edit pending, and a second run is current", async (t) => {
  const { box, edited } = await flatBox();
  t.teardown(() => box.cleanup());
  const applied = await runCalendarFolders({ boxRoot: box.root, mode: "apply" });
  const state = await loadCalendarState(box.root);
  const moved = await readFile(join(box.root, "_content/calendar/Family.attach/2026-06-25_Swim_meet_moved_to_Tuesday_swim0001.ics"), "utf-8");
  t.check({
    applied,
    entry: state.eventFiles["abcdefghswim0001 primary"],
    stillPending: moved === edited,
    top: (await readdir(join(box.root, "_content/calendar"))).filter((f) => f !== ".gitkeep").toSorted(),
  }, {
    applied: { code: 0, lines: [
      "calendar-folders: card Family.calendar.card for primary",
      "calendar-folders: move 2026-06-25_swim0001.ics -> Family.attach/2026-06-25_Swim_meet_moved_to_Tuesday_swim0001.ics",
    ] },
    entry: {
      filename: "2026-06-25_Swim_meet_moved_to_Tuesday_swim0001.ics", calendarId: "primary",
      contentHash: contentHash(ics("Swim meet", { start: "20260625" })), pendingSince: "2026-06-20T00:00:00.000Z",
    },
    stillPending: true,
    top: ["Family.attach", "Family.calendar.card"],
  });
  t.check(await runCalendarFolders({ boxRoot: box.root, mode: "apply" }), { code: 0, lines: ["calendar-folders: already current."] });
});

// A run interrupted after some moves leaves its journal. The rerun finishes
// the same plan from the journal, rather than re-planning from a half-moved
// box, and a journal that cannot be finished stops the run and stays.
void test("an interrupted run is finished from its journal; an unfinishable one stays", async (t) => {
  const { box } = await flatBox();
  t.teardown(() => box.cleanup());
  await runCalendarFolders({ boxRoot: box.root, mode: "apply" });
  const journal = join(box.root, "_bookkeeping/connectors/google-calendar-migration.json");
  const from = "2026-06-25_swim0001.ics";
  const to = "Family.attach/2026-06-25_Swim_meet_moved_to_Tuesday_swim0001.ics";
  // Put the box back as a crash after the card write, before the move, would leave it.
  await rename(join(box.root, "_content/calendar", to), join(box.root, "_content/calendar", from));
  const state = JSON.parse(await readFile(join(box.root, "_bookkeeping/connectors/google-calendar-state.json"), "utf-8"));
  await writeFile(journal, JSON.stringify({ cards: [], moves: [{ from, to }], eventFiles: state.eventFiles }));
  t.check(await runCalendarFolders({ boxRoot: box.root, mode: "apply" }), { code: 0, lines: ["calendar-folders: finished an interrupted run."] });

  await writeFile(journal, JSON.stringify({ cards: [], moves: [{ from: "gone.ics", to: "Family.attach/gone.ics" }], eventFiles: {} }));
  t.check(await runCalendarFolders({ boxRoot: box.root, mode: "apply" }), { code: 1, lines: [
    "calendar-folders: stopped: gone.ics is gone and Family.attach/gone.ics does not exist. The journal stays at _bookkeeping/connectors/google-calendar-migration.json and calendar sync is refused until it is resolved.",
  ] });
});
