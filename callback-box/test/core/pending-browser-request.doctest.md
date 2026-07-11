# Pending browser-request rendezvous

Tests for `createPendingBrowserRequests` — the generic primitive behind
CLI-long-poll → browser-tab round-trips (last-audio is one specialization;
the agent screenshot flow is another). Covers the ack phase, first-wins
fulfillment, the `reportNone` grace window, and how a consumer expresses a
"declined" answer without the primitive knowing about it.

```ts setup
import { createPendingBrowserRequests } from "../../src/core/pending-browser-request.js";
```

The screenshot consumer's fulfillment payload is a small union — note that
`declined` is just another payload, not a primitive concept:

```ts setup
type ScreenshotAnswer =
  | { kind: "image"; bytes: string }
  | { kind: "declined" };
```

## Ack phase: a client acks, then fulfills

The happy path for a two-phase request: the browser acks (cancelling the
`no-client` window), then answers with an image.

```ts
const reg = createPendingBrowserRequests<ScreenshotAnswer>();
const { requestId, outcome } = reg.create({ timeoutMs: 5000, ackGraceMs: 5000 });
print(`ack: ${reg.ack(requestId)}`);
print(`fulfill: ${reg.fulfill(requestId, { kind: "image", bytes: "PNGdata" })}`);
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

## Ack phase: no ack resolves `no-client`

When `ackGraceMs` is set and no ack arrives within it, the request resolves
`no-client` — nothing was listening (tab closed, event dropped, user on
mobile). This is distinct from `timeout` below.

```ts
const reg = createPendingBrowserRequests<ScreenshotAnswer>();
const { outcome } = reg.create({ timeoutMs: 5000, ackGraceMs: 20 });
const result = await outcome;
result.status
=> no-client
```

## Ack phase: acked but never answered resolves `timeout`

Once acked, the `no-client` window is cancelled and only the overall timeout
applies — a client saw the request but never answered (e.g. the user ignored
the popup).

```ts
const reg = createPendingBrowserRequests<ScreenshotAnswer>();
const { requestId, outcome } = reg.create({ timeoutMs: 20, ackGraceMs: 5000 });
print(`ack: ${reg.ack(requestId)}`);
const result = await outcome;
print(`status: ${result.status}`);
=>
ack: true
status: timeout
```

## Declined is a consumer-level fulfillment payload

The primitive has no notion of "declined" — the consumer expresses it by
fulfilling with its own payload variant. It resolves `fulfilled`, first-wins,
exactly like an image answer.

```ts
const reg = createPendingBrowserRequests<ScreenshotAnswer>();
const { requestId, outcome } = reg.create({ timeoutMs: 5000, ackGraceMs: 5000 });
reg.ack(requestId);
reg.fulfill(requestId, { kind: "declined" });
const result = await outcome;
print(`status: ${result.status}`);
print(`kind: ${result.status === "fulfilled" ? result.fulfillment.kind : "?"}`);
=>
status: fulfilled
kind: declined
```

## First fulfill wins; later answers are refused

The multi-tab contract: the first answer settles the request; a second tab's
answer (and any answer to an unknown id) is refused.

```ts
const reg = createPendingBrowserRequests<ScreenshotAnswer>();
print(`unknown fulfill: ${reg.fulfill("nope", { kind: "declined" })}`);
const { requestId, outcome } = reg.create({ timeoutMs: 5000 });
print(`first: ${reg.fulfill(requestId, { kind: "image", bytes: "first" })}`);
print(`second: ${reg.fulfill(requestId, { kind: "image", bytes: "second" })}`);
const result = await outcome;
print(`winner: ${result.status === "fulfilled" && result.fulfillment.kind === "image" ? result.fulfillment.bytes : "?"}`);
=>
unknown fulfill: false
first: true
second: false
winner: first
```

## Without an ack phase: no answer times out

A request created without `ackGraceMs` (the last-audio shape) has no ack
window — it can never resolve `no-client`, only `timeout` when nothing
answers.

```ts
const reg = createPendingBrowserRequests<ScreenshotAnswer>();
const { outcome } = reg.create({ timeoutMs: 20 });
const result = await outcome;
result.status
=> timeout
```

## `reportNone` resolves `none` after the grace window

A tab reporting "nothing here" doesn't settle immediately — another tab might
still answer — but once the grace window passes it resolves `none`. An ack
window, if any, is cancelled too (the reporting client clearly received the
request).

```ts
const reg = createPendingBrowserRequests<ScreenshotAnswer>({ graceMs: 20 });
const { requestId, outcome } = reg.create({ timeoutMs: 5000, ackGraceMs: 5000 });
print(`reported: ${reg.reportNone(requestId)}`);
const result = await outcome;
print(`status: ${result.status}`);
=>
reported: true
status: none
```

## An answer within the grace window still wins over `none`

```ts
const reg = createPendingBrowserRequests<ScreenshotAnswer>({ graceMs: 1000 });
const { requestId, outcome } = reg.create({ timeoutMs: 5000 });
reg.reportNone(requestId);
reg.fulfill(requestId, { kind: "image", bytes: "late" });
const result = await outcome;
result.status
=> fulfilled
```

## Ack and reportNone on unknown ids are refused

```ts
const reg = createPendingBrowserRequests<ScreenshotAnswer>();
print(`unknown ack: ${reg.ack("nope")}`);
print(`unknown none: ${reg.reportNone("nope")}`);
=>
unknown ack: false
unknown none: false
```
