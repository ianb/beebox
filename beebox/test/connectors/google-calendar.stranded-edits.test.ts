// # Google Calendar connector: stranded edits and recovery
//
// Continues [google-calendar.test.ts](google-calendar.test.ts). This part covers local edits Google will never accept, the week of retries before an edit is stranded, recurring masters surviving a resync, and the cases where a push succeeded but the local rewrite failed.

import { after, test } from "tap";
import "@ianbicking/tap-check/tap";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { initBox } from "../../src/core/box/structure/core.js";
import { createFakeGoogleCalendar } from "../../src/services/google-calendar/core.js";
import type { CalendarEvent, GoogleCalendarService } from "../../src/services/google-calendar/core.js";
import { createGoogleCalendarConnector } from "../../src/connectors/google-calendar/connector.js";
import { loadCalendarState } from "../../src/connectors/google-calendar/state.js";
import { contentHash } from "../../src/lib/content-hash.js";
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

const pendingSince = async (box: TmpBox, key: string) => {
  const entry = (await loadCalendarState(box.root)).eventFiles[key];
  return typeof entry === "string" ? null : entry?.pendingSince ?? null;
};

// Wrap `inner` so that, once `mode.quiet` is set, the incremental fetch returns
// nothing (nothing changed remotely) while the sync token advances. It insists
// on the stored token: if production stopped sending it, this wrapper would be
// standing in for a full fetch and the example would quietly test nothing.
function quietable(inner: GoogleCalendarService, overrides?: Partial<GoogleCalendarService>) {
  const mode = { quiet: false };
  const calendar: GoogleCalendarService = {
    ...inner,
    listEvents: async (calendarId, opts) => {
      if (mode.quiet) {
        if (!opts?.syncToken) throw new Error("expected the stored syncToken on this fetch");
        return { items: [], nextSyncToken: "fake-sync-token-2" };
      }
      return inner.listEvents(calendarId, opts);
    },
    ...overrides,
  };
  return { mode, calendar };
}

// Wrap `inner` so any fetch presenting a sync token gets Google's 410.
const expiringTokens = (inner: GoogleCalendarService, overrides?: Partial<GoogleCalendarService>): GoogleCalendarService => ({
  ...inner,
  listEvents: async (calendarId, opts) => {
    if (opts?.syncToken) return throwCalendarHttpError(410, "https://calendar.test/events?syncToken=expired");
    return inner.listEvents(calendarId, opts);
  },
  ...overrides,
});

after(async () => {
  try {
    await Promise.all(boxes.map((box) => box.cleanup()));
  } catch (error) {
    console.error("teardown failed:", error);
    process.exitCode = 1;
  }
});

