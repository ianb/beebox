# Core Data API

The core data API provides endpoints for reading box state, browsing cards, and modifying card attributes. All routes are purely local (file reads and git operations).

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";
import { execSync } from "node:child_process";
```

## Keeping a visible box awake

The frontend's visible-tab heartbeat uses a cheap box-scoped `HEAD` request.
Reaching the box scope lets a lazy hub start or refresh that box without doing
the full work of `/api/health`:

```ts
const ctx = await makeTestServer();
const response = await ctx.rawRequest({ method: "HEAD", url: "/api/keepalive" });
response.statusCode
=> 204

response.headers["cache-control"]
=> no-store

response.payload
=>
```

```ts cleanup
await ctx.cleanup();
```

## Browsing directories

`GET /api/browse/*` lists directory contents with parsed card metadata:

```ts
const ctx = await makeTestServer();
await ctx.seed(
  "_content/inbox/browse-test.memo.card",
  "---\nstatus: new\ncreated: 2026-01-01T00:00:00Z\n---\nBrowse\n",
);
await ctx.inject({ method: "GET", url: "/api/browse/_content/inbox" })
=>
200
{
  "path": "_content/inbox",
  «*»
  "cards": [
    {
      "relativePath": "_content/inbox/browse-test.memo.card",
      «*»
      "type": "memo"«*»
    }
  ]
}
```

```ts cleanup
await ctx.cleanup();
```

## Serving raw files

`GET /api/files/*` serves the file body, includes `ETag` and `Last-Modified`
for conditional GETs, and advertises `no-cache` so the browser revalidates
every time (otherwise agent edits would stay hidden behind stale HTTP cache):

```ts
const ctx = await makeTestServer();
await ctx.seed("_content/notes/hello.md", "# Hello");
const res = await ctx.rawRequest({ method: "GET", url: "/api/files/_content/notes/hello.md" });
res.statusCode
=> 200

res.headers["cache-control"]
=> no-cache

res.payload
=> # Hello
```

```ts continue
typeof res.headers["etag"]
=> string

typeof res.headers["last-modified"]
=> string
```

A second request that echoes the ETag back in `If-None-Match` gets a 304 with
no body:

```ts continue
const etag = res.headers["etag"] as string;
const revalidate = await ctx.rawRequest({
  method: "GET",
  url: "/api/files/_content/notes/hello.md",
  headers: { "if-none-match": etag },
});
revalidate.statusCode
=> 304

revalidate.payload
=>
```

After the file changes on disk, the ETag changes and the client gets a fresh
200 even when it sends the old ETag:

```ts continue
await ctx.seed("_content/notes/hello.md", "# Hello, world");
const fresh = await ctx.rawRequest({
  method: "GET",
  url: "/api/files/_content/notes/hello.md",
  headers: { "if-none-match": etag },
});
fresh.statusCode
=> 200

fresh.payload
=> # Hello, world
```

`.card` files are served as text here too — the card Source view fetches the
verbatim file this way (card.get returns only the parsed form):

```ts continue
await ctx.seed("_bookkeeping/archive/Note.memo.card", "---\nstatus: new\n---\nBody\n");
const card = await ctx.rawRequest({ method: "GET", url: "/api/files/_bookkeeping/archive/Note.memo.card" });
card.statusCode
=> 200

card.payload
=> ---
status: new
---
Body
```

```ts cleanup
await ctx.cleanup();
```

## Deleting raw files

`DELETE /api/files/*` removes a non-card file and commits the deletion:

```ts
const ctx = await makeTestServer();
await ctx.seed("_content/images/delete-me.webp", "not really an image");
ctx.commitAll("seed image");
const res = await ctx.request({ method: "DELETE", url: "/api/files/_content/images/delete-me.webp" });
res.statusCode
=> 200
```

```ts continue
execSync("git log -1 --pretty=%s", { cwd: ctx.boxRoot, encoding: "utf-8" }).trim()
=> Deleted by user: _content/images/delete-me.webp
```

```ts continue
await ctx.inject({ method: "GET", url: "/api/files/_content/images/delete-me.webp" })
=>
404
«*»"error": "Not found"«*»
```

```ts cleanup
await ctx.cleanup();
```

Dirty files get preserved in their own commit before the delete commit:

```ts
const ctx = await makeTestServer();
await ctx.seed("_content/images/dirty-delete.webp", "version 1");
ctx.commitAll("seed dirty image");
await ctx.seed("_content/images/dirty-delete.webp", "version 2");
const res = await ctx.request({ method: "DELETE", url: "/api/files/_content/images/dirty-delete.webp" });
res.statusCode
=> 200
```

```ts continue
execSync("git log -2 --pretty=%s", { cwd: ctx.boxRoot, encoding: "utf-8" }).trim()
=>
Deleted by user: _content/images/dirty-delete.webp
Saved before user delete: _content/images/dirty-delete.webp
```

```ts cleanup
await ctx.cleanup();
```
