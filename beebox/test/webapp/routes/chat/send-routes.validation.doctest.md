# `POST /api/chat/send` — validation (Track D.7)

`chat-send-routes.ts` used to hand-check `if (!message)` / `if (!sessionParam)`
against a TS-generic-only `SendBody` interface. Validation now runs through
`sendBodySchema` (zod) at the top of the handler — same response codes/shapes
the frontend (`api-chat.ts`) depends on: a 400 with a JSON `{error}` string
for bad input (the frontend only reads `response.ok` + the generic `error`
field, never a specific message), and unchanged success shapes
(`{queued}`/`{deduplicated}`/`{turnId}`) once past validation.

```ts setup
import { makeTestServer } from "../../../helpers/doctest-server.js";
import { resolveChannel } from "../../../../src/webapp/routes/chat/helpers.js";

const ctx = await makeTestServer();
const image = (img: Record<string, unknown>) => ({ message: "hi", session: "new", images: [img] });

// One line per request: "<status> <error>".
async function send(payload: Record<string, unknown>): Promise<string> {
  const res = await ctx.request({ method: "POST", url: "/api/chat/send", payload });
  return `${res.statusCode} ${res.body.error}`;
}
```

```ts teardown
await ctx.cleanup();
```

A missing or empty `message`, or a missing `session`, is a 400. An empty-string
`message` is rejected too, not just an absent field:

```ts
[
  await send({ session: "new" }),
  await send({ message: "", session: "new" }),
  await send({ message: "hi" }),
].join("\n")
=>
400 message is required
400 message is required
400 session is required (id or 'new')
```

A concrete session whose local transcript is missing is a named 410, never an
SDK resume attempt or generic 500:

```ts
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { message: "hi", session: "55555555-5555-4555-8555-555555555555" },
});
({ status: res.statusCode, code: res.body.code })
=> { status: 410, code: "CHAT_SESSION_UNAVAILABLE" }
```

An exact target must name an existing resumable chat. It never creates the
requested id through the registry fallback, and the `new` sentinel is invalid
in exact mode:

```ts
[
  await send({ message: "https://example.com", session: "missing-session", exactSession: true }),
  await send({ message: "https://example.com", session: "new", exactSession: true }),
].join("\n")
=>
404 Chat session is no longer available: missing-session
400 exactSession requires an existing session id
```

A malformed image attachment (wrong field types, or an empty `dataBase64`
that would otherwise ride to the SDK boundary's empty-`data` error) is
rejected at the zod parse boundary, before reaching `validateImages`'s
content-level checks:

```ts
[
  (await send(image({ id: "not-a-number", mimeType: "image/png", dataBase64: "abc" }))).split(" ")[0],
  (await send(image({ id: 1, mimeType: "image/png", dataBase64: "" }))).split(" ")[0],
].join(" ")
=> 400 400
```

An otherwise well-shaped image passes the zod boundary and reaches the
content-level check, which accepts only the four media types the Anthropic API
accepts. An `image/*` type the API rejects (`image/avif`, which the browser
image encoder used to produce for pasted photos; `image/svg+xml`; `image/bmp`)
gets a clean 400 instead of failing opaquely downstream:

```ts
[
  await send(image({ id: 1, mimeType: "application/pdf", dataBase64: "abc" })),
  await send(image({ id: 1, mimeType: "image/avif", dataBase64: "abc" })),
].join("\n")
=>
400 unsupported mime type: application/pdf (accepted: image/jpeg, image/png, image/gif, image/webp)
400 unsupported mime type: image/avif (accepted: image/jpeg, image/png, image/gif, image/webp)
```

## `channel`

The surface the message was sent from is the client's to declare — only the
browser can tell the iOS shell from mobile web, since the WebView carries an
ordinary iPhone UA. What the client sends wins over that UA:

```ts
[
  resolveChannel("ios-native", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"),
  resolveChannel("web-desktop", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"),
].join(" ")
=> ios-native web-desktop
```

A client that declares nothing — an old web bundle, or the iOS share extension
posting straight to this route — keeps getting the UA classification it got
before the field existed, and nothing at all when there is no UA to read:

```ts
[
  resolveChannel(undefined, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"),
  resolveChannel(undefined, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
  String(resolveChannel(undefined, undefined)),
].join(" ")
=> web-mobile web-desktop undefined
```

The value is a closed union at the parse boundary, so an unknown surface is a
400 rather than a made-up attribute in the agent's context. Invalid ambient
attention is likewise rejected before session resolution:

```ts
[
  await send({ message: "hi", session: "new", channel: "smoke-signal" }),
  await send({ message: "hi", session: "new", viewContext: { surface: "card", focusedRef: "https://example.com/?token=private", transcript: "hidden" } }),
].map((line) => line.split(" ")[0]).join(" ")
=> 400 400
```
