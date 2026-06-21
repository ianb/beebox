# Scheduler API

The scheduler API provides endpoints for viewing scheduler logs and listing scheduled scripts. All endpoints are read-only and work against local files.

```ts setup
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { makeTestServer } from "../../helpers/doctest-server.js";
```

## Scheduler log

The log endpoint returns scheduler tick entries from the JSONL log file.

An empty box returns no entries:

```ts
const ctx = await makeTestServer();
await ctx.inject({ method: "GET", url: "/api/scheduler/log" })
=>
200
«*»"entries": []«*»
```

```ts cleanup
await ctx.cleanup();
```

With log entries written, they're returned newest-first:

```ts
const ctx = await makeTestServer();
const logDir = join(ctx.boxRoot, ".callback-box");
await mkdir(logDir, { recursive: true });
const entries = [
  JSON.stringify({ event: "tick", ts: "2026-01-20T10:00:00Z", result: { scripts: [{ name: "test", status: "ran" }] } }),
  JSON.stringify({ event: "tick", ts: "2026-01-20T11:00:00Z", result: { scripts: [{ name: "test", status: "skipped" }] } }),
];
await writeFile(join(logDir, "scheduler.jsonl"), entries.join("\n") + "\n");
const res = await ctx.request({ method: "GET", url: "/api/scheduler/log" });
res.body.entries.length
=> 2
```

```ts continue
res.body.entries[0].ts
=> 2026-01-20T11:00:00Z
```

```ts cleanup
await ctx.cleanup();
```

The log can be filtered by status:

```ts
const ctx = await makeTestServer();
const logDir = join(ctx.boxRoot, ".callback-box");
await mkdir(logDir, { recursive: true });
const entries = [
  JSON.stringify({ event: "tick", ts: "2026-01-20T10:00:00Z", result: { scripts: [{ name: "test", status: "ran" }] } }),
  JSON.stringify({ event: "tick", ts: "2026-01-20T11:00:00Z", result: { scripts: [{ name: "test", status: "skipped" }] } }),
];
await writeFile(join(logDir, "scheduler.jsonl"), entries.join("\n") + "\n");
const res = await ctx.request({ method: "GET", url: "/api/scheduler/log?status=ran" });
res.body.entries.length
=> 1
```

```ts continue
res.body.entries[0].ts
=> 2026-01-20T10:00:00Z
```

```ts cleanup
await ctx.cleanup();
```

## Schedules listing

The schedules endpoint lists all scheduled script cards from `config/schedules/`.

An empty box returns no schedules:

```ts
const ctx = await makeTestServer();
await ctx.inject({ method: "GET", url: "/api/schedules" })
=>
200
«*»"schedules": []«*»
```

```ts cleanup
await ctx.cleanup();
```

With a scheduled script card, it returns the parsed schedule:

```ts
const ctx = await makeTestServer();
const schedulesDir = join(ctx.boxRoot, "config/schedules");
await mkdir(schedulesDir, { recursive: true });
await writeFile(
  join(schedulesDir, "test-echo.scheduled-script.card"),
  `---\ntype: scheduled-script\ncron: "0 * * * *"\ndescription: Echo test\nruns: echo hello\n---\n`,
);
await ctx.inject({ method: "GET", url: "/api/schedules" })
=>
200
{
  "schedules": [
    {
      "name": "test-echo",
      "description": "Echo test",
      «*»
      "scheduleType": "cron",
      "enabled": true«*»
    }
  ]
}
```

```ts cleanup
await ctx.cleanup();
```
