# Calendar API

Calendar configuration routes manage which Google calendars are synced.

```ts setup
import { makeTestServer } from "./helpers/doctest-server.js";
import { createFakeGoogleCalendar } from "../src/services/google-calendar.js";
```

## List available calendars

`GET /api/calendar/available` returns all calendars from the service, annotated with sync status. By default, "primary" is in the sync list:

```
const cal = createFakeGoogleCalendar({
  calendars: [
    { id: "user@gmail.com", summary: "My Calendar", primary: true, accessRole: "owner" },
    { id: "work@group.calendar.google.com", summary: "Work", accessRole: "writer" },
  ],
});
const ctx = await makeTestServer({ services: { calendar: cal } });
const res = await ctx.request({ method: "GET", url: "/api/calendar/available" });
res.statusCode
=> 200
```

The primary calendar is marked as syncing (default config syncs "primary"):

``` continue
res.body[0].summary
=> My Calendar
```

``` continue
res.body[0].syncing
=> true
```

Non-synced calendars show `syncing: false`:

``` continue
res.body[1].syncing
=> false
```

``` cleanup
await ctx.cleanup();
```

## Get calendar config

`GET /api/calendar/config` returns the saved config. Empty box returns empty object:

```
const cal = createFakeGoogleCalendar();
const ctx = await makeTestServer({ services: { calendar: cal } });
const res = await ctx.request({ method: "GET", url: "/api/calendar/config" });
res.statusCode
=> 200
```

``` continue
JSON.stringify(res.body)
=> {}
```

``` cleanup
await ctx.cleanup();
```

## Save calendar config

`PUT /api/calendar/config` saves which calendars to sync:

```
const cal = createFakeGoogleCalendar();
const ctx = await makeTestServer({ services: { calendar: cal } });
const res = await ctx.request({
  method: "PUT",
  url: "/api/calendar/config",
  payload: { calendars: ["user@gmail.com", "work@group.calendar.google.com"], syncDaysBack: 30 },
});
res.body.success
=> true
```

The config persists:

``` continue
const config = await ctx.request({ method: "GET", url: "/api/calendar/config" });
JSON.stringify(config.body.calendars)
=> ["user@gmail.com","work@group.calendar.google.com"]
```

``` continue
config.body.syncDaysBack
=> 30
```

``` cleanup
await ctx.cleanup();
```
