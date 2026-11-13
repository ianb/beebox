// The PCM worklet resamples the mic to 16 kHz. Call transcripts place each
// word by this timeline, so a second of audio must be exactly 16,000 samples
// whatever the device rate: at 48 kHz in 128-sample blocks, dropping each
// block's fraction gave 15,750 a second, and words drifted early by 1.6%.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const source = readFileSync(fileURLToPath(new URL("../../../src/lib/audio/mic-capture/pcm-processor.worklet.js", import.meta.url)), "utf8");

/** Run the worklet at `sampleRate` over `seconds` of silence in 128-sample blocks; the 16 kHz samples it produced. */
function samplesFor(opts: { sampleRate: number; seconds: number }): number {
  let posted = 0;
  let instance: { process: (inputs: Float32Array[][]) => boolean; _offset: number } | null = null;
  runInNewContext(source, {
    sampleRate: opts.sampleRate,
    AudioWorkletProcessor: class {
      port = { postMessage: (m: { samples: ArrayBuffer }) => { posted += m.samples.byteLength / 2; } };
    },
    registerProcessor: (_name: string, Processor: new () => typeof instance) => {
      instance = new Processor();
    },
  });
  if (instance === null) throw new Error("the worklet registered no processor");
  const worklet: { process: (inputs: Float32Array[][]) => boolean; _offset: number } = instance;
  const block = new Float32Array(128);
  for (let i = 0; i < (opts.sampleRate * opts.seconds) / 128; i++) worklet.process([[block]]);
  return posted + worklet._offset;
}

// 12.8 s is a whole number of 128-sample blocks at both rates: 204,800 samples at 16 kHz.
void test("12.8 seconds is 204,800 samples at 48 kHz and at 44.1 kHz", (t) => {
  t.check([samplesFor({ sampleRate: 48_000, seconds: 12.8 }), samplesFor({ sampleRate: 44_100, seconds: 12.8 })], [204_800, 204_800]);
  t.end();
});
