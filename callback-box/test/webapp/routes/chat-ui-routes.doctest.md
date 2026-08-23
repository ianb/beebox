# The `cb chat ui` round trip

The server half of `cb chat ui`: a loopback long-poll that parks until the
browser tab holding a chat session answers with its control inventory. A direct
sibling of the screenshot rendezvous (`test/core/screenshot.doctest.md`) — the
same pending-request registry with the same 2 s ack window, so `no-client` (no
tab was listening) and `timeout` (a tab saw it and never answered) stay honestly
distinct — with a JSON answer instead of an image, and no `declined` outcome
because this flow has no consent prompt.

```ts setup
import { getOrCreateAgentToken } from "../../../src/core/agent/token.js";
import { makeTestServer } from "../../helpers/doctest-server.js";
import type { UiScanEntry, UiScanPayload } from "../../../src/shared/ui-scan.js";

/** A syntactically-valid (but not pending) request id — real ids are UUIDs. */
const VALID_ID = "00000000-0000-0000-0000-000000000000";

// The request route is loopback-only: it requires the per-box agent bearer.
function agentAuth(ctx) {
  return { authorization: `Bearer ${getOrCreateAgentToken(ctx.boxRoot)}` };
}

// The browser learns which id to answer from the transient `ui-scan-request`
// bus event (no id is caller-supplied). Subscribe BEFORE starting the long-poll.
function captureRequestId(ctx) {
  return new Promise((resolve) => {
    ctx.eventBus.subscribe({
      listener: (e) => {
        if (e.event === "ui-scan-request") resolve(e.data.requestId);
      },
    });
  });
}

const mic: UiScanEntry = {
  id: "cb-composer-mic",
  role: "button",
  name: "Start dictating",
  container: "Compose message",
  does: null,
  actions: ["point", "focus"],
  disabled: false,
  offscreen: false,
};

const scanPayload: UiScanPayload = {
  entries: [mic],
  omittedUnnamed: 2,
  omittedUnknownRole: 0,
  duplicateIds: [],
  truncated: false,
  coverage: "dom",
  channel: "web-desktop",
  url: "/test/chat",
  scannedAt: "2026-08-23T14:32:07.000Z",
};
```

## A plain user session cannot start a scan

The request route is agent-initiated, exactly like the screenshot request route:
without the loopback bearer — what an ordinary browser session presents — it is
forbidden, so no user (nor a page they were tricked into loading) can ask a tab
to enumerate itself.

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/ui/request",
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

## Nobody attached: 504 no-client

No client acks within the 2 s ack window. `timeoutMs` is clamped to a 3 s floor
kept above that window, so the two failures cannot collapse into one.

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/ui/request",
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

## Seen but unanswered: 504 timeout

The "browser" reads the server-minted id off the bus and acks. The ack cancels
the `no-client` window; with no scan following, the overall timeout fires — a
different fact from "nothing was listening", and the agent is told which.

