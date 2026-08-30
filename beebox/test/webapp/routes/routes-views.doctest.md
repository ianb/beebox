# Views API

The views API serves agent-generated React components. It lists available views, serves compiled JS modules, and returns cards matching a view's dependency globs.

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";

const VIEW_SOURCE = `
export const name = "Test View";
export const description = "A test view";
export const dependencies = ["box/**/*.card"];
export const modes = ["page", "chat"];
export default function TestView({ cards }) {
  return <div>Cards: {cards.length}</div>;
}
`;

const MEMO_CARD = `---
status: new
created: 2026-03-01T12:00:00Z
---
Test memo content
`;
```

## Serving compiled modules

The module endpoint returns compiled JavaScript (not JSON), so we use `rawRequest` to get the raw payload:

```ts
const ctx = await makeTestServer();
await ctx.seedView("test.tsx", VIEW_SOURCE);

const res = await ctx.rawRequest({ method: "GET", url: "/api/views/test/module.js" });
res.statusCode
=> 200
```

The compiled output externalizes React via the window shim:

```ts continue
res.payload.includes("__bbxReact")
=> true
```

```ts cleanup
await ctx.cleanup();
```

A view with a syntax error returns an error module (not a 500):

```ts
const ctx = await makeTestServer();
await ctx.seedView("broken.tsx", "export default function() { return <div");

const res = await ctx.rawRequest({ method: "GET", url: "/api/views/broken/module.js" });
res.statusCode
=> 200
```

```ts continue
res.payload.includes("ErrorView")
=> true

res.payload.includes("Compile error")
=> false
```

The error module contains the actual error message:

```ts continue
res.payload.includes("Expected")
=> true
```

```ts cleanup
await ctx.cleanup();
```

## Fetching cards

The cards endpoint returns cards matching a view's dependency globs:

```ts
const ctx = await makeTestServer();
await ctx.seedView("test.tsx", VIEW_SOURCE);
await ctx.seed("box/inbox/Test.memo.card", MEMO_CARD);
ctx.commitAll("add test data");

const res = await ctx.request({ method: "GET", url: "/api/views/test/cards" });
res.statusCode
=> 200
```

```ts continue
res.body.cards.length
=> 1

res.body.cards[0].type
=> memo

res.body.cards[0].path
=> box/inbox/Test.memo.card

res.body.cards[0].frontmatter.status
=> new

JSON.stringify(res.body.files)
=> []
```

Non-card files matching the globs arrive in `files` as metadata (content
can be huge or binary, so it's fetched separately), and each card carries a
deep metadata listing of its attach scope:

```ts continue
const PLAYGROUND_VIEW = `
export const name = "Playground";
export const description = "Session history";
export const dependencies = ["box/**/*.card", "box/inbox/Test.attach/**/*.jsonl"];
export const modes = ["page"];
export default function P({ cards, files }) { return <div>{files.length}</div>; }
`;
await ctx.seedView("playground.tsx", PLAYGROUND_VIEW);
await ctx.seed("box/inbox/Test.attach/sessions/history.jsonl", '{"summary":"first run"}\n{"summary":"second run"}\n');
const res2 = await ctx.request({ method: "GET", url: "/api/views/playground/cards" });
res2.statusCode
=> 200

res2.body.cards[0].attachments.map((a) => a.path).join(", ")
=> box/inbox/Test.attach/sessions/history.jsonl

res2.body.cards[0].attachments[0].size > 0
=> true

res2.body.files.length
=> 1

res2.body.files[0].path
=> box/inbox/Test.attach/sessions/history.jsonl

typeof res2.body.files[0].content
=> undefined

typeof res2.body.files[0].mtimeMs
=> number
```

Content comes from `/api/files/*`, which supports byte ranges — a view
tails a large log instead of downloading it (suffix form `bytes=-N`):

```ts continue
const full = await ctx.rawRequest({ method: "GET", url: "/api/files/box/inbox/Test.attach/sessions/history.jsonl" });
full.statusCode
=> 200

full.headers["accept-ranges"]
=> bytes

const tail = await ctx.rawRequest({ method: "GET", url: "/api/files/box/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=-25" } });
tail.statusCode
=> 206

tail.headers["content-range"]
=> bytes 24-48/49

JSON.parse(tail.payload.trim()).summary
=> second run

const mid = await ctx.rawRequest({ method: "GET", url: "/api/files/box/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=0-22" } });
mid.payload
=> {"summary":"first run"}

const past = await ctx.rawRequest({ method: "GET", url: "/api/files/box/inbox/Test.attach/sessions/history.jsonl", headers: { range: "bytes=999-" } });
past.statusCode
=> 416
```

```ts cleanup
await ctx.cleanup();
```

A view with no dependencies returns an empty card list:

```ts
const ctx = await makeTestServer();

const noDeps = `
export const name = "Empty";
export const description = "No deps";
export const dependencies = [];
export const modes = ["page"];
export default function Empty() { return null; }
`;
await ctx.seedView("empty.tsx", noDeps);

const res = await ctx.request({ method: "GET", url: "/api/views/empty/cards" });
res.statusCode
=> 200

res.body.cards.length
=> 0
```

```ts cleanup
await ctx.cleanup();
```

Cards endpoint returns 404 for a nonexistent view:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/views/nonexistent/cards" });
res.statusCode
=> 404
```

```ts cleanup
await ctx.cleanup();
```
