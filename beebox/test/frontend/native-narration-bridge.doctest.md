# Native narration state

The embedded chat tells the native composer whether the current session has
narration mode enabled. The native side defaults to off; this message only
changes which transcript is used after a voice keyword send.

```ts setup
import { postNativeHqDictationState, postNativeNarrationState } from "../../src/frontend/src/components/chat/use-native-bridge.js";
import type { NativeShellWindow } from "../../src/frontend/src/components/chat/native-post.js";
```

HQ dictation uses its own state channel so native can distinguish persistent
HQ from narration mode:

```ts
const calls: Array<{ channel: string; payload: string }> = [];
const shell: NativeShellWindow = {
  beeboxNativePost: (channel, payload) => calls.push({ channel, payload }),
};
postNativeHqDictationState(false, shell);
postNativeHqDictationState(true, shell);
JSON.stringify(calls)
=> [{"channel":"beeboxHqDictationState","payload":"{\"enabled\":false}"},{"channel":"beeboxHqDictationState","payload":"{\"enabled\":true}"}]
```

The neutral bridge receives the current state as a JSON payload:

```ts
const calls: Array<{ channel: string; payload: string }> = [];
const shell: NativeShellWindow = {
  beeboxNativePost: (channel, payload) => calls.push({ channel, payload }),
};
postNativeNarrationState(false, shell);
postNativeNarrationState(true, shell);
JSON.stringify(calls)
=> [{"channel":"beeboxNarrationState","payload":"{\"enabled\":false}"},{"channel":"beeboxNarrationState","payload":"{\"enabled\":true}"}]
```
