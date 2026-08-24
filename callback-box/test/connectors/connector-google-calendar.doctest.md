# Google Calendar connector

The Google Calendar connector pulls events from Google via the
`GoogleCalendarService` and writes them as `.ics` files under
`store/calendar/`. Injecting a fake service lets us exercise the ICS
generation path (VTIMEZONE + DTSTART) without hitting the network.

```ts setup
import { join } from "node:path";
import { execSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
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
