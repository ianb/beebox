# Clerk API

The Clerk API powers the browser extension. These routes create cards directly in the box and expose lightweight endpoints for tab snapshots and pending actions.

```ts setup
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTestServer } from "./helpers/doctest-server.js";

const MEMO_PAYLOAD = {
  text: "Browser memo content",
  context: { url: "https://example.com/article", title: "Example Article" },
  timestamp: "2026-03-01T12:00:00Z",
};
```

## POST `/api/clerk/memo`

Creates a memo card immediately and commits it with a `Created-By: clerk-api` trailer:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/clerk/memo",
  payload: MEMO_PAYLOAD,
});
res.statusCode
=> 200
```

The memo is written to `box/inbox/` with the sanitized title:

``` continue
const inboxFiles = await readdir(join(ctx.boxRoot, "box/inbox"));
const memoFile = inboxFiles.find((name) => name.endsWith(".memo.card"));
memoFile?.includes("Browser_memo_content")
=> true

const memoContent = await ctx.read(`box/inbox/${memoFile}`);
memoContent.includes("Browser memo content")
=> true

memoContent.includes("Example Article")
=> true
```

``` cleanup
await ctx.cleanup();
```

## POST `/api/clerk/save-to-brief`

Creates a news-item card under `box/inbox/news/`:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/clerk/save-to-brief",
  payload: {
    url: "https://news.example.com/story",
    title: "Breaking Story",
    timestamp: "2026-03-01T13:00:00Z",
  },
});
res.statusCode
=> 200
```

``` continue
const newsFiles = await readdir(join(ctx.boxRoot, "box/inbox/news"));
const briefFile = newsFiles.find((name) => name.endsWith(".news-item.card"));
briefFile !== undefined
=> true

const briefContent = await ctx.read(`box/inbox/news/${briefFile}`);
briefContent.includes("Breaking Story")
=> true

briefContent.includes("https://news.example.com/story")
=> true
```

``` cleanup
await ctx.cleanup();
```

## POST `/api/clerk/save-page`

Saves the extracted page as a record card (and optional frozen HTML). The intent controls the destination directory:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/clerk/save-page",
  payload: {
    intent: "save",
    url: "https://blog.example.com/post",
    title: "Great Post",
    siteName: "Example Blog",
    byline: "Casey Writer",
    excerpt: "Short summary",
    markdown: "# Great Post\nContent",
    frozenHtml: "<html>snapshot</html>",
    timestamp: "2026-03-01T14:00:00Z",
  },
});
res.statusCode
=> 200
```

``` continue
const pageFiles = await readdir(join(ctx.boxRoot, "box/inbox/pages-saved"));
pageFiles.some((name) => name.endsWith(".record.card"))
=> true

const recordFile = pageFiles.find((name) => name.endsWith(".record.card"))!;
const recordContent = await ctx.read(`box/inbox/pages-saved/${recordFile}`);
recordContent.includes("Great Post")
=> true

recordContent.includes("Example Blog")
=> true
```

Additional frozen HTML is stored alongside the record:

``` continue
pageFiles.some((name) => name.endsWith(".frozen"))
=> true
```

``` cleanup
await ctx.cleanup();
```

## POST `/api/clerk/tabs`

Tab snapshots are stored for diagnostics; the route always returns `{ ok: true }`:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/clerk/tabs",
  payload: {
    tabs: [{ id: 1, windowId: 1, url: "https://tab.example", title: "Tab", active: true, pinned: false }],
    timestamp: "2026-03-01T15:00:00Z",
  },
});
res.statusCode
=> 200

res.body
=>
{
  "ok": true
}
```

``` continue
const snapshot = await readFile(join(ctx.boxRoot, ".callback-box/clerk-tabs.json"), "utf-8");
snapshot.includes("tab.example")
=> true
```

``` cleanup
await ctx.cleanup();
```

## GET `/api/clerk/actions`

Outbound actions are polled; currently the list is empty and dismissing returns a stub response:

```
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "GET",
  url: "/api/clerk/actions",
});
res.body
=>
{
  "actions": []
}
```

``` continue
const dismiss = await ctx.request({
  method: "POST",
  url: "/api/clerk/actions/example/dismiss",
});
dismiss.body
=>
{
  "dismissed": "example"
}
```

``` cleanup
await ctx.cleanup();
```
