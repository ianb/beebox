// # One voice recording's staging: batching, seal, discard
//
// `lib/audio/voice-stager.ts` stages a recording from its first PCM frame
// (`docs/plans/resilient-voice-recording.md`, Track 3). `VoiceStager` batches the
// worklet's 300 ms frames (16 kHz mono s16le, 9,600 bytes each) into 15 s
// `chunk` ops of exactly 480,000 bytes. `startStagedRecording` wraps it with the
// recording's queue lifecycle: `create` at start, then exactly one `finalize`
// (through `seal`) or `discard`. These examples inject a sink that records every
// op instead of the real IndexedDB-backed queue.

import { test } from "tap";
import "agent-doctest/tap";
import {
  VoiceStager,
  startStagedRecording,
} from "../../../src/lib/audio/voice-stager.js";
import type { VoiceStagingSink } from "../../../src/lib/audio/voice-stager.js";

const FRAME_BYTES = 9_600; // one 300 ms worklet frame

/** A 300 ms frame whose every byte is `fill`, so chunk contents can be checked. */
function frame(fill: number): ArrayBuffer {
  return new Uint8Array(FRAME_BYTES).fill(fill).buffer;
}

function recordingSink() {
  const ops: string[] = [];
  const chunks: Uint8Array[] = [];
  const sink: VoiceStagingSink = {
    enqueueCreate: (id, opts) =>
      ops.push(`create ${id} target=${String(opts.targetSessionId)}`),
    enqueueChunk: (id, bytes) => {
      chunks.push(new Uint8Array(bytes));
      ops.push(`chunk ${id} ${String(bytes.byteLength)}`);
    },
    enqueueFinalize: (id, opts) =>
      ops.push(`finalize ${id} emission=${String(opts.emissionId)} hq=${opts.hq === null ? "null" : opts.hq.emissionId}`),
    enqueueDiscard: (id) => ops.push(`discard ${id}`),
  };
  return { sink, ops, chunks };
}

// ## Fifty 300 ms frames fill exactly one 15 s chunk
void test("Fifty 300 ms frames fill exactly one 15 s chunk", async (t) => {
  const emitted: number[] = [];
  const stager = new VoiceStager({ emit: (bytes) => emitted.push(bytes.byteLength) });
  for (let i = 0; i < 49; i++) stager.push(frame(1));
  t.check(emitted, []);

  stager.push(frame(1));
  t.check(emitted, [480000]);
});

// ## `flush` emits the partial batch once
//
// Seventy-five frames are one full chunk plus 7.5 s left over; `flush` sends the
// remainder, and a second `flush` has nothing left to send.
void test("Seventy-five frames are one full chunk plus 7.5 s left over; flush sends the...", async (t) => {
  const sizes: number[] = [];
  const stager = new VoiceStager({ emit: (bytes) => sizes.push(bytes.byteLength) });
  for (let i = 0; i < 75; i++) stager.push(frame(2));
  stager.flush();
  stager.flush();
  t.check(sizes, [480000, 240000]);

  t.check(stager.bytesSeen(), 720000);
});

// ## Bytes are exact across a frame that straddles a batch boundary
//
// Frames of an odd size split across chunks: the concatenated chunks equal the
// concatenated frames, byte for byte, in order.
void test("Frames of an odd size split across chunks:", async (t) => {
  const out: Uint8Array[] = [];
  const stager = new VoiceStager({ emit: (bytes) => out.push(new Uint8Array(bytes)) });
  const input: Uint8Array[] = [];
  for (let i = 0; i < 70; i++) {
    const f = new Uint8Array(7_001).fill(i % 251);
    input.push(f);
    stager.push(f.buffer);
  }
  stager.flush();
  t.check(out.map((c) => c.byteLength), [480000, 10070]);

  const joined = (parts: Uint8Array[]) => {
    const all = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.byteLength; }
    return all;
  };
  t.check(Array.from(joined(out)), Array.from(joined(input)));
});

// ## A recording enqueues create, its chunks, then one finalize
//
// `seal` flushes the partial batch before `finalize`, so the queue's own chunk
// count (which `enqueueFinalize` snapshots) covers every byte. A second `seal`
// is a no-op.
void test("seal flushes the partial batch before finalize, so the queue's own chunk coun...", async (t) => {
  const { sink, ops, chunks } = recordingSink();
  const rec = startStagedRecording({ recordingId: "r1", targetSessionId: null, sink });
  for (let i = 0; i < 51; i++) rec.push(frame(3));
  t.check(rec.hasAudio(), true);

  rec.seal({ emissionId: "e1", hq: { emissionId: "e1", sessionId: "s1" } });
  rec.seal({ emissionId: null, hq: null });
  t.check(ops, ["create r1 target=null", "chunk r1 480000", "chunk r1 9600", "finalize r1 emission=e1 hq=e1"]);

  t.check(chunks.map((c) => [c.byteLength, [...new Set(c)]]), [[480000, [3]], [9600, [3]]]);

  // Frames that arrive after the seal (a late worklet message) are not part of the
  // recording, and a `discard` after a `seal` changes nothing:

  rec.push(frame(3));
  rec.discard();
  t.check(ops, ["create r1 target=null", "chunk r1 480000", "chunk r1 9600", "finalize r1 emission=e1 hq=e1"]);
});

// ## Discard is terminal too
void test("Discard is terminal too", async (t) => {
  const { sink, ops } = recordingSink();
  const rec = startStagedRecording({ recordingId: "r2", targetSessionId: "chat-1", sink });
  t.check(rec.hasAudio(), false);

  rec.discard();
  rec.discard();
  rec.seal({ emissionId: null, hq: null });
  t.check(ops, ["create r2 target=chat-1", "discard r2"]);
});
