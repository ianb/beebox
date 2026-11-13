// Turn voices into samples. Pure and deterministic: the same voice gives the
// same samples in every runtime (noise is seeded from the voice's id), so a
// headless WAV and the browser's playback are the same sound.
import { SeededRandom } from "../prng.js";
import { DEFAULT_SECONDS, renderNote } from "./instruments.js";
import { renderSample } from "./library/samples.js";
import type { SampleLibrary } from "./library/samples.js";
import { noteFreq } from "./notes.js";
import type { NoiseVoice, NoteVoice, PluckVoice, ToneVoice, Voice } from "./voice.js";
import { MAX_SECONDS } from "./voice.js";

export const SAMPLE_RATE = 44_100;

/** A `sample` voice reached the renderer before the sample library was loaded (a runtime bug). */
export class MissingLibraryError extends Error {
  name = "MissingLibraryError";
  constructor() {
    super("canvas-loop: a sample voice was rendered without the sample library");
  }
}
const DEFAULT_GAIN = 0.5;

/** A stable 32-bit seed from a string (FNV-1a). */
function seedOf(text: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash;
}

/**
 * Karplus–Strong: a noise burst one period long circulates through a delay
 * line; each pass averages neighbouring samples, so high partials fade first.
 * `brightness` smooths the first burst; `decay` sets the overall fade.
 */
function pluck(
  voice: PluckVoice,
  sampleRate: number,
): Float32Array<ArrayBuffer> {
  const seconds = Math.min(voice.decay ?? 2, MAX_SECONDS);
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const period = Math.max(2, Math.round(sampleRate / voice.freq));
  const random = new SeededRandom(seedOf(voice.id));
  const line = new Float32Array(period);
  for (let i = 0; i < period; i += 1) line[i] = random.next() * 2 - 1;
  const smooth = Math.round((1 - (voice.brightness ?? 0.5)) * 4);
  for (let pass = 0; pass < smooth; pass += 1) {
    for (let i = 0; i < period; i += 1)
      line[i] = ((line[i] ?? 0) + (line[(i + 1) % period] ?? 0)) / 2;
  }
  const gain = voice.gain ?? DEFAULT_GAIN;
  // -60 dB at `seconds`, on top of the string's own damping.
  const fade = Math.log(1000) / (seconds * sampleRate);
  for (let i = 0; i < out.length; i += 1) {
    const at = i % period;
    const sample = line[at] ?? 0;
    out[i] = sample * gain * Math.exp(-fade * i);
    line[at] = 0.996 * 0.5 * (sample + (line[(at + 1) % period] ?? 0));
  }
  return out;
}

const RAMP = 0.01;

/** A short linear fade in and out, so a tone starts and stops without a click. */
function envelope(
  i: number,
  args: { length: number; sampleRate: number },
): number {
  const ramp = Math.max(1, Math.round(RAMP * args.sampleRate));
  return Math.min(1, i / ramp, (args.length - i) / ramp);
}

function wave(kind: ToneVoice["wave"], phase: number): number {
  const turn = phase - Math.floor(phase);
  if (kind === "square") return turn < 0.5 ? 0.6 : -0.6;
  if (kind === "triangle") return 1 - 4 * Math.abs(turn - 0.5);
  return Math.sin(2 * Math.PI * turn);
}

function tone(voice: ToneVoice, sampleRate: number): Float32Array<ArrayBuffer> {
  const length = Math.ceil(voice.duration * sampleRate);
  const out = new Float32Array(length);
  const gain = voice.gain ?? DEFAULT_GAIN;
  for (let i = 0; i < length; i += 1) {
    out[i] =
      wave(voice.wave, (voice.freq * i) / sampleRate) *
      gain *
      envelope(i, { length, sampleRate });
  }
  return out;
}

function noise(
  voice: NoiseVoice,
  sampleRate: number,
): Float32Array<ArrayBuffer> {
  const length = Math.ceil(voice.duration * sampleRate);
  const out = new Float32Array(length);
  const random = new SeededRandom(seedOf(voice.id));
  const gain = voice.gain ?? DEFAULT_GAIN;
  const fade = Math.log(1000) / length;
  for (let i = 0; i < length; i += 1)
    out[i] = (random.next() * 2 - 1) * gain * Math.exp(-fade * i);
  return out;
}

function note(voice: NoteVoice, sampleRate: number): Float32Array<ArrayBuffer> {
  return renderNote(voice.instrument, {
    freq: noteFreq(voice.note),
    seconds: voice.duration ?? DEFAULT_SECONDS[voice.instrument],
    gain: voice.gain ?? DEFAULT_GAIN,
    sampleRate,
  });
}

/** How to render: the output rate, and the sample library `sample` voices play from. */
export interface RenderOptions {
  readonly sampleRate: number;
  /** Needed only for `sample` voices; rendering one without it throws. */
  readonly library?: SampleLibrary | undefined;
}

/** One voice's samples, starting at its first sample. */
export function renderVoice(
  voice: Voice,
  options: RenderOptions,
): Float32Array<ArrayBuffer> {
  const { sampleRate } = options;
  switch (voice.kind) {
    case "pluck":
      return pluck(voice, sampleRate);
    case "tone":
      return tone(voice, sampleRate);
    case "noise":
      return noise(voice, sampleRate);
    case "note":
      return note(voice, sampleRate);
    case "sample":
      if (options.library === undefined) throw new MissingLibraryError();
      return renderSample(voice, { sampleRate, library: options.library });
  }
}

/**
 * All voices mixed onto one track covering `frames` frames at `fps`. A voice
 * starts at its `at` frame; the part past the last frame is cut. The sum is
 * clipped at ±1, as a browser's audio output does.
 */
export function mix(
  voices: readonly Voice[],
  timing: { frames: number; fps: number } & RenderOptions,
): Float32Array<ArrayBuffer> {
  const { frames, fps, sampleRate } = timing;
  const out = new Float32Array(Math.ceil((frames / fps) * sampleRate));
  for (const voice of voices) {
    const start = Math.round((voice.at / fps) * sampleRate);
    if (start >= out.length) continue;
    const samples = renderVoice(voice, timing);
    const end = Math.min(out.length, start + samples.length);
    for (let i = start; i < end; i += 1)
      out[i] = (out[i] ?? 0) + (samples[i - start] ?? 0);
  }
  for (let i = 0; i < out.length; i += 1)
    out[i] = Math.max(-1, Math.min(1, out[i] ?? 0));
  return out;
}

/** 16-bit mono PCM WAV bytes for `samples` (-1..1). */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i += 1)
      view.setUint8(offset + i, value.codePointAt(i) ?? 0);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (const [i, sample] of samples.entries()) {
    view.setInt16(
      44 + i * 2,
      Math.round(Math.max(-1, Math.min(1, sample)) * 32_767),
      true,
    );
  }
  return bytes;
}
