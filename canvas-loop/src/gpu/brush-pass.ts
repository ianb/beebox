// Brushed strokes expanded on the GPU (canvas-loop-gpu-brushes.subplan.md):
// the prepared strokes' contours are packed into a records buffer (a header,
// one record per contour, pressure keyframes, and one record per stamp or ink
// stroke) and a geometry buffer (every prepared point with its arc length),
// uploaded once per frame. The `samples` entry of shader-brush.ts writes one
// sample per thread into a frame-temporary buffer; for stamp strokes the
// `dabs` entry then writes one dab instance per sample, and for ink strokes the
// `capsules` entry one capsule instance per sample, into one instance buffer
// (stamps first, then inks), which the mark atlas draws. Every output index is
// fixed here, before the dispatch. One batch: inputs and outputs must each fit
// one storage binding (at most 64 MiB), else the frame fails naming the sizes.
import type { Envelope, InkBrush, StampBrush } from "../core/brush/types.js";
import type { Prepared, PreparedContour } from "../scene/brush/expand.js";
import { GpuRenderError } from "../scene/errors.js";
import { timed } from "./frame.js";
import { POINT_WORDS } from "../scene/brush/expand.js";
import { CONTOUR_WORDS, DAB_FLOATS, INSTANCES_WGSL, ENVELOPE_KINDS, RECORD_HEAD, SAMPLES_WGSL, SAMPLE_FLOATS, SAMPLES_WORKGROUP, STROKE_WORDS } from "./shader-brush.js";
import type { PassTimer } from "./timing.js";

const MAX_BINDING = 64 * 1024 * 1024;

/** A contour's samples: the first index in the samples buffer, and how many. */
export interface SampleRange {
  readonly first: number;
  readonly count: number;
}

/** What one frame's brush pass wrote: the samples buffer (undefined with no strokes), its sample count, and each stroke's contour ranges. */
export interface BrushOutputs {
  readonly samples: GPUBuffer | undefined;
  readonly count: number;
  readonly ranges: readonly (readonly SampleRange[])[];
}

/** A stamp or ink stroke placed in the mark atlas: what the `dabs` or `capsules` entry needs besides its prepared stroke. */
export interface BrushJob {
  readonly prepared: Prepared;
  readonly brush: StampBrush | InkBrush;
  /** Brush space → device pixels, linear part (pixel ratio included). */
  readonly lin: readonly [number, number, number, number];
  readonly ratio: number;
  /** Added to a dab's linearly mapped position: the mark's translation less its box corner (the stroke's origin is added in stampWords). */
  readonly offset: readonly [number, number];
  /** The mark's slot on its page: x0, y0, x1, y1. */
  readonly slot: readonly [number, number, number, number];
}

/**
 * The instances of a frame's stamp and ink strokes (`DAB_FLOATS` floats each,
 * one per sample: dabs, then capsules), each stroke's first instance and
 * count, and the number of stamp instances (the capsules start there).
 */
export interface InstanceOutputs {
  readonly instances: GPUBuffer | undefined;
  readonly count: number;
  readonly strokes: readonly SampleRange[];
  readonly stamps: number;
}

/** The keyframes as the CPU reads them: a frame followed by one at the same t is skipped (envelope.ts). */
function keyframesOf(env: readonly (readonly [number, number])[]): number[] {
  return env.flatMap((f, i) => (env[i + 1]?.[0] === f[0] ? [] : [f[0], f[1]]));
}

function envelopeWords(env: Envelope): { kind: number; value: number; keys: number[] } {
  if (typeof env === "number") return { kind: ENVELOPE_KINDS.constant, value: env, keys: [] };
  if (typeof env === "string") return { kind: ENVELOPE_KINDS[env], value: 0, keys: [] };
  return { kind: ENVELOPE_KINDS.keyframes, value: 0, keys: keyframesOf(env) };
}

