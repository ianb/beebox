# Voice recording piece planning

`planPieces` cuts a recording's concatenated 16 kHz mono s16le PCM into byte
ranges of at most `pieceSeconds` each, on sample (2-byte) boundaries.
`nextPieceSeconds` halves the piece length toward the floor.

```ts setup
import { planPieces, nextPieceSeconds, HQ_PIECE_SECONDS, HQ_PIECE_FLOOR_SECONDS, PCM_BYTES_PER_SECOND } from "../../../src/core/voice-recording/pieces.js";
```

## A recording shorter than one piece is a single piece

```ts
PCM_BYTES_PER_SECOND
=> 32000

const totalBytes = PCM_BYTES_PER_SECOND * 60;
JSON.stringify(planPieces(totalBytes, HQ_PIECE_SECONDS))
=> [{"startByte":0,"endByte":1920000}]
```

## A recording longer than one piece splits into consecutive, non-overlapping ranges

10 minutes (600s) of audio at the default 300s piece length is exactly two
pieces:

```ts
const tenMinutes = PCM_BYTES_PER_SECOND * 600;
JSON.stringify(planPieces(tenMinutes, HQ_PIECE_SECONDS))
=> [{"startByte":0,"endByte":9600000},{"startByte":9600000,"endByte":19200000}]
```

A length that doesn't divide evenly leaves a shorter final piece — still
sample-aligned, since every full piece is already an even number of bytes:

```ts
// 420s = one 300s piece + a 120s remainder
const sevenMinutes = PCM_BYTES_PER_SECOND * 420;
const pieces = planPieces(sevenMinutes, HQ_PIECE_SECONDS);
JSON.stringify(pieces)
=> [{"startByte":0,"endByte":9600000},{"startByte":9600000,"endByte":13440000}]

pieces.every((p) => p.startByte % 2 === 0 && p.endByte % 2 === 0)
=> true
```

## Zero bytes produces zero pieces

```ts
planPieces(0, HQ_PIECE_SECONDS).length
=> 0
```

## `nextPieceSeconds` halves toward the floor, then returns null

```ts
nextPieceSeconds(HQ_PIECE_SECONDS)
=> 150

HQ_PIECE_FLOOR_SECONDS
=> 150

nextPieceSeconds(HQ_PIECE_FLOOR_SECONDS)
=> null
```

A piece length already below the floor also yields `null` (halving only ever
moves further from a usable length):

```ts
nextPieceSeconds(100)
=> null
```