```ts
const ctx = await makeTestServer();
const gotId = captureRequestId(ctx);
const longPoll = ctx.request({
  method: "POST",
  url: "/api/chat/ui/request",
  payload: { session: "s1", timeoutMs: 3000 },
  headers: agentAuth(ctx),
});
const requestId = await gotId;
const ackRes = await ctx.request({
  method: "POST",
  url: `/api/chat/ui/${requestId}`,
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

## A client that cannot scan says why

`failed` is an ordinary fulfillment, so the agent hears a reason instead of
waiting out the clock.

```ts
const ctx = await makeTestServer();
const gotId = captureRequestId(ctx);
const longPoll = ctx.request({
  method: "POST",
  url: "/api/chat/ui/request",
  payload: { session: "s1", timeoutMs: 8000 },
  headers: agentAuth(ctx),
});
const requestId = await gotId;
await ctx.request({
  method: "POST",
  url: `/api/chat/ui/${requestId}`,
  payload: { failed: "document is not ready" },
});
const res = await longPoll;
print(`status: ${res.statusCode}`);
print(`error: ${res.body.error}`);
print(`reason: ${res.body.reason}`);
=>
status: 502
error: failed
reason: document is not ready
```

```ts cleanup
await ctx.cleanup();
```

## The full loop: a scan answers the long-poll

The long-poll is started, the "browser" posts the inventory, and the CLI
receives it verbatim — the route is a rendezvous, not a transformer. Formatting
happens in the CLI (`core/chat/ui-dump.ts`), so the wire stays the payload.

```ts
const ctx = await makeTestServer();
const gotId = captureRequestId(ctx);
const longPoll = ctx.request({
  method: "POST",
  url: "/api/chat/ui/request",
  payload: { session: "s1", timeoutMs: 8000 },
  headers: agentAuth(ctx),
});
const requestId = await gotId;
const answer = await ctx.request({
  method: "POST",
  url: `/api/chat/ui/${requestId}`,
  payload: scanPayload,
});
print(`answer ok: ${JSON.stringify(answer.body)}`);
const res = await longPoll;
print(`status: ${res.statusCode}`);
print(`coverage: ${res.body.coverage}`);
print(`channel: ${res.body.channel}`);
print(`omitted: ${res.body.omittedUnnamed}`);
print(`first entry: ${res.body.entries[0].id}`);
=>
answer ok: {"ok":true}
status: 200
coverage: dom
channel: web-desktop
omitted: 2
first entry: cb-composer-mic
```

```ts cleanup
await ctx.cleanup();
```

## The native-unavailable coverage value survives the wire

A scan from inside the iOS shell that could not reach the native half reports it
as a value, not as a missing section — the dump turns this into the sentence
naming the composer, mic, capture and box switcher.

```ts
const ctx = await makeTestServer();
const gotId = captureRequestId(ctx);
const longPoll = ctx.request({
  method: "POST",
  url: "/api/chat/ui/request",
  payload: { session: "s1", timeoutMs: 8000 },
  headers: agentAuth(ctx),
});
const requestId = await gotId;
await ctx.request({
  method: "POST",
  url: `/api/chat/ui/${requestId}`,
  payload: { ...scanPayload, coverage: "dom-native-unavailable", channel: "ios-native" },
});
const res = await longPoll;
print(`status: ${res.statusCode}`);
print(`coverage: ${res.body.coverage}`);
=>
status: 200
coverage: dom-native-unavailable
```

```ts cleanup
await ctx.cleanup();
```

## A malformed payload is rejected at the boundary

The schema is `strict()`, so a compromised or outdated client cannot smuggle an
unknown field or an invented `coverage` value past the route into the agent's
context.

```ts
const ctx = await makeTestServer();
const post = async (payload: unknown): Promise<string> => {
  const res = await ctx.request({ method: "POST", url: `/api/chat/ui/${VALID_ID}`, payload });
  return `${res.statusCode} ${res.body.error}`;
};
print(await post({ ...scanPayload, coverage: "everything" }));
print(await post({ ...scanPayload, surprise: true }));
print(await post({ entries: "not an array" }));
print(await post({ ack: "yes" }));
=>
400 bad-answer
400 bad-answer
400 bad-answer
400 bad-answer
```

```ts cleanup
await ctx.cleanup();
```

## A well-formed answer to a request nobody is waiting on is a 404

The normal multi-tab outcome (another tab's scan already won) and the
post-abort one. Nothing is retried and nothing is stored.

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: `/api/chat/ui/${VALID_ID}`,
  payload: scanPayload,
});
print(`status: ${res.statusCode}`);
print(`error: ${res.body.error}`);
const malformedId = await ctx.request({
  method: "POST",
  url: "/api/chat/ui/..%2F..%2Ftarget",
  payload: { ack: true },
});
print(`traversal status: ${malformedId.statusCode}`);
print(`traversal error: ${malformedId.body.error}`);
=>
status: 404
error: unknown-request
traversal status: 400
traversal error: bad-request-id
```

```ts cleanup
await ctx.cleanup();
```