/** A stamp or ink stroke's record (shader-brush.ts lists the words). */
function strokeWords(j: BrushJob): number[] {
  const b = j.brush;
  // The samples are relative to the stroke's origin: its mapped position joins the offset here, in f64.
  const [l0, l1, l2, l3] = j.lin;
  const [ox, oy] = j.prepared.origin;
  const offset = [j.offset[0] + l0 * ox + l2 * oy, j.offset[1] + l1 * ox + l3 * oy];
  const head = [...j.lin, ...offset, ...j.slot, j.prepared.width, j.ratio];
  if (b.kind === "ink") return [...head, b.thinning];
  const base = j.prepared.base;
  const soft = b.tip === "soft" ? 1 : 0;
  return [...head, b.sizeJitter, b.sizeByPressure, b.flow, b.opacityByPressure, b.scatter, soft, b.hueJitter ?? 0, b.lightJitter ?? 0, base?.r ?? 0, base?.g ?? 0, base?.b ?? 0, base === undefined ? 0 : 1];
}

/** The records and geometry buffers' contents for `strokes`' contours (in order), with a record per stroke when `words` gives one, and their sample ranges. */
function pack(strokes: readonly Prepared[], words: readonly (readonly number[])[] | undefined): { records: ArrayBuffer; geometry: Uint32Array<ArrayBuffer>; count: number; contours: number; ranges: SampleRange[][] } {
  const all: { c: PreparedContour; wobble: number; si: number }[] = strokes.flatMap((s, si) => s.contours.map((c) => ({ c, wobble: s.wobble, si })));
  const envs = all.map((a) => envelopeWords(a.c.pressure));
  const keyWords = envs.reduce((n, e) => n + e.keys.length, 0);
  const keyAt = RECORD_HEAD + all.length * CONTOUR_WORDS;
  const strokeAt = keyAt + keyWords;
  const records = new ArrayBuffer((strokeAt + (words?.length ?? 0) * STROKE_WORDS) * 4);
  const ru = new Uint32Array(records);
  const rf = new Float32Array(records);
  const geometry = new Uint32Array(all.reduce((n, a) => n + a.c.geom.length, 0));
  let point = 0;
  let sample = 0;
  let key = keyAt;
  for (const [i, { c, wobble, si }] of all.entries()) {
    const at = RECORD_HEAD + i * CONTOUR_WORDS;
    const env = envs[i] ?? { kind: 1, value: 0, keys: [] };
    const points = c.geom.length / POINT_WORDS;
    // Copied as words: the fourth word of each point is a u32.
    geometry.set(new Uint32Array(c.geom.buffer, c.geom.byteOffset, c.geom.length), point * POINT_WORDS);
    ru.set([point, points, sample, c.count, c.seed], at);
    rf.set([c.step, c.total, c.cell], at + 5);
    ru[at + 8] = c.period ?? 0;
    rf[at + 9] = wobble;
    ru[at + 10] = env.kind;
    if (env.kind === ENVELOPE_KINDS.keyframes) ru.set([key, env.keys.length / 2], at + 11);
    else rf[at + 11] = env.value;
    ru[at + 13] = strokeAt + si * STROKE_WORDS;
    rf.set(env.keys, key);
    key += env.keys.length;
    point += points;
    sample += c.count;
  }
  for (const [i, w] of (words ?? []).entries()) rf.set(w, strokeAt + i * STROKE_WORDS);
  ru.set([all.length, sample], 0);
  let first = 0;
  const ranges = strokes.map((s) => s.contours.map((c) => {
    const r = { first, count: c.count };
    first += c.count;
    return r;
  }));
  return { records, geometry, count: sample, contours: all.length, ranges };
}

interface Pipes {
  readonly samples: GPUComputePipeline;
  readonly dabs: GPUComputePipeline;
  readonly capsules: GPUComputePipeline;
}

interface Encoding {
  readonly enc: GPUCommandEncoder;
  readonly temp: GPUBuffer[];
  readonly timer: PassTimer | undefined;
}

export class BrushPass {
  readonly #device: GPUDevice;
  #pipes: Pipes | undefined;

  constructor(device: GPUDevice) {
    this.#device = device;
  }

