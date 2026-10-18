// # Google Calendar connector
//
// The Google Calendar connector pulls events from Google via the
// `GoogleCalendarService` and writes them as `.ics` files under
// `_content/calendar/`. Injecting a fake service lets us exercise the ICS
// generation path (VTIMEZONE + DTSTART) without hitting the network.

import { after, test } from "tap";
import "agent-doctest/tap";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import ICALmodule from "ical.js";
import { makeTmpBox, type TmpBox } from "../helpers/doctest-helpers.js";
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

const CAL_DIR = "_content/calendar";

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
  // doctest:L109
  const box = await newBox();
  const calendar = primaryCalendar([
    evt("evt-meeting", { summary: "Weekly sync", start: { dateTime: "2026-06-01T14:00:00-04:00", timeZone: "America/New_York" }, end: { dateTime: "2026-06-01T15:00:00-04:00", timeZone: "America/New_York" }, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"] }),
  ]);
  const result = await connect(box, calendar).sync();
  const files = await icsNames(box);
  const comp = new ICALmodule.Component(ICALmodule.parse(await readIcs(box, files[0] ?? "")));
  const vtz = comp.getFirstSubcomponent("vtimezone");
  const vevent = comp.getFirstSubcomponent("vevent");
  t.check(
    ({
      success: result.success,
      files: files.length,
      root: comp.name,
      tzid: String(vtz?.getFirstPropertyValue("tzid")),
      standard: vtz?.getAllSubcomponents("standard").length,
      daylight: vtz?.getAllSubcomponents("daylight").length,
      summary: String(vevent?.getFirstPropertyValue("summary")),
      dtstartTzid: String(vevent?.getFirstProperty("dtstart")?.getParameter("tzid")),
      rrule: String(vevent?.getFirstProperty("rrule")?.toICALString()),
    }),
    {
    success: true,
    files: 1,
    root: "vcalendar",
    tzid: "America/New_York",
    standard: 1,
    daylight: 1,
    summary: "Weekly sync",
    dtstartTzid: "America/New_York",
    rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
  },
  );
});

// ## A locally-created .ics file gets pushed to Google
//
// Drop an unrecognized `.ics` into `_content/calendar/`. The connector parses it,
// inserts it into the fake calendar, and tracks it in state.
void test("Drop an unrecognized .ics into content/calendar/.", async (t) => {
  // doctest:L152
  const box = await newBox();
  await box.seed(`${CAL_DIR}/local-new.ics`, localIcs("local-1", { summary: "Locally created" }));
  box.commitAll("seed local ics");

  // doctest:L156
  const calendar = primaryCalendar();
  const result = await connect(box, calendar).sync();
  t.check(({ pushed: result.pushed?.length, remote: calendar.events.map((e) => e.summary) }), {
    pushed: 1,
    remote: [
      "Locally created",
    ],
  });
});

// ## A local edit is pushed when Google's copy is unchanged
//
// Sync an event, edit the local `.ics`, then sync again with Google's `updated`
// timestamp untouched. Because nothing changed remotely since the last pull, the
// local edit is pushed up to Google and the local file keeps it.
void test("Sync an event, edit the local .ics, then sync again with Google's updated tim...", async (t) => {
  // doctest:L169
  const box = await newBox();
  const calendar = primaryCalendar([lunch()]);
  const connector = connect(box, calendar);
  await connector.sync();
  const file = await editFirst(box, { from: "Lunch", to: "Lunch MINE" });
  await connector.sync();

  // doctest:L176
  t.check(({ remote: calendar.events[0]?.summary, fileKeepsEdit: (await readIcs(box, file)).includes("Lunch MINE") }), {
    remote: "Lunch MINE",
    fileKeepsEdit: true,
  });
});

// ## A remote change beats a local edit (remote wins)
//
// Sync an event, edit the local `.ics`, and *also* change Google's copy with a
// different `updated` timestamp. Both sides changed since the last pull, so the
// conflict resolves in Google's favor: the local edit is discarded, the file is
// overwritten with Google's version, and the change is recorded as a normal
// update (never a push).
void test("Sync an event, edit the local .ics, and also change Google's copy with a diff...", async (t) => {
  // doctest:L189
  const box = await newBox();
  const calendar = primaryCalendar([
    evt("evt-standup", { summary: "Standup", start: { dateTime: "2026-06-02T09:00:00-04:00", timeZone: "America/New_York" }, end: { dateTime: "2026-06-02T09:15:00-04:00", timeZone: "America/New_York" }, updated: "2026-06-01T10:00:00Z" }),
  ]);
  const connector = connect(box, calendar);
  await connector.sync();
  const file = await editFirst(box, { from: "Standup", to: "Standup MINE" });

  // doctest:L200
  // A concurrent remote change with a newer `updated` timestamp.
  calendar.events[0]!.summary = "Standup (rescheduled)";
  calendar.events[0]!.updated = "2026-06-02T10:00:00Z";

  // doctest:L204
  const result = await connector.sync();
  const rewritten = await readIcs(box, file);
  t.check(
    ({
      pushed: result.pushed ?? null,
      updated: result.updated.length,
      fileHasRemote: rewritten.includes("Standup (rescheduled)"),
      fileHasLocalEdit: rewritten.includes("MINE"),
    }),
    {
    pushed: null,
    updated: 1,
    fileHasRemote: true,
    fileHasLocalEdit: false,
  },
  );
});

