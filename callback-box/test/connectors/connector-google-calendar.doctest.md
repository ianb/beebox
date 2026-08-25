# Google Calendar connector

The Google Calendar connector pulls events from Google via the
`GoogleCalendarService` and writes them as `.ics` files under
`store/calendar/`. Injecting a fake service lets us exercise the ICS
generation path (VTIMEZONE + DTSTART) without hitting the network.

```ts setup
import { join } from "node:path";
import { execSync } from "node:child_process";
import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
// eslint-disable-next-line import-x/no-rename-default
import ICAL from "ical.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/index.js";
import { createFakeGoogleCalendar } from "../../src/services/google-calendar.js";
import type { CalendarEvent, GoogleCalendarService } from "../../src/services/google-calendar.js";
import { createGoogleCalendarConnector } from "../../src/connectors/google-calendar.js";
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
```

## A timezone-bearing event round-trips through ICS

Seed the fake with a single recurring weekly event in America/New_York and
sync. The event lands as one `.ics` file with a VTIMEZONE block (DST-aware,
two SUBCOMPONENTs since New_York observes DST) and a DTSTART that carries
the TZID parameter.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const calendar = createFakeGoogleCalendar({
  calendars: [
    { id: "primary", summary: "Main", primary: true, accessRole: "owner" },
  ],
  events: [
    {
      id: "evt-meeting",
      status: "confirmed",
      summary: "Weekly sync",
      start: { dateTime: "2026-06-01T14:00:00-04:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-06-01T15:00:00-04:00", timeZone: "America/New_York" },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
    },
  ],
});

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
const result = await connector.sync();
result.success
=> true
```

The sync wrote one `.ics` file:

```ts continue
const files = (await readdir(join(box.root, "store/calendar"))).filter((f) => f.endsWith(".ics"));
files.length
=> 1
```

The file parses cleanly as iCalendar (this is the regression bar — the
basic-vs-extended date format bug that broke every box's calendar sync
would have thrown here):

```ts continue
const ics = await readFile(join(box.root, "store/calendar", files[0]), "utf-8");
const comp = new ICAL.Component(ICAL.parse(ics));
comp.name
=> vcalendar
```

It includes a VTIMEZONE for America/New_York with STANDARD + DAYLIGHT
subcomponents:

```ts continue
const vtz = comp.getFirstSubcomponent("vtimezone");
String(vtz?.getFirstPropertyValue("tzid"))
=> America/New_York

vtz?.getAllSubcomponents("standard").length
=> 1

vtz?.getAllSubcomponents("daylight").length
=> 1
```

The VEVENT has DTSTART with the TZID parameter and the RRULE we passed in:

```ts continue
const vevent = comp.getFirstSubcomponent("vevent");
String(vevent?.getFirstPropertyValue("summary"))
=> Weekly sync

String(vevent?.getFirstProperty("dtstart")?.getParameter("tzid"))
=> America/New_York

String(vevent?.getFirstProperty("rrule")?.toICALString()).includes("FREQ=WEEKLY")
=> true
```

## A locally-created .ics file gets pushed to Google

Drop an unrecognized `.ics` into `store/calendar/`. The connector parses it,
inserts it into the fake calendar, and tracks it in state.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("store/calendar/local-new.ics",
  "BEGIN:VCALENDAR\r\n" +
  "VERSION:2.0\r\n" +
  "PRODID:-//Test//EN\r\n" +
  "BEGIN:VEVENT\r\n" +
  "UID:local-1\r\n" +
  "SUMMARY:Locally created\r\n" +
  "DTSTART;VALUE=DATE:20260601\r\n" +
  "DTEND;VALUE=DATE:20260602\r\n" +
  "END:VEVENT\r\n" +
  "END:VCALENDAR\r\n",
);
box.commitAll("seed local ics");

const calendar = createFakeGoogleCalendar({
  calendars: [
    { id: "primary", summary: "Main", primary: true, accessRole: "owner" },
  ],
});

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
const result = await connector.sync();
result.pushed?.length
=> 1
```

The fake calendar now has one event:

```ts continue
calendar.events.length
=> 1

calendar.events[0]?.summary
=> Locally created
```

## A local edit is pushed when Google's copy is unchanged

Sync an event, edit the local `.ics`, then sync again with Google's `updated`
timestamp untouched. Because nothing changed remotely since the last pull, the
local edit is pushed up to Google.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const calendar = createFakeGoogleCalendar({
  calendars: [
    { id: "primary", summary: "Main", primary: true, accessRole: "owner" },
  ],
  events: [
    {
      id: "evt-lunch",
      status: "confirmed",
      summary: "Lunch",
      updated: "2026-06-01T10:00:00Z",
      start: { dateTime: "2026-06-03T12:00:00-04:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-06-03T13:00:00-04:00", timeZone: "America/New_York" },
    },
  ],
});

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
await connector.sync();
const dir = join(box.root, "store/calendar");
const file = (await readdir(dir)).filter((f) => f.endsWith(".ics"))[0] ?? "";

// Edit locally; Google's `updated` is unchanged → the edit gets pushed.
const localIcs = await readFile(join(dir, file), "utf-8");
await writeFile(join(dir, file), localIcs.replace("Lunch", "Lunch MINE"));

await connector.sync();

// The patch reached Google: the fake calendar holds the locally-edited summary.
calendar.events[0]?.summary
=> Lunch MINE
```

The commit records the push (and never discards the edit):

```ts continue
const msg = execSync("git log -1 --pretty=%B", { cwd: box.root, encoding: "utf-8" });
msg.includes("Pushed:")
=> true

msg.includes("local edit discarded")
=> false
```

## A remote change beats a local edit (remote wins)

Sync an event, edit the local `.ics`, and *also* change Google's copy with a
different `updated` timestamp. Both sides changed since the last pull, so the
conflict resolves in Google's favor: the local edit is discarded, the file is
overwritten with Google's version, and the change is recorded as a normal
update (never a push).

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const calendar = createFakeGoogleCalendar({
  calendars: [
    { id: "primary", summary: "Main", primary: true, accessRole: "owner" },
  ],
  events: [
    {
      id: "evt-standup",
      status: "confirmed",
      summary: "Standup",
      updated: "2026-06-01T10:00:00Z",
      start: { dateTime: "2026-06-02T09:00:00-04:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-06-02T09:15:00-04:00", timeZone: "America/New_York" },
    },
  ],
});

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
await connector.sync();
const dir = join(box.root, "store/calendar");
const file = (await readdir(dir)).filter((f) => f.endsWith(".ics"))[0] ?? "";

// Local edit...
const localIcs = await readFile(join(dir, file), "utf-8");
await writeFile(join(dir, file), localIcs.replace("Standup", "Standup MINE"));

// ...and a concurrent remote change with a newer `updated` timestamp.
if (calendar.events[0]) {
  calendar.events[0].summary = "Standup (rescheduled)";
  calendar.events[0].updated = "2026-06-02T10:00:00Z";
}

const result = await connector.sync();
result.pushed
=> undefined

result.updated.length
=> 1
```

