# ChunkedRecorder stop-await + timeslice

`ChunkedRecorder` wraps a `MediaRecorder`. Two Track-5 properties matter and are
testable headless with a minimal fake `MediaRecorder`: the timeslice is
caller-settable (capture mode passes ~5s), and `stopAsync()` resolves only
*after* the final `dataavailable` fired — so the tail chunk uploads before a stop
path (Done / cancel / mode exit) proceeds. A bare `stop()` would drop that tail.

```ts setup
// Minimal fake MediaRecorder: records the timeslice passed to start(), and emits
// a final `dataavailable` asynchronously on stop() (as the real API does).
class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  constructor(stream, opts) {
    this.stream = stream;
    this.opts = opts;
    this.state = "inactive";
    this.ondataavailable = null;
    this.timeslice = null;
    FakeMediaRecorder.last = this;
  }
  start(timeslice) {
    this.state = "recording";
    this.timeslice = timeslice;
  }
  stop() {
    this.state = "inactive";
    // The real MediaRecorder flushes a final dataavailable asynchronously.
    queueMicrotask(() => {
      this.ondataavailable?.({ data: { size: 4, type: "audio/webm" } });
    });
  }
}

globalThis.MediaRecorder = FakeMediaRecorder;
if (!globalThis.navigator) globalThis.navigator = {};
Object.defineProperty(globalThis.navigator, "mediaDevices", {
  configurable: true,
  writable: true,
  value: {
    getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
    enumerateDevices: async () => [],
  },
});

const { ChunkedRecorder } = await import("../../../src/frontend/src/lib/audio/recorder.js");
```

## The caller's timeslice is passed through to MediaRecorder.start()

```ts
const chunks = [];
const rec = new ChunkedRecorder({ onChunk: (c) => chunks.push(c), timesliceMs: 5000 });
await rec.start();
FakeMediaRecorder.last.timeslice
=> 5000
```

The default (no `timesliceMs`) is the recorder's 20s:

```ts continue
const rec2 = new ChunkedRecorder({ onChunk: () => {} });
await rec2.start();
FakeMediaRecorder.last.timeslice
=> 20000
```

## stopAsync() resolves only after the final dataavailable delivered its chunk

Before the stop the recorder is recording and no chunk has arrived; after
`await stopAsync()` the tail chunk has been delivered and recording is over.

```ts
const chunks = [];
const rec = new ChunkedRecorder({ onChunk: (c) => chunks.push(c), timesliceMs: 5000 });
await rec.start();
[rec.recording, chunks.length].join(",")
=> true,0

await rec.stopAsync();
[rec.recording, chunks.length].join(",")
=> false,1
```

## stopAsync() on an unstarted recorder resolves immediately (no hang)

```ts
const rec = new ChunkedRecorder({ onChunk: () => {} });
await rec.stopAsync();
rec.recording
=> false
```
