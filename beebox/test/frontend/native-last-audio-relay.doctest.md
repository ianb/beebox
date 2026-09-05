# Relaying a last-audio request to the native shell

A box agent running `bbx chat retranscribe --message <id>` is answered by
whoever holds the recording. A message dictated in the **native** composer was
recorded natively and never entered the page, so a tab running inside a native
shell relays the request to the shell — which answers the box directly over
HTTP — as well as answering from its own store. Contract:
`docs/mobile-contract.md` §4.8.

```ts setup
import {
  createNativeLastAudioRequest,
  nativeLastAudioRequestFromDetail,
  postNativeLastAudioRequest,
} from "../../src/frontend/src/components/chat/native-last-audio-request.js";
import type { NativeShellWindow } from "../../src/frontend/src/components/chat/native-post.js";
```

The relay crosses on its own channel, through the same neutral transport as
every other web→native message:

```ts
const calls: Array<{ channel: string; payload: string }> = [];
const shell: NativeShellWindow = {
  beeboxNativePost: (channel, payload) => calls.push({ channel, payload }),
};
postNativeLastAudioRequest(shell, createNativeLastAudioRequest({
  requestId: "req-7f3c",
  messageId: "emission-9a21",
  sessionId: "session-42",
}));
JSON.stringify(calls)
=> [{"channel":"beeboxLastAudioRequest","payload":"{\"version\":1,\"requestId\":\"req-7f3c\",\"messageId\":\"emission-9a21\",\"sessionId\":\"session-42\"}"}]
```

A tab that has not been assigned a session yet relays `null` rather than
omitting the field — the shell prefers the session each recording was dictated
into anyway, and falls back to this one only when it has none:

```ts continue
calls.length = 0;
postNativeLastAudioRequest(shell, createNativeLastAudioRequest({
  requestId: "req-7f3c",
  messageId: "emission-9a21",
  sessionId: null,
}));
JSON.parse(calls[0].payload).sessionId
=> null
```

Parsing is strict on both ids. Neither is optional, and neither may be blank:
without `requestId` there is no URL to answer at, and without `messageId` the
answer cannot satisfy the server's echo-and-verify check — it would be
*ignored* rather than rejected, so a best-effort send would look exactly like a
phone that never replied.

```ts continue
JSON.stringify([
  nativeLastAudioRequestFromDetail({ version: 1, requestId: "r", messageId: "m", sessionId: null }),
  nativeLastAudioRequestFromDetail({ version: 1, requestId: "   ", messageId: "m", sessionId: null }),
  nativeLastAudioRequestFromDetail({ version: 1, requestId: "r", sessionId: null }),
  nativeLastAudioRequestFromDetail({ version: 2, requestId: "r", messageId: "m", sessionId: null }),
  nativeLastAudioRequestFromDetail({ version: 1, requestId: "r", messageId: "m", sessionId: 42 }),
  nativeLastAudioRequestFromDetail(null),
].map((parsed) => parsed === null ? null : `${parsed.requestId}/${parsed.messageId}`))
=> ["r/m",null,null,null,null,null]
```