  /** The pipelines, made on first use (a frame with no stamp or ink strokes never compiles them). */
  get #pipelines(): Pipes {
    const d = this.#device;
    if (this.#pipes === undefined) {
      const instances = d.createShaderModule({ code: INSTANCES_WGSL });
      const make = (module: GPUShaderModule, entryPoint: string): GPUComputePipeline => d.createComputePipeline({ layout: "auto", compute: { module, entryPoint } });
      this.#pipes = { samples: make(d.createShaderModule({ code: SAMPLES_WGSL }), "samples"), dabs: make(instances, "dabs"), capsules: make(instances, "capsules") };
    }
    return this.#pipes;
  }

  /** The largest buffer one batch binds: the device's storage binding and buffer limits, capped at 64 MiB. */
  get limit(): number {
    const l = this.#device.limits;
    return Math.min(l.maxStorageBufferBindingSize, l.maxBufferSize, MAX_BINDING);
  }

  #buffer(f: { temp: GPUBuffer[] }, a: { size: number; usage: number; data?: ArrayBuffer | ArrayBufferView<ArrayBuffer> }): GPUBuffer {
    const buf = this.#device.createBuffer({ size: Math.max(16, Math.ceil(a.size / 4) * 4), usage: a.usage });
    if (a.data !== undefined) this.#device.queue.writeBuffer(buf, 0, a.data);
    f.temp.push(buf);
    return buf;
  }

  #bind(pipe: GPUComputePipeline, entries: readonly (readonly [number, GPUBuffer])[]): GPUBindGroup {
    return this.#device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: entries.map(([binding, buffer]) => ({ binding, resource: { buffer } })) });
  }

  /** Fail the frame, naming the sizes, when one batch cannot hold it (until chunk 5 splits batches). */
  #check(p: { count: number; contours: number; buffers: readonly (readonly [string, number])[] }): number {
    const groups = Math.ceil(p.count / SAMPLES_WORKGROUP);
    const most = this.limit;
    const over = p.buffers.filter(([, n]) => n > most);
    const perDim = this.#device.limits.maxComputeWorkgroupsPerDimension;
    if (over.length > 0 || groups > perDim) {
      const sizes = over.map(([name, n]) => `${name} ${(n / 1048576).toFixed(1)} MiB`).join(", ");
      throw new GpuRenderError({ detail: `this frame's brushed strokes need ${p.count} samples over ${p.contours} contours${sizes === "" ? "" : ` (${sizes})`}, more than one brush batch holds (${(most / 1048576).toFixed(0)} MiB a buffer, ${perDim * SAMPLES_WORKGROUP} samples)` });
    }
    return groups;
  }

  /**
   * Upload `strokes` (prepared, in brush space) and encode the `samples`
   * dispatch on `f.enc`, then, given `jobs` (one per stroke), the `dabs`
   * dispatch over the stamps' samples and the `capsules` dispatch over the
   * inks'. Stamp strokes are packed before ink strokes (a stable reorder);
   * the ranges are returned in `strokes` order. Output buffers are
   * frame-temporary (in `f.temp`) and can be copied from.
   */
  #encode(strokes: readonly Prepared[], f: Encoding & { jobs?: readonly BrushJob[] }): BrushOutputs & { instances: GPUBuffer | undefined; stamps: number } {
    const { jobs } = f;
    const isInk = (i: number): number => (jobs?.[i]?.brush.kind === "ink" ? 1 : 0);
    const order = [...strokes.keys()].toSorted((x, y) => isInk(x) - isInk(y));
    const packed = pack(order.flatMap((i) => strokes[i] ?? []), jobs === undefined ? undefined : order.flatMap((i) => (jobs[i] === undefined ? [] : [strokeWords(jobs[i])])));
    const ranges: SampleRange[][] = [];
    let stamps = 0;
    for (const [k, i] of order.entries()) {
      ranges[i] = packed.ranges[k] ?? [];
      if (isInk(i) === 0) stamps += ranges[i].reduce((m, c) => m + c.count, 0);
    }
    const p = { ...packed, ranges };
    if (p.count === 0) return { samples: undefined, instances: undefined, count: 0, ranges: p.ranges, stamps };
    const bytes = p.count * SAMPLE_FLOATS * 4;
    const instanceBytes = f.jobs === undefined ? 0 : p.count * DAB_FLOATS * 4;
    const groups = this.#check({ count: p.count, contours: p.contours, buffers: [["records", p.records.byteLength], ["geometry", p.geometry.byteLength], ["samples", bytes], ["instances", instanceBytes]] });
    const S = GPUBufferUsage.STORAGE;
    const records = this.#buffer(f, { size: p.records.byteLength, usage: S | GPUBufferUsage.COPY_DST, data: p.records });
    const geometry = this.#buffer(f, { size: p.geometry.byteLength, usage: S | GPUBufferUsage.COPY_DST, data: p.geometry });
    const samples = this.#buffer(f, { size: bytes, usage: S | GPUBufferUsage.COPY_SRC });
    const range = (first: number, count: number): GPUBuffer => this.#buffer(f, { size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, data: new Uint32Array([first, count, p.contours, 0]) });
    const pipes = this.#pipelines;
    const cp = f.enc.beginComputePass(timed(f, "brush"));
    cp.setPipeline(pipes.samples);
    cp.setBindGroup(0, this.#bind(pipes.samples, [[0, records], [1, geometry], [2, samples], [4, range(0, p.count)]]));
    cp.dispatchWorkgroups(groups);
    let instances: GPUBuffer | undefined;
    if (f.jobs !== undefined) {
      const out = this.#buffer(f, { size: instanceBytes, usage: S | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC });
      for (const [pipe, first, count] of [[pipes.dabs, 0, stamps], [pipes.capsules, stamps, p.count - stamps]] as const) {
        if (count === 0) continue;
        cp.setPipeline(pipe);
        cp.setBindGroup(0, this.#bind(pipe, [[0, records], [2, samples], [3, out], [4, range(first, count)]]));
        cp.dispatchWorkgroups(Math.ceil(count / SAMPLES_WORKGROUP));
      }
      instances = out;
    }
    cp.end();
    return { samples, instances, count: p.count, ranges: p.ranges, stamps };
  }

  /** The `samples` dispatch alone, for `strokes` of any kind (verification and measurement). */
  encode(strokes: readonly Prepared[], f: Encoding): BrushOutputs {
    return this.#encode(strokes, f);
  }

  /** The stamp and ink strokes' samples and instances: stroke i's instances are `strokes[i]`; every stamp's come before every ink's, otherwise in `jobs` order. */
  encodeMarks(jobs: readonly BrushJob[], f: Encoding): InstanceOutputs {
    const out = this.#encode(jobs.map((s) => s.prepared), { ...f, jobs });
    const strokes = out.ranges.map((r) => ({ first: r[0]?.first ?? 0, count: r.reduce((n, c) => n + c.count, 0) }));
    return { instances: out.instances, count: out.count, strokes, stamps: out.stamps };
  }
}

