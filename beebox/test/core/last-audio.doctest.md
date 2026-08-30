# Last-audio loopback

Tests for `bbx chat get-last-audio`'s server side: the pending-request
registry (`createLastAudioPending`) and the two HTTP routes that connect a
CLI long-poll to the browser tab holding the recording.

```ts setup
import { createLastAudioPending } from "../../src/core/last-audio-pending.js";
import { AUDIO_QUESTION_MODEL, buildAudioQuestionPrompt } from "../../src/core/audio-question.js";
import { audioMimeType, missingMessageIdError } from "../../src/cli/commands/chat-audio.js";
import { makeTestServer } from "../helpers/doctest-server.js";
```

## Registry: an audio answer resolves the request

`create` targets an exact `messageId`; a fulfillment must echo the same id
back to be delivered.

```ts
const reg = createLastAudioPending();
const { requestId, outcome } = reg.create({ timeoutMs: 5000, messageId: "msg-abc" });
print(`fulfill: ${reg.fulfill(requestId, {
  audio: Buffer.from("RIFFfake"),
  contentType: "audio/wav",
  recordedAt: "2026-06-11T12:00:00Z",
  text: "hello there",
  messageId: "msg-abc",
  sessionId: "sess-1",
})}`);
const result = await outcome;
print(`status: ${result.status}`);
print(`audio: ${result.fulfillment.audio.toString()}`);
print(`recordedAt: ${result.fulfillment.recordedAt}`);
print(`pending left: ${reg.size()}`);
=>
fulfill: delivered
status: audio
audio: RIFFfake
recordedAt: 2026-06-11T12:00:00Z
pending left: 0
```

## Registry: no answer at all times out

```ts
const reg = createLastAudioPending();
const { outcome } = reg.create({ timeoutMs: 20, messageId: "msg-x" });
const result = await outcome;
result.status
=> timeout
```

## Registry: a "none" answer resolves after the grace window

A tab reporting "no audio cached" doesn't settle immediately — another tab
might still hold the recording — but once the grace window passes with no
audio, the request resolves `none`. `{none:true}` answers aren't targeted
(a tab can only say "I don't have it"), so this is unaffected by echo-and-verify.

```ts
const reg = createLastAudioPending({ graceMs: 20 });
const { requestId, outcome } = reg.create({ timeoutMs: 5000, messageId: "msg-y" });
print(`reported: ${reg.reportNone(requestId)}`);
const result = await outcome;
print(`status: ${result.status}`);
=>
reported: true
status: none
```

## Registry: audio arriving within the grace window still wins

```ts
const reg = createLastAudioPending({ graceMs: 1000 });
const { requestId, outcome } = reg.create({ timeoutMs: 5000, messageId: "msg-z" });
reg.reportNone(requestId);
reg.fulfill(requestId, { audio: Buffer.from("x"), contentType: "audio/wav", recordedAt: null, text: null, messageId: "msg-z", sessionId: null });
const result = await outcome;
result.status
=> audio
```

## Registry: production default — a "none" grace is the request's OWN timeoutMs, not a fixed short window

Fix (2026-08): a targeted request fans out to every connected tab, and most
of them don't hold this exact recording — they answer `none` almost
instantly. Without a per-request grace, that instant chorus of "none"s used
to cut the requested wait down to a fixed short grace window (2s), so a
background-throttled tab that DOES hold the recording could lose even though
plenty of the caller's requested timeout remained. With no factory-level
`graceMs` override (the production shape), a "none" arriving well within the
window still leaves room for a slower correct answer to win.

```ts
const reg = createLastAudioPending();
const { requestId, outcome } = reg.create({ timeoutMs: 300, messageId: "msg-slow" });
reg.reportNone(requestId); // an early "none" from a tab that doesn't hold it
await new Promise((r) => setTimeout(r, 150)); // 150ms in: past the old fixed grace, still inside this request's own 300ms window
reg.fulfill(requestId, { audio: Buffer.from("late-but-in-window"), contentType: "audio/wav", recordedAt: null, text: null, messageId: "msg-slow", sessionId: null });
const result = await outcome;
print(`status: ${result.status}`);
print(`audio: ${result.status === "audio" ? result.fulfillment.audio.toString() : "?"}`);
=>
status: audio
audio: late-but-in-window
```

## Registry: production default — all tabs answering `none` still resolves `none` at the full window's end

```ts
const reg = createLastAudioPending();
const { requestId, outcome } = reg.create({ timeoutMs: 60, messageId: "msg-nobody-has-it" });
reg.reportNone(requestId);
const result = await outcome;
result.status
=> none
```

