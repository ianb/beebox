// Brushed strokes expanded on the GPU (canvas-loop-gpu-brushes.subplan.md):
// the prepared strokes' contours are packed into a records buffer (a header,
// one record per contour, pressure keyframes) and a geometry buffer (every
// prepared point with its arc length), uploaded once per frame, and the
// `samples` entry of shader-brush.ts writes one sample per thread into a
// frame-temporary buffer. Every output index is fixed here, before the
// dispatch. One batch: inputs and samples must each fit one storage binding
// (at most 64 MiB), else the frame fails naming the sizes.
import type { Envelope } from "../core/brush/types.js";
import type { Prepared, PreparedContour } from "../scene/brush/expand.js";
import { GpuRenderError } from "../scene/errors.js";
import { timed } from "./frame.js";
import { POINT_WORDS } from "../scene/brush/expand.js";
import { BRUSH_WGSL, CONTOUR_WORDS, ENVELOPE_KINDS, RECORD_HEAD, SAMPLE_FLOATS, SAMPLES_WORKGROUP } from "./shader-brush.js";
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

/** The keyframes as the CPU reads them: a frame followed by one at the same t is skipped (envelope.ts). */
function keyframesOf(env: readonly (readonly [number, number])[]): number[] {
  return env.flatMap((f, i) => (env[i + 1]?.[0] === f[0] ? [] : [f[0], f[1]]));
}

function envelopeWords(env: Envelope): { kind: number; value: number; keys: number[] } {
  if (typeof env === "number") return { kind: ENVELOPE_KINDS.constant, value: env, keys: [] };
  if (typeof env === "string") return { kind: ENVELOPE_KINDS[env], value: 0, keys: [] };
  return { kind: ENVELOPE_KINDS.keyframes, value: 0, keys: keyframesOf(env) };
}

/** The records and geometry buffers' contents for `strokes`' contours (in order), and their sample ranges. */
function pack(strokes: readonly Prepared[]): { records: ArrayBuffer; geometry: Uint32Array<ArrayBuffer>; count: number; contours: number; ranges: SampleRange[][] } {
  const all: { c: PreparedContour; wobble: number }[] = strokes.flatMap((s) => s.contours.map((c) => ({ c, wobble: s.wobble })));
  const envs = all.map((a) => envelopeWords(a.c.pressure));
  const keyWords = envs.reduce((n, e) => n + e.keys.length, 0);
  const keyAt = RECORD_HEAD + all.length * CONTOUR_WORDS;
  const records = new ArrayBuffer((keyAt + keyWords) * 4);
  const ru = new Uint32Array(records);
  const rf = new Float32Array(records);
  const geometry = new Uint32Array(all.reduce((n, a) => n + a.c.geom.length, 0));
  let point = 0;
  let sample = 0;
  let key = keyAt;
  for (const [i, { c, wobble }] of all.entries()) {
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
    rf.set(env.keys, key);
    key += env.keys.length;
    point += points;
    sample += c.count;
  }
  ru.set([all.length, sample], 0);
  let first = 0;
  const ranges = strokes.map((s) => s.contours.map((c) => {
    const r = { first, count: c.count };
    first += c.count;
    return r;
  }));
  return { records, geometry, count: sample, contours: all.length, ranges };
}

export class BrushPass {
  readonly #device: GPUDevice;
  readonly #samples: GPUComputePipeline;

  constructor(device: GPUDevice) {
    this.#device = device;
    this.#samples = device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code: BRUSH_WGSL }), entryPoint: "samples" } });
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

  /**
   * Upload `strokes` (prepared, in brush space) and encode the `samples`
   * dispatch on `f.enc`. The samples buffer is frame-temporary (in `f.temp`)
   * and can be copied from.
   */
  encode(strokes: readonly Prepared[], f: { enc: GPUCommandEncoder; temp: GPUBuffer[]; timer: PassTimer | undefined }): BrushOutputs {
    const p = pack(strokes);
    if (p.count === 0) return { samples: undefined, count: 0, ranges: p.ranges };
    const bytes = p.count * SAMPLE_FLOATS * 4;
    const groups = Math.ceil(p.count / SAMPLES_WORKGROUP);
    const most = this.limit;
    const over = [["records", p.records.byteLength], ["geometry", p.geometry.byteLength], ["samples", bytes]].filter(([, n]) => Number(n) > most);
    if (over.length > 0 || groups > this.#device.limits.maxComputeWorkgroupsPerDimension) {
      const sizes = over.map(([name, n]) => `${name} ${(Number(n) / 1048576).toFixed(1)} MiB`).join(", ");
      throw new GpuRenderError({ detail: `this frame's brushed strokes need ${p.count} samples over ${p.contours} contours${sizes === "" ? "" : ` (${sizes})`}, more than one brush batch holds (${(most / 1048576).toFixed(0)} MiB a buffer, ${this.#device.limits.maxComputeWorkgroupsPerDimension * SAMPLES_WORKGROUP} samples)` });
    }
    const S = GPUBufferUsage.STORAGE;
    const records = this.#buffer(f, { size: p.records.byteLength, usage: S | GPUBufferUsage.COPY_DST, data: p.records });
    const geometry = this.#buffer(f, { size: p.geometry.byteLength, usage: S | GPUBufferUsage.COPY_DST, data: p.geometry });
    const samples = this.#buffer(f, { size: bytes, usage: S | GPUBufferUsage.COPY_SRC });
    const uniform = this.#buffer(f, { size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, data: new Uint32Array([0, p.count, p.contours, 0]) });
    const entries = [[0, records], [1, geometry], [2, samples], [4, uniform]] as const;
    const group = this.#device.createBindGroup({ layout: this.#samples.getBindGroupLayout(0), entries: entries.map(([binding, buffer]) => ({ binding, resource: { buffer } })) });
    const cp = f.enc.beginComputePass(timed(f, "brush"));
    cp.setPipeline(this.#samples);
    cp.setBindGroup(0, group);
    cp.dispatchWorkgroups(groups);
    cp.end();
    return { samples, count: p.count, ranges: p.ranges };
  }
}