// ## Sync-token expiry triggers a full resync (410)
//
// Incremental syncs pass Google the stored sync token; when Google reports it
// expired (HTTP 410), the connector drops the token, refetches the full window,
// and continues — the sync still succeeds and a fresh token is recorded (the 410
// handler cleared the stale one before the refetch stored anew; sync tokens live
// in the gitignored transient state, so read via the loader).
void test("Incremental syncs pass Google the stored sync token; when Google reports it e...", async (t) => {
  // doctest:L224
  const box = await newBox();
  const inner = primaryCalendar([evt("evt-1", { summary: "Planning", start: "2026-06-03T10:00:00Z", end: "2026-06-03T11:00:00Z" })]);

  // doctest:L227
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

  // doctest:L242
  // First sync: full window (no token yet) — records "fake-sync-token".
  // The second presents the stored token, gets the 410, and falls back to a full sync in the same run.
  const first = await connector.sync();
  const second = await connector.sync();
  t.check(
    ({
      first: first.success,
      second: second.success,
      tokenRejections,
      token: (await loadCalendarState(box.root)).syncTokens.primary,
    }),
    {
    first: true,
    second: true,
    tokenRejections: 1,
    token: "fake-sync-token",
  },
  );
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
  // doctest:L266
  const box = await newBox({ calendars: ["bad", "good"], syncDaysBack: 30, syncDaysForward: 90 });

  // doctest:L268
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

  // doctest:L280
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

  // doctest:L302
  const connector = connect(box, calendar);
  await connector.sync();

  // doctest:L305
  await box.seed(`${CAL_DIR}/local-new.ics`, localIcs("local-after-failure", { summary: "Push after pull failure", date: "20260613" }));
  box.commitAll("seed local orphan");

  // doctest:L308
  exerciseFailure = true;
  const result = await connector.sync();
  const state = await loadCalendarState(box.root);
  const message = lastCommit(box);
  const committed = committedFiles(box);
  const createdContents = await Promise.all(result.created.map((file) => readFile(join(box.root, file), "utf-8")));
  t.check(
    ({
      success: result.success,
      created: result.created.length,
      pushed: result.pushed?.length,
      syncTokens: state.syncTokens,
      tokensPresented: seenTokens.slice(-2),
      errorMentionsBad: result.error?.includes("bad"),
      errorLeaked: result.error?.includes("must-not-leak"),
      commitLeaked: message.includes("must-not-leak"),
      badWrite: createdContents.some((content) => content.includes("Written before failure")),
      goodWrite: createdContents.some((content) => content.includes("Later calendar still runs")),
      allWritesCommitted: result.created.every((file) => committed.includes(file)),
    }),
    {
    success: false,
    created: 2,
    pushed: 1,
    syncTokens: {
      bad: "old-bad",
      good: "advanced-good-token",
    },
    tokensPresented: [
      {
        calendarId: "bad",
        syncToken: "old-bad",
      },
      {
        calendarId: "good",
        syncToken: "old-good",
      },
    ],
    errorMentionsBad: true,
    errorLeaked: false,
    commitLeaked: false,
    badWrite: true,
    goodWrite: true,
    allWritesCommitted: true,
  },
  );
});

// ## A failed full retry stays inside its calendar boundary
//
// A real 410 clears the stale token and triggers a full retry. If that retry also
// fails, the connector leaves the invalid token absent, continues later
// calendars, and never exposes the HTTP request URL containing token material.
void test("A real 410 clears the stale token and triggers a full retry.", async (t) => {
  // doctest:L350
  const box = await newBox({ calendars: ["expired", "healthy"] });

  // doctest:L352
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

  // doctest:L376
  const connector = connect(box, calendar);
  await connector.sync();
  exerciseRetryFailure = true;
  const result = await connector.sync();

  // doctest:L381
  const state = await loadCalendarState(box.root);
  t.check(
    ({
      success: result.success,
      healthyCreated: result.created.some((file) => file.includes("healthy")),
      expiredToken: state.syncTokens.expired ?? null,
      healthyToken: state.syncTokens.healthy,
      leakedStale: result.error?.includes("stale-secret-token"),
      leakedRetry: result.error?.includes("full-retry-secret"),
    }),
    {
    success: false,
    healthyCreated: true,
    expiredToken: null,
    healthyToken: "healthy-next",
    leakedStale: false,
    leakedRetry: false,
  },
  );
});