## Registry: a mismatched or missing echoed messageId is ignored, not delivered

Echo-and-verify (Track 1b, load-bearing): a fulfillment whose `messageId`
doesn't match the request's target — including a stale-tab answer that omits
`messageId` entirely — is ignored outright. The request stays pending; a
later, correctly-targeted answer still wins it.

```ts
const reg = createLastAudioPending();
const { requestId, outcome } = reg.create({ timeoutMs: 5000, messageId: "msg-target" });
print(`mismatched: ${reg.fulfill(requestId, { audio: Buffer.from("wrong"), contentType: "audio/wav", recordedAt: null, text: null, messageId: "msg-other", sessionId: null })}`);
print(`no-id (stale tab): ${reg.fulfill(requestId, { audio: Buffer.from("stale"), contentType: "audio/wav", recordedAt: null, text: null, messageId: null, sessionId: null })}`);
print(`still pending: ${reg.size()}`);
print(`correct: ${reg.fulfill(requestId, { audio: Buffer.from("right"), contentType: "audio/wav", recordedAt: null, text: null, messageId: "msg-target", sessionId: null })}`);
const result = await outcome;
print(`status: ${result.status}`);
print(`audio: ${result.fulfillment.audio.toString()}`);
=>
mismatched: ignored
no-id (stale tab): ignored
still pending: 1
correct: delivered
status: audio
audio: right
```

## Registry: unknown and already-settled ids are refused

```ts
const reg = createLastAudioPending();
print(`unknown fulfill: ${reg.fulfill("nope", { audio: Buffer.from("x"), contentType: "audio/wav", recordedAt: null, text: null, messageId: null, sessionId: null })}`);
print(`unknown none: ${reg.reportNone("nope")}`);
const { requestId, outcome } = reg.create({ timeoutMs: 5000, messageId: "msg-a" });
print(`first: ${reg.fulfill(requestId, { audio: Buffer.from("a"), contentType: "audio/wav", recordedAt: null, text: null, messageId: "msg-a", sessionId: null })}`);
print(`second: ${reg.fulfill(requestId, { audio: Buffer.from("b"), contentType: "audio/wav", recordedAt: null, text: null, messageId: "msg-a", sessionId: null })}`);
const result = await outcome;
print(`winner: ${result.fulfillment.audio.toString()}`);
=>
unknown fulfill: unknown
unknown none: false
first: delivered
second: unknown
winner: a
```

## Route: answering an unknown request returns 404

This is also the normal multi-tab outcome — a second tab answering after
the first tab's audio already settled the request.

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/last-audio/nope",
  payload: { none: true },
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

## Route: a JSON answer that isn't {none:true} is rejected

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/last-audio/whatever",
  payload: { hello: 1 },
});
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```

## Route: a request nobody answers returns 504

`timeoutMs` is clamped to a 100ms minimum, so this resolves quickly.

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/last-audio/request",
  payload: { timeoutMs: 1, messageId: "msg-nobody" },
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

## Route: a request without messageId is rejected before any wait

Track 1b removed the untargeted "latest" mode entirely — every request must
name the exact message it wants.

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/last-audio/request",
  payload: { timeoutMs: 1 },
});
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```

## Route: full loop — long-poll answered by a multipart upload

The "browser" learns the server-minted request id from the transient
`chat-last-audio-request` bus event (the same instance the route emits on —
no id is caller-supplied). The long-poll is started, the "browser" answers with
audio + metadata fields, and the long-poll response carries the bytes and the
metadata headers.

