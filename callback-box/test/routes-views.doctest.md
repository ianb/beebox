# Views API

The views API serves agent-generated React components. It lists available views, serves compiled JS modules, and returns cards matching a view's dependency globs.

```ts setup
import { makeTestServer } from "./helpers/doctest-server.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const VIEW_SOURCE = `
export const name = "Test View";
export const description = "A test view";
export const dependencies = ["box/**/*.card"];
export const modes = ["page", "chat"];
export default function TestView({ cards }) {
  return <div>Cards: {cards.length}</div>;
}
`;

const MEMO_CARD = `<memo status="new">
<created>2026-03-01T12:00:00Z</created>
<content>Test memo content</content>
<source>text</source>
</memo>`;
```

## Listing views

An empty box returns no views:

```
const ctx = await makeTestServer();
await ctx.inject({ method: "GET", url: "/api/views" })
=>
200
[]
```

``` cleanup
await ctx.cleanup();
```

A box with a view in `views/` returns its metadata:

```
const ctx = await makeTestServer();
await mkdir(join(ctx.boxRoot, "views"), { recursive: true });
await ctx.seed("views/test.tsx", VIEW_SOURCE);

const res = await ctx.request({ method: "GET", url: "/api/views" });
res.statusCode
=> 200
```

``` continue
res.body.length
=> 1

res.body[0].name
=> Test View

res.body[0].slug
=> test

res.body[0].description
=> A test view

JSON.stringify(res.body[0].modes)
=> ["page","chat"]
```

``` cleanup
await ctx.cleanup();
```

## Serving compiled modules

The module endpoint returns compiled JavaScript (not JSON), so we use `rawRequest` to get the raw payload:

```
const ctx = await makeTestServer();
await mkdir(join(ctx.boxRoot, "views"), { recursive: true });
await ctx.seed("views/test.tsx", VIEW_SOURCE);

const res = await ctx.rawRequest({ method: "GET", url: "/api/views/test/module.js" });
res.statusCode
=> 200
```

The compiled output externalizes React via the window shim:

``` continue
res.payload.includes("__cbReact")
=> true
```

``` cleanup
await ctx.cleanup();
```

A view with a syntax error returns an error module (not a 500):

```
const ctx = await makeTestServer();
await mkdir(join(ctx.boxRoot, "views"), { recursive: true });
await ctx.seed("views/broken.tsx", "export default function() { return <div");

const res = await ctx.rawRequest({ method: "GET", url: "/api/views/broken/module.js" });
res.statusCode
=> 200
```

``` continue
res.payload.includes("ErrorView")
=> true

res.payload.includes("Compile error")
=> false
```

The error module contains the actual error message:

``` continue
res.payload.includes("Expected")
=> true
```

``` cleanup
await ctx.cleanup();
```

## Fetching cards

The cards endpoint returns cards matching a view's dependency globs:

```
const ctx = await makeTestServer();
await mkdir(join(ctx.boxRoot, "views"), { recursive: true });
await ctx.seed("views/test.tsx", VIEW_SOURCE);
await ctx.seed("box/inbox/Test.memo.card", MEMO_CARD);
ctx.commitAll("add test data");

const res = await ctx.request({ method: "GET", url: "/api/views/test/cards" });
res.statusCode
=> 200
```

``` continue
res.body.length
=> 1

res.body[0].tagName
=> memo

res.body[0].path
=> box/inbox/Test.memo.card

res.body[0].attrs.status
=> new
```

``` cleanup
await ctx.cleanup();
```

A view with no dependencies returns an empty card list:

```
const ctx = await makeTestServer();
await mkdir(join(ctx.boxRoot, "views"), { recursive: true });

const noDeps = `
export const name = "Empty";
export const description = "No deps";
export const dependencies = [];
export const modes = ["page"];
export default function Empty() { return null; }
`;
await ctx.seed("views/empty.tsx", noDeps);

const res = await ctx.request({ method: "GET", url: "/api/views/empty/cards" });
res.statusCode
=> 200

res.body.length
=> 0
```

``` cleanup
await ctx.cleanup();
```

Cards endpoint returns 404 for a nonexistent view:

```
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/views/nonexistent/cards" });
res.statusCode
=> 404
```

``` cleanup
await ctx.cleanup();
```
