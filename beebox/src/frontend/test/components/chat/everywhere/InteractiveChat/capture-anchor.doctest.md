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
let wait = startCaptureWait({ newestCapture: "u-earlier-capture", bubbleIds: [] });
let r = stepCaptureWait(wait, { newestCapture: "u-earlier-capture", bubbleIds: [], scrollTop: 0 });
r.step
=> { anchor: 'none' }

r = stepCaptureWait(r.wait!, { newestCapture: "u-earlier-capture", bubbleIds: ["cap-1"], scrollTop: 0 });
r.step
=> { anchor: 'bubble', index: 0 }

r = stepCaptureWait(r.wait!, { newestCapture: "u-earlier-capture", bubbleIds: ["cap-1"], scrollTop: 0 });
r.step
=> { anchor: 'none' }

r = stepCaptureWait(r.wait!, { newestCapture: "u-capture", bubbleIds: [], scrollTop: 0 });
[r.step, r.wait]
=> [ { anchor: 'user' }, null ]
```

A bubble already on screen from an earlier capture is not this capture's;
the new one is found by id at its own index:

```ts
const wait = startCaptureWait({ newestCapture: "u-1", bubbleIds: ["cap-old"] });
stepCaptureWait(wait, { newestCapture: "u-1", bubbleIds: ["cap-old", "cap-new"], scrollTop: 0 }).step
=> { anchor: 'bubble', index: 1 }
```

Loading older history adds messages above the newest capture message. The
newest is unchanged, so nothing is anchored and the wait goes on. The same
holds for a typed message from another tab: it is not a capture message, so
the newest capture message is unchanged:

```ts
const wait = startCaptureWait({ newestCapture: "u-5", bubbleIds: [] });
const r = stepCaptureWait(wait, { newestCapture: "u-5", bubbleIds: [], scrollTop: 0 });
[r.step, r.wait === wait]
=> [ { anchor: 'none' }, true ]
```

A chat with no user message yet still recognizes the first one:

```ts
const wait = startCaptureWait({ newestCapture: null, bubbleIds: [] });
stepCaptureWait(wait, { newestCapture: "u-capture", bubbleIds: [], scrollTop: 0 }).step
=> { anchor: 'user' }
```

A reader who scrolled up more than 160px from where the bubble anchor put
them stays where they are when the message arrives, and the wait ends. A
smaller drift, such as the content shrinking when the bubble leaves, still
anchors:

```ts setup
import { noteBubbleScrollTop } from "../../../../../src/components/chat/everywhere/InteractiveChat/capture-anchor.js";
```

```ts
const anchored = () => {
  const r = stepCaptureWait(startCaptureWait({ newestCapture: null, bubbleIds: [] }), { newestCapture: null, bubbleIds: ["cap-1"], scrollTop: 0 });
  return noteBubbleScrollTop(r.wait!, 2000);
};
const scrolledUp = stepCaptureWait(anchored(), { newestCapture: "u-capture", bubbleIds: [], scrollTop: 1700 });
const drifted = stepCaptureWait(anchored(), { newestCapture: "u-capture", bubbleIds: [], scrollTop: 1890 });
[scrolledUp.step, scrolledUp.wait, drifted.step]
=> [ { anchor: 'none' }, null, { anchor: 'user' } ]
```
