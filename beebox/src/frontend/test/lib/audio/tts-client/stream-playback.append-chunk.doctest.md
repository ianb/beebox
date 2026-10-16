# A chunk the browser cannot decode fails the segment

`appendChunk` (`src/lib/audio/tts-client/stream-playback.ts`) feeds one downloaded chunk
into the MediaSource `SourceBuffer` that streaming speech plays from. Per the
MSE spec, a chunk the browser cannot decode fires `error` and then
`updateend`. Waiting for `updateend` alone treated that as success, and the
clip hung or failed late. These use an `EventTarget` stand-in that fires the
spec's events in the spec's order.

```ts setup
import assert from "node:assert/strict";
import { appendChunk } from "../../../../src/lib/audio/tts-client/stream-playback.js";

/**
 * appendChunk uses only appendBuffer and the EventTarget methods, and a full
 * SourceBuffer (track lists, TimeRanges) cannot be built headless, so this
 * guard vouches for the stand-in after checking the one method it needs.
 */
function isSourceBuffer(target: EventTarget & { appendBuffer?: unknown }): target is SourceBuffer {
  return typeof target.appendBuffer === "function";
}

/** A SourceBuffer stand-in whose append fires `events`, in order, on the next tick. */
function fakeSourceBuffer(events: string[]): SourceBuffer {
  class FakeSourceBuffer extends EventTarget {
    appendBuffer() {
      setTimeout(() => { for (const name of events) this.dispatchEvent(new Event(name)); }, 0);
    }
  }
  const fake = new FakeSourceBuffer();
  assert.ok(isSourceBuffer(fake));
  return fake;
}
```

A decodable chunk resolves on `updateend`.

```ts
await appendChunk(fakeSourceBuffer(["update", "updateend"]), new Uint8Array([1, 2, 3])).then(() => "appended")
=> appended
```

An undecodable one rejects on `error`, even though `updateend` follows.

```ts
await appendChunk(fakeSourceBuffer(["error", "updateend"]), new Uint8Array([1, 2, 3]))
=> throws SourceBufferAppendError: Streaming speech audio could not be decoded (SourceBuffer error)
```

An append the browser aborts (the source was torn down) rejects too.

```ts
await appendChunk(fakeSourceBuffer(["abort", "updateend"]), new Uint8Array([1]))
=> throws SourceBufferAppendError: Streaming speech audio could not be decoded (SourceBuffer abort)
```
