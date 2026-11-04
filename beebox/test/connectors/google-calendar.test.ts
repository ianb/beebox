// # Google Calendar connector
//
// The Google Calendar connector pulls events from Google via the
// `GoogleCalendarService` and writes them as `.ics` files under
// `_content/calendar/`. Injecting a fake service lets us exercise the ICS
// generation path (VTIMEZONE + DTSTART) without hitting the network.

import { after, test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str } from "@ianbicking/tap-check/check";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { initBox } from "../../src/core/box/structure/core.js";
import { createFakeGoogleCalendar } from "../../src/services/google-calendar/core.js";
import type { CalendarEvent, GoogleCalendarService } from "../../src/services/google-calendar/core.js";
import { createGoogleCalendarConnector } from "../../src/connectors/google-calendar/connector.js";
import { loadCalendarState } from "../../src/connectors/google-calendar/state.js";
import ky from "ky";

// Freeze the connector's clock so the sync time-window is deterministic: the
// fixed-date fixtures below (2026-06-0X) stay inside the 30-day-back window no
// matter when the suite runs. Without this the tests age out (a June fixture
// falls off the window ~30 days later).
const NOW = () => new Date("2026-06-15T12:00:00Z");

async function throwCalendarHttpError(status: number, url: string): Promise<never> {
  await ky.get(url, {
    retry: 0,
    fetch: async () => new Response("", {
      status,
      statusText: status === 410 ? "Gone" : "Service Unavailable",
    }),
  });
  throw new Error("ky did not throw for an HTTP error response");
}

const PRIMARY = { id: "primary", summary: "Main", primary: true, accessRole: "owner" };

const CAL_DIR = "_content/calendar/Main.attach";

// Boxes made by examples; the teardown removes them all.
const boxes: Awaited<ReturnType<typeof makeTmpBox>>[] = [];

// A git box with the standard structure, committed. `config` seeds
// `_config/connectors/google-calendar.json` first.
async function newBox(config?: Record<string, unknown>) {
  const box = await makeTmpBox({ git: true });
  boxes.push(box);
  await initBox(box.root);
  if (config) await box.seed("_config/connectors/google-calendar.json", JSON.stringify(config, null, 2));
  box.commitAll("init box");
  return box;
}

type When = string | { dateTime: string; timeZone?: string };

const at = (when: When) => (typeof when === "string" ? { dateTime: when } : when);

const evt = (id: string, { start, end, ...rest }: Omit<Partial<CalendarEvent>, "start" | "end"> & { start: When; end: When }): CalendarEvent =>
  ({ id, status: "confirmed", start: at(start), end: at(end), ...rest });

// 12:00 New York on June 3rd, updated before the first sync.
const lunch = () => evt("evt-lunch", { summary: "Lunch", start: { dateTime: "2026-06-03T12:00:00-04:00", timeZone: "America/New_York" }, end: { dateTime: "2026-06-03T13:00:00-04:00", timeZone: "America/New_York" }, updated: "2026-06-01T10:00:00Z" });

const primaryCalendar = (events?: CalendarEvent[]) => createFakeGoogleCalendar({ calendars: [PRIMARY], events: events ?? [] });

const connectAt = (box: TmpBox, options: { calendar: GoogleCalendarService; now: () => Date }) => createGoogleCalendarConnector(box.root, options);

const connect = (box: TmpBox, calendar: GoogleCalendarService) => connectAt(box, { calendar, now: NOW });

// An `.ics` as a boxholder would drop it into the calendar directory.
const localIcs = (uid: string, { summary, date, extra }: { summary: string; date?: string; extra?: string }) =>
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\n" +
  `UID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART;VALUE=DATE:${date ?? "20260601"}\r\nDTEND;VALUE=DATE:${date ? String(Number(date) + 1) : "20260602"}\r\n` +
  `${extra ?? ""}END:VEVENT\r\nEND:VCALENDAR\r\n`;