The local file now matches Google's version, not the discarded local edit:

```ts continue
const after = await readFile(join(dir, file), "utf-8");
after.includes("Standup (rescheduled)")
=> true

after.includes("MINE")
=> false
```

The commit records the conflict as an update with no push:

```ts continue
const msg = execSync("git log -1 --pretty=%B", { cwd: box.root, encoding: "utf-8" });
msg.includes("local edit discarded — event also changed remotely (remote wins)")
=> true

msg.includes("Pushed:")
=> false
```

## Sync-token expiry triggers a full resync (410)

Incremental syncs pass Google the stored sync token; when Google reports it
expired (HTTP 410), the connector drops the token, refetches the full window,
and continues — the sync still succeeds and a fresh token is recorded.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const inner = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
  events: [
    {
      id: "evt-1",
      status: "confirmed",
      summary: "Planning",
      start: { dateTime: "2026-06-03T10:00:00Z" },
      end: { dateTime: "2026-06-03T11:00:00Z" },
    },
  ],
});

// Wrap the fake: any listEvents call that presents a sync token gets a 410,
// as Google does for an expired token. Full-window calls pass through.
let tokenRejections = 0;
const calendar = {
  ...inner,
  listEvents: async (calendarId, opts) => {
    if (opts?.syncToken) {
      tokenRejections += 1;
      return throwCalendarHttpError(
        410,
        "https://calendar.test/events?syncToken=expired-secret",
      );
    }
    return inner.listEvents(calendarId, opts);
  },
};

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });

// First sync: full window (no token yet) — records "fake-sync-token".
const first = await connector.sync();
first.success
=> true
```

The second sync presents the stored token, gets the 410, and recovers by
falling back to a full sync in the same run:

```ts continue
const second = await connector.sync();
JSON.stringify({ success: second.success, tokenRejections })
=> {"success":true,"tokenRejections":1}
```

The full-resync path re-recorded a usable sync token in connector state
(the 410 handler cleared the stale one before the refetch stored anew;
sync tokens live in the gitignored transient state, so read via the loader):

```ts continue
const { loadCalendarState } = await import("../../src/connectors/google-calendar-state.js");
const state = await loadCalendarState(box.root);
state.syncTokens.primary
=> fake-sync-token
```

```ts cleanup
await box.cleanup();
```

## A failed calendar does not abort later calendars or post-loop work

Each calendar is an independent member of the configured working set. If one
calendar fails after writing an event, the connector retains that completed
path, restores the calendar's incoming sync token, continues with later
calendars, pushes local orphans, and reports the overall run as failed.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/google-calendar.json", JSON.stringify({
  calendars: ["bad", "good"],
  syncDaysBack: 30,
  syncDaysForward: 90,
}, null, 2));
box.commitAll("init two-calendar box");

const firstBadEvent: CalendarEvent = {
  id: "evt-bad-first",
  status: "confirmed",
  summary: "Written before failure",
  start: { dateTime: "2026-06-10T09:00:00Z" },
  end: { dateTime: "2026-06-10T10:00:00Z" },
};
const poisonBadEvent: CalendarEvent = {
  id: "evt-bad-poison",
  status: "confirmed",
  start: { dateTime: "2026-06-11T09:00:00Z" },
  end: { dateTime: "2026-06-11T10:00:00Z" },
};
Object.defineProperty(poisonBadEvent, "summary", {
  get() { throw new Error("private event text and syncToken=must-not-leak"); },
});
const goodEvent: CalendarEvent = {
  id: "evt-good",
  status: "confirmed",
  summary: "Later calendar still runs",
  start: { dateTime: "2026-06-12T09:00:00Z" },
  end: { dateTime: "2026-06-12T10:00:00Z" },
};

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
      return {
        items: [firstBadEvent, poisonBadEvent],
        nextSyncToken: "advanced-bad-token",
      };
    }
    return { items: [goodEvent], nextSyncToken: "advanced-good-token" };
  },
};

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
await connector.sync();

await box.seed("store/calendar/local-new.ics",
  "BEGIN:VCALENDAR\r\n" +
  "VERSION:2.0\r\n" +
  "PRODID:-//Test//EN\r\n" +
  "BEGIN:VEVENT\r\n" +
  "UID:local-after-failure\r\n" +
  "SUMMARY:Push after pull failure\r\n" +
  "DTSTART;VALUE=DATE:20260613\r\n" +
  "DTEND;VALUE=DATE:20260614\r\n" +
  "END:VEVENT\r\n" +
  "END:VCALENDAR\r\n",
);
box.commitAll("seed local orphan");

exerciseFailure = true;
const result = await connector.sync();
JSON.stringify({
  success: result.success,
  created: result.created.length,
  pushed: result.pushed?.length,
})
=> {"success":false,"created":2,"pushed":1}
```

The failed member kept its old token, while the later calendar advanced. The
overall error and commit contain controlled diagnostics, not the thrown event
text or token-like detail.

```ts continue
const { loadCalendarState } = await import("../../src/connectors/google-calendar-state.js");
const state = await loadCalendarState(box.root);
JSON.stringify(state.syncTokens)
=> {"bad":"old-bad","good":"advanced-good-token"}

const secondRunTokens = seenTokens.slice(-2);
JSON.stringify(secondRunTokens)
=> [{"calendarId":"bad","syncToken":"old-bad"},{"calendarId":"good","syncToken":"old-good"}]

JSON.stringify({
  mentionsBad: result.error?.includes("bad"),
  leaked: result.error?.includes("must-not-leak"),
})
=> {"mentionsBad":true,"leaked":false}

const message = execSync("git log -1 --pretty=%B", { cwd: box.root, encoding: "utf-8" });
JSON.stringify({
  partial: message.includes("Sync calendar: partial"),
  mentionsBad: message.includes("bad"),
  leaked: message.includes("must-not-leak"),
})
=> {"partial":true,"mentionsBad":true,"leaked":false}

const committed = execSync("git show --name-only --pretty=format: HEAD", { cwd: box.root, encoding: "utf-8" });
const createdContents = await Promise.all(
  result.created.map((file) => readFile(join(box.root, file), "utf-8")),
);
JSON.stringify({
  badWrite: createdContents.some((content) => content.includes("Written before failure")),
  goodWrite: createdContents.some((content) => content.includes("Later calendar still runs")),
  allWritesCommitted: result.created.every((file) => committed.includes(file)),
})
=> {"badWrite":true,"goodWrite":true,"allWritesCommitted":true}
```

```ts cleanup
await box.cleanup();
```

## A failed full retry stays inside its calendar boundary

A real 410 clears the stale token and triggers a full retry. If that retry also
fails, the connector leaves the invalid token absent, continues later
calendars, and never exposes the HTTP request URL containing token material.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/google-calendar.json", JSON.stringify({
  calendars: ["expired", "healthy"],
}, null, 2));
box.commitAll("init retry box");

