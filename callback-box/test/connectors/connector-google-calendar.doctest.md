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
import { initBox } from "../../src/core/box.js";
import { createFakeGoogleCalendar } from "../../src/services/google-calendar.js";
import { createGoogleCalendarConnector } from "../../src/connectors/google-calendar.js";

// The connector only writes events inside its sync window (now-30d .. now+90d),
// so fixture dates are computed relative to the test run, never pinned — pinned
// dates rot out of the window as real time passes.
const DAY_MS = 24 * 3600 * 1000;
const tomorrow = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
const dayAfter = new Date(Date.now() + 2 * DAY_MS).toISOString().slice(0, 10);
const tomorrowCompact = tomorrow.replaceAll("-", "");
const dayAfterCompact = dayAfter.replaceAll("-", "");
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
      start: { dateTime: `${tomorrow}T14:00:00-04:00`, timeZone: "America/New_York" },
      end: { dateTime: `${tomorrow}T15:00:00-04:00`, timeZone: "America/New_York" },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
    },
  ],
});

const connector = createGoogleCalendarConnector(box.root, calendar);
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
  `DTSTART;VALUE=DATE:${tomorrowCompact}\r\n` +
  `DTEND;VALUE=DATE:${dayAfterCompact}\r\n` +
  "END:VEVENT\r\n" +
  "END:VCALENDAR\r\n",
);
box.commitAll("seed local ics");

const calendar = createFakeGoogleCalendar({
  calendars: [
    { id: "primary", summary: "Main", primary: true, accessRole: "owner" },
  ],
});

const connector = createGoogleCalendarConnector(box.root, calendar);
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
      start: { dateTime: `${tomorrow}T12:00:00-04:00`, timeZone: "America/New_York" },
      end: { dateTime: `${tomorrow}T13:00:00-04:00`, timeZone: "America/New_York" },
    },
  ],
});

const connector = createGoogleCalendarConnector(box.root, calendar);
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
      start: { dateTime: `${tomorrow}T09:00:00-04:00`, timeZone: "America/New_York" },
      end: { dateTime: `${tomorrow}T09:15:00-04:00`, timeZone: "America/New_York" },
    },
  ],
});

const connector = createGoogleCalendarConnector(box.root, calendar);
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
