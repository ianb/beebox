// # Calendar events are tracked per (event, calendar)
//
// A Google event id is unique within ONE calendar, not across calendars, so a box
// syncing two calendars can hold two different events with the same id. The
// connector's index (`eventFiles` in
// `_bookkeeping/connectors/google-calendar-state.json`) is therefore keyed
// `<eventId> <calendarId>` — see `src/connectors/google-calendar/event-index.ts`
// for why the separator is a space and why the calendar id comes last.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { join } from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { initBox } from "../../../src/core/box/structure/core.js";
import { createFakeGoogleCalendar } from "../../../src/services/google-calendar/core.js";
import type {
  CalendarEvent,
  CalendarListEntry,
  EventsListResult,
  GoogleCalendarService,
} from "../../../src/services/google-calendar/core.js";
import { createGoogleCalendarConnector } from "../../../src/connectors/google-calendar/connector.js";
import { loadCalendarState } from "../../../src/connectors/google-calendar/state.js";
import { contentHash } from "../../../src/lib/content-hash.js";

const NOW = () => new Date("2026-06-15T12:00:00Z");

/**
 * A fake that keeps a SEPARATE event list per calendar — the shipped
 * `createFakeGoogleCalendar` returns the same list for every calendar id, which
 * is exactly the distinction under test here. `silent` makes one calendar's
 * next list return nothing, the way an incremental sync with no news does.
 */
interface RoutedCalendar extends GoogleCalendarService {
  byCalendar: Record<string, CalendarEvent[]>;
  silent: Set<string>;
  patched: string[];
  inserted: string[];
}

function makeRoutedCalendar(byCalendar: Record<string, CalendarEvent[]>): RoutedCalendar {
  let nextId = 1;
  const listOf = (calendarId: string): CalendarEvent[] => {
    const events = fake.byCalendar[calendarId];
    if (!events) throw new Error(`no such calendar: ${calendarId}`);
    return events;
  };
  const fake: RoutedCalendar = {
    byCalendar,
    silent: new Set<string>(),
    patched: [],
    inserted: [],
    async listCalendars(): Promise<CalendarListEntry[]> {
      return Object.keys(fake.byCalendar).map((id) => ({ id, summary: id, accessRole: "owner" }));
    },
    async listEvents(calendarId): Promise<EventsListResult> {
      const items = fake.silent.has(calendarId) ? [] : listOf(calendarId);
      return { items: [...items], nextSyncToken: `token-${calendarId}` };
    },
    async insertEvent(calendarId, event): Promise<CalendarEvent> {
      const full: CalendarEvent = { ...event, id: `evt-new-${String(nextId++)}`, status: "confirmed" };
      fake.inserted.push(`${calendarId}/${full.id}`);
      listOf(calendarId).push(full);
      return full;
    },
    async patchEvent(calendarId, { eventId, event }): Promise<CalendarEvent> {
      const events = listOf(calendarId);
      const idx = events.findIndex((e) => e.id === eventId);
      if (idx === -1) throw new Error(`no event ${eventId} on ${calendarId}`);
      const existing = events[idx];
      if (!existing) throw new Error("unreachable: index came from findIndex");
      const merged: CalendarEvent = { ...existing, ...event, id: existing.id, status: existing.status };
      events[idx] = merged;
      fake.patched.push(`${calendarId}/${eventId}`);
      return merged;
    },
    async deleteEvent(calendarId, eventId): Promise<void> {
      fake.byCalendar[calendarId] = listOf(calendarId).filter((e) => e.id !== eventId);
    },
  };
  return fake;
}

const trackedKeys = async (root: string): Promise<string[]> =>
  Object.keys((await loadCalendarState(root)).eventFiles).toSorted();

const icsFiles = async (dir: string): Promise<string[]> =>
  (await readdir(dir)).filter((f) => f.endsWith(".ics")).toSorted();