const inner = createFakeGoogleCalendar({
  calendars: [
    { id: "expired", summary: "Expired", accessRole: "owner" },
    { id: "healthy", summary: "Healthy", accessRole: "owner" },
  ],
});
let exerciseRetryFailure = false;
const healthyEvent: CalendarEvent = {
  id: "evt-healthy",
  status: "confirmed",
  summary: "Healthy calendar",
  start: { dateTime: "2026-06-12T12:00:00Z" },
  end: { dateTime: "2026-06-12T13:00:00Z" },
};
const calendar: GoogleCalendarService = {
  ...inner,
  async listEvents(calendarId, opts) {
    if (!exerciseRetryFailure) {
      return { items: [], nextSyncToken: `old-${calendarId}` };
    }
    if (calendarId === "expired" && opts?.syncToken) {
      return throwCalendarHttpError(
        410,
        "https://calendar.test/events?syncToken=stale-secret-token",
      );
    }
    if (calendarId === "expired") {
      return throwCalendarHttpError(
        503,
        "https://calendar.test/events?pageToken=full-retry-secret",
      );
    }
    return { items: [healthyEvent], nextSyncToken: "healthy-next" };
  },
};

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
await connector.sync();
exerciseRetryFailure = true;
const result = await connector.sync();

const { loadCalendarState } = await import("../../src/connectors/google-calendar-state.js");
const state = await loadCalendarState(box.root);
JSON.stringify({
  success: result.success,
  healthyCreated: result.created.some((file) => file.includes("healthy")),
  expiredToken: state.syncTokens.expired ?? null,
  healthyToken: state.syncTokens.healthy,
  leakedStale: result.error?.includes("stale-secret-token"),
  leakedRetry: result.error?.includes("full-retry-secret"),
})
=> {"success":false,"healthyCreated":true,"expiredToken":null,"healthyToken":"healthy-next","leakedStale":false,"leakedRetry":false}
```

```ts cleanup
await box.cleanup();
```

## The sync commit is path-scoped (never sweeps unrelated staged files)

The connector builds an EXPLICIT changed-file list and commits exactly it,
rather than staging a directory and running a bare `commit()`. So a concurrent
mutator's already-staged file — here an unrelated `notes.md` staged before the
sync — is NOT co-committed under the calendar connector's attribution; it stays
staged and uncommitted.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const calendar = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
  events: [
    {
      id: "evt-review",
      status: "confirmed",
      summary: "Review",
      updated: "2026-06-01T10:00:00Z",
      start: { dateTime: "2026-06-04T15:00:00Z" },
      end: { dateTime: "2026-06-04T16:00:00Z" },
    },
  ],
});

// A concurrent actor stages an unrelated file just before the sync commits.
await writeFile(join(box.root, "notes.md"), "work in progress\n");
execSync("git add notes.md", { cwd: box.root });

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
await connector.sync();

// The calendar commit touched calendar files, but NOT the unrelated notes.md.
const committed = execSync("git show --name-only --pretty=format: HEAD", { cwd: box.root, encoding: "utf-8" });
committed.includes("notes.md")
=> false
```

`notes.md` is still staged and uncommitted — the sync left it exactly where the
concurrent actor put it.

```ts continue
const staged = execSync("git diff --cached --name-only --relative", { cwd: box.root, encoding: "utf-8" });
staged.trim()
=> notes.md
```

```ts cleanup
await box.cleanup();
```

## A corrupt state file fails the sync closed, nothing is pushed

`config/connectors/google-calendar-state.json` is the index of which `.ics`
file belongs to which Google event. It is not a cache: the push pass treats
every calendar file *absent* from that index as a locally-created event, so
recovering from an unreadable index by starting with an empty one would insert
a duplicate of every existing event into Google. The load refuses instead, and
the sync stops before the push pass runs.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const calendar = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
  events: [
    {
      id: "evt-review",
      status: "confirmed",
      summary: "Review",
      start: { dateTime: "2026-06-04T09:00:00Z" },
      end: { dateTime: "2026-06-04T10:00:00Z" },
    },
  ],
});

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
const first = await connector.sync();
JSON.stringify({ success: first.success, created: first.created.length, events: calendar.events.length })
=> {"success":true,"created":1,"events":1}
```

Truncate the state file the way an interrupted write would, then sync again.
The sync fails, and — the point of the test — the fake calendar is untouched:
no `insertEvent` reached Google.

```ts continue
const statePath = join(box.root, "config/connectors/google-calendar-state.json");
await writeFile(statePath, '{"syncTokens": {}, "eventFiles": {"evt-rev');

const second = await connector.sync();
JSON.stringify({ success: second.success, events: calendar.events.length })
=> {"success":false,"events":1}
```

The failure names the file and says what to do about it, and the corrupt bytes
are left exactly as they were for a human to look at:

```ts continue
second.error?.includes("could not be read or parsed")
=> true

(await readFile(statePath, "utf-8"))
=> {"syncTokens": {}, "eventFiles": {"evt-rev
```

The local `.ics` is still there too — a failed load never touches the store:

```ts continue
(await readdir(join(box.root, "store/calendar"))).filter((f) => f.endsWith(".ics")).length
=> 1
```

```ts cleanup
await box.cleanup();
```

## A rejected local push fails the sync and keeps the file

An untracked `.ics` that Google refuses used to warn and continue, so the file
retried on every wakeup while the connector reported success. The insert
failure is now part of the result.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("store/calendar/local-new.ics",
  "BEGIN:VCALENDAR\r\n" +
  "VERSION:2.0\r\n" +
  "PRODID:-//Test//EN\r\n" +
  "BEGIN:VEVENT\r\n" +
  "UID:local-rejected\r\n" +
  "SUMMARY:Rejected push\r\n" +
  "DTSTART;VALUE=DATE:20260601\r\n" +
  "DTEND;VALUE=DATE:20260602\r\n" +
  "END:VEVENT\r\n" +
  "END:VCALENDAR\r\n",
);
box.commitAll("seed local ics");

const inner = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
});
const calendar: GoogleCalendarService = {
  ...inner,
  insertEvent: async () => throwCalendarHttpError(503, "https://calendar.test/events"),
};

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
const result = await connector.sync();
JSON.stringify({
  success: result.success,
  pushed: result.pushed,
  remoteEvents: inner.events.length,
})
=> {"success":false,"remoteEvents":0}
```

The error names the operation, the calendar, and the file still sitting there
waiting to be retried:

```ts continue
result.error
=> Calendar sync failed for primary store/calendar/local-new.ics (local-push, HTTP 503)

(await readFile(join(box.root, "store/calendar/local-new.ics"), "utf-8")).includes("Rejected push")
=> true
```

```ts cleanup
await box.cleanup();
```

## A rejected X-CB-DELETE fails the sync and keeps the marker

A delete Google rejects has to stay pending — the file and its `X-CB-DELETE`
marker survive so the next sync retries — and it has to be visible, or the
retry loop runs forever behind a `cb wakeup` that exits zero.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const inner = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
  events: [
    {
      id: "evt-cancelme",
      status: "confirmed",
      summary: "Cancel me",
      updated: "2026-06-01T10:00:00Z",
      start: { dateTime: "2026-06-05T09:00:00Z" },
      end: { dateTime: "2026-06-05T10:00:00Z" },
    },
  ],
});