// ## A local edit Google will never take is stranded
//
// A patch that comes back 404 is definitive: there is no event on Google to
// patch, and no number of retries changes that. The edit used to sit in the
// retry queue forever, re-patched and re-reported on every wakeup. Now the file
// is stranded — moved to `_content/calendar/Main.attach/stranded/`, untracked, reported once.
void test("A patch that comes back 404 is definitive:", async (t) => {
  const box = await newBox();
  const inner = primaryCalendar([
    evt("evt-gone", { summary: "Deleted but edited here", start: "2026-06-05T10:00:00Z", end: "2026-06-05T11:00:00Z" }),
  ]);

  let patchCalls = 0;
  const calendar: GoogleCalendarService = {
    ...inner,
    listEvents: async (calendarId, opts) => {
      // After the first run this is an ordinary incremental sync that returns
      // nothing — the pull never revisits the event, which is why the pending
      // pass (and its stranding decision) is the only thing that can end this.
      if (opts?.syncToken) return { items: [], nextSyncToken: "fake-sync-token-2" };
      return inner.listEvents(calendarId, opts);
    },
    patchEvent: async () => {
      patchCalls++;
      return throwCalendarHttpError(404, "https://calendar.test/events/evt-gone");
    },
  };

  const connector = connect(box, calendar);
  await connector.sync();
  const file = await editFirst(box, { from: "Deleted but edited here", to: "MINE now" });
  inner.events = [];

  // The patch 404s. One try, then the file is stranded.
  const strandRun = await connector.sync();
  const dir = join(box.root, CAL_DIR);
  t.check(
    ({
      success: strandRun.success,
      patchCalls,
      blamed: strandRun.error?.includes(`_content/calendar/Main.attach/${file} (local-push, local: stranded — deleted on Google (HTTP 404))`),
      gone: (await icsNames(box)).includes(file),
      kept: (await readFile(join(dir, "stranded", file), "utf-8")).includes("MINE now"),
    }),
    {
    success: false,
    patchCalls: 1,
    blamed: true,
    gone: false,
    kept: true,
  },
  );

  // The entry is gone from the index. BOTH ends of the move are in that commit — the vacated
  // path as well as the new one. A commit that recorded only the arrival would
  // leave the old path staged-but-uncommitted, for the box's next sweep to
  // attribute to whatever ran next. Nothing is left behind in the working tree
  // either:

  const nameStatus = execSync("git show --name-status --pretty=format: HEAD", { cwd: box.root, encoding: "utf-8" });
  // Columns are status, path(s) — and the box package puts the box under
  // content/, so match by suffix rather than by a whole path.
  const rows = nameStatus.trim().split("\n").filter(Boolean).map((line) => line.split("\t"));
  const vacated = rows.find((row) => row[1]?.endsWith(`_content/calendar/Main.attach/${file}`));
  // Git may record the move as a rename (R) or as a delete plus an add.
  const renamed = vacated?.[0]?.startsWith("R") === true
    && vacated[2]?.endsWith(`_content/calendar/Main.attach/stranded/${file}`) === true;
  const deletedAndAdded = vacated?.[0] === "D"
    && rows.some((row) => row[0] === "A" && row[1]?.endsWith(`_content/calendar/Main.attach/stranded/${file}`));
  t.check(
    ({
      tracked: Object.keys((await loadCalendarState(box.root)).eventFiles),
      bothEndsCommitted: renamed || deletedAndAdded,
      status: execSync("git status --short", { cwd: box.root, encoding: "utf-8" }).trim(),
    }),
    {
    tracked: [],
    bothEndsCommitted: true,
    status: "",
  },
  );

  // The next run neither calls the API for it nor mentions it — the retry loop is
  // over, and the boxholder's edit is sitting in `stranded/` if they want it back:

  const quietRun = await connector.sync();
  t.check(
    ({
      success: quietRun.success,
      patchCalls,
      error: quietRun.error ?? null,
      stillThere: (await readdir(join(dir, "stranded"))).includes(file),
    }),
    {
    success: true,
    patchCalls: 1,
    error: null,
    stillThere: true,
  },
  );
});

// ## A transient failure is retried for a week, then stranded
//
// A 503 says nothing about whether Google would ever take the edit, so it is
// retried on every wakeup — but not forever. `pendingSince` records when the edit
// first failed, and the first run more than `STRANDED_AFTER_MS` (seven days)
// later gives up on it.
void test("A 503 says nothing about whether Google would ever take the edit, so it is re...", async (t) => {
  const box = await newBox();
  const inner = primaryCalendar([
    evt("evt-lunch", { summary: "Lunch", start: "2026-06-05T12:00:00Z", end: "2026-06-05T13:00:00Z", updated: "2026-06-01T10:00:00Z" }),
  ]);

  let clock = new Date("2026-06-15T12:00:00Z");
  const patchFails = true;
  const calendar: GoogleCalendarService = {
    ...inner,
    listEvents: async (calendarId, opts) => {
      if (opts?.syncToken) return { items: [], nextSyncToken: "fake-sync-token-2" };
      return inner.listEvents(calendarId, opts);
    },
    patchEvent: async (calendarId, opts) => {
      if (patchFails) return throwCalendarHttpError(503, "https://calendar.test/events/evt-lunch");
      return inner.patchEvent(calendarId, opts);
    },
  };

  const connector = connectAt(box, { calendar, now: () => clock });
  await connector.sync();
  const file = await editFirst(box, { from: "SUMMARY:Lunch", to: "SUMMARY:Lunch MINE" });
  const dir = join(box.root, CAL_DIR);

  // First failure: reported, file kept, and the retry window opens.
  const firstFail = await connector.sync();
  const first = {
    success: firstFail.success,
    http: firstFail.error?.includes("(local-push, HTTP 503)"),
    kept: (await icsNames(box)).includes(file),
    pendingSince: await pendingSince(box, "evt-lunch primary"),
  };

  // A day later it is still inside the window, so it is retried — and the stamp
  // is left alone, because the window measures the edit's age, not this run's.
  clock = new Date("2026-06-16T12:00:00Z");
  const secondFail = await connector.sync();
  const second = {
    http: secondFail.error?.includes("(local-push, HTTP 503)"),
    kept: (await icsNames(box)).includes(file),
    pendingSince: await pendingSince(box, "evt-lunch primary"),
  };

  // Eight days after the first failure the edit has run out of window. It is
  // stranded with the last error named, and the run after that says nothing.
  clock = new Date("2026-06-23T12:00:00Z");
  const strandRun = await connector.sync();
  const quietRun = await connector.sync();
  const third = {
    blamed: strandRun.error?.includes("(local-push, local: stranded — not pushed for 7 days: HTTP 503)"),
    gone: (await icsNames(box)).includes(file),
    kept: (await readFile(join(dir, "stranded", file), "utf-8")).includes("Lunch MINE"),
    tracked: Object.keys((await loadCalendarState(box.root)).eventFiles).length,
    quiet: quietRun.error ?? null,
  };
  t.check(({ first, second, third }), {
    first: {
      success: false,
      http: true,
      kept: true,
      pendingSince: "2026-06-15T12:00:00.000Z",
    },
    second: {
      http: true,
      kept: true,
      pendingSince: "2026-06-15T12:00:00.000Z",
    },
    third: {
      blamed: true,
      gone: false,
      kept: true,
      tracked: 0,
      quiet: null,
    },
  });
});

