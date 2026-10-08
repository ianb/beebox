# Google Calendar service

Fake Google Calendar maintains in-memory calendars and events.

```ts setup
import { createFakeGoogleCalendar } from "../../src/services/google-calendar/core.js";
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

Deleting the same event twice is idempotent — the second delete is a no-op
(the real service maps the API's 404/410 to success; the fake just leaves the
event set unchanged):

```ts
const svc = createFakeGoogleCalendar({
  events: [{ id: "e1", status: "confirmed", summary: "Delete Me" }],
});
await svc.deleteEvent("primary", "e1");
await svc.deleteEvent("primary", "e1");
svc.events.length
=> 0
```