// After the first sync the incremental fetch returns nothing (nothing changed
// remotely), and every delete is refused.
let quiet = false;
const calendar: GoogleCalendarService = {
  ...inner,
  listEvents: async (calendarId, opts) => {
    if (quiet) {
      // An incremental fetch is what the section is about. If production ever
      // stopped sending the stored token this wrapper would be standing in for
      // a full fetch instead, and the test would quietly test nothing.
      if (!opts?.syncToken) throw new Error("expected the stored syncToken on this fetch");
      return { items: [], nextSyncToken: "fake-sync-token-2" };
    }
    return inner.listEvents(calendarId, opts);
  },
  deleteEvent: async () => throwCalendarHttpError(503, "https://calendar.test/events/evt-cancelme"),
};

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
await connector.sync();

const dir = join(box.root, "store/calendar");
const file = (await readdir(dir)).filter((f) => f.endsWith(".ics"))[0] ?? "";
const ics = await readFile(join(dir, file), "utf-8");
await writeFile(join(dir, file), ics.replace("END:VEVENT", "X-CB-DELETE:no longer happening\r\nEND:VEVENT"));

quiet = true;
const result = await connector.sync();
JSON.stringify({ success: result.success, remoteEvents: inner.events.length })
=> {"success":false,"remoteEvents":1}
```

The marker and the file are both still there for the retry, and the failure
says which file is stuck:

```ts continue
(await readFile(join(dir, file), "utf-8")).includes("X-CB-DELETE")
=> true

result.error?.includes("(local-delete, HTTP 503)")
=> true
```

```ts cleanup
await box.cleanup();
```

## A failed patch keeps the local edit instead of overwriting it

When the local file changed and Google's copy did not, the connector pushes the
edit. If that patch is rejected — a transient 429 or 503 is the realistic case —
the old code fell through and wrote Google's version over the file, erasing the
boxholder's edit and reporting a normal update. The edit now survives, the
stored hash is left alone so the next sync retries, and the run fails.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const inner = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
  events: [
    {
      id: "evt-lunch",
      status: "confirmed",
      summary: "Lunch",
      updated: "2026-06-01T10:00:00Z",
      start: { dateTime: "2026-06-03T12:00:00-04:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-06-03T13:00:00-04:00", timeZone: "America/New_York" },
    },
  ],
});
const calendar: GoogleCalendarService = {
  ...inner,
  patchEvent: async () => throwCalendarHttpError(503, "https://calendar.test/events/evt-lunch"),
};

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
await connector.sync();

const dir = join(box.root, "store/calendar");
const file = (await readdir(dir)).filter((f) => f.endsWith(".ics"))[0] ?? "";
const localIcs = await readFile(join(dir, file), "utf-8");
await writeFile(join(dir, file), localIcs.replace("Lunch", "Lunch MINE"));

const result = await connector.sync();
JSON.stringify({ success: result.success, updated: result.updated.length, pushed: result.pushed })
=> {"success":false,"updated":0}
```

The file still holds the local edit, and the failure points at it:

```ts continue
const after = await readFile(join(dir, file), "utf-8");
after.includes("Lunch MINE")
=> true

result.error?.includes(`store/calendar/${file} (local-push, HTTP 503)`)
=> true
```

Nothing was recorded as an update, so the commit narrative does not claim the
event changed:

```ts continue
const msg = execSync("git log -1 --pretty=%B", { cwd: box.root, encoding: "utf-8" });
msg.includes("Updated:")
=> false
```

A later sync where the patch works pushes the edit that was held:

```ts continue
const recovered = createGoogleCalendarConnector(box.root, { calendar: inner, now: NOW });
await recovered.sync();
inner.events[0]?.summary
=> Lunch MINE
```

```ts cleanup
await box.cleanup();
```

## A full resync after a 410 removes events Google no longer has

A full-window list is the whole truth for that window and does not report
deletions, so an event we still track that the response omits was deleted
remotely while our sync token was invalid. The 410 recovery used to refresh
only the events Google returned, leaving the deleted one as a stale `.ics`
forever. Now the resync reconciles — but never at the cost of a local edit.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const inner = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
  events: [
    {
      id: "evt-keep",
      status: "confirmed",
      summary: "Still on Google",
      start: { dateTime: "2026-06-03T10:00:00Z" },
      end: { dateTime: "2026-06-03T11:00:00Z" },
    },
    {
      id: "evt-stale",
      status: "confirmed",
      summary: "Deleted while token was invalid",
      start: { dateTime: "2026-06-04T10:00:00Z" },
      end: { dateTime: "2026-06-04T11:00:00Z" },
    },
    {
      id: "evt-edited",
      status: "confirmed",
      summary: "Deleted but edited here",
      start: { dateTime: "2026-06-05T10:00:00Z" },
      end: { dateTime: "2026-06-05T11:00:00Z" },
    },
  ],
});

// The fake's listEvents ignores syncToken/timeMin/timeMax and always returns
// whatever `inner.events` currently holds, so splicing an event out below is
// exactly "Google no longer returns it". This wrapper supplies the 410.
const calendar: GoogleCalendarService = {
  ...inner,
  listEvents: async (calendarId, opts) => {
    if (opts?.syncToken) {
      return throwCalendarHttpError(410, "https://calendar.test/events?syncToken=expired");
    }
    return inner.listEvents(calendarId, opts);
  },
};

const dir = join(box.root, "store/calendar");
const summaries = async (): Promise<string[]> => {
  const names = (await readdir(dir)).filter((f) => f.endsWith(".ics"));
  const found: string[] = [];
  for (const name of names) {
    const text = await readFile(join(dir, name), "utf-8");
    found.push((/^SUMMARY:(.*)$/m.exec(text)?.[1] ?? name).trim());
  }
  return found.sort();
};

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
await connector.sync();
JSON.stringify(await summaries())
=> ["Deleted but edited here","Deleted while token was invalid","Still on Google"]
```

Edit one file locally, then delete both of those events from Google. The next
sync presents the stored token, gets the 410, and refetches the full window.

```ts continue
const names = (await readdir(dir)).filter((f) => f.endsWith(".ics"));
let editedFile = "";
for (const name of names) {
  const text = await readFile(join(dir, name), "utf-8");
  if (!text.includes("Deleted but edited here")) continue;
  editedFile = name;
  await writeFile(join(dir, name), text.replace("Deleted but edited here", "MINE now"));
}
inner.events = inner.events.filter((e) => e.id === "evt-keep");

