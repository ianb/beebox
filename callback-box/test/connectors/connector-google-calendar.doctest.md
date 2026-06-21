# Google Calendar connector

The Google Calendar connector pulls events from Google via the
`GoogleCalendarService` and writes them as `.ics` files under
`store/calendar/`. Injecting a fake service lets us exercise the ICS
generation path (VTIMEZONE + DTSTART) without hitting the network.

```ts setup
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
// eslint-disable-next-line import-x/no-rename-default
import ICAL from "ical.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box.js";
import { createFakeGoogleCalendar } from "../../src/services/google-calendar.js";
import { createGoogleCalendarConnector } from "../../src/connectors/google-calendar.js";
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
