# Native narration state

The embedded chat tells the native composer whether the current session has
narration mode enabled. The native side defaults to off; this message only
changes which transcript is used after a voice keyword send.

```ts setup
import { postNativeNarrationState } from "../../src/frontend/src/components/chat/use-native-bridge.js";
import type { NativeShellWindow } from "../../src/frontend/src/components/chat/native-post.js";
```

The neutral bridge receives the current state as a JSON payload:

```ts
const calls: Array<{ channel: string; payload: string }> = [];
const shell: NativeShellWindow = {
  callbackboxNativePost: (channel, payload) => calls.push({ channel, payload }),
};
postNativeNarrationState(false, shell);
postNativeNarrationState(true, shell);
JSON.stringify(calls)
=> [{"channel":"callbackboxNarrationState","payload":"{\"enabled\":false}"},{"channel":"callbackboxNarrationState","payload":"{\"enabled\":true}"}]
```
