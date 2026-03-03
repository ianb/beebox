# Core Data API

The core data API provides endpoints for reading box state, browsing cards, and modifying card attributes. All routes are purely local (file reads and git operations).

```ts setup
import { makeTestServer } from "./helpers/doctest-server.js";
```

## Box status

`GET /api/status` returns overall box state including counts:

```
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/status" });
res.statusCode
=> 200
```

``` continue
typeof res.body.counts.inbox
=> number

typeof res.body.counts.questions
=> number
```

``` cleanup
await ctx.cleanup();
```

## Inbox

`GET /api/inbox` returns inbox items. An empty box returns an empty list:

```
const ctx = await makeTestServer();
await ctx.inject({ method: "GET", url: "/api/inbox" })
=>
200
«*»"items": []«*»
```

``` cleanup
await ctx.cleanup();
```

With a seeded card, it appears in the inbox:

```
const ctx = await makeTestServer();
await ctx.seed(
  "box/inbox/test.memo.card",
  '<memo status="new"><created>2026-01-01T00:00:00Z</created><content>Hello</content></memo>\n',
);
ctx.commitAll("seed memo");
const res = await ctx.request({ method: "GET", url: "/api/inbox" });
res.statusCode
=> 200
```

``` continue
res.body.items.length > 0
=> true
```

``` cleanup
await ctx.cleanup();
```

## Loading a card

`GET /api/card/*` returns a parsed card by path:

```
const ctx = await makeTestServer();
await ctx.seed(
  "box/inbox/hello.memo.card",
  '<memo status="new"><created>2026-01-01T00:00:00Z</created><content>Hello world</content></memo>\n',
);
await ctx.inject({ method: "GET", url: "/api/card/box/inbox/hello.memo.card" })
=>
200
{
  "path": "box/inbox/hello.memo.card",
  "tagName": "memo",
  «*»
  "element": {
    "tagName": "memo"«*»
  }
}
```

``` cleanup
await ctx.cleanup();
```

Missing cards return 404:

```
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/card/box/inbox/nope.memo.card" });
res.statusCode
=> 404
```

``` cleanup
await ctx.cleanup();
```

## Patching a card

`PATCH /api/card/*` applies operations to a card. The `set-attr` op modifies an attribute:

```
const ctx = await makeTestServer();
await ctx.seed(
  "box/inbox/patch-test.memo.card",
  '<memo status="new"><created>2026-01-01T00:00:00Z</created><content>Patch me</content></memo>\n',
);
await ctx.inject({ method: "PATCH", url: "/api/card/box/inbox/patch-test.memo.card", payload: {
  ops: [{ op: "set-attr", attr: "status", value: "processed" }],
}})
=>
200
«*»"status": "processed"«*»"element":«*»"status": "processed"«*»
```

``` cleanup
await ctx.cleanup();
```

## Browsing directories

`GET /api/browse/*` lists directory contents with parsed card metadata:

```
const ctx = await makeTestServer();
await ctx.seed(
  "box/inbox/browse-test.memo.card",
  '<memo status="new"><created>2026-01-01T00:00:00Z</created><content>Browse</content></memo>\n',
);
await ctx.inject({ method: "GET", url: "/api/browse/box/inbox" })
=>
200
{
  "path": "box/inbox",
  «*»
  "cards": [
    {
      "relativePath": "box/inbox/browse-test.memo.card",
      «*»
      "tagName": "memo"«*»
    }
  ]
}
```

``` cleanup
await ctx.cleanup();
```

## News status

`GET /api/news-status` returns counts of news items by location:

```
const ctx = await makeTestServer();
await ctx.seed(
  "box/inbox/news/test.news-item.card",
  '<news-item status="new"><title>Test</title><source-url>https://example.com</source-url></news-item>\n',
);
await ctx.inject({ method: "GET", url: "/api/news-status" })
=>
200
{
  "inbox": 1,
  "pool": 0,
  "archive": 0,
  "trash": 0
}
```

``` cleanup
await ctx.cleanup();
```

## Debug log

The debug log supports a POST/GET/DELETE cycle for client-side logging:

```
const ctx = await makeTestServer();
await ctx.inject({
  method: "POST",
  url: "/api/debug-log",
  payload: { entries: [{ level: "info", message: "test message" }] },
});
await ctx.inject({ method: "GET", url: "/api/debug-log" })
=>
200
«*»"level": "info",
      "message": "test message"«*»
```

Deleting clears all entries:

``` continue
await ctx.inject({ method: "DELETE", url: "/api/debug-log" });
const res = await ctx.request({ method: "GET", url: "/api/debug-log" });
res.body.entries.length
=> 0
```

``` cleanup
await ctx.cleanup();
```

## Activity log

`GET /api/activity` returns the git commit history:

```
const ctx = await makeTestServer();
await ctx.seed(
  "box/inbox/log-test.memo.card",
  '<memo status="new"><created>2026-01-01T00:00:00Z</created><content>Log test</content></memo>\n',
);
ctx.commitAll("add log test card");
const res = await ctx.request({ method: "GET", url: "/api/activity?count=5" });
res.statusCode
=> 200
```

``` continue
Array.isArray(res.body.entries)
=> true

res.body.entries.length >= 1
=> true
```

``` cleanup
await ctx.cleanup();
```
