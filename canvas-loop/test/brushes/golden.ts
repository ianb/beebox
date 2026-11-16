// Golden numbers for the GPU brush expansion's readback tests: what the CPU
// expansion gave for the test scenes, recorded at commit 74ce5c74b, before
// chunk 9 deleted it (canvas-loop-gpu-brushes.subplan.md). A file in
// test/fixtures/brush-golden/ is a gzipped stream of f32 values, counts and
// flags among them (exact in f32), read in the order each reader below
// documents. Positions are relative to their contour's origin
// (`PreparedContour.origin`, f64), so f32 keeps them precise far from 0.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const DIR = new URL("../fixtures/brush-golden/", import.meta.url);

/** A reader of golden file `name`'s values, in order. */
export class Golden {
  readonly #f: Float32Array;
  readonly #name: string;
  #at = 0;

  constructor(name: string) {
    const buf = gunzipSync(readFileSync(new URL(`${name}.f32.gz`, DIR)));
    this.#f = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    this.#name = name;
  }

  /** The next `n` values. */
  floats(n: number): Float32Array {
    if (this.#at + n > this.#f.length) throw new Error(`golden ${this.#name}: asked for ${n} values at ${this.#at}, ${this.#f.length} recorded`);
    this.#at += n;
    return this.#f.subarray(this.#at - n, this.#at);
  }

  /** The next value, a count or a flag. */
  int(): number {
    return this.floats(1)[0] ?? NaN;
  }

  /** Every value read. */
  get done(): boolean {
    return this.#at === this.#f.length;
  }
}

/** A sample (brush space, less its contour's origin) and its pressure. */
export interface GoldenSample {
  readonly x: number;
  readonly y: number;
  readonly p: number;
}

/** `samples-<name>`: per brushed stroke of the scene (`brushRequests` order), per contour, the CPU samples. */
export function goldenSamples(name: string): GoldenSample[][][] {
  const g = new Golden(`samples-${name}`);
  const strokes = Array.from({ length: g.int() }, () => Array.from({ length: g.int() }, () => Array.from({ length: g.int() }, () => {
    const [x = NaN, y = NaN, p = NaN] = g.floats(3);
    return { x, y, p };
  })));
  if (!g.done) throw new Error(`golden samples-${name}: values left over`);
  return strokes;
}

/** A CPU dab (brush space, less its contour's origin), or a sample the stamp rule skipped. */
export type GoldenDab = { readonly skip: true } | { readonly skip: false; readonly x: number; readonly y: number; readonly r: number; readonly a: number; readonly rgb: readonly number[] };

/** `dabs-<name>`: every `stride`-th stamp stroke of the scene, from the first: its tip, and per contour, a dab or a skip per sample. */
export function goldenDabs(name: string): { stride: number; strokes: { soft: boolean; contours: GoldenDab[][] }[] } {
  const g = new Golden(`dabs-${name}`);
  const stride = g.int();
  const strokes = Array.from({ length: g.int() }, () => {
    const soft = g.int() === 1;
    const jittered = g.int() === 1;
    const contours = Array.from({ length: g.int() }, () => Array.from({ length: g.int() }, (): GoldenDab => {
      if (g.int() === 1) return { skip: true };
      const [x = NaN, y = NaN, r = NaN, a = NaN] = g.floats(4);
      return { skip: false, x, y, r, a, rgb: jittered ? [...g.floats(3)] : [0, 0, 0] };
    }));
    return { soft, contours };
  });
  if (!g.done) throw new Error(`golden dabs-${name}: values left over`);
  return { stride, strokes };
}

/** One bristle's run of points [a, z] (z included); a drawn run has its half width, alpha, colour and each point's strip sides. */
export type GoldenRun = { readonly a: number; readonly z: number } & ({ readonly drawn: false } | { readonly drawn: true; readonly hw: number; readonly alpha: number; readonly rgb: readonly number[]; readonly sides: Float32Array });

/** A bristle contour: one sample (a dot: brush space, less the origin) or bristles of runs. */
export type GoldenBristleContour =
  | { readonly n: 1; readonly dot: { x: number; y: number; r: number; a: number; rgb: readonly number[] } }
  | { readonly n: number; readonly dot: undefined; readonly bristles: readonly { excused: boolean; runs: GoldenRun[] }[] };

/** `bristles-<name>-r<ratio>`: per bristle stroke, per contour, its dot or its bristles' runs, as the bristle test places them. */
export function goldenBristles(name: string): GoldenBristleContour[][] {
  const g = new Golden(`bristles-${name}`);
  const strokes = Array.from({ length: g.int() }, () => Array.from({ length: g.int() }, (): GoldenBristleContour => {
    const n = g.int();
    if (n === 1) {
      const [x = NaN, y = NaN, r = NaN, a = NaN, ...rgb] = g.floats(7);
      return { n: 1, dot: { x, y, r, a, rgb } };
    }
    if (n < 2) return { n, dot: undefined, bristles: [] };
    const bristles = Array.from({ length: g.int() }, () => {
      const excused = g.int() === 1;
      const runs = Array.from({ length: g.int() }, (): GoldenRun => {
        const [a = NaN, z = NaN, drawn = NaN] = g.floats(3);
        if (drawn !== 1) return { a, z, drawn: false };
        const [hw = NaN, alpha = NaN, ...rgb] = g.floats(5);
        return { a, z, drawn: true, hw, alpha, rgb, sides: g.floats((z - a + 1) * 4) };
      });
      return { excused, runs };
    });
    return { n, dot: undefined, bristles };
  }));
  if (!g.done) throw new Error(`golden bristles-${name}: values left over`);
  return strokes;
}

/** `smears`: per smudge or wet stroke of the smear case, per contour, the CPU dabs (brush space, less the origin). */
export function goldenSmears(): { x: number; y: number; r: number; a: number }[][][] {
  const g = new Golden("smears");
  const strokes = Array.from({ length: g.int() }, () => Array.from({ length: g.int() }, () => Array.from({ length: g.int() }, () => {
    const [x = NaN, y = NaN, r = NaN, a = NaN] = g.floats(4);
    return { x, y, r, a };
  })));
  if (!g.done) throw new Error("golden smears: values left over");
  return strokes;
}

/** `ink-thin-outline`: per thin-ink row, the tone of perfect-freehand's outlines filled by exact area. */
export function goldenThinOutline(rows: number): number[] {
  const g = new Golden("ink-thin-outline");
  const out = [...g.floats(rows)];
  if (!g.done) throw new Error("golden ink-thin-outline: values left over");
  return out;
}
