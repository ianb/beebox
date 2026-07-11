# Per-segment audio concatenation

`concatSegments` joins each recording segment's chunks independently. Only the
first chunk of a recording carries the WebM/EBML header, so chunks are
concatenated *within* a segment (never across), yielding one buffer per segment
with chunk order preserved.

```ts setup
import { concatSegments, concatSegmentChunks } from "../../../src/core/capture/audio-concat.js";
```

## Two segments, three chunks each → two buffers, order preserved

```ts
const out = concatSegments([
  {
    segmentId: "seg-a",
    startedAt: "2026-07-09T14:00:00.000Z",
    chunks: [Buffer.from("A0"), Buffer.from("A1"), Buffer.from("A2")],
  },
  {
    segmentId: "seg-b",
    startedAt: "2026-07-09T14:05:00.000Z",
    chunks: [Buffer.from("B0"), Buffer.from("B1"), Buffer.from("B2")],
  },
]);
out.length
=> 2

out[0].segmentId
=> seg-a

out[0].buffer.toString("utf-8")
=> A0A1A2

out[1].segmentId
=> seg-b

out[1].buffer.toString("utf-8")
=> B0B1B2
```

The header chunk stays first — cross-segment bytes never mingle:

```ts continue
out[1].startedAt
=> 2026-07-09T14:05:00.000Z
```

## Empty segments are dropped

A segment that recorded no chunks produces no card:

```ts
const out = concatSegments([
  { segmentId: "empty", startedAt: "2026-07-09T14:00:00.000Z", chunks: [] },
  { segmentId: "real", startedAt: "2026-07-09T14:01:00.000Z", chunks: [Buffer.from("X")] },
]);
out.length
=> 1

out[0].segmentId
=> real
```

## `concatSegmentChunks` is plain ordered concatenation

```ts
concatSegmentChunks([Buffer.from("one"), Buffer.from("two")]).toString("utf-8")
=> onetwo
```

## A truncated tail chunk still concatenates (decodable prefix, no throw)

A crash mid-recording can leave the last chunk cut to half its bytes (the tail
since the last `dataavailable` is lost). Concat is pure byte-join, so it returns
a buffer carrying the full prefix plus whatever survived — never throwing:

```ts
const header = Buffer.from("HEADER-cluster0-cluster1-");
const truncatedTail = Buffer.from("cluster2-HALF").subarray(0, 8); // "cluster2" — cut mid-chunk
const out = concatSegments([
  { segmentId: "seg-a", startedAt: "2026-07-09T14:00:00.000Z", chunks: [header, truncatedTail] },
]);
out.length
=> 1

out[0].buffer.toString("utf-8")
=> HEADER-cluster0-cluster1-cluster2
```

The full prefix is intact — the truncation only costs the missing tail bytes:

```ts continue
out[0].buffer.toString("utf-8").startsWith("HEADER-cluster0-cluster1-")
=> true
```
