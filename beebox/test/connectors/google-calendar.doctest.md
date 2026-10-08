# Google Calendar connector

The Google Calendar connector pulls events from Google via the
`GoogleCalendarService` and writes them as `.ics` files under
`_content/calendar/`. Injecting a fake service lets us exercise the ICS
generation path (VTIMEZONE + DTSTART) without hitting the network.

```ts setup
import { join } from "node:path";
import { execSync } from "node:child_process";
import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
// eslint-disable-next-line import-x/no-rename-default
import ICAL from "ical.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/structure/core.js";
import { createFakeGoogleCalendar } from "../../src/services/google-calendar/core.js";
import type { CalendarEvent, GoogleCalendarService } from "../../src/services/google-calendar/core.js";
import { createGoogleCalendarConnector } from "../../src/connectors/google-calendar/connector.js";
import { loadCalendarState } from "../../src/connectors/google-calendar/state.js";
import { contentHash } from "../../src/lib/content-hash.js";
// eslint-disable-next-line import-x/no-rename-default
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

const at = (when: string | { dateTime: string; timeZone?: string }) => (typeof when === "string" ? { dateTime: when } : when);
const evt = (id: string, summary: string, start: string | { dateTime: string; timeZone?: string }, end: string | { dateTime: string; timeZone?: string }, extra: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({ id, status: "confirmed", summary, start: at(start), end: at(end), ...extra });
// 12:00 New York on June 3rd, updated before the first sync.
const lunch = () => evt("evt-lunch", "Lunch",
  { dateTime: "2026-06-03T12:00:00-04:00", timeZone: "America/New_York" },
  { dateTime: "2026-06-03T13:00:00-04:00", timeZone: "America/New_York" },
  { updated: "2026-06-01T10:00:00Z" });

const primaryCalendar = (events: CalendarEvent[] = []) => createFakeGoogleCalendar({ calendars: [PRIMARY], events });
const connect = (box, calendar: GoogleCalendarService, now: () => Date = NOW) => createGoogleCalendarConnector(box.root, { calendar, now });

// An `.ics` as a boxholder would drop it into the calendar directory.
const localIcs = (uid: string, summary: string, { date, extra }: { date?: string; extra?: string } = {}) =>
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\n" +
  `UID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART;VALUE=DATE:${date ?? "20260601"}\r\nDTEND;VALUE=DATE:${date ? String(Number(date) + 1) : "20260602"}\r\n` +
  `${extra ?? ""}END:VEVENT\r\nEND:VCALENDAR\r\n`;

const icsNames = async (box) => (await readdir(join(box.root, CAL_DIR))).filter((f) => f.endsWith(".ics"));
const readIcs = async (box, file: string) => readFile(join(box.root, CAL_DIR, file), "utf-8");
// The first synced `.ics`: edit `from` to `to` in place (and return its name).
async function editFirst(box, from: string, to: string): Promise<string> {
  const file = (await icsNames(box))[0] ?? "";
  await writeFile(join(box.root, CAL_DIR, file), (await readIcs(box, file)).replace(from, to));
  return file;
}
const lastCommit = (box) => execSync("git log -1 --pretty=%B", { cwd: box.root, encoding: "utf-8" });
const committedFiles = (box) => execSync("git show --name-only --pretty=format: HEAD", { cwd: box.root, encoding: "utf-8" });
const pendingSince = async (box, key: string) => {
  const entry = (await loadCalendarState(box.root)).eventFiles[key];
  return typeof entry === "string" ? null : entry?.pendingSince ?? null;
};

// Wrap `inner` so that, once `mode.quiet` is set, the incremental fetch returns
// nothing (nothing changed remotely) while the sync token advances. It insists
// on the stored token: if production stopped sending it, this wrapper would be
// standing in for a full fetch and the example would quietly test nothing.
function quietable(inner: GoogleCalendarService, overrides: Partial<GoogleCalendarService> = {}) {
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
const expiringTokens = (inner: GoogleCalendarService, overrides: Partial<GoogleCalendarService> = {}): GoogleCalendarService => ({
  ...inner,
  listEvents: async (calendarId, opts) => {
    if (opts?.syncToken) return throwCalendarHttpError(410, "https://calendar.test/events?syncToken=expired");
    return inner.listEvents(calendarId, opts);
  },
  ...overrides,
});
```

```ts teardown
await Promise.all(boxes.map((box) => box.cleanup()));
```

## A timezone-bearing event round-trips through ICS

