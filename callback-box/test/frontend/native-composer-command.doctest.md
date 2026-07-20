# Native composer selection commands

The web sends a strict, versioned selection intent through the neutral native
transport and strictly parses the native durability acknowledgement.

```ts setup
import {
  createNativeAddSelectionCommand,
  nativeComposerCommandAcknowledgementFromDetail,
  postNativeComposerCommand,
} from "../../src/frontend/src/components/chat/native-composer-command.js";
import type { NativeShellWindow } from "../../src/frontend/src/components/chat/native-post.js";
```

```ts
const calls: Array<{ channel: string; payload: string }> = [];
const shell: NativeShellWindow = {
  callbackboxNativePost: (channel, payload) => calls.push({ channel, payload }),
};
postNativeComposerCommand(shell, createNativeAddSelectionCommand("command-1", {
  ref: "/notes/plan.md",
  text: "Ship the native path",
  position: "body; paragraph 2",
}));
calls
=> [
  {
    "channel": "callbackboxComposerCommand",
    "payload": "{\"version\":1,\"id\":\"command-1\",\"kind\":\"add-selection\",\"selection\":{\"ref\":\"/notes/plan.md\",\"text\":\"Ship the native path\",\"position\":\"body; paragraph 2\"}}"
  }
]
```

```ts
nativeComposerCommandAcknowledgementFromDetail({ version: 1, id: "command-1", accepted: true })
=> {
  "version": 1,
  "id": "command-1",
  "accepted": true
}
```

```ts
nativeComposerCommandAcknowledgementFromDetail({ version: 1, id: "command-1", accepted: false })
=> null
```
