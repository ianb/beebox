# Native narration state

The embedded chat tells the native composer whether the current session has
narration mode enabled. The native side defaults to off; this message only
changes which transcript is used after a voice keyword send.

```ts setup
import { postNativeHqDictationState, postNativeNarrationState } from "../../../../src/components/chat/everywhere/InteractiveChat/use-native-bridge.js";
import type { NativeShellWindow } from "../../../../src/components/chat/native-post.js";
```

The HQ state channel carries `diarized`: the box's HQ service labels
speakers, which keeps native's HQ pass on the box instead of on the device.
`enabled` is always true — every dictated message gets the HQ pass
(docs/plans/hq-always.md) — and is still sent for native builds that read it:

```ts
const calls: Array<{ channel: string; payload: string }> = [];
const shell: NativeShellWindow = {
  beeboxNativePost: (channel, payload) => calls.push({ channel, payload }),
};
postNativeHqDictationState({ diarized: false }, shell);
postNativeHqDictationState({ diarized: true }, shell);
JSON.stringify(calls)
=> [{"channel":"beeboxHqDictationState","payload":"{\"enabled\":true,\"diarized\":false}"},{"channel":"beeboxHqDictationState","payload":"{\"enabled\":true,\"diarized\":true}"}]
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