```ts
const ctx = await makeTestServer();
const gotId = new Promise((resolve) => {
  ctx.eventBus.subscribe({ listener: (e) => {
    if (e.event === "chat-last-audio-request") resolve(e.data.requestId);
  }});
});
const longPoll = ctx.rawRequest({
  method: "POST",
  url: "/api/chat/last-audio/request",
  payload: { timeoutMs: 5000, messageId: "msg-plants-1" },
});
// The id is emitted synchronously as the request parks.
const requestId = await gotId;
const boundary = "----cbtestboundary";
const upload = [
  `--${boundary}`,
  'Content-Disposition: form-data; name="recordedAt"',
  "",
  "2026-06-11T12:00:00Z",
  `--${boundary}`,
  'Content-Disposition: form-data; name="text"',
  "",
  "remember to water the plants",
  `--${boundary}`,
  'Content-Disposition: form-data; name="messageId"',
  "",
  "msg-plants-1",
  `--${boundary}`,
  'Content-Disposition: form-data; name="sessionId"',
  "",
  "sess-42",
  `--${boundary}`,
  'Content-Disposition: form-data; name="file"; filename="last-message.wav"',
  "Content-Type: audio/wav",
  "",
  "RIFFfakewavbytes",
  `--${boundary}--`,
  "",
].join("\r\n");
const answer = await ctx.request({
  method: "POST",
  url: `/api/chat/last-audio/${requestId}`,
  payload: upload,
  headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
});
print(`answer ok: ${JSON.stringify(answer.body)}`);
const res = await longPoll;
print(`status: ${res.statusCode}`);
print(`content-type: ${res.headers["content-type"]}`);
print(`recorded-at: ${res.headers["x-recorded-at"]}`);
print(`text: ${decodeURIComponent(res.headers["x-message-text"])}`);
print(`message-id: ${decodeURIComponent(res.headers["x-message-id"])}`);
print(`session-id: ${decodeURIComponent(res.headers["x-session-id"])}`);
print(`audio: ${res.payload}`);
=>
answer ok: {"ok":true}
status: 200
content-type: audio/wav
recorded-at: 2026-06-11T12:00:00Z
text: remember to water the plants
message-id: msg-plants-1
session-id: sess-42
audio: RIFFfakewavbytes
```

```ts cleanup
await ctx.cleanup();
```

## Route: a stale-tab answer with no echoed messageId is ignored, then a correct answer wins

Echo-and-verify (Track 1b, load-bearing): a stale pre-1b tab still answers
with whatever it last retained and no `messageId` field at all. That answer
must not win a targeted request — it's ignored (200, `ok:false`), the
long-poll keeps waiting, and a subsequent correctly-targeted answer delivers.

```ts
const ctx = await makeTestServer();
const gotId = new Promise((resolve) => {
  ctx.eventBus.subscribe({ listener: (e) => {
    if (e.event === "chat-last-audio-request") resolve(e.data.requestId);
  }});
});
const longPoll = ctx.rawRequest({
  method: "POST",
  url: "/api/chat/last-audio/request",
  payload: { timeoutMs: 5000, messageId: "msg-real" },
});
const requestId = await gotId;
function multipartUpload(boundary: string, fields: Record<string, string>): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (name === "file") continue;
    parts.push(`--${boundary}`, `Content-Disposition: form-data; name="${name}"`, "", value);
  }
  parts.push(
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="last-message.wav"',
    "Content-Type: audio/wav",
    "",
    fields.file,
    `--${boundary}--`,
    ""
  );
  return parts.join("\r\n");
}
const staleBoundary = "----cbteststale";
const staleAnswer = await ctx.request({
  method: "POST",
  url: `/api/chat/last-audio/${requestId}`,
  payload: multipartUpload(staleBoundary, {
    recordedAt: "2026-06-11T12:00:00Z",
    text: "no identity here",
    file: "STALEWAVBYTES",
  }),
  headers: { "content-type": `multipart/form-data; boundary=${staleBoundary}` },
});
print(`stale answer: ${JSON.stringify(staleAnswer.body)}`);
const rightBoundary = "----cbtestright";
const rightAnswer = await ctx.request({
  method: "POST",
  url: `/api/chat/last-audio/${requestId}`,
  payload: multipartUpload(rightBoundary, {
    recordedAt: "2026-06-11T12:05:00Z",
    text: "the real message",
    messageId: "msg-real",
    sessionId: "sess-real",
    file: "REALWAVBYTES",
  }),
  headers: { "content-type": `multipart/form-data; boundary=${rightBoundary}` },
});
print(`right answer: ${JSON.stringify(rightAnswer.body)}`);
const res = await longPoll;
print(`status: ${res.statusCode}`);
print(`message-id: ${decodeURIComponent(res.headers["x-message-id"])}`);
print(`audio: ${res.payload}`);
=>
stale answer: {"ok":false,"ignored":true,"message":"messageId did not match the pending request's target"}
right answer: {"ok":true}
status: 200
message-id: msg-real
audio: REALWAVBYTES
```

```ts cleanup
await ctx.cleanup();
```

## Route: an answer with a mismatched messageId is ignored, not delivered

