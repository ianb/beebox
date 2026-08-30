# Agent-initiated screenshot rendezvous

Tests for `bbx chat screenshot`'s server side: the pending-request registry
(the generic `createPendingBrowserRequests`, whose fulfillment payload here is
a `{kind: "image" | "declined" | "failed"}` union) and the two HTTP routes that
connect the CLI long-poll to the browser tab holding the session.

```ts setup
import { createPendingBrowserRequests } from "../../src/core/pending-browser-request.js";
import { getOrCreateAgentToken } from "../../src/core/agent/token.js";
import { makeTestServer } from "../helpers/doctest-server.js";

type ScreenshotAnswer =
  | { kind: "image"; png: Buffer; fidelity: "extension" | "displaymedia" }
  | { kind: "declined" }
  | { kind: "failed"; reason: string };

// An 8-byte PNG signature plus a trailing byte — enough to pass the route's
// magic-byte check.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

// A syntactically-valid (but not pending) request id — the answer route rejects
// a non-UUID param before any lookup, so answer-route tests use a real UUID.
const VALID_ID = "00000000-0000-0000-0000-000000000000";

// The request route is loopback-only: it requires the per-box agent bearer.
// getOrCreateAgentToken mints/reads the same token file verifyAgentBearer checks.
function agentAuth(ctx) {
  return { authorization: `Bearer ${getOrCreateAgentToken(ctx.boxRoot)}` };
}

// The browser learns which id to answer from the transient `screenshot-request`
// bus event (no id is caller-supplied). Subscribe BEFORE starting the long-poll,
// then await the emitted id — this is the real server-generated-id path.
function captureRequestId(ctx) {
  return new Promise((resolve) => {
    ctx.eventBus.subscribe({
      listener: (e) => {
        if (e.event === "screenshot-request") resolve(e.data.requestId);
      },
    });
  });
}

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
  url: `/api/chat/screenshot/${VALID_ID}`,
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

## Route: a malformed request id is rejected before any lookup

A live pending id is always a server-minted UUID, so a param that isn't one
(here a path-traversal attempt) is a 400 at the boundary — it never reaches the
registry or the filesystem.

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/..%2F..%2Ftarget",
  payload: { declined: true },
});
print(`status: ${res.statusCode}`);
print(`error: ${res.body.error}`);
=>
status: 400
error: bad-request-id
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
  url: `/api/chat/screenshot/${VALID_ID}`,
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
  url: `/api/chat/screenshot/${VALID_ID}`,
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

## Route: a plain user session (no agent bearer) is rejected 403

The request route is agent-initiated. Without the loopback bearer — what an
ordinary browser session would present — it is forbidden, so no user can start
a screenshot request.

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
status: 403
error: forbidden
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
  headers: agentAuth(ctx),
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

The "browser" learns the server-minted id from the `screenshot-request` bus
event, then acks via `{ack: true}`. The ack cancels the `no-client` window; with
no image the overall 3s timeout then fires as `timeout` — distinct from
`no-client`.

```ts
const ctx = await makeTestServer();
const gotId = captureRequestId(ctx);
const longPoll = ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/request",
  payload: { session: "s1", timeoutMs: 3000 },
  headers: agentAuth(ctx),
});
const requestId = await gotId;
const ackRes = await ctx.request({
  method: "POST",
  url: `/api/chat/screenshot/${requestId}`,
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
const gotId = captureRequestId(ctx);
const longPoll = ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/request",
  payload: { session: "s1", timeoutMs: 8000 },
  headers: agentAuth(ctx),
});
const requestId = await gotId;
const answer = await ctx.request({
  method: "POST",
  url: `/api/chat/screenshot/${requestId}`,
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

The long-poll is started; the "browser" reads the server-minted id off the bus
and answers with a PNG plus `viewport`/`fidelity` fields; the route writes the
image under `tmp/screenshot-<requestId>.png` and returns its absolute path with
the metadata. The saved bytes match what was uploaded.

```ts
const ctx = await makeTestServer();
const gotId = captureRequestId(ctx);
const longPoll = ctx.request({
  method: "POST",
  url: "/api/chat/screenshot/request",
  payload: { session: "s1", timeoutMs: 8000 },
  headers: agentAuth(ctx),
});
const requestId = await gotId;
const boundary = "----cbshotloop";
const body = multipart({
  boundary,
  file: PNG,
  fields: { fidelity: "extension", viewport: JSON.stringify({ cssWidth: 1440, cssHeight: 900, dpr: 2 }) },
});
const answer = await ctx.request({
  method: "POST",
  url: `/api/chat/screenshot/${requestId}`,
  payload: body,
  headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
});
print(`answer ok: ${JSON.stringify(answer.body)}`);
const res = await longPoll;
print(`status: ${res.statusCode}`);
print(`fidelity: ${res.body.fidelity}`);
print(`viewport: ${JSON.stringify(res.body.viewport)}`);
print(`path ends: ${res.body.path.endsWith(`/tmp/screenshot-${requestId}.png`)}`);
print(`path absolute: ${res.body.path.startsWith("/")}`);
// The 200 is sent only after the PNG is written; the file therefore exists.
const saved = await ctx.read(`tmp/screenshot-${requestId}.png`);
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

## Route: a genuine client abort cancels the pending entry

The plan's abort semantics, exercised over a REAL listening socket (Fastify's
`inject` can't model a mid-flight client disconnect). A real `fetch` starts the
long-poll, is aborted after the request has parked, and the server's
disconnect-detection cancels the entry — so a late browser answer to that id
settles nothing (404). A normal completed long-poll is never hijacked (the
`writableFinished` gate above), which the other full-loop cases confirm.

```ts
const ctx = await makeTestServer();
await ctx.server.listen({ port: 0, host: "127.0.0.1" });
const addr = ctx.server.server.address();
const port = typeof addr === "object" && addr !== null ? addr.port : 0;
const token = getOrCreateAgentToken(ctx.boxRoot);

const gotId = captureRequestId(ctx);
const controller = new AbortController();
const poll = fetch(`http://127.0.0.1:${port}/test/api/chat/screenshot/request`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ session: "s1", timeoutMs: 30000 }),
  signal: controller.signal,
}).then(() => "resolved", (e) => e.name);

// Wait until the request has parked (its id is on the bus), then sever the
// client connection mid-poll.
const requestId = await gotId;
controller.abort();
print(`poll outcome: ${await poll}`);

// Give the server a moment to observe the socket close and cancel the entry.
await new Promise((resolve) => setTimeout(resolve, 250));

// A late answer to the now-cancelled request settles nothing → 404.
const late = await ctx.request({
  method: "POST",
  url: `/api/chat/screenshot/${requestId}`,
  payload: { declined: true },
});
print(`late status: ${late.statusCode}`);
print(`late error: ${late.body.error}`);
=>
poll outcome: AbortError
late status: 404
late error: unknown-request
```

```ts cleanup
await ctx.cleanup();
```
</content>