// A push Google accepts inside the window closes it instead: the stamp is dropped
// the moment the edit lands, so a later unrelated failure starts a fresh week
// rather than inheriting a spent one.
void test("A push Google accepts inside the window closes it instead:", async (t) => {
  const box = await newBox();
  const inner = primaryCalendar([
    evt("evt-lunch", { summary: "Lunch", start: "2026-06-05T12:00:00Z", end: "2026-06-05T13:00:00Z", updated: "2026-06-01T10:00:00Z" }),
  ]);
  let clock = new Date("2026-06-15T12:00:00Z");
  let patchFails = true;
  const calendar: GoogleCalendarService = {
    ...inner,
    listEvents: async (calendarId, opts) => {
      if (opts?.syncToken) return { items: [], nextSyncToken: "fake-sync-token-2" };
      return inner.listEvents(calendarId, opts);
    },
    patchEvent: async (calendarId, opts) => {
      if (patchFails) return throwCalendarHttpError(503, "https://calendar.test/events/evt-lunch");
      return inner.patchEvent(calendarId, opts);
    },
  };

  const connector = connectAt(box, { calendar, now: () => clock });
  await connector.sync();
  await editFirst(box, { from: "SUMMARY:Lunch", to: "SUMMARY:Lunch MINE" });
  await connector.sync();
  const opened = await pendingSince(box, "evt-lunch primary");

  patchFails = false;
  clock = new Date("2026-06-18T12:00:00Z");
  const accepted = await connector.sync();
  t.check(
    ({
      opened,
      success: accepted.success,
      remote: inner.events[0]?.summary,
      pendingSince: await pendingSince(box, "evt-lunch primary"),
    }),
    {
    opened: "2026-06-15T12:00:00.000Z",
    success: true,
    remote: "Lunch MINE",
    pendingSince: null,
  },
  );
});

