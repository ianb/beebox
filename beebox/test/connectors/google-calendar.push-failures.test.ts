// # Google Calendar connector: failed pushes and resyncs
//
// Continues [google-calendar.test.ts](google-calendar.test.ts). This part covers a rejected `X-BBX-DELETE`, failed and retried patches, a full resync after a 410 removing vanished events, and a local edit pushed when Google returns nothing.

import { after, test } from "tap";
import "@ianbicking/tap-check/tap";
import { join } from "node:path";
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

// ## A rejected X-BBX-DELETE fails the sync and keeps the marker
//
// A delete Google rejects has to stay pending — the file and its `X-BBX-DELETE`
// marker survive so the next sync retries — and it has to be visible, or the
// retry loop runs forever behind a `bbx wakeup` that exits zero. The failure says
// which file is stuck.
void test("A delete Google rejects has to stay pending — the file and its X-BBX-DELETE m...", async (t) => {
  const box = await newBox();
  const inner = primaryCalendar([
    evt("evt-cancelme", { summary: "Cancel me", start: "2026-06-05T09:00:00Z", end: "2026-06-05T10:00:00Z", updated: "2026-06-01T10:00:00Z" }),
  ]);

  // After the first sync nothing changed remotely, and every delete is refused.
  const { mode, calendar } = quietable(inner, {
    deleteEvent: async () => throwCalendarHttpError(503, "https://calendar.test/events/evt-cancelme"),
  });

  const connector = connect(box, calendar);
  await connector.sync();
  const file = await editFirst(box, { from: "END:VEVENT", to: "X-BBX-DELETE:no longer happening\r\nEND:VEVENT" });

  mode.quiet = true;
  const result = await connector.sync();
  t.check(
    ({
      success: result.success,
      remoteEvents: inner.events.length,
      markerKept: (await readIcs(box, file)).includes("X-BBX-DELETE"),
      stuck: result.error?.includes("(local-delete, HTTP 503)"),
    }),
    {
    success: false,
    remoteEvents: 1,
    markerKept: true,
    stuck: true,
  },
  );
});

// ## A failed patch keeps the local edit instead of overwriting it
//
// When the local file changed and Google's copy did not, the connector pushes the
// edit. If that patch is rejected — a transient 429 or 503 is the realistic case —
// the old code fell through and wrote Google's version over the file, erasing the
// boxholder's edit and reporting a normal update. The edit now survives, the
// stored hash is left alone so the next sync retries, and the run fails; the
// failure points at the file. Nothing is recorded as an update (`updated` stays empty).
void test("When the local file changed and Google's copy did not, the connector pushes t...", async (t) => {
  const box = await newBox();
  const inner = primaryCalendar([lunch()]);
  const calendar: GoogleCalendarService = {
    ...inner,
    patchEvent: async () => throwCalendarHttpError(503, "https://calendar.test/events/evt-lunch"),
  };

  const connector = connect(box, calendar);
  await connector.sync();
  const file = await editFirst(box, { from: "Lunch", to: "Lunch MINE" });

  const result = await connector.sync();
  t.check(
    ({
      success: result.success,
      updated: result.updated.length,
      pushed: result.pushed ?? null,
      editKept: (await readIcs(box, file)).includes("Lunch MINE"),
      blamed: result.error?.includes(`_content/calendar/Main.attach/${file} (local-push, HTTP 503)`),
    }),
    {
    success: false,
    updated: 0,
    pushed: null,
    editKept: true,
    blamed: true,
  },
  );

  // A later sync where the patch works pushes the edit that was held:

  await connect(box, inner).sync();
  t.check(inner.events[0]?.summary, "Lunch MINE");
});

