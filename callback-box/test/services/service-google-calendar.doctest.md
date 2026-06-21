# Google Calendar service

Fake Google Calendar maintains in-memory calendars and events.

```ts setup
import { createFakeGoogleCalendar } from "../../src/services/google-calendar.js";
import { withCallLog, printCalls } from "../../src/services/call-log.js";
```

## Empty by default

```ts
const svc = createFakeGoogleCalendar();
(await svc.listCalendars()).length
=> 0
```

## Pre-loaded calendars

```ts
const svc = createFakeGoogleCalendar({
  calendars: [
    { id: "primary", summary: "Main", primary: true, accessRole: "owner" },
    { id: "work", summary: "Work", accessRole: "writer" },
  ],
});
(await svc.listCalendars()).map(c => c.summary).join(", ")
=> Main, Work
```

## Pre-loaded events

```ts
const svc = createFakeGoogleCalendar({
  events: [
    { id: "e1", status: "confirmed", summary: "Meeting" },
  ],
});
const result = await svc.listEvents("primary");
result.items[0]?.summary
=> Meeting
```

## Inserting events

```ts
const svc = createFakeGoogleCalendar();
const evt = await svc.insertEvent("primary", { summary: "New Event" });
evt.summary
=> New Event
```

```ts continue
evt.id.startsWith("evt-")
=> true
```

```ts continue
svc.events.length
=> 1
```

## Deleting events

```ts
const svc = createFakeGoogleCalendar({
  events: [
    { id: "e1", status: "confirmed", summary: "Delete Me" },
    { id: "e2", status: "confirmed", summary: "Keep Me" },
  ],
});
await svc.deleteEvent("primary", "e1");
svc.events.length
=> 1
```

```ts continue
svc.events[0]?.summary
=> Keep Me
```

## Call logging

```ts
const svc = withCallLog(createFakeGoogleCalendar());
await svc.insertEvent("cal1", { summary: "Logged" });
printCalls(svc.callLog, "insertEvent")
=> insertEvent("cal1", {"summary":"Logged"})
```