const icsNames = async (box: TmpBox) => (await readdir(join(box.root, CAL_DIR))).filter((f) => f.endsWith(".ics"));

const readIcs = async (box: TmpBox, file: string) => readFile(join(box.root, CAL_DIR, file), "utf-8");

// The first synced `.ics`: edit `from` to `to` in place (and return its name).
async function editFirst(box: TmpBox, { from, to }: { from: string; to: string }): Promise<string> {
  const file = (await icsNames(box))[0] ?? "";
  await writeFile(join(box.root, CAL_DIR, file), (await readIcs(box, file)).replace(from, to));
  return file;
}

const NY_TZ = [
  "BEGIN:VTIMEZONE",
  "TZID:America/New_York",
  "BEGIN:STANDARD",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "TZNAME:GMT-5",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "TZNAME:GMT-4",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
];

// The lines of a synced `.ics` holding one event, with the New York VTIMEZONE when `newYork` is set.
const syncedIcs = <T>(newYork: boolean, event: T[]): Array<string | T> => [
  "BEGIN:VCALENDAR",
  "PRODID:-//Bee Box//EN",
  "VERSION:2.0",
  ...(newYork ? NY_TZ : []),
  "BEGIN:VEVENT",
  ...event,
  "END:VEVENT",
  "END:VCALENDAR",
];

const icsLines = async (box: TmpBox, file: string) => (await readIcs(box, file)).split("\r\n");

const lastCommit = (box: TmpBox) => execSync("git log -1 --pretty=%B", { cwd: box.root, encoding: "utf-8" });

const committedFiles = (box: TmpBox) => execSync("git show --name-only --pretty=format: HEAD", { cwd: box.root, encoding: "utf-8" });

after(async () => {
  try {
    await Promise.all(boxes.map((box) => box.cleanup()));
  } catch (error) {
    console.error("teardown failed:", error);
    process.exitCode = 1;
  }
});