const result = await connector.sync();
JSON.stringify(await summaries())
=> ["Still on Google"]
```

The untouched stale file is deleted; the locally-edited one is stranded rather
than deleted behind the boxholder's back — the edit is still on disk, under
`stranded/`, and the run reports it once:

```ts continue
JSON.stringify({
  success: result.success,
  files: (await readdir(dir)).filter((f) => f.endsWith(".ics")).length,
  editKept: (await readFile(join(dir, "stranded", editedFile), "utf-8")).includes("MINE now"),
})
=> {"success":false,"files":1,"editKept":true}

result.error?.includes("(stale-cleanup, local: stranded — deleted on Google (absent from a full resync))")
=> true
```

Nothing tracks it any more, so no later run patches, reports, or re-inserts it
(index keys are `<eventId> <calendarId>` — see
`google-calendar-event-index.doctest.md`):

```ts continue
const { loadCalendarState: loadState1 } = await import("../../src/connectors/google-calendar-state.js");
JSON.stringify(Object.keys((await loadState1(box.root)).eventFiles))
=> ["evt-keep primary"]
```

An event outside the refetched window was never in the full response's scope, so
its absence is not evidence of anything and it is never removed. Push one into
Google (which tracks it), delete it there, and force another 410:

```ts continue
await box.seed("store/calendar/2027-01-01_faraway.ics",
  "BEGIN:VCALENDAR\r\n" +
  "VERSION:2.0\r\n" +
  "PRODID:-//Test//EN\r\n" +
  "BEGIN:VEVENT\r\n" +
  "UID:far-away\r\n" +
  "SUMMARY:Far future\r\n" +
  "DTSTART;VALUE=DATE:20270101\r\n" +
  "DTEND;VALUE=DATE:20270102\r\n" +
  "END:VEVENT\r\n" +
  "END:VCALENDAR\r\n",
);
const pushRun = await connector.sync();
pushRun.pushed?.length
=> 1
```

```ts continue
inner.events = inner.events.filter((e) => e.summary !== "Far future");
const afterFar = await connector.sync();
JSON.stringify({
  stillThere: (await readdir(dir)).includes("2027-01-01_faraway.ics"),
  blamed: afterFar.error?.includes("faraway") ?? false,
})
=> {"stillThere":true,"blamed":false}
```

```ts cleanup
await box.cleanup();
```

## A local edit is pushed even when Google returns nothing

The pull can only reconcile events Google chooses to return, and an incremental
sync returns nothing for an event nobody else touched — while the sync token
advances past it. So a local edit used to reach Google only if the same event
happened to come back in a pull, in practice only during a full resync. The
push phase now looks for tracked files whose content no longer matches the hash
the connector recorded, and patches them.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const inner = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
  events: [
    {
      id: "evt-lunch",
      status: "confirmed",
      summary: "Lunch",
      updated: "2026-06-01T10:00:00Z",
      start: { dateTime: "2026-06-03T12:00:00-04:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-06-03T13:00:00-04:00", timeZone: "America/New_York" },
    },
  ],
});

// After the first pull the incremental sync returns nothing, exactly as Google
// does when no one has touched the event since the stored token.
let quiet = false;
const calendar: GoogleCalendarService = {
  ...inner,
  listEvents: async (calendarId, opts) => {
    if (quiet) {
      // An incremental fetch is what the section is about. If production ever
      // stopped sending the stored token this wrapper would be standing in for
      // a full fetch instead, and the test would quietly test nothing.
      if (!opts?.syncToken) throw new Error("expected the stored syncToken on this fetch");
      return { items: [], nextSyncToken: "fake-sync-token-2" };
    }
    return inner.listEvents(calendarId, opts);
  },
};

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
await connector.sync();

const dir = join(box.root, "store/calendar");
const file = (await readdir(dir)).filter((f) => f.endsWith(".ics"))[0] ?? "";
const localIcs = await readFile(join(dir, file), "utf-8");
await writeFile(join(dir, file), localIcs.replace("Lunch", "Lunch MINE"));

quiet = true;
const result = await connector.sync();
JSON.stringify({
  success: result.success,
  updated: result.updated.length,
  remote: inner.events[0]?.summary,
})
=> {"success":true,"updated":1,"remote":"Lunch MINE"}
```

The file was rewritten from Google's response and its hash re-stamped, so the
edit stops being pending — a third sync pushes nothing:

```ts continue
const msg = execSync("git log -1 --pretty=%B", { cwd: box.root, encoding: "utf-8" });
msg.includes("Pushed:")
=> true

const third = await connector.sync();
JSON.stringify({ updated: third.updated.length, remote: inner.events[0]?.summary })
=> {"updated":0,"remote":"Lunch MINE"}
```

```ts cleanup
await box.cleanup();
```

## A rejected patch is retried on the next sync

A patch Google refuses leaves the file and its stored hash alone so the edit
survives. That is only half a retry: an incremental sync will not resend an
event Google did not change, and the sync token advances anyway, so the pull
never revisits it. The mismatched hash IS the retry queue — the pending-edit
pass finds it on the next run without any new state.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const inner = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
  events: [
    {
      id: "evt-dentist",
      status: "confirmed",
      summary: "Dentist",
      updated: "2026-06-01T10:00:00Z",
      start: { dateTime: "2026-06-05T09:00:00Z" },
      end: { dateTime: "2026-06-05T10:00:00Z" },
    },
  ],
});

let quiet = false;
let patchFails = false;
const calendar: GoogleCalendarService = {
  ...inner,
  listEvents: async (calendarId, opts) => {
    if (quiet) {
      // An incremental fetch is what the section is about. If production ever
      // stopped sending the stored token this wrapper would be standing in for
      // a full fetch instead, and the test would quietly test nothing.
      if (!opts?.syncToken) throw new Error("expected the stored syncToken on this fetch");
      return { items: [], nextSyncToken: "fake-sync-token-2" };
    }
    return inner.listEvents(calendarId, opts);
  },
  patchEvent: async (calendarId, opts) => {
    if (patchFails) return throwCalendarHttpError(503, "https://calendar.test/events/evt-dentist");
    return inner.patchEvent(calendarId, opts);
  },
};

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
await connector.sync();

const dir = join(box.root, "store/calendar");
const file = (await readdir(dir)).filter((f) => f.endsWith(".ics"))[0] ?? "";
const localIcs = await readFile(join(dir, file), "utf-8");
await writeFile(join(dir, file), localIcs.replace("Dentist", "Dentist MINE"));

