# WAV encoder

`src/frontend/src/lib/wav-encode.ts` packages PCM s16le chunks (16kHz
mono, what the pcm-processor worklet emits) into a WAV-formatted Blob.
Used by narration mode to send segment audio to the HQ transcription
pass.

```ts setup
import { encodePcmChunksAsWav } from "../../../src/frontend/src/lib/wav-encode.js";

function sampleChunk(samples: number): ArrayBuffer {
  const buf = new ArrayBuffer(samples * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples; i++) view.setInt16(i * 2, i, true);
  return buf;
}

function readHeaderField(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]!);
  return out;
}
```

## Empty input

```ts
const blob = encodePcmChunksAsWav([]);
blob.size
=> 44

blob.type
=> audio/wav
```

The empty WAV is still valid — just header, zero data.

## Header structure

```ts
const blob = encodePcmChunksAsWav([sampleChunk(100)]);
const bytes = new Uint8Array(await blob.arrayBuffer());
readHeaderField(bytes, 0, 4)
=> RIFF

readHeaderField(bytes, 8, 4)
=> WAVE

JSON.stringify(readHeaderField(bytes, 12, 4))
=> "fmt "

readHeaderField(bytes, 36, 4)
=> data
```

## Sample rate, channels, bit depth

`pcm-processor` produces 16kHz mono 16-bit PCM. The WAV header should
match.

```ts
const blob = encodePcmChunksAsWav([sampleChunk(100)]);
const view = new DataView(await blob.arrayBuffer());
view.getUint16(22, true)
=> 1

view.getUint32(24, true)
=> 16000

view.getUint16(34, true)
=> 16
```

## Total size and data chunk length

8000 samples = 16000 bytes; concatenating two chunks gives 32000 bytes
of data, plus the 44-byte header → 32044 total.

```ts
const chunk = sampleChunk(8000);
const blob = encodePcmChunksAsWav([chunk, chunk]);
blob.size
=> 32044

const view = new DataView(await blob.arrayBuffer());
view.getUint32(4, true)
=> 32036

view.getUint32(40, true)
=> 32000
```

`getUint32(4, ...)` is the RIFF chunk size (total minus 8 for the RIFF
header); `getUint32(40, ...)` is the data subchunk size.
