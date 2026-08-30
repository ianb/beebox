# Agent-initiated screenshot — request logic

The browser side of `bbx chat screenshot` (Track B) decides four things purely,
extracted into `screenshot-request-logic.ts` (the React hook + DOM/network live
in `screenshot-request-handler.ts`, which can't run under the Node tier):

1. does a broadcast `screenshot-request` target *this* view's session,
2. is it already past its deadline,
3. what answer does a capture outcome map to, and
4. how the FIFO popup queue + ephemeral indicators fold.

```ts setup
import {
  matchesRequestSession,
  isRequestExpired,
  captureOutcomeToAnswer,
  classifyUploadResponse,
  screenshotReducer,
} from "../../src/frontend/src/components/chat/screenshot-request-logic.js";

const req = (requestId, extra) => ({ requestId, session: "s1", expiresAt: "2999-01-01T00:00:00Z", ...extra });
```

## Session match is EXACT, never a null wildcard

Unlike the `forSession` chat helper (null on either side = wildcard), a capture
request matches only when the ids are equal and this view actually has a
session. An idle `?session=new` tab (`viewSession === null`) must NOT answer an
established session's request.

```ts
matchesRequestSession("s1", "s1")
=> true

matchesRequestSession("s1", "s2")
=> false

matchesRequestSession("s1", null)
=> false
```

## Expiry is a loose clock hint

A request past its ISO deadline is dropped; before it, kept. An unparseable
deadline is treated as not-expired rather than silently discarding the request
on a bad hint.

```ts
isRequestExpired("2000-01-01T00:00:00Z", Date.parse("2020-01-01T00:00:00Z"))
=> true

isRequestExpired("2999-01-01T00:00:00Z", Date.parse("2020-01-01T00:00:00Z"))
=> false

isRequestExpired("not-a-date", Date.now())
=> false
```

## Capture outcome → answer

An image becomes an `upload`; a dismissed picker a `declined`; an unsupported
client the plan's named `unsupported-client` failure; any other error carries
its own message. Every degraded path is named — never a silent blank.

```ts
const image = captureOutcomeToAnswer({ kind: "image", blob: new Blob([]), viewport: { cssWidth: 800, cssHeight: 600, dpr: 2 } });
JSON.stringify({ kind: image.kind, viewport: image.viewport })
=> {"kind":"upload","viewport":{"cssWidth":800,"cssHeight":600,"dpr":2}}

JSON.stringify(captureOutcomeToAnswer({ kind: "declined" }))
=> {"kind":"declined"}

JSON.stringify(captureOutcomeToAnswer({ kind: "unsupported" }))
=> {"kind":"failed","reason":"unsupported-client"}

JSON.stringify(captureOutcomeToAnswer({ kind: "error", message: "canvas 2D context unavailable" }))
=> {"kind":"failed","reason":"canvas 2D context unavailable"}
```

## Upload response → resolution

The PNG POST to the answer route settles four ways (finding 2). A 2xx shows the
"shared" indicator. A 404 is the quiet multi-tab/expired case — another tab won
or the request already settled, so no post, no toast, no indicator. Any other
HTTP status means the capture happened but the *server* rejected it, so post a
named `failed` (the server's `error` field, else a generic `upload-rejected`) so
the agent's command settles as `failed:` instead of hanging to `timeout`. A
thrown fetch means the channel is down — nothing can be posted, so toast locally
rather than falsely claim it was shared.

```ts
JSON.stringify(classifyUploadResponse({ kind: "ok" }))
=> {"kind":"indicator"}

JSON.stringify(classifyUploadResponse({ kind: "http", status: 404, errorField: null }))
=> {"kind":"quiet"}

JSON.stringify(classifyUploadResponse({ kind: "http", status: 400, errorField: "bad-viewport" }))
=> {"kind":"failed","reason":"bad-viewport"}

JSON.stringify(classifyUploadResponse({ kind: "http", status: 502, errorField: null }))
=> {"kind":"failed","reason":"upload-rejected"}

JSON.stringify(classifyUploadResponse({ kind: "network" }))
=> {"kind":"toast"}
```

The object-URL revoke timing (thumbnail freed on the non-indicator paths and on
row unmount-before-timer) is DOM-lifecycle and stays manual-verify — it can't run
under the Node tier.

## The queue is FIFO, one popup at a time

Two requests enqueue in order; the head is the active popup. Resolving the head
pops it so the next promotes — never two popups stacked.

```ts
let state = { queue: [], indicators: [] };
state = screenshotReducer(state, { type: "enqueue", request: req("a") });
state = screenshotReducer(state, { type: "enqueue", request: req("b") });
state.queue.map((r) => r.requestId).join(",")
=> a,b

state = screenshotReducer(state, { type: "resolveHead", indicator: null });
state.queue.map((r) => r.requestId).join(",")
=> b
```

A redelivered request (same `requestId`) never stacks a second popup.

```ts continue
state = screenshotReducer(state, { type: "enqueue", request: req("b") });
state.queue.length
=> 1
```

## Resolving with an indicator records the ephemeral row; dismiss removes it

`resolveHead` with an indicator both pops the queue and appends the "shared with
the agent" row; the relay path adds one without ever queuing a popup; dismiss
ages it out.

```ts
let s = { queue: [req("x")], indicators: [] };
s = screenshotReducer(s, { type: "resolveHead", indicator: { requestId: "x", thumbnailUrl: "blob:x" } });
JSON.stringify({ queue: s.queue.length, indicators: s.indicators.map((i) => i.requestId) })
=> {"queue":0,"indicators":["x"]}

s = screenshotReducer(s, { type: "addIndicator", indicator: { requestId: "y", thumbnailUrl: "blob:y" } });
s.indicators.map((i) => i.requestId).join(",")
=> x,y

s = screenshotReducer(s, { type: "dismissIndicator", requestId: "x" });
s.indicators.map((i) => i.requestId).join(",")
=> y
```