```ts
const ctx = await makeTestServer();
const gotId = new Promise((resolve) => {
  ctx.eventBus.subscribe({ listener: (e) => {
    if (e.event === "chat-last-audio-request") resolve(e.data.requestId);
  }});
});
const longPoll = ctx.rawRequest({
  method: "POST",
  url: "/api/chat/last-audio/request",
  payload: { timeoutMs: 100, messageId: "msg-wanted" },
});
const requestId = await gotId;
const boundary = "----cbtestmismatch";
const upload = [
  `--${boundary}`,
  'Content-Disposition: form-data; name="messageId"',
  "",
  "msg-someone-elses",
  `--${boundary}`,
  'Content-Disposition: form-data; name="file"; filename="last-message.wav"',
  "Content-Type: audio/wav",
  "",
  "WRONGWAVBYTES",
  `--${boundary}--`,
  "",
].join("\r\n");
const answer = await ctx.request({
  method: "POST",
  url: `/api/chat/last-audio/${requestId}`,
  payload: upload,
  headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
});
print(`answer: ${JSON.stringify(answer.body)}`);
const res = await longPoll;
print(`status: ${res.statusCode}`);
print(`error: ${JSON.parse(res.payload).error}`);
=>
answer: {"ok":false,"ignored":true,"message":"messageId did not match the pending request's target"}
status: 504
error: no-client
```

```ts cleanup
await ctx.cleanup();
```

## Route: a targeted request where the tab answers none resolves not-available

A tab that doesn't hold the requested recording answers `{none:true}` — the
request resolves the same "not available" outcome as no tab answering at all,
never wrong audio.

```ts
const ctx = await makeTestServer();
const gotId = new Promise((resolve) => {
  ctx.eventBus.subscribe({ listener: (e) => {
    if (e.event === "chat-last-audio-request") resolve(e.data.requestId);
  }});
});
const longPoll = ctx.rawRequest({
  method: "POST",
  url: "/api/chat/last-audio/request",
  payload: { timeoutMs: 5000, messageId: "msg-not-held" },
});
const requestId = await gotId;
const answer = await ctx.request({
  method: "POST",
  url: `/api/chat/last-audio/${requestId}`,
  payload: { none: true },
});
print(`answer: ${JSON.stringify(answer.body)}`);
const res = await longPoll;
print(`status: ${res.statusCode}`);
print(`error: ${JSON.parse(res.payload).error}`);
=>
answer: {"ok":true}
status: 404
error: no-audio
```

```ts cleanup
await ctx.cleanup();
```

## CLI: the required `--message` error is agent-legible

`retranscribe`/`ask-about-audio`/`get-last-audio` all require `--message <id>`
(unless `--file` supplies the audio directly for the first two) — validated
before any HTTP request. The Commander actions call `process.exit`, which
would kill the test process, so this pins the extracted, unit-testable error
text instead of invoking the command.

```ts
print(missingMessageIdError("bbx chat get-last-audio"));
print(missingMessageIdError("bbx chat retranscribe"));
=>
bbx chat get-last-audio: requires --message <id> — read message-id="…" off the <speech> wrapper of the message you mean
bbx chat retranscribe: requires --message <id> — read message-id="…" off the <speech> wrapper of the message you mean
```

## ask-about-audio helpers

Audio questions use the model selected by the bakeoff for full-audio
understanding:

```ts
AUDIO_QUESTION_MODEL
=> gemini-3.7-flash
```

`audioMimeType` maps `--file` extensions to MIME types; unknown extensions
are rejected rather than guessed:

```ts
print(`wav: ${audioMimeType("/tmp/x/clip.WAV")}`);
print(`m4a: ${audioMimeType("voice.m4a")}`);
print(`mp3: ${audioMimeType("song.mp3")}`);
print(`unknown: ${audioMimeType("notes.txt")}`);
=>
wav: audio/wav
m4a: audio/mp4
mp3: audio/mpeg
unknown: null
```

The model prompt wraps the caller's question with framing that keeps the
answer addressed to the asker, not the recording's speaker. Context and a
known transcript are optional labeled sections:

```ts
const bare = buildAudioQuestionPrompt({ question: "What language is spoken?" });
print(`has question: ${bare.includes("Question: What language is spoken?")}`);
print(`frames the audio: ${bare.includes("voice message")}`);
print(`no transcript section: ${!bare.includes("automated transcription")}`);
=>
has question: true
frames the audio: true
no transcript section: true
```

```ts continue
const full = buildAudioQuestionPrompt({
  question: "Did the transcript get the Spanish right?",
  context: "The user is practicing Spanish for a trip.",
  transcript: "No. No.",
});
print(`has context: ${full.includes("practicing Spanish for a trip")}`);
print(`transcript framed as fallible: ${full.includes("trust the audio over the transcript")}`);
print(`question last: ${full.trimEnd().endsWith("Did the transcript get the Spanish right?")}`);
=>
has context: true
transcript framed as fallible: true
question last: true
```
