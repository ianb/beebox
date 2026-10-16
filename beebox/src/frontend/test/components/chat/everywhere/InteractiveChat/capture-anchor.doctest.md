# Capture anchor: what the chat list puts at the top after Done in capture

Done in capture should anchor like a typed send. The capture's message
arrives from the box seconds after Done, so the list waits: it anchors the
new capture bubble when that appears, then the capture message when it
arrives. "New" means "not in the list at Done".

```ts setup
import { startCaptureWait, stepCaptureWait } from "../../../../../src/components/chat/everywhere/InteractiveChat/capture-anchor.js";
```

The bubble appears first and is anchored once; the message arrives later,
is anchored, and ends the wait:

```ts
let wait = startCaptureWait({ newestUser: "u-typed", bubbleIds: [] });
let r = stepCaptureWait(wait, { newestUser: "u-typed", bubbleIds: [] });
r.step
=> { anchor: 'none' }

r = stepCaptureWait(r.wait!, { newestUser: "u-typed", bubbleIds: ["cap-1"] });
r.step
=> { anchor: 'bubble', index: 0 }

r = stepCaptureWait(r.wait!, { newestUser: "u-typed", bubbleIds: ["cap-1"] });
r.step
=> { anchor: 'none' }

r = stepCaptureWait(r.wait!, { newestUser: "u-capture", bubbleIds: [] });
[r.step, r.wait]
=> [ { anchor: 'user' }, null ]
```

A bubble already on screen from an earlier capture is not this capture's;
the new one is found by id at its own index:

```ts
const wait = startCaptureWait({ newestUser: "u-1", bubbleIds: ["cap-old"] });
stepCaptureWait(wait, { newestUser: "u-1", bubbleIds: ["cap-old", "cap-new"] }).step
=> { anchor: 'bubble', index: 1 }
```

Loading older history adds user messages above the newest one. The newest
is unchanged, so nothing is anchored and the wait goes on:

```ts
const wait = startCaptureWait({ newestUser: "u-5", bubbleIds: [] });
const r = stepCaptureWait(wait, { newestUser: "u-5", bubbleIds: [] });
[r.step, r.wait === wait]
=> [ { anchor: 'none' }, true ]
```

A chat with no user message yet still recognizes the first one:

```ts
const wait = startCaptureWait({ newestUser: null, bubbleIds: [] });
stepCaptureWait(wait, { newestUser: "u-capture", bubbleIds: [] }).step
=> { anchor: 'user' }
```