// ## The sync commit is path-scoped (never sweeps unrelated staged files)
//
// The connector builds an EXPLICIT changed-file list and commits exactly it,
// rather than staging a directory and running a bare `commit()`. So a concurrent
// mutator's already-staged file — here an unrelated `notes.md` staged before the
// sync — is NOT co-committed under the calendar connector's attribution; it stays
// staged and uncommitted, exactly where the concurrent actor put it.
void test("The connector builds an EXPLICIT changed-file list and commits exactly it, ra...", async (t) => {
  // doctest:L402
  const box = await newBox();
  const calendar = primaryCalendar([
    evt("evt-review", { summary: "Review", start: "2026-06-04T15:00:00Z", end: "2026-06-04T16:00:00Z", updated: "2026-06-01T10:00:00Z" }),
  ]);

  // doctest:L407
  // A concurrent actor stages an unrelated file just before the sync commits.
  await writeFile(join(box.root, "notes.md"), "work in progress\n");
  execSync("git add notes.md", { cwd: box.root });

  // doctest:L411
  await connect(box, calendar).sync();

  // doctest:L413
  t.check(
    ({
      committedNotes: committedFiles(box).includes("notes.md"),
      stillStaged: execSync("git diff --cached --name-only --relative", { cwd: box.root, encoding: "utf-8" }).trim(),
    }),
    {
    committedNotes: false,
    stillStaged: "notes.md",
  },
  );
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
  // doctest:L430
  const box = await newBox();
  const calendar = primaryCalendar([evt("evt-review", { summary: "Review", start: "2026-06-04T09:00:00Z", end: "2026-06-04T10:00:00Z" })]);
  const connector = connect(box, calendar);
  const first = await connector.sync();
  const firstRun = { success: first.success, created: first.created.length, events: calendar.events.length };

  // Truncate the state file the way an interrupted write would, then sync again.
  // The sync fails, and — the point of the test — the fake calendar is untouched:
  // no `insertEvent` reached Google. The failure names the file and says what to do
  // about it, the corrupt bytes are left exactly as they were for a human to look
  // at, and the local `.ics` is still there too — a failed load never touches the
  // store:

  // doctest:L445
  const statePath = join(box.root, "_bookkeeping/connectors/google-calendar-state.json");
  await writeFile(statePath, '{"syncTokens": {}, "eventFiles": {"evt-rev');

  // doctest:L448
  const second = await connector.sync();
  t.check(
    ({
      firstRun,
      success: second.success,
      events: calendar.events.length,
      explained: second.error?.includes("could not be read or parsed"),
      stateBytes: await readFile(statePath, "utf-8"),
      icsFiles: (await icsNames(box)).length,
    }),
    {
    firstRun: {
      success: true,
      created: 1,
      events: 1,
    },
    success: false,
    events: 1,
    explained: true,
    stateBytes: "{\"syncTokens\": {}, \"eventFiles\": {\"evt-rev",
    icsFiles: 1,
  },
  );
});

// ## A rejected local push fails the sync and keeps the file
//
// An untracked `.ics` that Google refuses used to warn and continue, so the file
// retried on every wakeup while the connector reported success. The insert
// failure is now part of the result. The error names the operation, the calendar,
// and the file still sitting there waiting to be retried.
void test("An untracked .ics that Google refuses used to warn and continue, so the file...", async (t) => {
  // doctest:L476
  const box = await newBox();
  await box.seed(`${CAL_DIR}/local-new.ics`, localIcs("local-rejected", { summary: "Rejected push" }));
  box.commitAll("seed local ics");

  // doctest:L480
  const inner = primaryCalendar();
  const calendar: GoogleCalendarService = {
    ...inner,
    insertEvent: async () => throwCalendarHttpError(503, "https://calendar.test/events"),
  };

  // doctest:L486
  const result = await connect(box, calendar).sync();
  t.check(
    ({
      success: result.success,
      pushed: result.pushed ?? null,
      remoteEvents: inner.events.length,
      error: result.error,
      fileKept: (await readIcs(box, "local-new.ics")).includes("Rejected push"),
    }),
    {
    success: false,
    pushed: null,
    remoteEvents: 0,
    error: "Calendar sync failed for primary _content/calendar/local-new.ics (local-push, HTTP 503)",
    fileKept: true,
  },
  );
});