// Run 2: Google still returns the event, the patch is rejected, the edit stays.
patchFails = true;
const rejected = await connector.sync();
JSON.stringify({ success: rejected.success, remote: inner.events[0]?.summary })
=> {"success":false,"remote":"Dentist"}
```

Run 3 is an ordinary incremental sync — Google returns nothing at all — and the
held edit still goes up:

```ts continue
quiet = true;
patchFails = false;
const retried = await connector.sync();
JSON.stringify({
  success: retried.success,
  updated: retried.updated.length,
  remote: inner.events[0]?.summary,
})
=> {"success":true,"updated":1,"remote":"Dentist MINE"}
```

```ts cleanup
await box.cleanup();
```

## A local edit Google will never take is stranded

A patch that comes back 404 is definitive: there is no event on Google to
patch, and no number of retries changes that. The edit used to sit in the
retry queue forever, re-patched and re-reported on every wakeup. Now the file
is stranded — moved to `store/calendar/stranded/`, untracked, reported once.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const inner = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
  events: [
    {
      id: "evt-gone",
      status: "confirmed",
      summary: "Deleted but edited here",
      start: { dateTime: "2026-06-05T10:00:00Z" },
      end: { dateTime: "2026-06-05T11:00:00Z" },
    },
  ],
});

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

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
await connector.sync();

const dir = join(box.root, "store/calendar");
const file = (await readdir(dir)).filter((f) => f.endsWith(".ics"))[0] ?? "";
const localIcs = await readFile(join(dir, file), "utf-8");
await writeFile(join(dir, file), localIcs.replace("Deleted but edited here", "MINE now"));
inner.events = [];

// The patch 404s. One try, then the file is stranded.
const strandRun = await connector.sync();
JSON.stringify({
  success: strandRun.success,
  patchCalls,
  blamed: strandRun.error?.includes(`store/calendar/${file} (local-push, local: stranded — deleted on Google (HTTP 404))`),
  gone: (await readdir(dir)).includes(file),
  kept: (await readFile(join(dir, "stranded", file), "utf-8")).includes("MINE now"),
})
=> {"success":false,"patchCalls":1,"blamed":true,"gone":false,"kept":true}
```

The entry is gone from the index, and the commit narrative names the file and
why it was given up on:

```ts continue
const { loadCalendarState } = await import("../../src/connectors/google-calendar-state.js");
JSON.stringify(Object.keys((await loadCalendarState(box.root)).eventFiles))
=> []

const msg = execSync("git log -1 --pretty=%B", { cwd: box.root, encoding: "utf-8" });
JSON.stringify({
  section: msg.includes("Stranded:"),
  reason: msg.includes("MINE now — deleted on Google (HTTP 404)"),
})
=> {"section":true,"reason":true}
```

BOTH ends of the move are in that commit — the vacated path as well as the new
one. A commit that recorded only the arrival would leave the old path staged-but
-uncommitted, for the box's next sweep to attribute to whatever ran next:

```ts continue
const nameStatus = execSync("git show --name-status --pretty=format: HEAD", { cwd: box.root, encoding: "utf-8" });
// Columns are status, path(s) — and the box package puts the box under
// content/, so match by suffix rather than by a whole path.
const rows = nameStatus.trim().split("\n").filter(Boolean).map((line) => line.split("\t"));
const vacated = rows.find((row) => row[1]?.endsWith(`store/calendar/${file}`));
// Git may record the move as a rename (R) or as a delete plus an add.
const renamed = vacated?.[0]?.startsWith("R") === true
  && vacated[2]?.endsWith(`store/calendar/stranded/${file}`) === true;
const deletedAndAdded = vacated?.[0] === "D"
  && rows.some((row) => row[0] === "A" && row[1]?.endsWith(`store/calendar/stranded/${file}`));
JSON.stringify({ recorded: renamed || deletedAndAdded })
=> {"recorded":true}
```

Nothing is left behind in the working tree either:

```ts continue
JSON.stringify({
  status: execSync("git status --short", { cwd: box.root, encoding: "utf-8" }).trim(),
})
=> {"status":""}
```

The next run neither calls the API for it nor mentions it — the retry loop is
over, and the boxholder's edit is sitting in `stranded/` if they want it back:

```ts continue
const quietRun = await connector.sync();
JSON.stringify({
  success: quietRun.success,
  patchCalls,
  error: quietRun.error ?? null,
  stillThere: (await readdir(join(dir, "stranded"))).includes(file),
})
=> {"success":true,"patchCalls":1,"error":null,"stillThere":true}
```

```ts cleanup
await box.cleanup();
```

## A transient failure is retried for a week, then stranded

A 503 says nothing about whether Google would ever take the edit, so it is
retried on every wakeup — but not forever. `pendingSince` records when the edit
first failed, and the first run more than `STRANDED_AFTER_MS` (seven days)
later gives up on it.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const inner = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
  events: [
    {
      id: "evt-lunch",
      status: "confirmed",
      summary: "Lunch",
      updated: "2026-06-01T10:00:00Z",
      start: { dateTime: "2026-06-05T12:00:00Z" },
      end: { dateTime: "2026-06-05T13:00:00Z" },
    },
  ],
});

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

const connector = createGoogleCalendarConnector(box.root, { calendar, now: () => clock });
await connector.sync();

const dir = join(box.root, "store/calendar");
const file = (await readdir(dir)).filter((f) => f.endsWith(".ics"))[0] ?? "";
const localIcs = await readFile(join(dir, file), "utf-8");
await writeFile(join(dir, file), localIcs.replace("SUMMARY:Lunch", "SUMMARY:Lunch MINE"));

// First failure: reported, file kept, and the retry window opens.
const firstFail = await connector.sync();
const { loadCalendarState } = await import("../../src/connectors/google-calendar-state.js");
const afterFirst = (await loadCalendarState(box.root)).eventFiles["evt-lunch primary"];
JSON.stringify({
  success: firstFail.success,
  http: firstFail.error?.includes("(local-push, HTTP 503)"),
  kept: (await readdir(dir)).includes(file),
  pendingSince: typeof afterFirst === "string" ? null : afterFirst?.pendingSince,
})
=> {"success":false,"http":true,"kept":true,"pendingSince":"2026-06-15T12:00:00.000Z"}
```

A day later it is still inside the window, so it is retried — and the stamp is
left alone, because the window measures the edit's age, not this run's:

```ts continue
clock = new Date("2026-06-16T12:00:00Z");
const secondFail = await connector.sync();
const afterSecond = (await loadCalendarState(box.root)).eventFiles["evt-lunch primary"];
JSON.stringify({
  http: secondFail.error?.includes("(local-push, HTTP 503)"),
  kept: (await readdir(dir)).includes(file),
  pendingSince: typeof afterSecond === "string" ? null : afterSecond?.pendingSince,
})
=> {"http":true,"kept":true,"pendingSince":"2026-06-15T12:00:00.000Z"}
```

Eight days after the first failure the edit has run out of window. It is
stranded with the last error named, and the run after that says nothing:

```ts continue
clock = new Date("2026-06-23T12:00:00Z");
const strandRun = await connector.sync();
const quietRun = await connector.sync();
JSON.stringify({
  blamed: strandRun.error?.includes("(local-push, local: stranded — not pushed for 7 days: HTTP 503)"),
  gone: (await readdir(dir)).includes(file),
  kept: (await readFile(join(dir, "stranded", file), "utf-8")).includes("Lunch MINE"),
  tracked: Object.keys((await loadCalendarState(box.root)).eventFiles).length,
  quiet: quietRun.error ?? null,
})
=> {"blamed":true,"gone":false,"kept":true,"tracked":0,"quiet":null}
```

A push Google accepts inside the window closes it instead: the stamp is dropped
the moment the edit lands, so a later unrelated failure starts a fresh week
rather than inheriting a spent one.

```ts continue
const box2 = await makeTmpBox({ git: true });
await initBox(box2.root);
box2.commitAll("init box");
clock = new Date("2026-06-15T12:00:00Z");
patchFails = true;
inner.events = [
  {
    id: "evt-lunch",
    status: "confirmed",
    summary: "Lunch",
    updated: "2026-06-01T10:00:00Z",
    start: { dateTime: "2026-06-05T12:00:00Z" },
    end: { dateTime: "2026-06-05T13:00:00Z" },
  },
];
const connector2 = createGoogleCalendarConnector(box2.root, { calendar, now: () => clock });
await connector2.sync();

