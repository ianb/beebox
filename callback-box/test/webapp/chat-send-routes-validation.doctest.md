# `POST /api/chat/send` — validation (Track D.7)

`chat-send-routes.ts` used to hand-check `if (!message)` / `if (!sessionParam)`
against a TS-generic-only `SendBody` interface. Validation now runs through
`sendBodySchema` (zod) at the top of the handler — same response codes/shapes
the frontend (`api-chat.ts`) depends on: a 400 with a JSON `{error}` string
for bad input (the frontend only reads `response.ok` + the generic `error`
field, never a specific message), and unchanged success shapes
(`{queued}`/`{deduplicated}`/`{turnId}`) once past validation.

```ts setup
import { makeTestServer } from "../helpers/doctest-server.js";
```

Missing `message` returns 400:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "POST", url: "/api/chat/send", payload: { session: "new" } });
`${res.statusCode} ${res.body.error}`
=> 400 message is required
```

```ts cleanup
await ctx.cleanup();
```

Missing `session` returns 400:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "POST", url: "/api/chat/send", payload: { message: "hi" } });
`${res.statusCode} ${res.body.error}`
=> 400 session is required (id or 'new')
```

```ts cleanup
await ctx.cleanup();
```

An empty-string `message` is also rejected (not just an absent field):

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "POST", url: "/api/chat/send", payload: { message: "", session: "new" } });
`${res.statusCode} ${res.body.error}`
=> 400 message is required
```

```ts cleanup
await ctx.cleanup();
```

A malformed image attachment (wrong field types) is rejected at the same
parse boundary, before ever reaching `validateImages`'s content-level checks:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { message: "hi", session: "new", images: [{ id: "not-a-number", mimeType: "image/png", dataBase64: "abc" }] },
});
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```

An unsupported mime type on an otherwise well-shaped image is still caught
by `validateImages`'s content-level check (structural shape is fine, so it
passes the zod boundary and reaches the business rule):

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { message: "hi", session: "new", images: [{ id: 1, mimeType: "application/pdf", dataBase64: "abc" }] },
});
`${res.statusCode} ${res.body.error}`
=> 400 unsupported mime type: application/pdf
```

```ts cleanup
await ctx.cleanup();
```
