# Audio-review report route

Tests for `cb chat retranscribe`/`cb chat ask-about-audio`'s report-back
(retranscription-in-chat plan, Track 2): `POST /api/chat/audio-review` and
the pure report-building/skip logic the CLI call sites use before posting.

```ts setup
import { makeTestServer } from "../helpers/doctest-server.js";
import {
  buildRetranscriptionReport,
  buildConsultedReport,
} from "../../src/cli/commands/chat-audio-report.js";
```

## Route: a valid retranscription body emits `chat-retranscription`

```ts
const ctx = await makeTestServer();
const gotEvent = new Promise((resolve) => {
  ctx.eventBus.subscribe({ listener: (e) => {
    if (e.event === "chat-retranscription") resolve(e.data);
  }});
});
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/audio-review",
  payload: {
    kind: "retranscription",
    sessionId: "sess-1",
    messageId: "msg-1",
    newText: "remember to water the plants",
    service: "whisper",
    diarized: false,
    recordedAt: "2026-06-11T12:00:00Z",
  },
});
print(`status: ${res.statusCode}`);
print(`body: ${JSON.stringify(res.body)}`);
print(`event: ${JSON.stringify(await gotEvent)}`);
=>
status: 200
body: {"ok":true}
event: {"sessionId":"sess-1","messageId":"msg-1","newText":"remember to water the plants","service":"whisper","diarized":false,"recordedAt":"2026-06-11T12:00:00Z"}
```

```ts cleanup
await ctx.cleanup();
```

## Route: a valid consulted body emits `chat-audio-consulted`

```ts
const ctx = await makeTestServer();
const gotEvent = new Promise((resolve) => {
  ctx.eventBus.subscribe({ listener: (e) => {
    if (e.event === "chat-audio-consulted") resolve(e.data);
  }});
});
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/audio-review",
  payload: {
    kind: "consulted",
    sessionId: "sess-2",
    messageId: "msg-2",
    command: "ask-about-audio",
    question: "did I say can or cannot?",
  },
});
print(`status: ${res.statusCode}`);
print(`body: ${JSON.stringify(res.body)}`);
print(`event: ${JSON.stringify(await gotEvent)}`);
=>
status: 200
body: {"ok":true}
event: {"sessionId":"sess-2","messageId":"msg-2","command":"ask-about-audio","question":"did I say can or cannot?"}
```

```ts cleanup
await ctx.cleanup();
```

## Route: a missing sessionId is rejected with 400

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/audio-review",
  payload: {
    kind: "retranscription",
    sessionId: "",
    messageId: "msg-1",
    newText: "hello",
    diarized: false,
  },
});
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```

## Route: an unknown `kind` is rejected with 400

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/audio-review",
  payload: {
    kind: "something-else",
    sessionId: "sess-1",
    messageId: "msg-1",
  },
});
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```

## `buildRetranscriptionReport`: full payload

```ts
JSON.stringify(buildRetranscriptionReport({
  sessionId: "sess-1",
  messageId: "msg-1",
  newText: "the corrected text",
  service: "voxtral",
  diarized: true,
  recordedAt: "2026-06-11T12:00:00Z",
}))
=> {"kind":"retranscription","sessionId":"sess-1","messageId":"msg-1","newText":"the corrected text","diarized":true,"service":"voxtral","recordedAt":"2026-06-11T12:00:00Z"}
```

## `buildRetranscriptionReport`: unknown service and no recordedAt omit those fields

```ts
JSON.stringify(buildRetranscriptionReport({
  sessionId: "sess-1",
  messageId: "msg-1",
  newText: "text",
  service: undefined,
  diarized: false,
  recordedAt: null,
}))
=> {"kind":"retranscription","sessionId":"sess-1","messageId":"msg-1","newText":"text","diarized":false}
```

## `buildRetranscriptionReport`: null sessionId/messageId skip silently

`--file` runs and old browser tabs that answered without echoing an id both
land here — no report is attempted.

```ts
print(`null session: ${buildRetranscriptionReport({ sessionId: null, messageId: "msg-1", newText: "t", service: undefined, diarized: false, recordedAt: null })}`);
print(`null message: ${buildRetranscriptionReport({ sessionId: "sess-1", messageId: null, newText: "t", service: undefined, diarized: false, recordedAt: null })}`);
=>
null session: null
null message: null
```

## `buildConsultedReport`: present ids build the report; absent ones skip

```ts
print(JSON.stringify(buildConsultedReport({ sessionId: "sess-1", messageId: "msg-1", question: "was I whispering?" })));
print(`${buildConsultedReport({ sessionId: null, messageId: "msg-1", question: "q" })}`);
print(`${buildConsultedReport({ sessionId: "sess-1", messageId: null, question: "q" })}`);
=>
{"kind":"consulted","sessionId":"sess-1","messageId":"msg-1","command":"ask-about-audio","question":"was I whispering?"}
null
null
```