const dir2 = join(box2.root, "store/calendar");
const file2 = (await readdir(dir2)).filter((f) => f.endsWith(".ics"))[0] ?? "";
const ics2 = await readFile(join(dir2, file2), "utf-8");
await writeFile(join(dir2, file2), ics2.replace("SUMMARY:Lunch", "SUMMARY:Lunch MINE"));
await connector2.sync();

patchFails = false;
clock = new Date("2026-06-18T12:00:00Z");
const accepted = await connector2.sync();
const entry2 = (await loadCalendarState(box2.root)).eventFiles["evt-lunch primary"];
JSON.stringify({
  success: accepted.success,
  remote: inner.events[0]?.summary,
  pendingSince: typeof entry2 === "string" ? null : entry2?.pendingSince ?? null,
})
=> {"success":true,"remote":"Lunch MINE","pendingSince":null}
```

```ts cleanup
await box.cleanup();
await box2.cleanup();
```

## A full resync never removes a recurring master

`singleEvents=false` plus a `timeMin`/`timeMax` leaves it to Google whether a
series' master comes back in a window, and `isInWindow` cannot arbitrate — it
answers `true` for every recurring event by construction. So a master missing
from a full resync is no information at all, and the stale pass leaves it
alone. (A series really deleted in Google arrives as a cancelled event on an
ordinary pull.)

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const inner = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
  events: [
    {
      id: "evt-weekly",
      status: "confirmed",
      summary: "Weekly sync",
      start: { dateTime: "2026-06-01T14:00:00-04:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-06-01T15:00:00-04:00", timeZone: "America/New_York" },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
    },
  ],
});

const calendar: GoogleCalendarService = {
  ...inner,
  listEvents: async (calendarId, opts) => {
    if (opts?.syncToken) {
      return throwCalendarHttpError(410, "https://calendar.test/events?syncToken=expired");
    }
    return inner.listEvents(calendarId, opts);
  },
  // Google still holds the series even though the resync did not list it, so a
  // patch to it succeeds. (The stale pass has already run by then — this is
  // what makes the section's claim about the master testable with an edit.)
  patchEvent: async (_calendarId, opts) => ({
    ...opts.event, id: "evt-weekly", status: "confirmed", updated: "2026-06-15T00:00:00Z",
  }),
};

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
await connector.sync();
const dir = join(box.root, "store/calendar");
const file = (await readdir(dir)).filter((f) => f.endsWith(".ics"))[0] ?? "";

// The resync comes back without the master. Nothing may be concluded from that.
inner.events = [];
const result = await connector.sync();
JSON.stringify({ success: result.success, kept: (await readdir(dir)).includes(file) })
=> {"success":true,"kept":true}
```

It is still tracked, too — an untracked `.ics` would be read as a
locally-created event and inserted back into Google as a duplicate series:

```ts continue
const { loadCalendarState } = await import("../../src/connectors/google-calendar-state.js");
const state = await loadCalendarState(box.root);
JSON.stringify(Object.keys(state.eventFiles))
=> ["evt-weekly primary"]
```

A LOCALLY EDITED master is not stranded either. A non-recurring event missing
from a full resync is deleted-on-Google and its edit is given up on; for a
master, absence is not evidence, so the edit stays in the ordinary push queue:

```ts continue
const edited = (await readFile(join(dir, file), "utf-8")).replace("Weekly sync", "Weekly sync MINE");
await writeFile(join(dir, file), edited);
const afterEdit = await connector.sync();
JSON.stringify({
  success: afterEdit.success,
  kept: (await readdir(dir)).includes(file),
  stranded: (await readdir(dir)).includes("stranded"),
  tracked: Object.keys((await loadCalendarState(box.root)).eventFiles),
})
=> {"success":true,"kept":true,"stranded":false,"tracked":["evt-weekly primary"]}
```

```ts cleanup
await box.cleanup();
```

## An edit to a locally-created event is pushed too

A file pushed from the box gets tracked with the hash of what is on disk, like
one written from a pull. Without that hash the entry has nothing to compare
against, so a later edit to an event the boxholder created here would look
identical to the original forever and never enter the pending-edit push.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("store/calendar/local-new.ics",
  "BEGIN:VCALENDAR\r\n" +
  "VERSION:2.0\r\n" +
  "PRODID:-//Test//EN\r\n" +
  "BEGIN:VEVENT\r\n" +
  "UID:local-editable\r\n" +
  "SUMMARY:Locally created\r\n" +
  "DTSTART;VALUE=DATE:20260601\r\n" +
  "DTEND;VALUE=DATE:20260602\r\n" +
  "END:VEVENT\r\n" +
  "END:VCALENDAR\r\n",
);
box.commitAll("seed local ics");

const inner = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
});

// After the insert, Google has nothing new to report on any later sync.
let quiet = false;
const calendar: GoogleCalendarService = {
  ...inner,
  listEvents: async (calendarId, opts) => {
    if (quiet) {
      // An incremental fetch is what the section is about. If production ever
      // stopped sending the stored token this wrapper would be standing in for
      // a full fetch instead, and the test would quietly test nothing.
      if (!opts?.syncToken) throw new Error("expected the stored syncToken on this fetch");
      return { items: [], nextSyncToken: "fake-sync-token-2" };
    }
    return inner.listEvents(calendarId, opts);
  },
};

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
const first = await connector.sync();
JSON.stringify({ pushed: first.pushed?.length, remote: inner.events[0]?.summary })
=> {"pushed":1,"remote":"Locally created"}
```

Edit the file the box created. The next sync patches it up:

```ts continue
const filePath = join(box.root, "store/calendar/local-new.ics");
const localIcs = await readFile(filePath, "utf-8");
await writeFile(filePath, localIcs.replace("Locally created", "Locally created MINE"));