// ## Two calendars, one event id, one date, two files
//
// Both calendars return an event called `evt-shared`, on the same day. They are
// different events — a standup at work, a dentist appointment at home — and this
// is the ordinary case: one invitation copied into both calendars. Each calendar
// has its own folder (`work.attach/`, `home.attach/`), so each event gets its own
// file and its own entry. Keyed by the bare id, the two would share one entry.
void test("Both calendars return an event called evt-shared, on the same day.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/google-calendar.json", JSON.stringify({
    calendars: ["work", "home"],
  }, null, 2));
  box.commitAll("init two-calendar box");

  const calendar = makeRoutedCalendar({
    work: [{
      id: "evt-shared",
      status: "confirmed",
      summary: "Standup",
      start: { dateTime: "2026-06-10T09:00:00Z" },
      end: { dateTime: "2026-06-10T09:15:00Z" },
    }],
    home: [{
      id: "evt-shared",
      status: "confirmed",
      summary: "Dentist",
      start: { dateTime: "2026-06-10T15:00:00Z" },
      end: { dateTime: "2026-06-10T16:00:00Z" },
    }],
  });

  const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
  const workDir = join(box.root, "_content/calendar/work.attach");
  const dir = join(box.root, "_content/calendar/home.attach");
  const first = await connector.sync();
  t.check({ success: first.success, work: await icsFiles(workDir), home: await icsFiles(dir) }, {
    success: true,
    work: ["2026-06-10_Standup_t-shared.ics"],
    home: ["2026-06-10_Dentist_t-shared.ics"],
  });

  // Both are tracked, under one key each. Keyed by the bare id, the second sync
  // would have overwritten the first's entry and left its file untracked:

  t.check(await trackedKeys(box.root), [
    "evt-shared home",
    "evt-shared work",
  ]);

  // Each file names the calendar it came from:

  const workIcs = await readFile(join(workDir, "2026-06-10_Standup_t-shared.ics"), "utf-8");
  const homeFile = "2026-06-10_Dentist_t-shared.ics";
  const homeIcs = await readFile(join(dir, homeFile), "utf-8");
  t.check(
    {
      work: workIcs.includes("X-BBX-CALENDAR-ID:work"),
      home: homeIcs.includes("X-BBX-CALENDAR-ID:home"),
    },
    {
    work: true,
    home: true,
  },
  );

  // ## The pending-edit pass pushes each edit to its own calendar
  //
  // Edit the home event's file, and let home's next incremental sync return nothing
  // — the pull never sees the edit, so the pending-edit pass owns it. Work's pull
  // still reconciles ITS `evt-shared`, which must not make the pass skip home's.

  calendar.silent.add("home");
  // The title edit is pushed by the pending-edit pass, which leaves the name
  // alone; renaming is the pull's job.
  await writeFile(join(dir, homeFile), homeIcs.replace("SUMMARY:Dentist", "SUMMARY:Dentist MINE"));

  const second = await connector.sync();
  t.check(
    {
      success: second.success,
      patched: calendar.patched,
      remote: calendar.byCalendar["home"]?.[0]?.summary,
      work: calendar.byCalendar["work"]?.[0]?.summary,
    },
    {
    success: true,
    patched: [
      "home/evt-shared",
    ],
    remote: "Dentist MINE",
    work: "Standup",
  },
  );

  // ## A cancellation deletes only its own calendar's file
  //
  // Work cancels its standup. Home's dentist appointment keeps its file and its
  // entry — under the bare-id key, the cancellation deleted whichever file was
  // written last.

  calendar.silent.delete("home");
  calendar.byCalendar["work"] = [{
    id: "evt-shared",
    status: "cancelled",
  }];

  const third = await connector.sync();
  // Home's pull returns the pushed title, so its file is renamed to match.
  const renamedHome = "2026-06-10_Dentist_MINE_t-shared.ics";
  t.check(
    {
      success: third.success,
      work: await icsFiles(workDir),
      home: await icsFiles(dir),
      tracked: await trackedKeys(box.root),
    },
    {
    success: true,
    work: [],
    home: [renamedHome],
    tracked: [
      "evt-shared home",
    ],
  },
  );

  // ## Two entries naming one file are deduped on the way in
  //
  // A box that synced under the old bare-id keys can have written two events into
  // one file. Within one calendar's folder that is still possible. Every pass downstream assumes one file per entry — the pending-edit
  // pass patches "the" event a file belongs to — so the index is deduped once per
  // sync. Here neither entry records a hash, so there is nothing to choose on and
  // index order decides. Untracking the loser is safe because the file stays tracked
  // by the keeper, so the orphan scan never re-inserts it.

  const statePath = join(box.root, "_bookkeeping/connectors/google-calendar-state.json");
  const collided = {
    version: 2,
    syncTokens: {},
    eventFiles: {
      "evt-shared home": { filename: renamedHome, calendarId: "home" },
      "evt-ghost home": { filename: renamedHome, calendarId: "home" },
    },
  };
  await writeFile(statePath, JSON.stringify(collided, null, 2));

  const deduped = await connector.sync();
  t.check(
    {
      success: deduped.success,
      blamed: deduped.error?.includes(
        `_content/calendar/home.attach/${renamedHome} (stale-cleanup, local: two tracked events named one file; this entry was untracked)`,
      ),
      tracked: await trackedKeys(box.root),
    },
    {
    success: false,
    blamed: true,
    tracked: [
      "evt-shared home",
    ],
  },
  );

  // When one entry's recorded hash DOES match the file's bytes, that entry keeps it
  // whatever the order — it is the one the file was last written for. Keeping the
  // other would leave a hash mismatch, which the pending-edit pass reads as an edit
  // and patches into the wrong calendar's event: the exact failure this dedupe
  // exists to prevent.

  const homeHash = contentHash(await readFile(join(dir, renamedHome), "utf-8"));
  await writeFile(statePath, JSON.stringify({
    version: 2,
    syncTokens: {},
    eventFiles: {
      // First in order, and NOT what the file holds.
      "evt-ghost home": { filename: renamedHome, calendarId: "home", contentHash: "0000000000000000" },
      "evt-shared home": { filename: renamedHome, calendarId: "home", contentHash: homeHash },
    },
  }, null, 2));

  const byHash = await connector.sync();
  t.check(
    {
      blamed: byHash.error?.includes(`_content/calendar/home.attach/${renamedHome} (stale-cleanup`),
      tracked: await trackedKeys(box.root),
    },
    {
    blamed: true,
    tracked: [
      "evt-shared home",
    ],
  },
  );
});

