// # A chunk the browser cannot decode fails the segment
//
// `appendChunk` (`src/lib/audio/tts-client/stream-playback.ts`) feeds one downloaded chunk
// into the MediaSource `SourceBuffer` that streaming speech plays from. Per the
// MSE spec, a chunk the browser cannot decode fires `error` and then
// `updateend`. Waiting for `updateend` alone treated that as success, and the
// clip hung or failed late. These use an `EventTarget` stand-in that fires the
// spec's events in the spec's order.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { appendChunk, type ChunkSink } from "../../../../src/lib/audio/tts-client/stream-playback.js";

/** A SourceBuffer stand-in whose append fires `events`, in order, on the next tick. */
function fakeSourceBuffer(events: string[]): ChunkSink {
  class FakeSourceBuffer extends EventTarget {
    appendBuffer() {
      setTimeout(() => { for (const name of events) this.dispatchEvent(new Event(name)); }, 0);
    }
  }
  return new FakeSourceBuffer();
}

// A decodable chunk resolves on `updateend`.
void test("A decodable chunk resolves on updateend.", async (t) => {
  t.check(await appendChunk(fakeSourceBuffer(["update", "updateend"]), new Uint8Array([1, 2, 3])).then(() => "appended"), "appended");
});

// An undecodable one rejects on `error`, even though `updateend` follows.
void test("An undecodable one rejects on error, even though updateend follows.", async (t) => {
  await t.checkThrows(async () => (await appendChunk(fakeSourceBuffer(["error", "updateend"]), new Uint8Array([1, 2, 3]))), "SourceBufferAppendError: Streaming speech audio could not be decoded (SourceBuffer error)");
});

// An append the browser aborts (the source was torn down) rejects too.
void test("An append the browser aborts (the source was torn down) rejects too.", async (t) => {
  await t.checkThrows(async () => (await appendChunk(fakeSourceBuffer(["abort", "updateend"]), new Uint8Array([1]))), "SourceBufferAppendError: Streaming speech audio could not be decoded (SourceBuffer abort)");
});
