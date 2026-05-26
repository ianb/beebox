# Core Data API

The core data API provides endpoints for reading box state, browsing cards, and modifying card attributes. All routes are purely local (file reads and git operations).

```ts setup
import { makeTestServer } from "./helpers/doctest-server.js";
import { execSync } from "node:child_process";
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

## Serving raw files

`GET /api/files/*` serves the file body, includes `ETag` and `Last-Modified`
for conditional GETs, and advertises `no-cache` so the browser revalidates
every time (otherwise agent edits would stay hidden behind stale HTTP cache):

```
const ctx = await makeTestServer();
await ctx.seed("store/notes/hello.md", "# Hello");
const res = await ctx.rawRequest({ method: "GET", url: "/api/files/store/notes/hello.md" });
res.statusCode
=> 200

res.headers["cache-control"]
=> no-cache

res.payload
=> # Hello
```

``` continue
typeof res.headers["etag"]
=> string

typeof res.headers["last-modified"]
=> string
```

A second request that echoes the ETag back in `If-None-Match` gets a 304 with
no body:

``` continue
const etag = res.headers["etag"] as string;
const revalidate = await ctx.rawRequest({
  method: "GET",
  url: "/api/files/store/notes/hello.md",
  headers: { "if-none-match": etag },
});
revalidate.statusCode
=> 304

revalidate.payload
=>
```

After the file changes on disk, the ETag changes and the client gets a fresh
200 even when it sends the old ETag:

``` continue
await ctx.seed("store/notes/hello.md", "# Hello, world");
const fresh = await ctx.rawRequest({
  method: "GET",
  url: "/api/files/store/notes/hello.md",
  headers: { "if-none-match": etag },
});
fresh.statusCode
=> 200

fresh.payload
=> # Hello, world
```

``` cleanup
await ctx.cleanup();
```

## Deleting raw files

`DELETE /api/files/*` removes a non-card file and commits the deletion:

```
const ctx = await makeTestServer();
await ctx.seed("store/images/delete-me.webp", "not really an image");
ctx.commitAll("seed image");
const res = await ctx.request({ method: "DELETE", url: "/api/files/store/images/delete-me.webp" });
res.statusCode
=> 200
```

``` continue
execSync("git log -1 --pretty=%s", { cwd: ctx.boxRoot, encoding: "utf-8" }).trim()
=> Deleted by user: store/images/delete-me.webp
```

``` continue
await ctx.inject({ method: "GET", url: "/api/files/store/images/delete-me.webp" })
=>
404
«*»"error": "Not found"«*»
```

``` cleanup
await ctx.cleanup();
```

Dirty files get preserved in their own commit before the delete commit:

```
const ctx = await makeTestServer();
await ctx.seed("store/images/dirty-delete.webp", "version 1");
ctx.commitAll("seed dirty image");
await ctx.seed("store/images/dirty-delete.webp", "version 2");
const res = await ctx.request({ method: "DELETE", url: "/api/files/store/images/dirty-delete.webp" });
res.statusCode
=> 200
```

``` continue
execSync("git log -2 --pretty=%s", { cwd: ctx.boxRoot, encoding: "utf-8" }).trim()
=>
Deleted by user: store/images/dirty-delete.webp
Saved before user delete: store/images/dirty-delete.webp
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

## Questions

`GET /api/questions` returns question cards with enriched prompt data:

```
const ctx = await makeTestServer();
await ctx.seed(
  "box/questions/ask.question.card",
  `---\ntype: question\nstatus: pending\nprompt: What color?\ninput:\n  type: select\n  options:\n    - {id: red, label: Red}\n    - {id: blue, label: Blue}\n---\n`,
);
ctx.commitAll("seed question");
const res = await ctx.request({ method: "GET", url: "/api/questions" });
res.statusCode
=> 200
```

``` continue
res.body.items.length
=> 1

res.body.items[0].prompt
=> What color?
```

``` continue
Array.isArray(res.body.items[0].options)
=> true
```

``` cleanup
await ctx.cleanup();
```

Empty box returns empty question list:

```
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/questions" });
res.body.items.length
=> 0
```

``` cleanup
await ctx.cleanup();
```

## Agent context

`GET /api/context` returns context for agent decision-making:

```
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/context" });
res.statusCode
=> 200
```

``` continue
typeof res.body.summary
=> string

Array.isArray(res.body.pendingQuestions)
=> true

typeof res.body.inboxCount
=> number
```

``` cleanup
await ctx.cleanup();
```

With a pending question, it appears in context:

```
const ctx = await makeTestServer();
await ctx.seed(
  "box/questions/ctx-q.question.card",
  `---\ntype: question\nstatus: pending\nprompt: Deploy now?\ninput:\n  type: text\n---\n`,
);
ctx.commitAll("seed question");
const res = await ctx.request({ method: "GET", url: "/api/context" });
res.body.pendingQuestions.length
=> 1
```

``` continue
res.body.pendingQuestions[0].prompt
=> Deploy now?
```

``` cleanup
await ctx.cleanup();
```
