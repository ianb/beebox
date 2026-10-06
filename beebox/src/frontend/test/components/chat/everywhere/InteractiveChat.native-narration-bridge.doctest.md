# Native narration state

The embedded chat tells the native composer whether the current session has
narration mode enabled. The native side defaults to off; this message only
changes which transcript is used after a voice keyword send.

```ts setup
import { postNativeHqDictationState, postNativeNarrationState } from "../../../../src/components/chat/everywhere/InteractiveChat/use-native-bridge.js";
import type { NativeShellWindow } from "../../../../src/components/chat/native-post.js";
```

HQ dictation uses its own state channel so native can distinguish persistent
HQ from narration mode. `diarized` says the box's HQ service labels speakers,
which keeps native's HQ pass on the box instead of on the device:

```ts
const calls: Array<{ channel: string; payload: string }> = [];
const shell: NativeShellWindow = {
  beeboxNativePost: (channel, payload) => calls.push({ channel, payload }),
};
postNativeHqDictationState({ enabled: false, diarized: false }, shell);
postNativeHqDictationState({ enabled: true, diarized: true }, shell);
JSON.stringify(calls)
=> [{"channel":"beeboxHqDictationState","payload":"{\"enabled\":false,\"diarized\":false}"},{"channel":"beeboxHqDictationState","payload":"{\"enabled\":true,\"diarized\":true}"}]
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
