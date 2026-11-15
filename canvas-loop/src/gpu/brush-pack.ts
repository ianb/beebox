// Packing for the GPU brush pass (brush-pass.ts; canvas-loop-gpu-brushes.subplan.md):
// the prepared strokes' contours, in order, go into input buffers of at most
// the pass's limit, split only between contours (`pack`); each input's samples
// are cut into batches (`planBatches`). A contour that alone exceeds the limit
// is an error, raised at lowering so it names the call (`checkContours`), as is
// a bristle whose strip exceeds it (`checkBristles`) and a smear that cannot be
// one batch (`checkSmear`). A bristle stroke's batches are cut between
// bristles (`bristleUnits`, then `planBatches` over whole units).
import type { BristleBrush, Envelope, InkBrush, SmearBrush, StampBrush } from "../core/brush/types.js";
import type { Prepared, PreparedContour } from "../scene/brush/expand.js";
import { POINT_WORDS } from "../scene/brush/expand.js";
import { GpuRenderError } from "../scene/errors.js";
import { CONTOUR_WORDS, DAB_FLOATS, ENVELOPE_KINDS, RECORD_HEAD, SAMPLE_FLOATS, STROKE_WORDS } from "./shader-brush.js";
import { RUN_FLOATS, RUN_VERTICES } from "./shader-bristle.js";

/** A contour's samples: the first index in the frame's samples, and how many. */
export interface SampleRange {
  readonly first: number;
  readonly count: number;
}

/** A stroke placed for the GPU: what the `dabs`, `capsules`, `bristles` or `smears` entry needs besides its prepared stroke. */
export interface BrushJob {
  readonly prepared: Prepared;
  readonly brush: StampBrush | InkBrush | BristleBrush | SmearBrush;
  /** Brush space → device pixels, linear part (pixel ratio included). */
  readonly lin: readonly [number, number, number, number];
  readonly ratio: number;
  /** Added to a dab's linearly mapped position: the mark's translation less its box corner, or for a smear the layer's (each contour's origin is added in `pack`, in f64). */
  readonly offset: readonly [number, number];
  /** The mark's slot on its page: x0, y0, x1, y1 (unused for a smear). */
  readonly slot: readonly [number, number, number, number];
  /** A bristle stroke's one-sample dots as a stamp job: no dab is skipped (kinds.ts `paintBristle` draws every dot). */
  readonly dot?: boolean;
}

/** The keyframes as the CPU reads them: a frame followed by one at the same t is skipped (envelope.ts). */
function keyframesOf(env: readonly (readonly [number, number])[]): number[] {
  return env.flatMap((f, i) => (env[i + 1]?.[0] === f[0] ? [] : [f[0], f[1]]));
}

interface EnvelopeWords {
  readonly kind: number;
  readonly value: number;
  readonly keys: number[];
}

function envelopeWords(env: Envelope): EnvelopeWords {
  if (typeof env === "number") return { kind: ENVELOPE_KINDS.constant, value: env, keys: [] };
  if (typeof env === "string") return { kind: ENVELOPE_KINDS[env], value: 0, keys: [] };
  return { kind: ENVELOPE_KINDS.keyframes, value: 0, keys: keyframesOf(env) };
}

/** A stroke's record (shader-brush.ts lists the words). */
function strokeWords(j: BrushJob): number[] {
  const b = j.brush;
  // Word 4: a bristle dot (no dab skipped). Word 5 is unused: each contour's offset is in its own record (`pack`).
  const head = [...j.lin, j.dot === true ? 1 : 0, 0, ...j.slot, j.prepared.width, j.ratio];
  if (b.kind === "ink") return [...head, b.thinning];
  if (b.kind === "smear") return [...head, b.sizeByPressure, b.flow, b.opacityByPressure];
  const base = j.prepared.base;
  const colour = [b.hueJitter ?? 0, b.lightJitter ?? 0, base?.r ?? 0, base?.g ?? 0, base?.b ?? 0, base === undefined ? 0 : 1];
  if (b.kind === "bristle") return [...head, Math.round(b.bristles), b.flow, b.load, b.spread, 0, 0, ...colour];
  const soft = b.tip === "soft" ? 1 : 0;
  return [...head, b.sizeJitter, b.sizeByPressure, b.flow, b.opacityByPressure, b.scatter, soft, ...colour];
}

/** The input bytes one contour needs on its own: a records buffer with its record, keyframes and stroke record, and a geometry buffer with its points. */
function contourBytes(c: PreparedContour, env: EnvelopeWords): { records: number; geometry: number } {
  return { records: (RECORD_HEAD + CONTOUR_WORDS + env.keys.length + STROKE_WORDS) * 4, geometry: c.geom.length * 4 };
}

