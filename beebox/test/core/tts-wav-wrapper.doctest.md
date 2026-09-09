# PCM to WAV: a header, not a transcode

Gemini's speech endpoint answers raw PCM and rejects mp3, so the bytes need a
container before a browser will play them. `pcmToWav`
(`src/core/tts/wav.ts`) prepends the canonical 44-byte header and copies the
samples through untouched.

```ts setup
import { pcmToWav } from "../../src/core/tts/wav.js";
```

## The header describes Gemini's output, and the samples survive

```ts
const pcm = Buffer.alloc(960, 7);
const wav = pcmToWav(pcm);
const header = wav.subarray(0, 44);
JSON.stringify({
  riff: header.toString("ascii", 0, 4),
  wave: header.toString("ascii", 8, 12),
  fmt: header.toString("ascii", 12, 16),
  pcmFormat: header.readUInt16LE(20),
  channels: header.readUInt16LE(22),
  sampleRate: header.readUInt32LE(24),
  bitsPerSample: header.readUInt16LE(34),
  data: header.toString("ascii", 36, 40),
})
=> {"riff":"RIFF","wave":"WAVE","fmt":"fmt ","pcmFormat":1,"channels":1,"sampleRate":24000,"bitsPerSample":16,"data":"data"}
```

Sizes are the two the format requires: the `data` chunk is the payload length,
and the `RIFF` size is everything after that field.

```ts
const sized = pcmToWav(Buffer.alloc(960, 7));
`total=${String(sized.length)} riffSize=${String(sized.readUInt32LE(4))} dataSize=${String(sized.readUInt32LE(40))}`
=> total=1004 riffSize=996 dataSize=960
```

Nothing is resampled or re-encoded — the payload is byte-identical.

```ts
const original = Buffer.from([1, 2, 3, 4, 250, 251, 252, 253]);
const wrapped = pcmToWav(original);
wrapped.subarray(44).equals(original)
=> true
```

Byte rate and block align follow from the other fields, so a future backend at
a different rate stays consistent rather than needing its own header code.

```ts
const stereo48k = pcmToWav(Buffer.alloc(16), { sampleRate: 48000, channels: 2 });
`blockAlign=${String(stereo48k.readUInt16LE(32))} byteRate=${String(stereo48k.readUInt32LE(28))}`
=> blockAlign=4 byteRate=192000
```
