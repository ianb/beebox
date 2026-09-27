# Actions API

The actions API handles raw-Fastify mutations — creating cards and uploading
voice memos. (Answering and dismissing questions moved to the tRPC
`actions.answer`/`actions.dismiss` mutations — see `trpc-actions.doctest.md`;
the raw `/api/actions/answer` duplicate was removed.)

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";
```

## Creating a card

`POST /api/actions/create` creates a card from a template:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/actions/create",
  payload: {
    path: "_content/inbox/new.memo.card",
    template: "memo",
    args: { content: "Hello from the API" },
  },
});
res.statusCode
=> 200
```

```ts continue
res.body.success
=> true

res.body.path
=> _content/inbox/new.memo.card
```

The card exists on disk:

```ts continue
const content = await ctx.read("_content/inbox/new.memo.card");
content.includes("Hello from the API")
=> true
```

```ts cleanup
await ctx.cleanup();
```

Missing path returns 400:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/actions/create",
  payload: { template: "memo" },
});
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```

Missing template returns 400:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/actions/create",
  payload: { path: "_content/inbox/test.memo.card" },
});
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```