function tooLarge(c: PreparedContour, a: { bytes: { records: number; geometry: number }; limit: number }): GpuRenderError {
  return new GpuRenderError({ detail: `a brushed contour of ${c.geom.length / POINT_WORDS} points needs ${kib(a.bytes.geometry)} of geometry and ${kib(a.bytes.records)} of records, more than one brush buffer holds (${kib(a.limit)}); split the path into shorter ones` });
}

/** Throw, naming the sizes, when one of `p`'s contours cannot fit one brush input buffer of `limit` bytes. Lowering calls it, so the error names the call. */
export function checkContours(p: Prepared, limit: number): void {
  for (const c of p.contours) {
    const bytes = contourBytes(c, envelopeWords(c.pressure));
    if (bytes.records > limit || bytes.geometry > limit) throw tooLarge(c, { bytes, limit });
  }
}

const kib = (n: number): string => `${(n / 1024).toFixed(1)} KiB`;

/** Bytes of run vertices one bristle of a contour of `count` samples writes. */
export function bristleBytes(count: number): number {
  return Math.max(0, count - 1) * RUN_VERTICES * RUN_FLOATS * 4;
}

/** Throw, naming the sizes, when one bristle of `p` (a bristle stroke) cannot fit one output buffer of `limit` bytes: a bristle never splits. Lowering calls it, so the error names the call. */
export function checkBristles(p: Prepared, limit: number): void {
  for (const c of p.contours) {
    const bytes = bristleBytes(c.count);
    if (bytes > limit) throw new GpuRenderError({ detail: `a bristle of ${c.count} samples needs ${kib(bytes)} of strip vertices, more than one brush buffer holds (${kib(limit)}); split the path into shorter ones` });
  }
}

/**
 * Throw, naming the sizes, when smear stroke `p` cannot be one batch under
 * `limit`: its records and geometry must fit one input, and its samples and
 * dabs one output buffer each. A smear never splits (its load carries from
 * dab to dab). Lowering calls it, so the error names the call.
 */
export function checkSmear(p: Prepared, limit: number): void {
  const n = p.contours.reduce((m, c) => m + c.count, 0);
  const records = (RECORD_HEAD + STROKE_WORDS + p.contours.reduce((m, c) => m + CONTOUR_WORDS + envelopeWords(c.pressure).keys.length, 0)) * 4;
  const geometry = p.contours.reduce((m, c) => m + c.geom.length, 0) * 4;
  const dabs = n * Math.max(DAB_FLOATS, SAMPLE_FLOATS) * 4;
  if (Math.max(records, geometry, dabs) > limit) throw new GpuRenderError({ detail: `a smudge or wet stroke of ${n} dabs needs ${kib(dabs)} of dabs, ${kib(geometry)} of geometry and ${kib(records)} of records, and must stay in one brush buffer (${kib(limit)}); split it into shorter strokes` });
}

/**
 * An upper bound of the bytes one frame's brush batches need in its shared
 * sample buffer and output buffer (brush-pass.ts `reserve`), each at most
 * `limit`: the stamp, ink and bristle-dot samples and instances, the bristle
 * samples and strip vertices, and the largest smear's samples and dabs.
 */
export function scratchNeed(a: { gpu: readonly Pick<BrushJob, "prepared" | "brush">[]; smears: readonly Prepared[]; limit: number }): { samples: number; out: number } {
  let instances = 0;
  let bristleSamples = 0;
  let vertices = 0;
  for (const g of a.gpu) {
    for (const c of g.prepared.contours) {
      if (g.brush.kind !== "bristle" || c.count < 2) instances += c.count;
      if (g.brush.kind !== "bristle") continue;
      // A bristle batch computes every sample between its first and last contour, one-sample contours included.
      bristleSamples += c.count;
      vertices += Math.max(0, c.count - 1) * RUN_VERTICES * Math.round(g.brush.bristles);
    }
  }
  const smear = Math.max(0, ...a.smears.map((p) => p.contours.reduce((n, c) => n + c.count, 0)));
  const fit = (n: number, bytes: number): number => Math.min(n, Math.floor(a.limit / bytes)) * bytes;
  const s = SAMPLE_FLOATS * 4;
  return {
    samples: Math.max(fit(instances, s), fit(bristleSamples, s), smear * s),
    out: Math.max(fit(instances, DAB_FLOATS * 4), fit(vertices, RUN_FLOATS * 4), smear * DAB_FLOATS * 4),
  };
}

/** A run of samples a batch holds: `whole`, it must not be split between batches. */
export interface Span {
  readonly first: number;
  readonly count: number;
  readonly whole: boolean;
}

/**
 * Cut `spans` (consecutive, in sample order) into batches of at most `cap`
 * samples: a span that is not `whole` may split anywhere; a whole one goes
 * into one batch, and one over `cap` is an error (its caller names it).
 */