Seed the fake with a single recurring weekly event in America/New_York and
sync. The event lands as one `.ics` file with a VTIMEZONE block (DST-aware,
STANDARD + DAYLIGHT subcomponents since New_York observes DST) and a DTSTART
that carries the TZID parameter. The file parses cleanly as iCalendar (this is
the regression bar — the basic-vs-extended date format bug that broke every
box's calendar sync would have thrown here).

```ts
const box = await newBox();
const calendar = primaryCalendar([
  evt("evt-meeting", "Weekly sync",
    { dateTime: "2026-06-01T14:00:00-04:00", timeZone: "America/New_York" },
    { dateTime: "2026-06-01T15:00:00-04:00", timeZone: "America/New_York" },
    { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"] }),
]);
const result = await connect(box, calendar).sync();
const files = await icsNames(box);
const comp = new ICAL.Component(ICAL.parse(await readIcs(box, files[0])));
const vtz = comp.getFirstSubcomponent("vtimezone");
const vevent = comp.getFirstSubcomponent("vevent");
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
})
=>
{
  success: true,
  files: 1,
  root: "vcalendar",
  tzid: "America/New_York",
  standard: 1,
  daylight: 1,
  summary: "Weekly sync",
  dtstartTzid: "America/New_York",
  rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO"
}
```

## A locally-created .ics file gets pushed to Google

Drop an unrecognized `.ics` into `_content/calendar/`. The connector parses it,
inserts it into the fake calendar, and tracks it in state.

```ts
const box = await newBox();
await box.seed(`${CAL_DIR}/local-new.ics`, localIcs("local-1", "Locally created"));
box.commitAll("seed local ics");

const calendar = primaryCalendar();
const result = await connect(box, calendar).sync();
({ pushed: result.pushed?.length, remote: calendar.events.map((e) => e.summary) })
=> { pushed: 1, remote: ["Locally created"] }
```

## A local edit is pushed when Google's copy is unchanged

Sync an event, edit the local `.ics`, then sync again with Google's `updated`
timestamp untouched. Because nothing changed remotely since the last pull, the
local edit is pushed up to Google and the local file keeps it.

```ts
const box = await newBox();
const calendar = primaryCalendar([lunch()]);
const connector = connect(box, calendar);
await connector.sync();
const file = await editFirst(box, "Lunch", "Lunch MINE");
await connector.sync();

({ remote: calendar.events[0]?.summary, fileKeepsEdit: (await readIcs(box, file)).includes("Lunch MINE") })
=> { remote: "Lunch MINE", fileKeepsEdit: true }
```

## A remote change beats a local edit (remote wins)

Sync an event, edit the local `.ics`, and *also* change Google's copy with a
different `updated` timestamp. Both sides changed since the last pull, so the
conflict resolves in Google's favor: the local edit is discarded, the file is
overwritten with Google's version, and the change is recorded as a normal
update (never a push).

```ts
const box = await newBox();
const calendar = primaryCalendar([
  evt("evt-standup", "Standup",
    { dateTime: "2026-06-02T09:00:00-04:00", timeZone: "America/New_York" },
    { dateTime: "2026-06-02T09:15:00-04:00", timeZone: "America/New_York" },
    { updated: "2026-06-01T10:00:00Z" }),
]);
const connector = connect(box, calendar);
await connector.sync();
const file = await editFirst(box, "Standup", "Standup MINE");

// A concurrent remote change with a newer `updated` timestamp.
calendar.events[0]!.summary = "Standup (rescheduled)";
calendar.events[0]!.updated = "2026-06-02T10:00:00Z";

const result = await connector.sync();
const after = await readIcs(box, file);
({
  pushed: result.pushed ?? null,
  updated: result.updated.length,
  fileHasRemote: after.includes("Standup (rescheduled)"),
  fileHasLocalEdit: after.includes("MINE"),
})
=> { pushed: null, updated: 1, fileHasRemote: true, fileHasLocalEdit: false }
```

## Sync-token expiry triggers a full resync (410)

Incremental syncs pass Google the stored sync token; when Google reports it
expired (HTTP 410), the connector drops the token, refetches the full window,
and continues — the sync still succeeds and a fresh token is recorded (the 410
handler cleared the stale one before the refetch stored anew; sync tokens live
in the gitignored transient state, so read via the loader).

```ts
const box = await newBox();
const inner = primaryCalendar([evt("evt-1", "Planning", "2026-06-03T10:00:00Z", "2026-06-03T11:00:00Z")]);

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
({
  first: first.success,
  second: second.success,
  tokenRejections,
  token: (await loadCalendarState(box.root)).syncTokens.primary,
})
=> { first: true, second: true, tokenRejections: 1, token: "fake-sync-token" }
```

## A failed calendar does not abort later calendars or post-loop work

Each calendar is an independent member of the configured working set. If one
calendar fails after writing an event, the connector retains that completed
path, restores the calendar's incoming sync token, continues with later
calendars, pushes local orphans, and reports the overall run as failed. The
failed member keeps its old token while the later calendar advances. The
overall error and commit contain controlled diagnostics, not the thrown event
text or token-like detail.

```ts
const box = await newBox({ calendars: ["bad", "good"], syncDaysBack: 30, syncDaysForward: 90 });

const firstBadEvent = evt("evt-bad-first", "Written before failure", "2026-06-10T09:00:00Z", "2026-06-10T10:00:00Z");
const poisonBadEvent: CalendarEvent = {
  id: "evt-bad-poison",
  status: "confirmed",
  start: { dateTime: "2026-06-11T09:00:00Z" },
  end: { dateTime: "2026-06-11T10:00:00Z" },
};
Object.defineProperty(poisonBadEvent, "summary", {
  get() { throw new Error("private event text and syncToken=must-not-leak"); },
});
const goodEvent = evt("evt-good", "Later calendar still runs", "2026-06-12T09:00:00Z", "2026-06-12T10:00:00Z");

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

await box.seed(`${CAL_DIR}/local-new.ics`, localIcs("local-after-failure", "Push after pull failure", { date: "20260613" }));
box.commitAll("seed local orphan");

exerciseFailure = true;
const result = await connector.sync();
const state = await loadCalendarState(box.root);
const message = lastCommit(box);
const committed = committedFiles(box);
const createdContents = await Promise.all(result.created.map((file) => readFile(join(box.root, file), "utf-8")));
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
})
=>
{
  success: false,
  created: 2,
  pushed: 1,
  syncTokens: { bad: "old-bad", good: "advanced-good-token" },
  tokensPresented: [{ calendarId: "bad", syncToken: "old-bad" }, { calendarId: "good", syncToken: "old-good" }],
  errorMentionsBad: true,
  errorLeaked: false,
  commitLeaked: false,
  badWrite: true,
  goodWrite: true,
  allWritesCommitted: true
}
```

## A failed full retry stays inside its calendar boundary

A real 410 clears the stale token and triggers a full retry. If that retry also
fails, the connector leaves the invalid token absent, continues later
calendars, and never exposes the HTTP request URL containing token material.

```ts
const box = await newBox({ calendars: ["expired", "healthy"] });

const inner = createFakeGoogleCalendar({
  calendars: [
    { id: "expired", summary: "Expired", accessRole: "owner" },
    { id: "healthy", summary: "Healthy", accessRole: "owner" },
  ],
});
let exerciseRetryFailure = false;
const healthyEvent = evt("evt-healthy", "Healthy calendar", "2026-06-12T12:00:00Z", "2026-06-12T13:00:00Z");
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
({
  success: result.success,
  healthyCreated: result.created.some((file) => file.includes("healthy")),
  expiredToken: state.syncTokens.expired ?? null,
  healthyToken: state.syncTokens.healthy,
  leakedStale: result.error?.includes("stale-secret-token"),
  leakedRetry: result.error?.includes("full-retry-secret"),
})
=> { success: false, healthyCreated: true, expiredToken: null, healthyToken: "healthy-next", leakedStale: false, leakedRetry: false }
```

## The sync commit is path-scoped (never sweeps unrelated staged files)

The connector builds an EXPLICIT changed-file list and commits exactly it,
rather than staging a directory and running a bare `commit()`. So a concurrent
mutator's already-staged file — here an unrelated `notes.md` staged before the
sync — is NOT co-committed under the calendar connector's attribution; it stays
staged and uncommitted, exactly where the concurrent actor put it.

```ts
const box = await newBox();
const calendar = primaryCalendar([
  evt("evt-review", "Review", "2026-06-04T15:00:00Z", "2026-06-04T16:00:00Z", { updated: "2026-06-01T10:00:00Z" }),
]);

// A concurrent actor stages an unrelated file just before the sync commits.
await writeFile(join(box.root, "notes.md"), "work in progress\n");
execSync("git add notes.md", { cwd: box.root });

await connect(box, calendar).sync();

({
  committedNotes: committedFiles(box).includes("notes.md"),
  stillStaged: execSync("git diff --cached --name-only --relative", { cwd: box.root, encoding: "utf-8" }).trim(),
})
=> { committedNotes: false, stillStaged: "notes.md" }
```

## A corrupt state file fails the sync closed, nothing is pushed

`_bookkeeping/connectors/google-calendar-state.json` is the index of which `.ics`
file belongs to which Google event. It is not a cache: the push pass treats
every calendar file *absent* from that index as a locally-created event, so
recovering from an unreadable index by starting with an empty one would insert
a duplicate of every existing event into Google. The load refuses instead, and
the sync stops before the push pass runs.

```ts
const box = await newBox();
const calendar = primaryCalendar([evt("evt-review", "Review", "2026-06-04T09:00:00Z", "2026-06-04T10:00:00Z")]);
const connector = connect(box, calendar);
const first = await connector.sync();
const firstRun = { success: first.success, created: first.created.length, events: calendar.events.length };
```

Truncate the state file the way an interrupted write would, then sync again.
The sync fails, and — the point of the test — the fake calendar is untouched:
no `insertEvent` reached Google. The failure names the file and says what to do
about it, the corrupt bytes are left exactly as they were for a human to look
at, and the local `.ics` is still there too — a failed load never touches the
store:

```ts continue
const statePath = join(box.root, "_bookkeeping/connectors/google-calendar-state.json");
await writeFile(statePath, '{"syncTokens": {}, "eventFiles": {"evt-rev');

const second = await connector.sync();
({
  firstRun,
  success: second.success,
  events: calendar.events.length,
  explained: second.error?.includes("could not be read or parsed"),
  stateBytes: await readFile(statePath, "utf-8"),
  icsFiles: (await icsNames(box)).length,
})
=>
{
  firstRun: { success: true, created: 1, events: 1 },
  success: false,
  events: 1,
  explained: true,
  stateBytes: "{\"syncTokens\": {}, \"eventFiles\": {\"evt-rev",
  icsFiles: 1
}
```

## A rejected local push fails the sync and keeps the file

An untracked `.ics` that Google refuses used to warn and continue, so the file
retried on every wakeup while the connector reported success. The insert
failure is now part of the result. The error names the operation, the calendar,
and the file still sitting there waiting to be retried.

```ts
const box = await newBox();
await box.seed(`${CAL_DIR}/local-new.ics`, localIcs("local-rejected", "Rejected push"));
box.commitAll("seed local ics");

const inner = primaryCalendar();
const calendar: GoogleCalendarService = {
  ...inner,
  insertEvent: async () => throwCalendarHttpError(503, "https://calendar.test/events"),
};

const result = await connect(box, calendar).sync();
({
  success: result.success,
  pushed: result.pushed ?? null,
  remoteEvents: inner.events.length,
  error: result.error,
  fileKept: (await readIcs(box, "local-new.ics")).includes("Rejected push"),
})
=>
{
  success: false,
  pushed: null,
  remoteEvents: 0,
  error: "Calendar sync failed for primary _content/calendar/local-new.ics (local-push, HTTP 503)",
  fileKept: true
}
```

## A rejected X-BBX-DELETE fails the sync and keeps the marker

A delete Google rejects has to stay pending — the file and its `X-BBX-DELETE`
marker survive so the next sync retries — and it has to be visible, or the
retry loop runs forever behind a `bbx wakeup` that exits zero. The failure says
which file is stuck.

```ts
const box = await newBox();
const inner = primaryCalendar([
  evt("evt-cancelme", "Cancel me", "2026-06-05T09:00:00Z", "2026-06-05T10:00:00Z", { updated: "2026-06-01T10:00:00Z" }),
]);

// After the first sync nothing changed remotely, and every delete is refused.
const { mode, calendar } = quietable(inner, {
  deleteEvent: async () => throwCalendarHttpError(503, "https://calendar.test/events/evt-cancelme"),
});

const connector = connect(box, calendar);
await connector.sync();
const file = await editFirst(box, "END:VEVENT", "X-BBX-DELETE:no longer happening\r\nEND:VEVENT");

mode.quiet = true;
const result = await connector.sync();
({
  success: result.success,
  remoteEvents: inner.events.length,
  markerKept: (await readIcs(box, file)).includes("X-BBX-DELETE"),
  stuck: result.error?.includes("(local-delete, HTTP 503)"),
})
=> { success: false, remoteEvents: 1, markerKept: true, stuck: true }
```

## A failed patch keeps the local edit instead of overwriting it

When the local file changed and Google's copy did not, the connector pushes the
edit. If that patch is rejected — a transient 429 or 503 is the realistic case —
the old code fell through and wrote Google's version over the file, erasing the
boxholder's edit and reporting a normal update. The edit now survives, the
stored hash is left alone so the next sync retries, and the run fails; the
failure points at the file. Nothing is recorded as an update (`updated` stays empty).

```ts
const box = await newBox();
const inner = primaryCalendar([lunch()]);
const calendar: GoogleCalendarService = {
  ...inner,
  patchEvent: async () => throwCalendarHttpError(503, "https://calendar.test/events/evt-lunch"),
};

const connector = connect(box, calendar);
await connector.sync();
const file = await editFirst(box, "Lunch", "Lunch MINE");

const result = await connector.sync();
({
  success: result.success,
  updated: result.updated.length,
  pushed: result.pushed ?? null,
  editKept: (await readIcs(box, file)).includes("Lunch MINE"),
  blamed: result.error?.includes(`_content/calendar/${file} (local-push, HTTP 503)`),
})
=> { success: false, updated: 0, pushed: null, editKept: true, blamed: true }
```

A later sync where the patch works pushes the edit that was held:

```ts continue
await connect(box, inner).sync();
inner.events[0]?.summary
=> Lunch MINE
```

## A full resync after a 410 removes events Google no longer has

A full-window list is the whole truth for that window and does not report
deletions, so an event we still track that the response omits was deleted
remotely while our sync token was invalid. The 410 recovery used to refresh
only the events Google returned, leaving the deleted one as a stale `.ics`
forever. Now the resync reconciles — but never at the cost of a local edit.

```ts
const box = await newBox();
const inner = primaryCalendar([
  evt("evt-keep", "Still on Google", "2026-06-03T10:00:00Z", "2026-06-03T11:00:00Z"),
  evt("evt-stale", "Deleted while token was invalid", "2026-06-04T10:00:00Z", "2026-06-04T11:00:00Z"),
  evt("evt-edited", "Deleted but edited here", "2026-06-05T10:00:00Z", "2026-06-05T11:00:00Z"),
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
  return found.sort();
};

const connector = connect(box, calendar);
await connector.sync();
const initial = await summaries();
```

Edit one file locally, then delete both of those events from Google. The next
sync presents the stored token, gets the 410, and refetches the full window.
The untouched stale file is deleted; the locally-edited one is stranded rather
than deleted behind the boxholder's back — the edit is still on disk, under
`stranded/`, and the run reports it once. Nothing tracks it any more, so no
later run patches, reports, or re-inserts it (index keys are
`<eventId> <calendarId>` — see `google-calendar-event-index.doctest.md`):

```ts continue
let editedFile = "";
for (const name of await icsNames(box)) {
  const text = await readIcs(box, name);
  if (!text.includes("Deleted but edited here")) continue;
  editedFile = name;
  await writeFile(join(dir, name), text.replace("Deleted but edited here", "MINE now"));
}
inner.events = inner.events.filter((e) => e.id === "evt-keep");

const result = await connector.sync();
({
  initial,
  afterResync: await summaries(),
  success: result.success,
  files: (await icsNames(box)).length,
  editKept: (await readFile(join(dir, "stranded", editedFile), "utf-8")).includes("MINE now"),
  reported: result.error?.includes("(stale-cleanup, local: stranded — deleted on Google (absent from a full resync))"),
  tracked: Object.keys((await loadCalendarState(box.root)).eventFiles),
})
=>
{
  initial: ["Deleted but edited here", "Deleted while token was invalid", "Still on Google"],
  afterResync: ["Still on Google"],
  success: false,
  files: 1,
  editKept: true,
  reported: true,
  tracked: ["evt-keep primary"]
}
```

An event outside the refetched window was never in the full response's scope, so
its absence is not evidence of anything and it is never removed. Push one into
Google (which tracks it), delete it there, and force another 410:

```ts continue
await box.seed(`${CAL_DIR}/2027-01-01_faraway.ics`, localIcs("far-away", "Far future", { date: "20270101" }));
const pushRun = await connector.sync();

inner.events = inner.events.filter((e) => e.summary !== "Far future");
const afterFar = await connector.sync();
({
  pushed: pushRun.pushed?.length,
  stillThere: (await icsNames(box)).includes("2027-01-01_faraway.ics"),
  blamed: afterFar.error?.includes("faraway") ?? false,
})
=> { pushed: 1, stillThere: true, blamed: false }
```

## A local edit is pushed even when Google returns nothing

The pull can only reconcile events Google chooses to return, and an incremental
sync returns nothing for an event nobody else touched — while the sync token
advances past it. So a local edit used to reach Google only if the same event
happened to come back in a pull, in practice only during a full resync. The
push phase now looks for tracked files whose content no longer matches the hash
the connector recorded, and patches them. The file is rewritten from Google's
response and its hash re-stamped, so the edit stops being pending — a third
sync pushes nothing.

```ts
const box = await newBox();
const inner = primaryCalendar([lunch()]);
// After the first pull the incremental sync returns nothing, exactly as Google
// does when no one has touched the event since the stored token.
const { mode, calendar } = quietable(inner);

const connector = connect(box, calendar);
await connector.sync();
await editFirst(box, "Lunch", "Lunch MINE");

mode.quiet = true;
const result = await connector.sync();
const third = await connector.sync();
({
  success: result.success,
  updated: result.updated.length,
  remote: inner.events[0]?.summary,
  third: { updated: third.updated.length, remote: inner.events[0]?.summary },
})
=> { success: true, updated: 1, remote: "Lunch MINE", third: { updated: 0, remote: "Lunch MINE" } }
```

## A rejected patch is retried on the next sync

A patch Google refuses leaves the file and its stored hash alone so the edit
survives. That is only half a retry: an incremental sync will not resend an
event Google did not change, and the sync token advances anyway, so the pull
never revisits it. The mismatched hash IS the retry queue — the pending-edit
pass finds it on the next run without any new state. Run 2: Google still
returns the event, the patch is rejected, the edit stays. Run 3 is an ordinary
incremental sync — Google returns nothing at all — and the held edit still goes
up.

```ts
const box = await newBox();
const inner = primaryCalendar([
  evt("evt-dentist", "Dentist", "2026-06-05T09:00:00Z", "2026-06-05T10:00:00Z", { updated: "2026-06-01T10:00:00Z" }),
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
await editFirst(box, "Dentist", "Dentist MINE");

patchFails = true;
const rejected = await connector.sync();
const afterRejected = { success: rejected.success, remote: inner.events[0]?.summary };

mode.quiet = true;
patchFails = false;
const retried = await connector.sync();
({
  rejected: afterRejected,
  retried: { success: retried.success, updated: retried.updated.length, remote: inner.events[0]?.summary },
})
=>
{
  rejected: { success: false, remote: "Dentist" },
  retried: { success: true, updated: 1, remote: "Dentist MINE" }
}
```

## A local edit Google will never take is stranded

A patch that comes back 404 is definitive: there is no event on Google to
patch, and no number of retries changes that. The edit used to sit in the
retry queue forever, re-patched and re-reported on every wakeup. Now the file
is stranded — moved to `_content/calendar/stranded/`, untracked, reported once.

```ts
const box = await newBox();
const inner = primaryCalendar([
  evt("evt-gone", "Deleted but edited here", "2026-06-05T10:00:00Z", "2026-06-05T11:00:00Z"),
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
const file = await editFirst(box, "Deleted but edited here", "MINE now");
inner.events = [];

// The patch 404s. One try, then the file is stranded.
const strandRun = await connector.sync();
const dir = join(box.root, CAL_DIR);
({
  success: strandRun.success,
  patchCalls,
  blamed: strandRun.error?.includes(`_content/calendar/${file} (local-push, local: stranded — deleted on Google (HTTP 404))`),
  gone: (await icsNames(box)).includes(file),
  kept: (await readFile(join(dir, "stranded", file), "utf-8")).includes("MINE now"),
})
=> { success: false, patchCalls: 1, blamed: true, gone: false, kept: true }
```

The entry is gone from the index. BOTH ends of the move are in that commit — the vacated
path as well as the new one. A commit that recorded only the arrival would
leave the old path staged-but-uncommitted, for the box's next sweep to
attribute to whatever ran next. Nothing is left behind in the working tree
either:

```ts continue
const nameStatus = execSync("git show --name-status --pretty=format: HEAD", { cwd: box.root, encoding: "utf-8" });
// Columns are status, path(s) — and the box package puts the box under
// content/, so match by suffix rather than by a whole path.
const rows = nameStatus.trim().split("\n").filter(Boolean).map((line) => line.split("\t"));
const vacated = rows.find((row) => row[1]?.endsWith(`_content/calendar/${file}`));
// Git may record the move as a rename (R) or as a delete plus an add.
const renamed = vacated?.[0]?.startsWith("R") === true
  && vacated[2]?.endsWith(`_content/calendar/stranded/${file}`) === true;
const deletedAndAdded = vacated?.[0] === "D"
  && rows.some((row) => row[0] === "A" && row[1]?.endsWith(`_content/calendar/stranded/${file}`));
({
  tracked: Object.keys((await loadCalendarState(box.root)).eventFiles),
  bothEndsCommitted: renamed || deletedAndAdded,
  status: execSync("git status --short", { cwd: box.root, encoding: "utf-8" }).trim(),
})
=> { tracked: [], bothEndsCommitted: true, status: "" }
```

The next run neither calls the API for it nor mentions it — the retry loop is
over, and the boxholder's edit is sitting in `stranded/` if they want it back:

```ts continue
const quietRun = await connector.sync();
({
  success: quietRun.success,
  patchCalls,
  error: quietRun.error ?? null,
  stillThere: (await readdir(join(dir, "stranded"))).includes(file),
})
=> { success: true, patchCalls: 1, error: null, stillThere: true }
```

## A transient failure is retried for a week, then stranded

A 503 says nothing about whether Google would ever take the edit, so it is
retried on every wakeup — but not forever. `pendingSince` records when the edit
first failed, and the first run more than `STRANDED_AFTER_MS` (seven days)
later gives up on it.

```ts
const box = await newBox();
const inner = primaryCalendar([
  evt("evt-lunch", "Lunch", "2026-06-05T12:00:00Z", "2026-06-05T13:00:00Z", { updated: "2026-06-01T10:00:00Z" }),
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

const connector = connect(box, calendar, () => clock);
await connector.sync();
const file = await editFirst(box, "SUMMARY:Lunch", "SUMMARY:Lunch MINE");
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
({ first, second, third })
=>
{
  first: { success: false, http: true, kept: true, pendingSince: "2026-06-15T12:00:00.000Z" },
  second: { http: true, kept: true, pendingSince: "2026-06-15T12:00:00.000Z" },
  third: { blamed: true, gone: false, kept: true, tracked: 0, quiet: null }
}
```

A push Google accepts inside the window closes it instead: the stamp is dropped
the moment the edit lands, so a later unrelated failure starts a fresh week
rather than inheriting a spent one.

```ts
const box = await newBox();
const inner = primaryCalendar([
  evt("evt-lunch", "Lunch", "2026-06-05T12:00:00Z", "2026-06-05T13:00:00Z", { updated: "2026-06-01T10:00:00Z" }),
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

const connector = connect(box, calendar, () => clock);
await connector.sync();
await editFirst(box, "SUMMARY:Lunch", "SUMMARY:Lunch MINE");
await connector.sync();
const opened = await pendingSince(box, "evt-lunch primary");

patchFails = false;
clock = new Date("2026-06-18T12:00:00Z");
const accepted = await connector.sync();
({
  opened,
  success: accepted.success,
  remote: inner.events[0]?.summary,
  pendingSince: await pendingSince(box, "evt-lunch primary"),
})
=> { opened: "2026-06-15T12:00:00.000Z", success: true, remote: "Lunch MINE", pendingSince: null }
```

## A full resync never removes a recurring master

`singleEvents=false` plus a `timeMin`/`timeMax` leaves it to Google whether a
series' master comes back in a window, and `isInWindow` cannot arbitrate — it
answers `true` for every recurring event by construction. So a master missing
from a full resync is no information at all, and the stale pass leaves it
alone. (A series really deleted in Google arrives as a cancelled event on an
ordinary pull.) It is still tracked, too — an untracked `.ics` would be read as
a locally-created event and inserted back into Google as a duplicate series.

```ts
const box = await newBox();
const inner = primaryCalendar([
  evt("evt-weekly", "Weekly sync",
    { dateTime: "2026-06-01T14:00:00-04:00", timeZone: "America/New_York" },
    { dateTime: "2026-06-01T15:00:00-04:00", timeZone: "America/New_York" },
    { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"] }),
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
({
  success: result.success,
  kept: (await icsNames(box)).includes(file),
  tracked: Object.keys((await loadCalendarState(box.root)).eventFiles),
})
=> { success: true, kept: true, tracked: ["evt-weekly primary"] }
```

A LOCALLY EDITED master is not stranded either. A non-recurring event missing
from a full resync is deleted-on-Google and its edit is given up on; for a
master, absence is not evidence, so the edit stays in the ordinary push queue:

```ts continue
await editFirst(box, "Weekly sync", "Weekly sync MINE");
const afterEdit = await connector.sync();
({
  success: afterEdit.success,
  kept: (await icsNames(box)).includes(file),
  stranded: (await readdir(join(box.root, CAL_DIR))).includes("stranded"),
  tracked: Object.keys((await loadCalendarState(box.root)).eventFiles),
})
=> { success: true, kept: true, stranded: false, tracked: ["evt-weekly primary"] }
```

## An edit to a locally-created event is pushed too

A file pushed from the box gets tracked with the hash of what is on disk, like
one written from a pull. Without that hash the entry has nothing to compare
against, so a later edit to an event the boxholder created here would look
identical to the original forever and never enter the pending-edit push.

```ts
const box = await newBox();
await box.seed(`${CAL_DIR}/local-new.ics`, localIcs("local-editable", "Locally created"));
box.commitAll("seed local ics");

const inner = primaryCalendar();
// After the insert, Google has nothing new to report on any later sync.
const { mode, calendar } = quietable(inner);

const connector = connect(box, calendar);
const first = await connector.sync();
const firstRun = { pushed: first.pushed?.length, remote: inner.events[0]?.summary };
```

Edit the file the box created. The next sync patches it up:

```ts continue
const filePath = join(box.root, CAL_DIR, "local-new.ics");
await writeFile(filePath, (await readFile(filePath, "utf-8")).replace("Locally created", "Locally created MINE"));

mode.quiet = true;
const second = await connector.sync();
({
  firstRun,
  success: second.success,
  updated: second.updated.length,
  remote: inner.events[0]?.summary,
})
=> { firstRun: { pushed: 1, remote: "Locally created" }, success: true, updated: 1, remote: "Locally created MINE" }
```

## An event Google created is tracked even if the local rewrite fails

Pushing a locally-created `.ics` is two steps: the insert, then a rewrite that
strips the `X-BBX-` annotations out of the local file. Only the first of those
is visible to Google, so the tracking entry is written the moment the insert
returns. If the rewrite is the thing that fails, the event is still tracked and
the failure is reported — an untracked event Google holds would look
locally-created to the next run's orphan scan, which would insert a duplicate.

Make the rewrite fail by taking write permission off the file: it stays
readable, so everything up to the rewrite proceeds exactly as it normally does.

```ts
const box = await newBox();
await box.seed(`${CAL_DIR}/annotated.ics`, localIcs("annotated-local", "Book the hall", { extra: "X-BBX-REASON:the caterer asked\r\n" }));
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
  blamed: first.error?.includes("_content/calendar/annotated.ics (local-push, error)"),
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
({
  afterFirst,
  second: {
    success: second.success,
    pushed: second.pushed?.length ?? 0,
    remote: inner.events.map((e) => e.summary),
    kept: (await readFile(filePath, "utf-8")).includes("X-BBX-REASON"),
  },
})
=>
{
  afterFirst: {
    success: false,
    pushed: 1,
    blamed: true,
    remote: ["Book the hall"],
    tracked: { ids: 1, filename: "annotated.ics", hashed: true }
  },
  second: { success: true, pushed: 0, remote: ["Book the hall"], kept: true }
}
```

## A pushed edit Google accepted survives a failed local rewrite

The pending-edit pass patches Google and then rewrites the local file from the
response to normalize it. Google's acceptance is the fact that matters, so the
entry is stamped against Google's copy before the rewrite is attempted. A
rewrite that fails is a reported failure, not a lost update: the recorded hash
no longer matches the file, so the next run re-patches the same content Google
already has — idempotent, and never a second event.

```ts
const box = await newBox();
const inner = primaryCalendar([
  evt("evt-review", "Review", "2026-06-05T09:00:00Z", "2026-06-05T10:00:00Z", { updated: "2026-06-01T10:00:00Z" }),
]);
const { mode, calendar } = quietable(inner);

const connector = connect(box, calendar);
await connector.sync();

// The edit changes the summary and leaves an annotation the normalizing
// rewrite would have dropped, so the file and Google's copy really do differ.
const file = await editFirst(box, "Review", "Review MINE");
await editFirst(box, "END:VEVENT", "X-BBX-REF:_content/note.md\r\nEND:VEVENT");
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
  blamed: rewriteFailed.error?.includes(`_content/calendar/${file} (local-push, error)`),
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
({
  afterFailure,
  retried: { success: retried.success, updated: retried.updated.length },
  settled: { success: settled.success, updated: settled.updated.length },
  remote: inner.events.map((e) => e.summary),
})
=>
{
  afterFailure: {
    success: false,
    blamed: true,
    remote: ["Review MINE"],
    tracked: { ids: 1, filename: "2026-06-05_t-review.ics", pending: true }
  },
  retried: { success: true, updated: 1 },
  settled: { success: true, updated: 0 },
  remote: ["Review MINE"]
}
```
