// # ChunkedRecorder stop-await + timeslice
//
// `ChunkedRecorder` wraps a `MediaRecorder`. Two Track-5 properties matter and are
// testable headless with a minimal fake `MediaRecorder`: the timeslice is
// caller-settable (capture mode passes ~5s), and `stopAsync()` resolves only
// *after* the final `dataavailable` fired — so the tail chunk uploads before a stop
// path (Done / cancel / mode exit) proceeds. A bare `stop()` would drop that tail.

import { test } from "tap";
import "agent-doctest/tap";

// Minimal fake MediaRecorder: records the timeslice passed to start(), and emits
// a final `dataavailable` asynchronously on stop() (as the real API does).
class FakeMediaRecorder {
  static last: FakeMediaRecorder | null = null;
  static isTypeSupported() { return true; }
  state = "inactive";
  ondataavailable: ((event: { data: { size: number; type: string } }) => void) | null = null;
  timeslice: number | null = null;
  constructor(public stream: MediaStream, public opts: MediaRecorderOptions) {
    FakeMediaRecorder.last = this;
  }
  start(timeslice: number) {
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

Object.defineProperty(globalThis, "MediaRecorder", { value: FakeMediaRecorder, configurable: true, writable: true });
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  writable: true,
  value: {
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      enumerateDevices: async () => [],
    },
  },
});

const { ChunkedRecorder } = await import("../../../src/lib/audio/recorder.js");

// ## The caller's timeslice is passed through to MediaRecorder.start()
void test("The caller's timeslice is passed through to MediaRecorder.start()", async (t) => {
  // doctest:L52
  const chunks = [];
  const rec = new ChunkedRecorder({ onChunk: (c) => chunks.push(c), timesliceMs: 5000 });
  await rec.start();
  t.check(FakeMediaRecorder.last?.timeslice, 5000);
});

// ## stopAsync() resolves only after the final dataavailable delivered its chunk
//
// Before the stop the recorder is recording and no chunk has arrived; after
// `await stopAsync()` the tail chunk has been delivered and recording is over.
void test("Before the stop the recorder is recording and no chunk has arrived; after awa...", async (t) => {
  // doctest:L65
  const chunks = [];
  const rec = new ChunkedRecorder({ onChunk: (c) => chunks.push(c), timesliceMs: 5000 });
  await rec.start();
  t.check([rec.recording, chunks.length].join(","), "true,0");

  // doctest:L71
  await rec.stopAsync();
  t.check([rec.recording, chunks.length].join(","), "false,1");
});

// ## stopAsync() on an unstarted recorder resolves immediately (no hang)
void test("stopAsync() on an unstarted recorder resolves immediately (no hang)", async (t) => {
  // doctest:L79
  const rec = new ChunkedRecorder({ onChunk: () => {} });
  await rec.stopAsync();
  t.check(rec.recording, false);
});