export function planBatches(spans: readonly Span[], cap: number): SampleRange[] {
  const out: SampleRange[] = [];
  let first = spans[0]?.first ?? 0;
  let fill = 0;
  const close = (): void => {
    if (fill > 0) out.push({ first, count: fill });
    first += fill;
    fill = 0;
  };
  for (const s of spans) {
    if (s.whole) {
      if (s.count > cap) throw new GpuRenderError({ detail: `a run of ${s.count} brush samples that must stay in one batch is more than a batch holds (${cap})` });
      if (fill + s.count > cap) close();
      fill += s.count;
      continue;
    }
    let left = s.count;
    while (left > 0) {
      if (fill === cap) close();
      const take = Math.min(left, cap - fill);
      fill += take;
      left -= take;
    }
  }
  close();
  return out;
}

/** A contour in packing order, with its stroke's index and wobble, its envelope's words, and its first sample in the frame. */
interface Entry {
  readonly c: PreparedContour;
  readonly wobble: number;
  readonly si: number;
  readonly env: EnvelopeWords;
  readonly first: number;
}

/** One pair of input buffers' contents: whole contours, the first of them the frame's contour `cbase`, and their samples. */
export interface Input {
  readonly records: ArrayBuffer;
  readonly geometry: Uint32Array<ArrayBuffer>;
  readonly contours: number;
  readonly cbase: number;
  readonly first: number;
  readonly count: number;
  readonly spans: readonly Span[];
}

/** Group `all` (in order) into runs of whole contours whose records and geometry each fit `limit` bytes. */
function splitInputs(all: readonly Entry[], a: { limit: number; strokes: boolean }): Entry[][] {
  const groups: Entry[][] = [];
  let group: Entry[] = [];
  let records = RECORD_HEAD;
  let geometry = 0;
  for (const e of all) {
    const bytes = contourBytes(e.c, e.env);
    if (bytes.records > a.limit || bytes.geometry > a.limit) throw tooLarge(e.c, { bytes, limit: a.limit });
    const stroke = (g: readonly Entry[]): number => (a.strokes && g.at(-1)?.si !== e.si ? STROKE_WORDS : 0);
    if (group.length > 0 && ((records + CONTOUR_WORDS + e.env.keys.length + stroke(group)) * 4 > a.limit || (geometry + e.c.geom.length) * 4 > a.limit)) {
      groups.push(group);
      group = [];
      records = RECORD_HEAD;
      geometry = 0;
    }
    records += CONTOUR_WORDS + e.env.keys.length + stroke(group);
    geometry += e.c.geom.length;
    group.push(e);
  }
  if (group.length > 0) groups.push(group);
  return groups;
}

/**
 * One input's records and geometry buffers' contents for `group`'s contours
 * (in order), with a record per stroke when `jobs` gives one. A contour's
 * samples are relative to its own origin; given a job, its record holds where
 * that origin lands in the mark's own pixels, `offset + lin · origin`, summed
 * in f64, so a far contour of the same stroke moves no other.
 */
function packInput(group: readonly Entry[], a: { jobs: readonly BrushJob[] | undefined; cbase: number }): Input {
  const { jobs } = a;
  const s0 = group[0]?.si ?? 0;
  const strokes = jobs === undefined ? 0 : (group.at(-1)?.si ?? s0) - s0 + 1;
  const keyWords = group.reduce((n, e) => n + e.env.keys.length, 0);
  const keyAt = RECORD_HEAD + group.length * CONTOUR_WORDS;
  const strokeAt = keyAt + keyWords;
  const records = new ArrayBuffer((strokeAt + strokes * STROKE_WORDS) * 4);
  const ru = new Uint32Array(records);
  const rf = new Float32Array(records);
  const geometry = new Uint32Array(group.reduce((n, e) => n + e.c.geom.length, 0));
  let point = 0;
  let key = keyAt;
  let count = 0;
  for (const [i, { c, wobble, si, env, first }] of group.entries()) {
    const at = RECORD_HEAD + i * CONTOUR_WORDS;
    const points = c.geom.length / POINT_WORDS;
    // Copied as words: the fourth word of each point is a u32.
    geometry.set(new Uint32Array(c.geom.buffer, c.geom.byteOffset, c.geom.length), point * POINT_WORDS);
    ru.set([point, points, first, c.count, c.seed], at);
    rf.set([c.step, c.total, c.cell], at + 5);
    ru[at + 8] = c.period ?? 0;
    rf[at + 9] = wobble;
    ru[at + 10] = env.kind;
    if (env.kind === ENVELOPE_KINDS.keyframes) ru.set([key, env.keys.length / 2], at + 11);
    else rf[at + 11] = env.value;
    ru[at + 13] = strokeAt + (si - s0) * STROKE_WORDS;
    const job = jobs?.[si];
    if (job !== undefined) {
      const [l0, l1, l2, l3] = job.lin;
      const [ox, oy] = c.origin;
      rf.set([job.offset[0] + l0 * ox + l2 * oy, job.offset[1] + l1 * ox + l3 * oy], at + 14);
    }
    rf.set(env.keys, key);
    key += env.keys.length;
    point += points;
    count += c.count;
  }
  for (let k = 0; k < strokes; k++) {
    const job = jobs?.[s0 + k];
    if (job !== undefined) rf.set(strokeWords(job), strokeAt + k * STROKE_WORDS);
  }
  ru.set([group.length, count], 0);
  const spans = group.flatMap((e) => (e.c.count === 0 ? [] : [{ first: e.first, count: e.c.count, whole: false }]));
  return { records, geometry, contours: group.length, cbase: a.cbase, first: group[0]?.first ?? 0, count, spans };
}

