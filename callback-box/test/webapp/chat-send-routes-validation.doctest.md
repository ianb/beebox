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

A concrete session whose local transcript is missing is a named 410, never an
SDK resume attempt or generic 500:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { message: "hi", session: "55555555-5555-4555-8555-555555555555" },
});
JSON.stringify({ status: res.statusCode, code: res.body.code })
=> {"status":410,"code":"CHAT_SESSION_UNAVAILABLE"}
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

An exact target must name an existing resumable chat. It never creates the
requested id through the registry fallback:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { message: "https://example.com", session: "missing-session", exactSession: true },
});
`${res.statusCode} ${res.body.error}`
=> 404 Chat session is no longer available: missing-session
```

```ts cleanup
await ctx.cleanup();
```

The `new` sentinel is also invalid in exact mode:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { message: "https://example.com", session: "new", exactSession: true },
});
`${res.statusCode} ${res.body.error}`
=> 400 exactSession requires an existing session id
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
=> 400 unsupported mime type: application/pdf (accepted: image/jpeg, image/png, image/gif, image/webp)
```

The check accepts only the four media types the Anthropic API accepts, so an
`image/*` type the API rejects — `image/avif` (which the browser image encoder
used to produce for pasted photos), `image/svg+xml`, `image/bmp` — is now
rejected here with a clean 400 instead of failing opaquely downstream:

```ts continue
const avif = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { message: "hi", session: "new", images: [{ id: 1, mimeType: "image/avif", dataBase64: "abc" }] },
});
`${avif.statusCode} ${avif.body.error}`
=> 400 unsupported mime type: image/avif (accepted: image/jpeg, image/png, image/gif, image/webp)
```

An empty `dataBase64` is a malformed attachment, rejected at the zod parse
boundary (`.min(1)`) so it can't ride to the SDK boundary's empty-`data`
error:

```ts continue
const empty = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { message: "hi", session: "new", images: [{ id: 1, mimeType: "image/png", dataBase64: "" }] },
});
empty.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```