quiet = true;
const second = await connector.sync();
JSON.stringify({
  success: second.success,
  updated: second.updated.length,
  remote: inner.events[0]?.summary,
})
=> {"success":true,"updated":1,"remote":"Locally created MINE"}
```

```ts cleanup
await box.cleanup();
```

## An event Google created is tracked even if the local rewrite fails

Pushing a locally-created `.ics` is two steps: the insert, then a rewrite that
strips the `X-CB-` annotations out of the local file. Only the first of those
is visible to Google, so the tracking entry is written the moment the insert
returns. If the rewrite is the thing that fails, the event is still tracked and
the failure is reported — an untracked event Google holds would look
locally-created to the next run's orphan scan, which would insert a duplicate.

Make the rewrite fail by taking write permission off the file: it stays
readable, so everything up to the rewrite proceeds exactly as it normally does.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("store/calendar/annotated.ics",
  "BEGIN:VCALENDAR\r\n" +
  "VERSION:2.0\r\n" +
  "PRODID:-//Test//EN\r\n" +
  "BEGIN:VEVENT\r\n" +
  "UID:annotated-local\r\n" +
  "SUMMARY:Book the hall\r\n" +
  "DTSTART;VALUE=DATE:20260601\r\n" +
  "DTEND;VALUE=DATE:20260602\r\n" +
  "X-CB-REASON:the caterer asked\r\n" +
  "END:VEVENT\r\n" +
  "END:VCALENDAR\r\n",
);
box.commitAll("seed local ics");

const inner = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
});

let quiet = false;
const calendar: GoogleCalendarService = {
  ...inner,
  listEvents: async (calendarId, opts) => {
    if (quiet) {
      if (!opts?.syncToken) throw new Error("expected the stored syncToken on this fetch");
      return { items: [], nextSyncToken: "fake-sync-token-2" };
    }
    return inner.listEvents(calendarId, opts);
  },
};

const filePath = join(box.root, "store/calendar/annotated.ics");
await chmod(filePath, 0o444);

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
const first = await connector.sync();
JSON.stringify({
  success: first.success,
  pushed: first.pushed?.length,
  blamed: first.error?.includes("store/calendar/annotated.ics (local-push, error)"),
  remote: inner.events.map((e) => e.summary),
})
=> {"success":false,"pushed":1,"blamed":true,"remote":["Book the hall"]}
```

The entry is tracked against the bytes that are actually on disk — annotations
and all, since the strip never happened — so the file is neither re-pushed nor
seen as a pending edit:

```ts continue
const { loadCalendarState } = await import("../../src/connectors/google-calendar-state.js");
const state = await loadCalendarState(box.root);
const entry = Object.values(state.eventFiles)[0];
JSON.stringify({
  ids: Object.keys(state.eventFiles).length,
  filename: typeof entry === "string" ? entry : entry?.filename,
  hashed: typeof entry === "string" ? false : entry?.contentHash !== undefined,
})
=> {"ids":1,"filename":"annotated.ics","hashed":true}
```

The second sync is the one that used to duplicate. Google still has exactly one
event:

```ts continue
quiet = true;
const second = await connector.sync();
await chmod(filePath, 0o644);
JSON.stringify({
  success: second.success,
  pushed: second.pushed?.length ?? 0,
  remote: inner.events.map((e) => e.summary),
  kept: (await readFile(filePath, "utf-8")).includes("X-CB-REASON"),
})
=> {"success":true,"pushed":0,"remote":["Book the hall"],"kept":true}
```

```ts cleanup
await box.cleanup();
```

## A pushed edit Google accepted survives a failed local rewrite

The pending-edit pass patches Google and then rewrites the local file from the
response to normalize it. Google's acceptance is the fact that matters, so the
entry is stamped against Google's copy before the rewrite is attempted. A
rewrite that fails is a reported failure, not a lost update: the recorded hash
no longer matches the file, so the next run re-patches the same content Google
already has — idempotent, and never a second event.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const inner = createFakeGoogleCalendar({
  calendars: [{ id: "primary", summary: "Main", primary: true, accessRole: "owner" }],
  events: [
    {
      id: "evt-review",
      status: "confirmed",
      summary: "Review",
      updated: "2026-06-01T10:00:00Z",
      start: { dateTime: "2026-06-05T09:00:00Z" },
      end: { dateTime: "2026-06-05T10:00:00Z" },
    },
  ],
});

let quiet = false;
const calendar: GoogleCalendarService = {
  ...inner,
  listEvents: async (calendarId, opts) => {
    if (quiet) {
      if (!opts?.syncToken) throw new Error("expected the stored syncToken on this fetch");
      return { items: [], nextSyncToken: "fake-sync-token-2" };
    }
    return inner.listEvents(calendarId, opts);
  },
};

const connector = createGoogleCalendarConnector(box.root, { calendar, now: NOW });
await connector.sync();

const dir = join(box.root, "store/calendar");
const file = (await readdir(dir)).filter((f) => f.endsWith(".ics"))[0] ?? "";
const filePath = join(dir, file);
const localIcs = await readFile(filePath, "utf-8");
// The edit changes the summary and leaves an annotation the normalizing
// rewrite would have dropped, so the file and Google's copy really do differ.
await writeFile(filePath, localIcs
  .replace("Review", "Review MINE")
  .replace("END:VEVENT", "X-CB-REF:store/note.md\r\nEND:VEVENT"));
await chmod(filePath, 0o444);

quiet = true;
const rewriteFailed = await connector.sync();
JSON.stringify({
  success: rewriteFailed.success,
  blamed: rewriteFailed.error?.includes(`store/calendar/${file} (local-push, error)`),
  remote: inner.events.map((e) => e.summary),
})
=> {"success":false,"blamed":true,"remote":["Review MINE"]}
```

The entry is still tracked, and its hash describes what Google accepted rather
than what is on disk — that mismatch is the retry:

```ts continue
const { loadCalendarState } = await import("../../src/connectors/google-calendar-state.js");
const { contentHash } = await import("../../src/lib/content-hash.js");
const state = await loadCalendarState(box.root);
const entry = state.eventFiles["evt-review primary"];
JSON.stringify({
  ids: Object.keys(state.eventFiles).length,
  filename: typeof entry === "string" ? entry : entry?.filename,
  pending: typeof entry === "string"
    ? false
    : entry?.contentHash !== contentHash(await readFile(filePath, "utf-8")),
})
=> {"ids":1,"filename":"2026-06-05_t-review.ics","pending":true}
```

Give the file back its write bit and the next run re-patches the same content.
Google ends up where it already was, with one event:

```ts continue
await chmod(filePath, 0o644);
const retried = await connector.sync();
const settled = await connector.sync();
JSON.stringify({
  retried: { success: retried.success, updated: retried.updated.length },
  settled: { success: settled.success, updated: settled.updated.length },
  remote: inner.events.map((e) => e.summary),
})
=> {"retried":{"success":true,"updated":1},"settled":{"success":true,"updated":0},"remote":["Review MINE"]}
```

```ts cleanup
await box.cleanup();
```