/** `strokes`' contours packed (in order) into input buffers of at most `limit` bytes, and their sample ranges. */
export function pack(strokes: readonly Prepared[], a: { jobs: readonly BrushJob[] | undefined; limit: number }): { inputs: Input[]; count: number; ranges: SampleRange[][] } {
  let first = 0;
  const all: Entry[] = [];
  const ranges = strokes.map((s, si) => s.contours.map((c) => {
    all.push({ c, wobble: s.wobble, si, env: envelopeWords(c.pressure), first });
    const r = { first, count: c.count };
    first += c.count;
    return r;
  }));
  let cbase = 0;
  const inputs = splitInputs(all, { limit: a.limit, strokes: a.jobs !== undefined }).map((g) => {
    const input = packInput(g, { jobs: a.jobs, cbase });
    cbase += g.length;
    return input;
  });
  return { inputs, count: first, ranges };
}

/** One copy of a batch's readback: `count` items from item `src` of the batch's buffer to item `dst` of readback buffer `chunk`. */
export interface ReadCopy {
  readonly chunk: number;
  readonly src: number;
  readonly dst: number;
  readonly count: number;
}

/**
 * The copies that read items [first, first + count) of a frame back into
 * readback buffers of `per` items each (the last may be shorter), so that no
 * readback buffer exceeds the device's buffer limit. A batch that crosses a
 * buffer's end is copied in two or more pieces.
 */
export function readCopies(b: { first: number; count: number }, per: number): ReadCopy[] {
  if (!(per >= 1)) throw new GpuRenderError({ detail: `a readback buffer must hold at least one item (it holds ${per})` });
  const out: ReadCopy[] = [];
  for (let i = b.first, end = b.first + b.count; i < end; ) {
    const chunk = Math.floor(i / per);
    const n = Math.min(end, (chunk + 1) * per) - i;
    out.push({ chunk, src: i - b.first, dst: i - chunk * per, count: n });
    i += n;
  }
  return out;
}

/** One thread of the `bristles` entry: a contour (its index in its input) and one of its bristles, with its run vertices' first index in the frame and count. */
export interface BristleUnit {
  readonly input: number;
  readonly contour: number;
  readonly bristle: number;
  readonly first: number;
  readonly count: number;
  /** The contour's samples in the frame. */
  readonly samples: SampleRange;
}

/**
 * The bristle strokes' units, in packing order (input, contour, bristle), with
 * each stroke's range of run vertices: a contour of `n > 1` samples gives each
 * of the stroke's bristles `(n − 1) × 6` vertices; a one-sample contour gives
 * none (its dab is laid with the stamps').
 */
export function bristleUnits(packed: { inputs: readonly Input[]; ranges: readonly (readonly SampleRange[])[] }, bristles: readonly number[]): { units: BristleUnit[]; strokes: SampleRange[]; count: number } {
  const units: BristleUnit[] = [];
  const strokes: SampleRange[] = [];
  let input = 0;
  let g = 0;
  let first = 0;
  for (const [si, contours] of packed.ranges.entries()) {
    const start = first;
    for (const r of contours) {
      while ((packed.inputs[input]?.cbase ?? 0) + (packed.inputs[input]?.contours ?? 0) <= g) input++;
      const contour = g - (packed.inputs[input]?.cbase ?? 0);
      const count = Math.max(0, r.count - 1) * RUN_VERTICES;
      if (count > 0) {
        for (let b = 0; b < (bristles[si] ?? 0); b++) {
          units.push({ input, contour, bristle: b, first, count, samples: r });
          first += count;
        }
      }
      g++;
    }
    strokes.push({ first: start, count: first - start });
  }
  return { units, strokes, count: first };
}
