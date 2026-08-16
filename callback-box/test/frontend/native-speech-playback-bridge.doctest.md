# Native speech playback state

The embedded chat tells the native composer when synthesized speech starts and
stops. Native uses this to pause continuous dictation before playback and resume
it after the final queued segment.

```ts setup
import {
  postNativeResponseState,
  postNativeSpeechPlaybackState,
} from "../../src/frontend/src/components/chat/use-native-bridge.js";
import type { NativeShellWindow } from "../../src/frontend/src/components/chat/native-post.js";
```

The neutral bridge receives both playback edges as JSON payloads:

```ts
const calls: Array<{ channel: string; payload: string }> = [];
const shell: NativeShellWindow = {
  callbackboxNativePost: (channel, payload) => calls.push({ channel, payload }),
};
postNativeSpeechPlaybackState(true, shell);
postNativeSpeechPlaybackState(false, shell);
JSON.stringify(calls)
=> [{"channel":"callbackboxSpeechPlaybackState","payload":"{\"playing\":true}"},{"channel":"callbackboxSpeechPlaybackState","payload":"{\"playing\":false}"}]
```

The response-generation edge uses a separate semantic state so native waiting
ticks stop at the same streaming-to-refreshing boundary as web chat:

```ts
const responseCalls: Array<{ channel: string; payload: string }> = [];
const responseShell: NativeShellWindow = {
  callbackboxNativePost: (channel, payload) => responseCalls.push({ channel, payload }),
};
postNativeResponseState(true, responseShell);
postNativeResponseState(false, responseShell);
JSON.stringify(responseCalls)
=> [{"channel":"callbackboxResponseState","payload":"{\"active\":true}"},{"channel":"callbackboxResponseState","payload":"{\"active\":false}"}]
```