// ## A timezone-bearing event round-trips through ICS
//
// Seed the fake with a single recurring weekly event in America/New_York and
// sync. The event lands as one `.ics` file with a VTIMEZONE block (DST-aware,
// STANDARD + DAYLIGHT subcomponents since New_York observes DST) and a DTSTART
// that carries the TZID parameter. The file parses cleanly as iCalendar (this is
// the regression bar — the basic-vs-extended date format bug that broke every
// box's calendar sync would have thrown here).
void test("Seed the fake with a single recurring weekly event in America/NewYork and sync.", async (t) => {
  const box = await newBox();
  const calendar = primaryCalendar([
    evt("evt-meeting", { summary: "Weekly sync", start: { dateTime: "2026-06-01T14:00:00-04:00", timeZone: "America/New_York" }, end: { dateTime: "2026-06-01T15:00:00-04:00", timeZone: "America/New_York" }, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"] }),
  ]);
  const result = await connect(box, calendar).sync();
  const files = await icsNames(box);
  t.check(result, { success: true, created: ["_content/calendar/Main.attach/2026-06-01_Weekly_sync_-meeting.ics"], updated: [] });
  t.check(files, ["2026-06-01_Weekly_sync_-meeting.ics"]);
  t.check(await icsLines(box, files[0] ?? ""), syncedIcs(true, [
    "UID:evt-meeting",
    "SUMMARY:Weekly sync",
    "DTSTART;TZID=America/New_York:20260601T140000",
    "DTEND;TZID=America/New_York:20260601T150000",
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "RRULE:FREQ=WEEKLY;BYDAY=MO",
    "X-BBX-CALENDAR-ID:primary",
    "X-BBX-CALENDAR-NAME:Main",
    "X-BBX-CALENDAR-ROLE:owner",
  ]));
});

// ## An event's time is written in its own zone, whatever offset Google sent
//
// Google returns `dateTime` at the calendar's offset (here Los Angeles, -07:00)
// or in UTC (after a push), while `timeZone` names the event's zone. The file
// gives the instant's wall time in the event's zone: 11:00-07:00 and 19:00Z
// are 14:00 and 15:00 in New York.
void test("A dateTime whose offset differs from its timeZone lands at that zone's wall time", async (t) => {
  const box = await newBox();
  const calendar = primaryCalendar([
    evt("evt-offset", { summary: "Call", start: { dateTime: "2026-06-01T11:00:00-07:00", timeZone: "America/New_York" }, end: { dateTime: "2026-06-01T19:00:00Z", timeZone: "America/New_York" } }),
  ]);
  await connect(box, calendar).sync();
  const files = await icsNames(box);
  t.check((await icsLines(box, files[0] ?? "")).filter((l) => /^(DTSTART|DTEND);/.test(l)), [
    "DTSTART;TZID=America/New_York:20260601T140000",
    "DTEND;TZID=America/New_York:20260601T150000",
  ]);
});

// ## A locally-created .ics file gets pushed to Google
//
// Drop an unrecognized `.ics` into `_content/calendar/`. The connector parses it,
// inserts it into the fake calendar, and tracks it in state.
void test("Drop an unrecognized .ics into content/calendar/.", async (t) => {
  const box = await newBox();
  await box.seed(`${CAL_DIR}/local-new.ics`, localIcs("local-1", { summary: "Locally created" }));
  box.commitAll("seed local ics");

  const calendar = primaryCalendar();
  const result = await connect(box, calendar).sync();
  t.check(result, { success: true, created: [], updated: [], pushed: ["_content/calendar/Main.attach/local-new.ics"] });
  t.check(calendar.events, [
    { id: "evt-1", status: "confirmed", summary: "Locally created", start: { date: "2026-06-01" }, end: { date: "2026-06-02" } },
  ]);
});

// ## A local edit is pushed when Google's copy is unchanged
//
// Sync an event, edit the local `.ics`, then sync again with Google's `updated`
// timestamp untouched. Because nothing changed remotely since the last pull, the
// local edit is pushed up to Google and the local file keeps it.
void test("Sync an event, edit the local .ics, then sync again with Google's updated tim...", async (t) => {
  const box = await newBox();
  const calendar = primaryCalendar([lunch()]);
  const connector = connect(box, calendar);
  await connector.sync();
  const file = await editFirst(box, { from: "Lunch", to: "Lunch MINE" });
  await connector.sync();

  t.check(calendar.events, [
    {
      id: "evt-lunch",
      status: "confirmed",
      start: { dateTime: "2026-06-03T16:00:00.000Z", timeZone: "America/New_York" },
      end: { dateTime: "2026-06-03T17:00:00.000Z", timeZone: "America/New_York" },
      summary: "Lunch MINE",
      updated: isoDate(),
    },
  ]);
  // The pushed copy holds 16:00Z; the rewritten file still says 12:00 New York.
  t.check((await icsLines(box, file)).filter((l) => /^(SUMMARY:|DTSTART;|DTEND;)/.test(l)), [
    "SUMMARY:Lunch MINE",
    "DTSTART;TZID=America/New_York:20260603T120000",
    "DTEND;TZID=America/New_York:20260603T130000",
  ]);
});

// ## A remote change beats a local edit (remote wins)
//
// Sync an event, edit the local `.ics`, and *also* change Google's copy with a
// different `updated` timestamp. Both sides changed since the last pull, so the
// conflict resolves in Google's favor: the local edit is discarded, the file is
// overwritten with Google's version, and the change is recorded as a normal
// update (never a push). The new title renames the file: names follow titles.
void test("Sync an event, edit the local .ics, and also change Google's copy with a diff...", async (t) => {
  const box = await newBox();
  const calendar = primaryCalendar([
    evt("evt-standup", { summary: "Standup", start: { dateTime: "2026-06-02T09:00:00-04:00", timeZone: "America/New_York" }, end: { dateTime: "2026-06-02T09:15:00-04:00", timeZone: "America/New_York" }, updated: "2026-06-01T10:00:00Z" }),
  ]);
  const connector = connect(box, calendar);
  await connector.sync();
  await editFirst(box, { from: "Standup", to: "Standup MINE" });

  // A concurrent remote change with a newer `updated` timestamp.
  calendar.events[0]!.summary = "Standup (rescheduled)";
  calendar.events[0]!.updated = "2026-06-02T10:00:00Z";

  const result = await connector.sync();
  t.check(result, { success: true, created: [], updated: ["_content/calendar/Main.attach/2026-06-02_Standup_rescheduled_-standup.ics"] });
  t.check(await icsNames(box), ["2026-06-02_Standup_rescheduled_-standup.ics"]);
  const rewritten = await readIcs(box, "2026-06-02_Standup_rescheduled_-standup.ics");
  t.check(rewritten.split("\r\n"), syncedIcs(true, [
    "UID:evt-standup",
    "SUMMARY:Standup (rescheduled)",
    "DTSTART;TZID=America/New_York:20260602T090000",
    "DTEND;TZID=America/New_York:20260602T091500",
    "LAST-MODIFIED:20260602T100000Z",
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "X-BBX-CALENDAR-ID:primary",
    "X-BBX-CALENDAR-NAME:Main",
    "X-BBX-CALENDAR-ROLE:owner",
  ]));
});

// ## Sync-token expiry triggers a full resync (410)
//
// Incremental syncs pass Google the stored sync token; when Google reports it
// expired (HTTP 410), the connector drops the token, refetches the full window,
// and continues — the sync still succeeds and a fresh token is recorded (the 410
// handler cleared the stale one before the refetch stored anew; sync tokens live
// in the gitignored transient state, so read via the loader).
void test("Incremental syncs pass Google the stored sync token; when Google reports it e...", async (t) => {
  const box = await newBox();
  const inner = primaryCalendar([evt("evt-1", { summary: "Planning", start: "2026-06-03T10:00:00Z", end: "2026-06-03T11:00:00Z" })]);

  // Any listEvents call that presents a sync token gets a 410, as Google does
  // for an expired token. Full-window calls pass through.
  let tokenRejections = 0;
  const calendar: GoogleCalendarService = {
    ...inner,
    listEvents: async (calendarId, opts) => {
      if (opts?.syncToken) {
        tokenRejections += 1;
        return throwCalendarHttpError(410, "https://calendar.test/events?syncToken=expired-secret");
      }
      return inner.listEvents(calendarId, opts);
    },
  };
  const connector = connect(box, calendar);

  // First sync: full window (no token yet) — records "fake-sync-token".
  // The second presents the stored token, gets the 410, and falls back to a full sync in the same run.
  const first = await connector.sync();
  const second = await connector.sync();
  t.check(first, { success: true, created: ["_content/calendar/Main.attach/2026-06-03_Planning_evt-1.ics"], updated: [] });
  t.check(second, { success: true, created: [], updated: ["_content/calendar/Main.attach/2026-06-03_Planning_evt-1.ics"] });
  t.check(tokenRejections, 1);
  t.check((await loadCalendarState(box.root)).syncTokens.primary, "fake-sync-token");
});

// ## A failed calendar does not abort later calendars or post-loop work
//
// Each calendar is an independent member of the configured working set. If one
// calendar fails after writing an event, the connector retains that completed
// path, restores the calendar's incoming sync token, continues with later
// calendars, pushes local orphans, and reports the overall run as failed. The
// failed member keeps its old token while the later calendar advances. The
// overall error and commit contain controlled diagnostics, not the thrown event
// text or token-like detail.
void test("Each calendar is an independent member of the configured working set.", async (t) => {
  const box = await newBox({ calendars: ["bad", "good"], syncDaysBack: 30, syncDaysForward: 90 });

  const firstBadEvent = evt("evt-bad-first", { summary: "Written before failure", start: "2026-06-10T09:00:00Z", end: "2026-06-10T10:00:00Z" });
  const poisonBadEvent: CalendarEvent = {
    id: "evt-bad-poison",
    status: "confirmed",
    start: { dateTime: "2026-06-11T09:00:00Z" },
    end: { dateTime: "2026-06-11T10:00:00Z" },
  };
  Object.defineProperty(poisonBadEvent, "summary", {
    get() { throw new Error("private event text and syncToken=must-not-leak"); },
  });
  const goodEvent = evt("evt-good", { summary: "Later calendar still runs", start: "2026-06-12T09:00:00Z", end: "2026-06-12T10:00:00Z" });

  const inner = createFakeGoogleCalendar({
    calendars: [
      { id: "bad", summary: "Bad", accessRole: "owner" },
      { id: "good", summary: "Good", accessRole: "owner" },
    ],
  });
  let exerciseFailure = false;
  const seenTokens: Array<{ calendarId: string; syncToken: string | undefined }> = [];
  const calendar: GoogleCalendarService = {
    ...inner,
    async listEvents(calendarId, opts) {
      seenTokens.push({ calendarId, syncToken: opts?.syncToken });
      if (!exerciseFailure) {
        return { items: [], nextSyncToken: `old-${calendarId}` };
      }
      if (calendarId === "bad") {
        return { items: [firstBadEvent, poisonBadEvent], nextSyncToken: "advanced-bad-token" };
      }
      return { items: [goodEvent], nextSyncToken: "advanced-good-token" };
    },
  };

  const connector = connect(box, calendar);
  await connector.sync();

  await box.seed("_content/calendar/Good.attach/local-new.ics", localIcs("local-after-failure", { summary: "Push after pull failure", date: "20260613" }));
  box.commitAll("seed local orphan");

  exerciseFailure = true;
  const result = await connector.sync();
  const state = await loadCalendarState(box.root);
  const message = lastCommit(box);
  const committed = committedFiles(box);
  const createdContents = await Promise.all(result.created.map((file) => readFile(join(box.root, file), "utf-8")));
  t.check(result, {
    success: false,
    created: [
      "_content/calendar/Bad.attach/2026-06-10_Written_before_failure_ad-first.ics",
      "_content/calendar/Good.attach/2026-06-12_Later_calendar_still_runs_evt-good.ics",
    ],
    updated: [],
    // The folder decides the calendar: a file in Good's folder goes to Good.
    pushed: ["_content/calendar/Good.attach/local-new.ics"],
    error: "Calendar sync failed for bad (incremental-sync, error)",
  });
  t.check(state.syncTokens, { bad: "old-bad", good: "advanced-good-token" });
  t.check(seenTokens.slice(-2), [
    { calendarId: "bad", syncToken: "old-bad" },
    { calendarId: "good", syncToken: "old-good" },
  ]);
  // The event times print in the machine's local zone, so they are wildcards.
  t.checkText(
    message,
    `Sync calendar: partial (3 changed, 1 failed)

New:
- Written before failure («*», Bad) [ref: _content/calendar/Bad.attach/2026-06-10_Written_before_failure_ad-first.ics]
- Later calendar still runs («*», Good) [ref: _content/calendar/Good.attach/2026-06-12_Later_calendar_still_runs_evt-good.ics]

Pushed:
- Push after pull failure (Sat, Jun 13)

Failed:
- bad (incremental-sync, error)

Pulled-By: google-calendar-connector`,
  );
  // DTSTART/DTEND are floating local times (UTC events), so they follow the machine's zone.
  t.check(createdContents.map((c) => c.split("\r\n")), [
    syncedIcs(false, [
      "UID:evt-bad-first",
      "SUMMARY:Written before failure",
      str`DTSTART:${any(String)}`,
      str`DTEND:${any(String)}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "X-BBX-CALENDAR-ID:bad",
      "X-BBX-CALENDAR-NAME:Bad",
      "X-BBX-CALENDAR-ROLE:owner",
    ]),
    syncedIcs(false, [
      "UID:evt-good",
      "SUMMARY:Later calendar still runs",
      str`DTSTART:${any(String)}`,
      str`DTEND:${any(String)}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "X-BBX-CALENDAR-ID:good",
      "X-BBX-CALENDAR-NAME:Good",
      "X-BBX-CALENDAR-ROLE:owner",
    ]),
  ]);
  t.checkText(
    committed,
    `_bookkeeping/connectors/google-calendar-state.json
_content/calendar/Bad.attach/2026-06-10_Written_before_failure_ad-first.ics
_content/calendar/Good.attach/2026-06-12_Later_calendar_still_runs_evt-good.ics`,
  );
});

// ## A failed full retry stays inside its calendar boundary
//
// A real 410 clears the stale token and triggers a full retry. If that retry also
// fails, the connector leaves the invalid token absent, continues later
// calendars, and never exposes the HTTP request URL containing token material.
void test("A real 410 clears the stale token and triggers a full retry.", async (t) => {
  const box = await newBox({ calendars: ["expired", "healthy"] });

  const inner = createFakeGoogleCalendar({
    calendars: [
      { id: "expired", summary: "Expired", accessRole: "owner" },
      { id: "healthy", summary: "Healthy", accessRole: "owner" },
    ],
  });
  let exerciseRetryFailure = false;
  const healthyEvent = evt("evt-healthy", { summary: "Healthy calendar", start: "2026-06-12T12:00:00Z", end: "2026-06-12T13:00:00Z" });
  const calendar: GoogleCalendarService = {
    ...inner,
    async listEvents(calendarId, opts) {
      if (!exerciseRetryFailure) {
        return { items: [], nextSyncToken: `old-${calendarId}` };
      }
      if (calendarId === "expired" && opts?.syncToken) {
        return throwCalendarHttpError(410, "https://calendar.test/events?syncToken=stale-secret-token");
      }
      if (calendarId === "expired") {
        return throwCalendarHttpError(503, "https://calendar.test/events?pageToken=full-retry-secret");
      }
      return { items: [healthyEvent], nextSyncToken: "healthy-next" };
    },
  };

  const connector = connect(box, calendar);
  await connector.sync();
  exerciseRetryFailure = true;
  const result = await connector.sync();

  const state = await loadCalendarState(box.root);
  t.check(result, {
    success: false,
    created: ["_content/calendar/Healthy.attach/2026-06-12_Healthy_calendar_-healthy.ics"],
    updated: [],
    error: "Calendar sync failed for expired (full-sync, HTTP 503)",
  });
  t.check(state.syncTokens, { healthy: "healthy-next" });
});

// ## The sync commit is path-scoped (never sweeps unrelated staged files)
//
// The connector builds an EXPLICIT changed-file list and commits exactly it,
// rather than staging a directory and running a bare `commit()`. So a concurrent
// mutator's already-staged file — here an unrelated `notes.md` staged before the
// sync — is NOT co-committed under the calendar connector's attribution; it stays
// staged and uncommitted, exactly where the concurrent actor put it.
void test("The connector builds an EXPLICIT changed-file list and commits exactly it, ra...", async (t) => {
  const box = await newBox();
  const calendar = primaryCalendar([
    evt("evt-review", { summary: "Review", start: "2026-06-04T15:00:00Z", end: "2026-06-04T16:00:00Z", updated: "2026-06-01T10:00:00Z" }),
  ]);

  // A concurrent actor stages an unrelated file just before the sync commits.
  await writeFile(join(box.root, "notes.md"), "work in progress\n");
  execSync("git add notes.md", { cwd: box.root });

  await connect(box, calendar).sync();

  t.checkText(
    committedFiles(box),
    `_bookkeeping/connectors/google-calendar-state.json
_config/connectors/google-calendar.json
_content/calendar/Main.attach/2026-06-04_Review_t-review.ics
_content/calendar/Main.calendar.card`,
  );
  t.checkText(execSync("git diff --cached --name-only --relative", { cwd: box.root, encoding: "utf-8" }), "notes.md");
});

// ## A corrupt state file fails the sync closed, nothing is pushed
//
// `_bookkeeping/connectors/google-calendar-state.json` is the index of which `.ics`
// file belongs to which Google event. It is not a cache: the push pass treats
// every calendar file *absent* from that index as a locally-created event, so
// recovering from an unreadable index by starting with an empty one would insert
// a duplicate of every existing event into Google. The load refuses instead, and
// the sync stops before the push pass runs.
void test("bookkeeping/connectors/google-calendar-state.json is the index of which .ics...", async (t) => {
  const box = await newBox();
  const calendar = primaryCalendar([evt("evt-review", { summary: "Review", start: "2026-06-04T09:00:00Z", end: "2026-06-04T10:00:00Z" })]);
  const reviewEvent: CalendarEvent = { id: "evt-review", status: "confirmed", summary: "Review", start: { dateTime: "2026-06-04T09:00:00Z" }, end: { dateTime: "2026-06-04T10:00:00Z" } };
  const connector = connect(box, calendar);
  const first = await connector.sync();
  t.check(first, { success: true, created: ["_content/calendar/Main.attach/2026-06-04_Review_t-review.ics"], updated: [] });
  t.check(calendar.events, [reviewEvent]);

  // Truncate the state file the way an interrupted write would, then sync again.
  // The sync fails, and — the point of the test — the fake calendar is untouched:
  // no `insertEvent` reached Google. The failure names the file and says what to do
  // about it, the corrupt bytes are left exactly as they were for a human to look
  // at, and the local `.ics` is still there too — a failed load never touches the
  // store:

  const statePath = join(box.root, "_bookkeeping/connectors/google-calendar-state.json");
  await writeFile(statePath, '{"syncTokens": {}, "eventFiles": {"evt-rev');

  const second = await connector.sync();
  t.check(second, {
    success: false,
    created: [],
    updated: [],
    error: `Calendar state at ${statePath} exists but could not be read or parsed. Refusing to sync — inspect or remove the file by hand before syncing again.`,
  });
  t.check(calendar.events, [reviewEvent]);
  t.checkText(await readFile(statePath, "utf-8"), '{"syncTokens": {}, "eventFiles": {"evt-rev');
  t.check(await icsNames(box), ["2026-06-04_Review_t-review.ics"]);
});

// ## A rejected local push fails the sync and keeps the file
//
// An untracked `.ics` that Google refuses used to warn and continue, so the file
// retried on every wakeup while the connector reported success. The insert
// failure is now part of the result. The error names the operation, the calendar,
// and the file still sitting there waiting to be retried.
void test("An untracked .ics that Google refuses used to warn and continue, so the file...", async (t) => {
  const box = await newBox();
  await box.seed(`${CAL_DIR}/local-new.ics`, localIcs("local-rejected", { summary: "Rejected push" }));
  box.commitAll("seed local ics");

  const inner = primaryCalendar();
  const calendar: GoogleCalendarService = {
    ...inner,
    insertEvent: async () => throwCalendarHttpError(503, "https://calendar.test/events"),
  };

  const result = await connect(box, calendar).sync();
  t.check(result, {
    success: false,
    created: [],
    updated: [],
    error: "Calendar sync failed for primary _content/calendar/Main.attach/local-new.ics (local-push, HTTP 503)",
  });
  t.check(inner.events, []);
  t.check(await icsLines(box, "local-new.ics"), [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    "BEGIN:VEVENT",
    "UID:local-rejected",
    "SUMMARY:Rejected push",
    "DTSTART;VALUE=DATE:20260601",
    "DTEND;VALUE=DATE:20260602",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]);
});
