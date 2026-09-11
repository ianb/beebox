# One voice recording's staging: batching, seal, discard

`lib/audio/voice-stager.ts` stages a recording from its first PCM frame
(`docs/plans/resilient-voice-recording.md`, Track 3). `VoiceStager` batches the
worklet's 300 ms frames (16 kHz mono s16le, 9,600 bytes each) into 15 s
`chunk` ops of exactly 480,000 bytes. `startStagedRecording` wraps it with the
recording's queue lifecycle: `create` at start, then exactly one `finalize`
(through `seal`) or `discard`. These examples inject a sink that records every
op instead of the real IndexedDB-backed queue.

```ts setup
import {
  VoiceStager,
  VOICE_BATCH_BYTES,
  startStagedRecording,
} from "../../../../src/frontend/src/lib/audio/voice-stager.js";

const FRAME_BYTES = 9_600; // one 300 ms worklet frame

/** A 300 ms frame whose every byte is `fill`, so chunk contents can be checked. */
function frame(fill: number): ArrayBuffer {
  return new Uint8Array(FRAME_BYTES).fill(fill).buffer;
}

function recordingSink() {
  const ops: string[] = [];
  const chunks: Uint8Array[] = [];
  const sink = {
    enqueueCreate: (id: string, opts: { targetSessionId: string | null }) =>
      ops.push(`create ${id} target=${String(opts.targetSessionId)}`),
    enqueueChunk: (id: string, bytes: ArrayBuffer) => {
      chunks.push(new Uint8Array(bytes));
      ops.push(`chunk ${id} ${String(bytes.byteLength)}`);
    },
    enqueueFinalize: (id: string, opts: { hq: { emissionId: string; sessionId: string } | null }) =>
      ops.push(`finalize ${id} hq=${opts.hq === null ? "null" : opts.hq.emissionId}`),
    enqueueDiscard: (id: string) => ops.push(`discard ${id}`),
  };
  return { sink, ops, chunks };
}
```

## Fifty 300 ms frames fill exactly one 15 s chunk

```ts
VOICE_BATCH_BYTES
=> 480000

const emitted: number[] = [];
const stager = new VoiceStager({ emit: (bytes) => emitted.push(bytes.byteLength) });
for (let i = 0; i < 49; i++) stager.push(frame(1));
emitted.length
=> 0

stager.push(frame(1));
emitted.join(",")
=> 480000
```

## `flush` emits the partial batch once

Seventy-five frames are one full chunk plus 7.5 s left over; `flush` sends the
remainder, and a second `flush` has nothing left to send.

```ts
const sizes: number[] = [];
const stager = new VoiceStager({ emit: (bytes) => sizes.push(bytes.byteLength) });
for (let i = 0; i < 75; i++) stager.push(frame(2));
stager.flush();
stager.flush();
sizes.join(",")
=> 480000,240000

stager.bytesSeen()
=> 720000
```

## Bytes are exact across a frame that straddles a batch boundary

Frames of an odd size split across chunks: the concatenated chunks equal the
concatenated frames, byte for byte, in order.

```ts
const out: Uint8Array[] = [];
const stager = new VoiceStager({ emit: (bytes) => out.push(new Uint8Array(bytes)) });
const input: Uint8Array[] = [];
for (let i = 0; i < 70; i++) {
  const f = new Uint8Array(7_001).fill(i % 251);
  input.push(f);
  stager.push(f.buffer);
}
stager.flush();
out.map((c) => c.byteLength).join(",")
=> 480000,10070

const joined = (parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return all;
};
const a = joined(input);
const b = joined(out);
a.byteLength === b.byteLength && a.every((v, i) => v === b[i])
=> true
```

## A recording enqueues create, its chunks, then one finalize

`seal` flushes the partial batch before `finalize`, so the queue's own chunk
count (which `enqueueFinalize` snapshots) covers every byte. A second `seal`
is a no-op.

```ts
const { sink, ops, chunks } = recordingSink();
const rec = startStagedRecording({ recordingId: "r1", targetSessionId: null, sink });
for (let i = 0; i < 51; i++) rec.push(frame(3));
rec.hasAudio()
=> true

rec.seal({ emissionId: "e1", sessionId: "s1" });
rec.seal(null);
ops.join("\n")
=>
create r1 target=null
chunk r1 480000
chunk r1 9600
finalize r1 hq=e1

chunks.every((c) => c.every((v) => v === 3))
=> true
```

Frames that arrive after the seal (a late worklet message) are not part of the
recording, and a `discard` after a `seal` changes nothing:

```ts continue
rec.push(frame(3));
rec.discard();
ops.length
=> 4
```

## Discard is terminal too

```ts
const { sink, ops } = recordingSink();
const rec = startStagedRecording({ recordingId: "r2", targetSessionId: "chat-1", sink });
rec.hasAudio()
=> false

rec.discard();
rec.discard();
rec.seal(null);
ops.join("\n")
=>
create r2 target=chat-1
discard r2
```