// ## A pre-composite-key state file is migrated on load
//
// State written before the key change is keyed by the bare event id and carries no
// `version`. It is re-keyed on load, from each entry's own `calendarId` — and the
// legacy plain-filename entries, which record no calendar at all, are kept under
// the `(legacy)` sentinel rather than dropped. Dropping one would leave its `.ics`
// untracked, and the orphan scan inserts an untracked `.ics` into Google as a
// brand-new event.
void test("State written before the key change is keyed by the bare event id and carries...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);

  box.commitAll("init box");

  const calendar = createFakeGoogleCalendar({
    calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
    events: [{
      id: "evt-old",
      status: "confirmed",
      summary: "Standing meeting",
      start: { dateTime: "2026-06-08T09:00:00Z" },
      end: { dateTime: "2026-06-08T10:00:00Z" },
    }],
  });
  const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
  const seeded = await connector.sync();
  const dir = join(box.root, "_content/calendar/Main.attach");
  const oldFile = "2026-06-08_Standing_meeting_evt-old.ics";
  t.check({ success: seeded.success, files: await icsFiles(dir) }, {
    success: true,
    files: [oldFile],
  });

  // Rewrite the state the way the old connector wrote it: bare-id keys, no version
  // marker, and `evt-old` as a bare filename string (the oldest format of all).
  //
  // A second file joins it, tracked only by an old-format entry — an event Google
  // no longer returns, so nothing but the index says it is ours.

  const older = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
    "BEGIN:VEVENT\r\nUID:evt-other\r\nSUMMARY:Older\r\n" +
    "DTSTART:20260620T090000Z\r\nDTEND:20260620T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  await writeFile(join(dir, "2026-06-20_vt-other.ics"), older);

  const statePath = join(box.root, "_bookkeeping/connectors/google-calendar-state.json");
  await writeFile(statePath, JSON.stringify({
    syncTokens: {},
    eventFiles: {
      "evt-old": oldFile,
      "evt-other": { filename: "2026-06-20_vt-other.ics", calendarId: "primary" },
    },
  }, null, 2));

  t.check(await trackedKeys(box.root), [
    "evt-old (legacy)",
    "evt-other primary",
  ]);

  // The next sync is the one that could do damage: it must neither re-insert the two
  // tracked files as new Google events nor lose track of them. `evt-old` comes back
  // in the pull and is adopted onto its real calendar; `evt-other` — which Google
  // does not return — keeps its file under the re-keyed entry.

  const after = await connector.sync();
  t.check(
    {
      success: after.success,
      remoteEvents: calendar.events.length,
      files: await icsFiles(dir),
      tracked: await trackedKeys(box.root),
    },
    {
    success: true,
    remoteEvents: 1,
    files: [
      oldFile,
      "2026-06-20_vt-other.ics",
    ],
    tracked: [
      "evt-old primary",
      "evt-other primary",
    ],
  },
  );

  // The rewritten file carries the version marker:

  const saved: { version?: number } = JSON.parse(await readFile(statePath, "utf-8"));
  t.check(saved.version, 2);

  // The marker is what we WRITE, never what we trust on the way in: normalizing is
  // gated on the shape of the keys themselves. A marked file can still hold a bare
  // key — a hand repair, an older binary writing between two runs of this one — and
  // a bare key is invisible to every lookup, so the stale pass would read its event
  // as deleted on Google and remove the file.

  const marked: { version: number; syncTokens: Record<string, string>; eventFiles: Record<string, unknown> } =
    JSON.parse(await readFile(statePath, "utf-8"));
  const other = marked.eventFiles["evt-other primary"];
  delete marked.eventFiles["evt-other primary"];
  marked.eventFiles["evt-other"] = other;
  await writeFile(statePath, JSON.stringify(marked, null, 2));

  t.check(await trackedKeys(box.root), [
    "evt-old primary",
    "evt-other primary",
  ]);
});
