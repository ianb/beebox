// The sample library in memory, and rendering one `sample` voice from it.
import { SketchUsageError } from "../../errors.js";
import type { SampleVoice } from "../voice.js";
import { LIBRARY_RATE } from "./catalog.js";
import { decodeMuLaw } from "./mulaw.js";

/** Each sample name's takes, as float samples at LIBRARY_RATE. */
export type SampleLibrary = ReadonlyMap<string, readonly Float32Array[]>;

const DEFAULT_GAIN = 0.5;

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.codePointAt(i) ?? 0;
  return bytes;
}

/** Decode the generated data module's base64 μ-law into a library. */
export function decodeLibrary(data: Readonly<Record<string, readonly string[]>>): SampleLibrary {
  const library = new Map<string, readonly Float32Array[]>();
  for (const [name, takes] of Object.entries(data)) library.set(name, takes.map((take) => decodeMuLaw(fromBase64(take))));
  return library;
}

/**
 * One sample voice at `sampleRate`: the take `variant` (wrapping), played at
 * speed `rate` by linear interpolation, scaled by `gain`.
 */
export function renderSample(voice: SampleVoice, options: { sampleRate: number; library: SampleLibrary }): Float32Array<ArrayBuffer> {
  const takes = options.library.get(voice.name);
  if (takes === undefined || takes.length === 0) {
    throw new SketchUsageError({ detail: `sound: voice "${voice.id}" names "${voice.name}", which the loaded sample library does not have` });
  }
  const source = takes[(voice.variant ?? 0) % takes.length] ?? new Float32Array(0);
  const step = (LIBRARY_RATE * (voice.rate ?? 1)) / options.sampleRate;
  const out = new Float32Array(Math.floor((source.length - 1) / step) + 1);
  const gain = voice.gain ?? DEFAULT_GAIN;
  for (let i = 0; i < out.length; i += 1) {
    const at = i * step;
    const base = Math.floor(at);
    const frac = at - base;
    const a = source[base] ?? 0;
    const b = source[base + 1] ?? a;
    out[i] = (a + (b - a) * frac) * gain;
  }
  return out;
}