/**
 * Verification and measurement: encode with `encode` on a new command
 * encoder, copy the buffer it names back, and report the CPU time to encode
 * and the brush pass's GPU time when timing.
 */
export async function readBrushPass<T extends { buffer: GPUBuffer | undefined; bytes: number }>(device: GPUDevice, a: { timer: PassTimer | undefined; encode: (f: Encoding) => T }): Promise<{ out: T; data: ArrayBuffer; encodeMs: number; gpuMs: number | undefined }> {
  const temp: GPUBuffer[] = [];
  try {
    a.timer?.begin();
    const enc = device.createCommandEncoder();
    const t0 = performance.now();
    const out = a.encode({ enc, temp, timer: a.timer });
    const encodeMs = performance.now() - t0;
    const read = out.buffer === undefined ? undefined : device.createBuffer({ size: out.bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    if (read !== undefined && out.buffer !== undefined) {
      temp.push(read);
      enc.copyBufferToBuffer(out.buffer, 0, read, 0, out.bytes);
    }
    const times = a.timer?.resolve(enc, temp);
    device.queue.submit([enc.finish()]);
    let data = new ArrayBuffer(0);
    if (read !== undefined) {
      await read.mapAsync(GPUMapMode.READ);
      data = read.getMappedRange().slice(0);
      read.unmap();
    }
    const gpu = times === undefined || a.timer === undefined ? undefined : await a.timer.read(times);
    return { out, data, encodeMs, gpuMs: gpu?.kinds.brush?.ms };
  } finally {
    for (const b of temp) b.destroy();
  }
}
