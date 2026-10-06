# Encoding streamed PCM to MP3 as it arrives

Gemini speaks raw 24 kHz PCM. The browser's streaming player takes MP3, so
`pcmToMp3` (`src/core/tts/mp3-encoder.ts`) runs the audio through `ffmpeg` on
the way. These examples use the real `ffmpeg`, a declared runtime dependency of
the server (`docs/plans/tts-streamed-playback.md`).

```ts setup
import { pcmToMp3, Mp3EncoderError } from "../../../src/core/tts/mp3-encoder.js";

/** `seconds` of a 440 Hz tone as 16-bit little-endian mono 24 kHz PCM. */
function tone(seconds) {
  const samples = Math.round(24000 * seconds);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 24000)), i * 2);
  return pcm;
}

/** A gate a PCM source can wait on until the test opens it. */
function gate() {
  let open;
  const opened = new Promise((resolve) => { open = resolve; });
  return { opened, open };
}

async function collect(chunks) {
  const out = [];
  for await (const chunk of chunks) out.push(chunk);
  return Buffer.concat(out);
}
```

## MP3 comes out before the PCM has finished arriving

The source sends one second of audio, then waits. MP3 frames for that second
arrive while it waits, which is the whole point: the browser can start playing
before the provider finishes. The first bytes are an MPEG audio frame, with no
ID3 tag in front, so a `SourceBuffer` sees audio first.

```ts
const held = gate();
let sourceFinished = false;
async function* source() {
  yield tone(1);
  await held.opened;
  yield tone(0.5);
  sourceFinished = true;
}
const mp3 = pcmToMp3(source());
const first = await mp3.next();
const earlyOutput = { beforeSourceFinished: !sourceFinished, frameSync: first.value[0] === 0xff && (first.value[1] & 0xe0) === 0xe0 };
held.open();
const rest = await collect(mp3);
({ ...earlyOutput, totalKb: Math.round((first.value.length + rest.length) / 1000) })
=> { beforeSourceFinished: true, frameSync: true, totalKb: 12 }
```

## A provider failure comes through as itself

When the PCM source fails — the provider's stream broke — that error reaches
the caller unchanged, and the encoder is stopped. It is not reported as an
encoder failure.

```ts
class ProviderBroke extends Error {
  name = "ProviderBroke";
}
async function* breaking() {
  yield tone(0.5);
  throw new ProviderBroke("stream reset");
}
await collect(pcmToMp3(breaking()))
=> throws ProviderBroke: stream reset
```

## A missing ffmpeg says so

```ts
await collect(pcmToMp3((async function* () { yield tone(0.5); })(), { command: "ffmpeg-not-installed-here" }))
=> throws Mp3EncoderError: MP3 encoder (ffmpeg) could not start: spawn ffmpeg-not-installed-here ENOENT
```

## Aborting stops the encoder at once

The route aborts when the browser goes away. The encoder is killed, and the
iteration ends with the abort's reason rather than waiting for the source.

```ts
const never = gate();
async function* stalls() {
  yield tone(0.5);
  await never.opened;
}
const controller = new AbortController();
const started = Date.now();
const aborted = collect(pcmToMp3(stalls(), { signal: controller.signal }));
setTimeout(() => controller.abort(new Error("browser went away")), 200);
const outcome = await aborted.catch((e) => e.message);
({ outcome, prompt: Date.now() - started < 2000 })
=> { outcome: "browser went away", prompt: true }
```
