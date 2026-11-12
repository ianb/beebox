// A run's sound as files: the mixed WAV, and a waveform strip an agent can
// read like a frame (one column per slice of time, a red mark at each voice
// start, a grey tick each second).
import { SAMPLE_RATE, encodeWav, mix } from "../../core/sound/synth.js";
import type { Voice } from "../../core/sound/voice.js";
import { encodePng } from "./capture.js";

const WIDTH = 1200;
const HEIGHT = 120;

function waveform(
  samples: Float32Array,
  marks: { starts: readonly number[]; seconds: number },
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const paint = (
    xy: readonly [number, number],
    rgb: readonly [number, number, number],
  ): void => {
    const at = (xy[1] * WIDTH + xy[0]) * 4;
    data[at] = rgb[0];
    data[at + 1] = rgb[1];
    data[at + 2] = rgb[2];
    data[at + 3] = 255;
  };
  for (let y = 0; y < HEIGHT; y += 1)
    for (let x = 0; x < WIDTH; x += 1) paint([x, y], [250, 248, 242]);
  const column = (fraction: number): number =>
    Math.min(WIDTH - 1, Math.floor(fraction * WIDTH));
  for (let s = 1; s < marks.seconds; s += 1)
    for (let y = 0; y < HEIGHT; y += 1)
      paint([column(s / marks.seconds), y], [220, 216, 205]);
  // Column x covers the same fraction of the run as `column` maps marks to.
  const per = samples.length / WIDTH;
  for (let x = 0; x < WIDTH; x += 1) {
    let lo = 0;
    let hi = 0;
    for (const sample of samples.subarray(
      Math.floor(x * per),
      Math.max(Math.floor(x * per) + 1, Math.floor((x + 1) * per)),
    )) {
      lo = Math.min(lo, sample);
      hi = Math.max(hi, sample);
    }
    const top = Math.round((1 - hi) * (HEIGHT / 2 - 1));
    const bottom = Math.round((1 - lo) * (HEIGHT / 2 - 1));
    for (let y = top; y <= bottom; y += 1) paint([x, y], [40, 60, 90]);
  }
  for (const start of marks.starts)
    for (let y = 0; y < 8; y += 1) paint([column(start), y], [210, 50, 40]);
  return data;
}

/** `sound.wav` and `sound.png` for a run's voices, or nothing when it made no sound. */
export function soundFiles(
  voices: readonly Voice[],
  timing: { frames: number; fps: number },
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  if (voices.length === 0) return files;
  const samples = mix(voices, { ...timing, sampleRate: SAMPLE_RATE });
  files.set("sound.wav", encodeWav(samples, SAMPLE_RATE));
  const starts = voices
    .filter((voice) => voice.at < timing.frames)
    .map((voice) => voice.at / timing.frames);
  files.set(
    "sound.png",
    encodePng({
      width: WIDTH,
      height: HEIGHT,
      data: waveform(samples, { starts, seconds: timing.frames / timing.fps }),
    }),
  );
  return files;
}
