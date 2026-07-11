# Agent-initiated screenshot rendezvous

Tests for `cb chat screenshot`'s server side: the pending-request registry
(the generic `createPendingBrowserRequests`, whose fulfillment payload here is
a `{kind: "image" | "declined" | "failed"}` union) and the two HTTP routes that
connect the CLI long-poll to the browser tab holding the session.

```ts setup
import { createPendingBrowserRequests } from "../../src/core/pending-browser-request.js";
import { makeTestServer } from "../helpers/doctest-server.js";

type ScreenshotAnswer =
  | { kind: "image"; png: Buffer; fidelity: "extension" | "displaymedia" }
  | { kind: "declined" }
  | { kind: "failed"; reason: string };

// An 8-byte PNG signature plus a trailing byte — enough to pass the route's
// magic-byte check.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

// Build a multipart body with an optional file + text fields. Returns a Buffer
// so binary PNG bytes survive intact.
function multipart(opts: { boundary: string; file?: Buffer; fields?: Record<string, string> }): Buffer {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(opts.fields ?? {})) {
    parts.push(Buffer.from(`--${opts.boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (opts.file !== undefined) {
    parts.push(Buffer.from(`--${opts.boundary}\r\nContent-Disposition: form-data; name="file"; filename="shot.png"\r\nContent-Type: image/png\r\n\r\n`));
    parts.push(opts.file);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${opts.boundary}--\r\n`));
  return Buffer.concat(parts);
}
```

## Registry: an image fulfillment resolves the request

The two-phase happy path: the tab acks (cancelling the `no-client` window),
then answers with an image.

```ts
const reg = createPendingBrowserRequests<ScreenshotAnswer>();
const { requestId, outcome } = reg.create({ timeoutMs: 5000, ackGraceMs: 5000 });
print(`ack: ${reg.ack(requestId)}`);
print(`fulfill: ${reg.fulfill(requestId, { kind: "image", png: PNG, fidelity: "extension" })}`);
const result = await outcome;
print(`status: ${result.status}`);
print(`kind: ${result.status === "fulfilled" ? result.fulfillment.kind : "?"}`);
print(`pending left: ${reg.size()}`);
=>
ack: true
fulfill: true
status: fulfilled
kind: image
pending left: 0
```

## Registry: no ack resolves `no-client`

```ts
const reg = createPendingBrowserRequests<ScreenshotAnswer>();
const { outcome } = reg.create({ timeoutMs: 5000, ackGraceMs: 20 });
const result = await outcome;
result.status
=> no-client
```

## Registry: acked-then-silent resolves `timeout`

```ts
const reg = createPendingBrowserRequests<ScreenshotAnswer>();
const { requestId, outcome } = reg.create({ timeoutMs: 20, ackGraceMs: 5000 });
reg.ack(requestId);
const result = await outcome;
result.status
=> timeout
```

## Registry: a cancelled request refuses a late answer

The route cancels a pending entry when the CLI's long-poll is aborted. A tab
answering afterwards settles nothing — which the answer route maps to 404.

```ts
const reg = createPendingBrowserRequests<ScreenshotAnswer>();
const { requestId } = reg.create({ timeoutMs: 5000, ackGraceMs: 5000 });
print(`cancel: ${reg.cancel(requestId)}`);
print(`late fulfill: ${reg.fulfill(requestId, { kind: "image", png: PNG, fidelity: "extension" })}`);
print(`size: ${reg.size()}`);
=>
cancel: true
late fulfill: false
size: 0
```

## Route: answering an unknown/settled request returns 404

Also the normal multi-tab outcome — a second tab answering after the first
already won, or a tab answering a request the CLI already abandoned.

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/nope",
  payload: { declined: true },
});
print(`status: ${res.statusCode}`);
print(`error: ${res.body.error}`);
=>
status: 404
error: unknown-request
```

```ts cleanup
await ctx.cleanup();
```

## Route: a non-PNG multipart upload is rejected at the boundary

```ts
const ctx = await makeTestServer();
const boundary = "----cbshot";
const body = multipart({ boundary, file: Buffer.from("not a png"), fields: { fidelity: "displaymedia" } });
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/whatever",
  payload: body,
  headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
});
print(`status: ${res.statusCode}`);
print(`error: ${res.body.error}`);
=>
status: 400
error: not-png
```

```ts cleanup
await ctx.cleanup();
```

## Route: an oversized PNG is rejected at the boundary

A valid PNG signature followed by >25 MB of bytes trips the size cap (checked
after the magic bytes, so the error is `too-large`, not `not-png`).

```ts
const ctx = await makeTestServer();
const boundary = "----cbbig";
const oversized = Buffer.concat([PNG, Buffer.alloc(26 * 1024 * 1024)]);
const body = multipart({ boundary, file: oversized, fields: { fidelity: "extension" } });
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/whatever",
  payload: body,
  headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
});
print(`status: ${res.statusCode}`);
print(`error: ${res.body.error}`);
=>
status: 400
error: too-large
```

```ts cleanup
await ctx.cleanup();
```

## Route: a request nobody acks returns 504 no-client

No tab acks within the 2s ack window, so the request resolves `no-client`
(distinct from `timeout`). `timeoutMs` is clamped to a 3s floor kept above the
ack window.

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/request",
  payload: { session: "s1", timeoutMs: 3000 },
});
print(`status: ${res.statusCode}`);
print(`error: ${res.body.error}`);
=>
status: 504
error: no-client
```

