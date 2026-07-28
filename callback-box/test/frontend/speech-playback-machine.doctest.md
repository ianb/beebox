# Speech playback progress

The speech playback machine exposes what each visible speech segment is doing.
Queued audio starts in `waiting`, changes to `playing` only when the media
element actually begins playback, and disappears from the progress map after a
successful finish. A failed segment stays `failed` while the queue advances so
the UI does not make a rapid series of playback failures look successful.

```ts setup
import { createActor } from "xstate";
import { speechPlaybackMachine } from "../../src/frontend/src/machines/speechPlaybackMachine.js";

Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "iPhone" },
  configurable: true,
});

function segment(text) {
  return { text, displayText: text, hasTextBefore: false };
}

async function waitUntilIdle(actor) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (actor.getSnapshot().matches("idle")) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("speech playback did not return to idle");
}
```

## A media failure remains visible

The middle segment rejects from the real machine's `ttsClient.speak` boundary.
Playback continues through the third segment, but index 1 remains failed after
the queue finishes.

```ts
const ttsClient = {
  async speak(text, options) {
    options.onPlaybackStarted();
    if (text === "broken") throw new Error("media playback rejected");
  },
  prefetch() {
    throw new Error("prefetch is disabled for the iPhone test user agent");
  },
  stop() {},
};
const playbackErrors = [];
const originalConsoleError = console.error;
console.error = (...args) => playbackErrors.push(args);
const actor = createActor(speechPlaybackMachine, { input: {} });
actor.start();
actor.send({
  type: "PLAY",
  messageId: "message-1",
  segments: [segment("first"), segment("broken"), segment("third")],
  baseIndex: 0,
  ttsClient,
});
await waitUntilIdle(actor);
console.error = originalConsoleError;
JSON.stringify(actor.getSnapshot().context.segmentStates)
=> {"1":"failed"}

playbackErrors.length
=> 1
```

## Waiting is distinct from actual playback

Generation can take time. The border must stay in `waiting` until the media
element's playback callback fires, then change to `playing`.

```ts
let playbackStarted;
let finishPlayback;
const ttsClient = {
  speak(_text, options) {
    playbackStarted = options.onPlaybackStarted;
    return new Promise((resolve) => {
      finishPlayback = resolve;
    });
  },
  prefetch() {
    throw new Error("prefetch is disabled for the iPhone test user agent");
  },
  stop() {},
};
const actor = createActor(speechPlaybackMachine, { input: {} });
actor.start();
actor.send({
  type: "PLAY",
  messageId: "message-2",
  segments: [segment("slow generation")],
  baseIndex: 0,
  ttsClient,
});
await Promise.resolve();
actor.getSnapshot().context.segmentStates[0]
=> waiting

playbackStarted();
actor.getSnapshot().context.segmentStates[0]
=> playing

finishPlayback();
await waitUntilIdle(actor);
JSON.stringify(actor.getSnapshot().context.segmentStates)
=> {}
```
