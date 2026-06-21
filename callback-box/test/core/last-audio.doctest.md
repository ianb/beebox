# Last-audio loopback

Tests for `cb chat get-last-audio`'s server side: the pending-request
registry (`createLastAudioPending`) and the two HTTP routes that connect a
CLI long-poll to the browser tab holding the recording.

```ts setup
import { createLastAudioPending } from "../../src/core/last-audio-pending.js";
import { buildAudioQuestionPrompt } from "../../src/core/audio-question.js";
import { audioMimeType } from "../../src/cli/commands/chat-audio.js";
import { makeTestServer } from "../helpers/doctest-server.js";
```

## Registry: an audio answer resolves the request

```ts
const reg = createLastAudioPending();
const { requestId, outcome } = reg.create({ timeoutMs: 5000 });
reg.fulfill(requestId, {
  audio: Buffer.from("RIFFfake"),
  contentType: "audio/wav",
  recordedAt: "2026-06-11T12:00:00Z",
  text: "hello there",
});
const result = await outcome;
print(`status: ${result.status}`);
print(`audio: ${result.fulfillment.audio.toString()}`);
print(`recordedAt: ${result.fulfillment.recordedAt}`);
print(`pending left: ${reg.size()}`);
=>
status: audio
audio: RIFFfake
recordedAt: 2026-06-11T12:00:00Z
pending left: 0
```

## Registry: no answer at all times out

```ts
const reg = createLastAudioPending();
const { outcome } = reg.create({ timeoutMs: 20 });
const result = await outcome;
result.status
=> timeout
```

## Registry: a "none" answer resolves after the grace window

A tab reporting "no audio cached" doesn't settle immediately — another tab
might still hold the recording — but once the grace window passes with no
audio, the request resolves `none`.

```ts
const reg = createLastAudioPending({ graceMs: 20 });
const { requestId, outcome } = reg.create({ timeoutMs: 5000 });
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
const { requestId, outcome } = reg.create({ timeoutMs: 5000 });
reg.reportNone(requestId);
reg.fulfill(requestId, { audio: Buffer.from("x"), contentType: "audio/wav", recordedAt: null, text: null });
const result = await outcome;
result.status
=> audio
```

## Registry: unknown and already-settled ids are refused

```ts
const reg = createLastAudioPending();
print(`unknown fulfill: ${reg.fulfill("nope", { audio: Buffer.from("x"), contentType: "audio/wav", recordedAt: null, text: null })}`);
print(`unknown none: ${reg.reportNone("nope")}`);
const { requestId, outcome } = reg.create({ timeoutMs: 5000 });
print(`first: ${reg.fulfill(requestId, { audio: Buffer.from("a"), contentType: "audio/wav", recordedAt: null, text: null })}`);
print(`second: ${reg.fulfill(requestId, { audio: Buffer.from("b"), contentType: "audio/wav", recordedAt: null, text: null })}`);
const result = await outcome;
print(`winner: ${result.fulfillment.audio.toString()}`);
=>
unknown fulfill: false
unknown none: false
first: true
second: false
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
  payload: { timeoutMs: 1 },
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

## Route: full loop — long-poll answered by a multipart upload

The caller-supplied `requestId` stands in for the bus broadcast (the test
has no browser subscribed to the event stream). The long-poll is started,
the "browser" answers with audio + metadata fields, and the long-poll
response carries the bytes and the metadata headers.

```ts
const ctx = await makeTestServer();
const longPoll = ctx.rawRequest({
  method: "POST",
  url: "/api/chat/last-audio/request",
  payload: { timeoutMs: 5000, requestId: "test-req-1" },
});
// Let the long-poll register its pending entry before answering.
await new Promise((resolve) => setTimeout(resolve, 50));
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
  'Content-Disposition: form-data; name="file"; filename="last-message.wav"',
  "Content-Type: audio/wav",
  "",
  "RIFFfakewavbytes",
  `--${boundary}--`,
  "",
].join("\r\n");
const answer = await ctx.request({
  method: "POST",
  url: "/api/chat/last-audio/test-req-1",
  payload: upload,
  headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
});
print(`answer ok: ${JSON.stringify(answer.body)}`);
const res = await longPoll;
print(`status: ${res.statusCode}`);
print(`content-type: ${res.headers["content-type"]}`);
print(`recorded-at: ${res.headers["x-recorded-at"]}`);
print(`text: ${decodeURIComponent(res.headers["x-message-text"])}`);
print(`audio: ${res.payload}`);
=>
answer ok: {"ok":true}
status: 200
content-type: audio/wav
recorded-at: 2026-06-11T12:00:00Z
text: remember to water the plants
audio: RIFFfakewavbytes
```

```ts cleanup
await ctx.cleanup();
```

## ask-about-audio helpers

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
