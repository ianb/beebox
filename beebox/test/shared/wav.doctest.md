# WAV header builder

`buildWavHeader` is the one WAV header layout shared by the server's HQ piece
cutter and the frontend's whole-segment encoder (`docs/plans/resilient-voice-recording.md`,
#8). It must keep producing byte-identical headers to what the frontend's
inline builder wrote before this module absorbed it.

```ts setup
import { buildWavHeader } from "../../src/shared/wav.js";

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}
```

## A 16 kHz mono header matches the canonical byte layout

```ts
hex(buildWavHeader({ sampleRate: 16000, channels: 1, byteLength: 4 }))
=> 524946462800000057415645666d74201000000001000100803e0000007d0000020010006461746104000000
```

## A different sample rate and channel count changes the fields that depend on them

8 kHz stereo: `byteRate = sampleRate * channels * 2`, `blockAlign = channels * 2`.

```ts
hex(buildWavHeader({ sampleRate: 8000, channels: 2, byteLength: 100 }))
=> 524946468800000057415645666d74201000000001000200401f0000007d0000040010006461746164000000
```