// ## A full resync after a 410 removes events Google no longer has
//
// A full-window list is the whole truth for that window and does not report
// deletions, so an event we still track that the response omits was deleted
// remotely while our sync token was invalid. The 410 recovery used to refresh
// only the events Google returned, leaving the deleted one as a stale `.ics`
// forever. Now the resync reconciles — but never at the cost of a local edit.
void test("A full-window list is the whole truth for that window and does not report del...", async (t) => {
  const box = await newBox();
  const inner = primaryCalendar([
    evt("evt-keep", { summary: "Still on Google", start: "2026-06-03T10:00:00Z", end: "2026-06-03T11:00:00Z" }),
    evt("evt-stale", { summary: "Deleted while token was invalid", start: "2026-06-04T10:00:00Z", end: "2026-06-04T11:00:00Z" }),
    evt("evt-edited", { summary: "Deleted but edited here", start: "2026-06-05T10:00:00Z", end: "2026-06-05T11:00:00Z" }),
  ]);

  // The fake's listEvents ignores syncToken/timeMin/timeMax and always returns
  // whatever `inner.events` currently holds, so filtering an event out below is
  // exactly "Google no longer returns it". This wrapper supplies the 410.
  const calendar = expiringTokens(inner);

  const dir = join(box.root, CAL_DIR);
  const summaries = async (): Promise<string[]> => {
    const found: string[] = [];
    for (const name of await icsNames(box)) {
      found.push((/^SUMMARY:(.*)$/m.exec(await readIcs(box, name))?.[1] ?? name).trim());
    }
    return found.toSorted();
  };

  const connector = connect(box, calendar);
  await connector.sync();
  const initial = await summaries();

  // Edit one file locally, then delete both of those events from Google. The next
  // sync presents the stored token, gets the 410, and refetches the full window.
  // The untouched stale file is deleted; the locally-edited one is stranded rather
  // than deleted behind the boxholder's back — the edit is still on disk, under
  // `stranded/`, and the run reports it once. Nothing tracks it any more, so no
  // later run patches, reports, or re-inserts it (index keys are
  // `<eventId> <calendarId>` — see `test/connectors/google-calendar/event-index.test.ts`):

  let editedFile = "";
  for (const name of await icsNames(box)) {
    const text = await readIcs(box, name);
    if (!text.includes("Deleted but edited here")) continue;
    editedFile = name;
    await writeFile(join(dir, name), text.replace("Deleted but edited here", "MINE now"));
  }
  inner.events = inner.events.filter((e) => e.id === "evt-keep");

  const result = await connector.sync();
  t.check(
    ({
      initial,
      afterResync: await summaries(),
      success: result.success,
      files: (await icsNames(box)).length,
      editKept: (await readFile(join(dir, "stranded", editedFile), "utf-8")).includes("MINE now"),
      reported: result.error?.includes("(stale-cleanup, local: stranded — deleted on Google (absent from a full resync))"),
      tracked: Object.keys((await loadCalendarState(box.root)).eventFiles),
    }),
    {
    initial: [
      "Deleted but edited here",
      "Deleted while token was invalid",
      "Still on Google",
    ],
    afterResync: [
      "Still on Google",
    ],
    success: false,
    files: 1,
    editKept: true,
    reported: true,
    tracked: [
      "evt-keep primary",
    ],
  },
  );

  // An event outside the refetched window was never in the full response's scope, so
  // its absence is not evidence of anything and it is never removed. Push one into
  // Google (which tracks it), delete it there, and force another 410:

  await box.seed(`${CAL_DIR}/2027-01-01_faraway.ics`, localIcs("far-away", { summary: "Far future", date: "20270101" }));
  const pushRun = await connector.sync();

  inner.events = inner.events.filter((e) => e.summary !== "Far future");
  const afterFar = await connector.sync();
  t.check(
    ({
      pushed: pushRun.pushed?.length,
      stillThere: (await icsNames(box)).includes("2027-01-01_faraway.ics"),
      blamed: afterFar.error?.includes("faraway") ?? false,
    }),
    {
    pushed: 1,
    stillThere: true,
    blamed: false,
  },
  );
});

// ## A local edit is pushed even when Google returns nothing
//
// The pull can only reconcile events Google chooses to return, and an incremental
// sync returns nothing for an event nobody else touched — while the sync token
// advances past it. So a local edit used to reach Google only if the same event
// happened to come back in a pull, in practice only during a full resync. The
// push phase now looks for tracked files whose content no longer matches the hash
// the connector recorded, and patches them. The file is rewritten from Google's
// response and its hash re-stamped, so the edit stops being pending — a third
// sync pushes nothing.
void test("The pull can only reconcile events Google chooses to return, and an increment...", async (t) => {
  const box = await newBox();
  const inner = primaryCalendar([lunch()]);
  // After the first pull the incremental sync returns nothing, exactly as Google
  // does when no one has touched the event since the stored token.
  const { mode, calendar } = quietable(inner);

  const connector = connect(box, calendar);
  await connector.sync();
  await editFirst(box, { from: "Lunch", to: "Lunch MINE" });

  mode.quiet = true;
  const result = await connector.sync();
  const third = await connector.sync();
  t.check(
    ({
      success: result.success,
      updated: result.updated.length,
      remote: inner.events[0]?.summary,
      third: { updated: third.updated.length, remote: inner.events[0]?.summary },
    }),
    {
    success: true,
    updated: 1,
    remote: "Lunch MINE",
    third: {
      updated: 0,
      remote: "Lunch MINE",
    },
  },
  );
});

// ## A rejected patch is retried on the next sync
//
// A patch Google refuses leaves the file and its stored hash alone so the edit
// survives. That is only half a retry: an incremental sync will not resend an
// event Google did not change, and the sync token advances anyway, so the pull
// never revisits it. The mismatched hash IS the retry queue — the pending-edit
// pass finds it on the next run without any new state. Run 2: Google still
// returns the event, the patch is rejected, the edit stays. Run 3 is an ordinary
// incremental sync — Google returns nothing at all — and the held edit still goes
// up.
void test("A patch Google refuses leaves the file and its stored hash alone so the edit...", async (t) => {
  const box = await newBox();
  const inner = primaryCalendar([
    evt("evt-dentist", { summary: "Dentist", start: "2026-06-05T09:00:00Z", end: "2026-06-05T10:00:00Z", updated: "2026-06-01T10:00:00Z" }),
  ]);
  let patchFails = false;
  const { mode, calendar } = quietable(inner, {
    patchEvent: async (calendarId, opts) => {
      if (patchFails) return throwCalendarHttpError(503, "https://calendar.test/events/evt-dentist");
      return inner.patchEvent(calendarId, opts);
    },
  });

  const connector = connect(box, calendar);
  await connector.sync();
  await editFirst(box, { from: "Dentist", to: "Dentist MINE" });

  patchFails = true;
  const rejected = await connector.sync();
  const afterRejected = { success: rejected.success, remote: inner.events[0]?.summary };

  mode.quiet = true;
  patchFails = false;
  const retried = await connector.sync();
  t.check(
    ({
      rejected: afterRejected,
      retried: { success: retried.success, updated: retried.updated.length, remote: inner.events[0]?.summary },
    }),
    {
    rejected: {
      success: false,
      remote: "Dentist",
    },
    retried: {
      success: true,
      updated: 1,
      remote: "Dentist MINE",
    },
  },
  );
});
