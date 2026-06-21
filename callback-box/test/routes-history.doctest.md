# History API

The history API exposes the git commit log and diffs. It provides a paginated view of box activity.

```ts setup
import { makeTestServer } from "./helpers/doctest-server.js";
```

## Commit log

`GET /api/history` returns paginated commits. A fresh box has at least the initial commit:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/history" });
res.statusCode
=> 200
```

```ts continue
Array.isArray(res.body.commits)
=> true

res.body.commits.length >= 1
=> true
```

```ts cleanup
await ctx.cleanup();
```

Seeded data shows up in the log:

```ts
const ctx = await makeTestServer();
await ctx.seed(
  "box/inbox/test.memo.card",
  '<memo status="new"><created>2026-01-01T00:00:00Z</created><content>History test</content></memo>\n',
);
ctx.commitAll("add history test card");
const res = await ctx.request({ method: "GET", url: "/api/history?count=5" });
res.body.commits[0].subject
=> add history test card
```

```ts cleanup
await ctx.cleanup();
```

## Commit diff

`GET /api/history/diff/:hash` returns the diff for a specific commit:

```ts
const ctx = await makeTestServer();
await ctx.seed(
  "box/inbox/diff-test.memo.card",
  '<memo status="new"><created>2026-01-01T00:00:00Z</created><content>Diff test</content></memo>\n',
);
ctx.commitAll("add diff test");
const log = await ctx.request({ method: "GET", url: "/api/history?count=1" });
const hash = log.body.commits[0].hash;
const res = await ctx.request({ method: "GET", url: `/api/history/diff/${hash}` });
res.statusCode
=> 200
```

```ts continue
res.body.diff.includes("diff-test.memo.card")
=> true
```

```ts cleanup
await ctx.cleanup();
```

Invalid hash format returns empty diff:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/history/diff/not-a-hash!" });
res.body.diff
=>
```

```ts cleanup
await ctx.cleanup();
```

## Session log

`GET /api/history/session/:sessionId` returns a parsed session log. A nonexistent session returns `found: false`:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/history/session/00000000-0000-0000-0000-000000000000" });
res.body.found
=> false
```

```ts continue
res.body.entries.length
=> 0
```

```ts cleanup
await ctx.cleanup();
```

Invalid session ID format also returns not found:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/history/session/bad-id" });
res.body.found
=> false
```

```ts cleanup
await ctx.cleanup();
```