// ## A full resync never removes a recurring master
//
// `singleEvents=false` plus a `timeMin`/`timeMax` leaves it to Google whether a
// series' master comes back in a window, and `isInWindow` cannot arbitrate — it
// answers `true` for every recurring event by construction. So a master missing
// from a full resync is no information at all, and the stale pass leaves it
// alone. (A series really deleted in Google arrives as a cancelled event on an
// ordinary pull.) It is still tracked, too — an untracked `.ics` would be read as
// a locally-created event and inserted back into Google as a duplicate series.
void test("singleEvents=false plus a timeMin/timeMax leaves it to Google whether a serie...", async (t) => {
  const box = await newBox();
  const inner = primaryCalendar([
    evt("evt-weekly", { summary: "Weekly sync", start: { dateTime: "2026-06-01T14:00:00-04:00", timeZone: "America/New_York" }, end: { dateTime: "2026-06-01T15:00:00-04:00", timeZone: "America/New_York" }, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"] }),
  ]);

  const calendar = expiringTokens(inner, {
    // Google still holds the series even though the resync did not list it, so a
    // patch to it succeeds. (The stale pass has already run by then — this is
    // what makes the section's claim about the master testable with an edit.)
    patchEvent: async (_calendarId, opts) => ({
      ...opts.event, id: "evt-weekly", status: "confirmed", updated: "2026-06-15T00:00:00Z",
    }),
  });

  const connector = connect(box, calendar);
  await connector.sync();
  const file = (await icsNames(box))[0] ?? "";

  // The resync comes back without the master. Nothing may be concluded from that.
  inner.events = [];
  const result = await connector.sync();
  t.check(
    ({
      success: result.success,
      kept: (await icsNames(box)).includes(file),
      tracked: Object.keys((await loadCalendarState(box.root)).eventFiles),
    }),
    {
    success: true,
    kept: true,
    tracked: [
      "evt-weekly primary",
    ],
  },
  );

  // A LOCALLY EDITED master is not stranded either. A non-recurring event missing
  // from a full resync is deleted-on-Google and its edit is given up on; for a
  // master, absence is not evidence, so the edit stays in the ordinary push queue:

  await editFirst(box, { from: "Weekly sync", to: "Weekly sync MINE" });
  const afterEdit = await connector.sync();
  t.check(
    ({
      success: afterEdit.success,
      kept: (await icsNames(box)).includes(file),
      stranded: (await readdir(join(box.root, CAL_DIR))).includes("stranded"),
      tracked: Object.keys((await loadCalendarState(box.root)).eventFiles),
    }),
    {
    success: true,
    kept: true,
    stranded: false,
    tracked: [
      "evt-weekly primary",
    ],
  },
  );
});

// ## An edit to a locally-created event is pushed too
//
// A file pushed from the box gets tracked with the hash of what is on disk, like
// one written from a pull. Without that hash the entry has nothing to compare
// against, so a later edit to an event the boxholder created here would look
// identical to the original forever and never enter the pending-edit push.
void test("A file pushed from the box gets tracked with the hash of what is on disk, lik...", async (t) => {
  const box = await newBox();
  await box.seed(`${CAL_DIR}/local-new.ics`, localIcs("local-editable", { summary: "Locally created" }));
  box.commitAll("seed local ics");

  const inner = primaryCalendar();
  // After the insert, Google has nothing new to report on any later sync.
  const { mode, calendar } = quietable(inner);

  const connector = connect(box, calendar);
  const first = await connector.sync();
  const firstRun = { pushed: first.pushed?.length, remote: inner.events[0]?.summary };

  // Edit the file the box created. The next sync patches it up:

  const filePath = join(box.root, CAL_DIR, "local-new.ics");
  await writeFile(filePath, (await readFile(filePath, "utf-8")).replace("Locally created", "Locally created MINE"));

  mode.quiet = true;
  const second = await connector.sync();
  t.check(
    ({
      firstRun,
      success: second.success,
      updated: second.updated.length,
      remote: inner.events[0]?.summary,
    }),
    {
    firstRun: {
      pushed: 1,
      remote: "Locally created",
    },
    success: true,
    updated: 1,
    remote: "Locally created MINE",
  },
  );
});

// ## An event Google created is tracked even if the local rewrite fails
//
// Pushing a locally-created `.ics` is two steps: the insert, then a rewrite that
// strips the `X-BBX-` annotations out of the local file. Only the first of those
// is visible to Google, so the tracking entry is written the moment the insert
// returns. If the rewrite is the thing that fails, the event is still tracked and
// the failure is reported — an untracked event Google holds would look
// locally-created to the next run's orphan scan, which would insert a duplicate.
//
// Make the rewrite fail by taking write permission off the file: it stays
// readable, so everything up to the rewrite proceeds exactly as it normally does.
void test("Pushing a locally-created .ics is two steps:", async (t) => {
  const box = await newBox();
  await box.seed(`${CAL_DIR}/annotated.ics`, localIcs("annotated-local", { summary: "Book the hall", extra: "X-BBX-REASON:the caterer asked\r\n" }));
  box.commitAll("seed local ics");

  const inner = primaryCalendar();
  const { mode, calendar } = quietable(inner);

  const filePath = join(box.root, CAL_DIR, "annotated.ics");
  await chmod(filePath, 0o444);

  const connector = connect(box, calendar);
  const first = await connector.sync();
  const state = await loadCalendarState(box.root);
  const entry = Object.values(state.eventFiles)[0];
  const afterFirst = {
    success: first.success,
    pushed: first.pushed?.length,
    blamed: first.error?.includes("_content/calendar/Main.attach/annotated.ics (local-push, error)"),
    remote: inner.events.map((e) => e.summary),
    tracked: {
      ids: Object.keys(state.eventFiles).length,
      filename: typeof entry === "string" ? entry : entry?.filename,
      hashed: typeof entry === "string" ? false : entry?.contentHash !== undefined,
    },
  };

  // The second sync is the one that used to duplicate. Google still has exactly
  // one event, and the file (annotations and all, since the strip never
  // happened) is neither re-pushed nor seen as a pending edit.
  mode.quiet = true;
  const second = await connector.sync();
  await chmod(filePath, 0o644);
  t.check(
    ({
      afterFirst,
      second: {
        success: second.success,
        pushed: second.pushed?.length ?? 0,
        remote: inner.events.map((e) => e.summary),
        kept: (await readFile(filePath, "utf-8")).includes("X-BBX-REASON"),
      },
    }),
    {
    afterFirst: {
      success: false,
      pushed: 1,
      blamed: true,
      remote: [
        "Book the hall",
      ],
      tracked: {
        ids: 1,
        filename: "annotated.ics",
        hashed: true,
      },
    },
    second: {
      success: true,
      pushed: 0,
      remote: [
        "Book the hall",
      ],
      kept: true,
    },
  },
  );
});

// ## A pushed edit Google accepted survives a failed local rewrite
//
// The pending-edit pass patches Google and then rewrites the local file from the
// response to normalize it. Google's acceptance is the fact that matters, so the
// entry is stamped against Google's copy before the rewrite is attempted. A
// rewrite that fails is a reported failure, not a lost update: the recorded hash
// no longer matches the file, so the next run re-patches the same content Google
// already has — idempotent, and never a second event.
void test("The pending-edit pass patches Google and then rewrites the local file from th...", async (t) => {
  const box = await newBox();
  const inner = primaryCalendar([
    evt("evt-review", { summary: "Review", start: "2026-06-05T09:00:00Z", end: "2026-06-05T10:00:00Z", updated: "2026-06-01T10:00:00Z" }),
  ]);
  const { mode, calendar } = quietable(inner);

  const connector = connect(box, calendar);
  await connector.sync();

  // The edit changes the summary and leaves an annotation the normalizing
  // rewrite would have dropped, so the file and Google's copy really do differ.
  const file = await editFirst(box, { from: "Review", to: "Review MINE" });
  await editFirst(box, { from: "END:VEVENT", to: "X-BBX-REF:_content/note.md\r\nEND:VEVENT" });
  const filePath = join(box.root, CAL_DIR, file);
  await chmod(filePath, 0o444);

  mode.quiet = true;
  const rewriteFailed = await connector.sync();

  // The entry is still tracked, and its hash describes what Google accepted
  // rather than what is on disk — that mismatch is the retry.
  const state = await loadCalendarState(box.root);
  const entry = state.eventFiles["evt-review primary"];
  const afterFailure = {
    success: rewriteFailed.success,
    blamed: rewriteFailed.error?.includes(`_content/calendar/Main.attach/${file} (local-push, error)`),
    remote: inner.events.map((e) => e.summary),
    tracked: {
      ids: Object.keys(state.eventFiles).length,
      filename: typeof entry === "string" ? entry : entry?.filename,
      pending: typeof entry === "string" ? false : entry?.contentHash !== contentHash(await readFile(filePath, "utf-8")),
    },
  };

  // Give the file back its write bit and the next run re-patches the same
  // content. Google ends up where it already was, with one event.
  await chmod(filePath, 0o644);
  const retried = await connector.sync();
  const settled = await connector.sync();
  t.check(
    ({
      afterFailure,
      retried: { success: retried.success, updated: retried.updated.length },
      settled: { success: settled.success, updated: settled.updated.length },
      remote: inner.events.map((e) => e.summary),
    }),
    {
    afterFailure: {
      success: false,
      blamed: true,
      remote: [
        "Review MINE",
      ],
      tracked: {
        ids: 1,
        filename: "2026-06-05_Review_t-review.ics",
        pending: true,
      },
    },
    retried: {
      success: true,
      updated: 1,
    },
    settled: {
      success: true,
      updated: 0,
    },
    remote: [
      "Review MINE",
    ],
  },
  );
});