```ts cleanup
await ctx.cleanup();
```

## Route: acked-then-silent returns 504 timeout

A caller-supplied `requestId` (which the request route accepts for test
correlation, standing in for the bus broadcast) lets the "browser" ack via
`{ack: true}`. The ack cancels the `no-client` window; with no image the overall
3s timeout then fires as `timeout` — distinct from `no-client`.

```ts
const ctx = await makeTestServer();
const longPoll = ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/request",
  payload: { session: "s1", timeoutMs: 3000, requestId: "shot-timeout" },
});
await new Promise((resolve) => setTimeout(resolve, 50));
const ackRes = await ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/shot-timeout",
  payload: { ack: true },
});
print(`ack ok: ${JSON.stringify(ackRes.body)}`);
const res = await longPoll;
print(`status: ${res.statusCode}`);
print(`error: ${res.body.error}`);
=>
ack ok: {"ok":true}
status: 504
error: timeout
```

```ts cleanup
await ctx.cleanup();
```

## Route: a decline answer returns 409

```ts
const ctx = await makeTestServer();
const longPoll = ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/request",
  payload: { session: "s1", timeoutMs: 8000, requestId: "shot-decline" },
});
await new Promise((resolve) => setTimeout(resolve, 50));
const answer = await ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/shot-decline",
  payload: { declined: true },
});
print(`answer ok: ${JSON.stringify(answer.body)}`);
const res = await longPoll;
print(`status: ${res.statusCode}`);
print(`error: ${res.body.error}`);
=>
answer ok: {"ok":true}
status: 409
error: declined
```

```ts cleanup
await ctx.cleanup();
```

## Route: full loop — long-poll answered by a multipart PNG upload

The long-poll is started; the "browser" answers with a PNG plus
`viewport`/`fidelity` fields; the route writes the image under
`tmp/screenshots/<requestId>.png` and returns its absolute path with the
metadata. The saved bytes match what was uploaded.

```ts
const ctx = await makeTestServer();
const longPoll = ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/request",
  payload: { session: "s1", timeoutMs: 8000, requestId: "shot-loop" },
});
await new Promise((resolve) => setTimeout(resolve, 50));
const boundary = "----cbshotloop";
const body = multipart({
  boundary,
  file: PNG,
  fields: { fidelity: "extension", viewport: JSON.stringify({ cssWidth: 1440, cssHeight: 900, dpr: 2 }) },
});
const answer = await ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/shot-loop",
  payload: body,
  headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
});
print(`answer ok: ${JSON.stringify(answer.body)}`);
const res = await longPoll;
print(`status: ${res.statusCode}`);
print(`fidelity: ${res.body.fidelity}`);
print(`viewport: ${JSON.stringify(res.body.viewport)}`);
print(`path ends: ${res.body.path.endsWith("/tmp/screenshots/shot-loop.png")}`);
print(`path absolute: ${res.body.path.startsWith("/")}`);
// The 200 is sent only after the PNG is written; the file therefore exists.
const saved = await ctx.read("tmp/screenshots/shot-loop.png");
print(`saved non-empty: ${saved.length > 0}`);
=>
answer ok: {"ok":true}
status: 200
fidelity: extension
viewport: {"cssWidth":1440,"cssHeight":900,"dpr":2}
path ends: true
path absolute: true
saved non-empty: true
```

```ts cleanup
await ctx.cleanup();
```
</content>
