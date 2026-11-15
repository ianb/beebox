// Brushed strokes expanded on the GPU (canvas-loop-gpu-brushes.subplan.md):
// the prepared strokes' contours are packed into a records buffer (a header,
// one record per contour, pressure keyframes, and one record per stamp or ink
// stroke) and a geometry buffer (every prepared point with its arc length),
// uploaded once per frame. The `samples` entry of shader-brush.ts writes one
// sample per thread into a frame-temporary buffer; for stamp strokes the
// `dabs` entry then writes one dab instance per sample, and for ink strokes the
// `capsules` entry one capsule instance per sample, into one instance buffer
// (stamps first, then inks), which the mark atlas draws. Every output index is
// fixed here, before the dispatch.
//
// Batches. No buffer exceeds `limit` (the device's storage binding and buffer
// limits, at most 64 MiB). Inputs past it are split between contours into
// several records and geometry buffers; a contour that alone exceeds it is an
// error naming the call (`checkContours`, at lowering). The samples are cut
// into batches inside each input; a batch's samples and instances go into the
// same two output buffers, reused from batch to batch within the frame's one
// command encoder: batch i's draws (`each`) are encoded before batch i + 1's
// dispatch. Samples, stamps and capsules may split at any sample (a capsule
// batch also computes the next sample, one of overlap). `planBatches` takes
// spans that must not split, for bristle (one per bristle) and smear (one per
// smear) when they move to the GPU. Packing and planning are in brush-pack.ts.
import type { Prepared } from "../scene/brush/expand.js";
import { GpuRenderError } from "../scene/errors.js";
import { timed } from "./frame.js";
import { pack, planBatches, readCopies } from "./brush-pack.js";
import type { BrushJob, Input, SampleRange } from "./brush-pack.js";
import { DAB_FLOATS, INSTANCES_WGSL, SAMPLES_WGSL, SAMPLE_FLOATS, SAMPLES_WORKGROUP, UNIFORM_WORDS } from "./shader-brush.js";
import type { PassTimer } from "./timing.js";

export type { BrushJob, SampleRange } from "./brush-pack.js";

const MAX_BINDING = 64 * 1024 * 1024;

/** A batch's output: `buffer` holds items [first, first + count) of the frame's `total`, from its start. */
export interface Batch {
  readonly buffer: GPUBuffer;
  readonly first: number;
  readonly count: number;
  readonly total: number;
}

/** What one frame's brush pass wrote: its sample count, each stroke's contour ranges, and how many batches and input buffers it used. */
export interface BrushOutputs {
  readonly count: number;
  readonly ranges: readonly (readonly SampleRange[])[];
  readonly batches: number;
  readonly inputs: number;
  /** CPU milliseconds to pack, upload and encode the pass, without the time in `each`. */
  readonly ms: number;
}

/**
 * The instances of a frame's stamp and ink strokes (`DAB_FLOATS` floats each,
 * one per sample: dabs, then capsules), each stroke's first instance and
 * count, the number of stamp instances (the capsules start there), and how
 * many batches and input buffers they took.
 */
export interface InstanceOutputs {
  readonly count: number;
  readonly strokes: readonly SampleRange[];
  readonly stamps: number;
  readonly batches: number;
  readonly inputs: number;
  /** CPU milliseconds to pack, upload and encode the pass, without the time in `each`. */
  readonly ms: number;
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
  readonly #forced: number | undefined;
  #pipes: Pipes | undefined;

  /** `limit` (tests) forces a smaller buffer limit than the device's, so batches split. */
  constructor(device: GPUDevice, options?: { limit?: number | undefined }) {
    this.#device = device;
    this.#forced = options?.limit;
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

  /** The largest buffer one batch binds: the device's storage binding and buffer limits, capped at 64 MiB (or the forced limit). */
  get limit(): number {
    const l = this.#device.limits;
    return Math.min(l.maxStorageBufferBindingSize, l.maxBufferSize, MAX_BINDING, this.#forced ?? Infinity);
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

  /**
   * Samples per batch: the instances (and the one sample of overlap a capsule
   * batch computes) or the samples fit one buffer, and one dispatch stays
   * within the device's workgroups per dimension.
   */
  #cap(instances: boolean): number {
    const most = this.limit;
    const threads = this.#device.limits.maxComputeWorkgroupsPerDimension * SAMPLES_WORKGROUP;
    const cap = instances ? Math.min(Math.floor(most / (DAB_FLOATS * 4)), Math.floor(most / (SAMPLE_FLOATS * 4)) - 1, threads - 1) : Math.min(Math.floor(most / (SAMPLE_FLOATS * 4)), threads);
    if (cap < 1) throw new GpuRenderError({ detail: `a brush buffer of ${most} bytes holds no batch` });
    return cap;
  }

  /**
   * Upload `strokes` (prepared, in brush space) and encode, batch by batch,
   * the `samples` dispatch, then, given `jobs` (one per stroke), the `dabs`
   * dispatch over the stamps' samples and the `capsules` dispatch over the
   * inks'; after each batch, `each` encodes what reads its output (the
   * instances with jobs, else the samples). Stamp strokes are packed before
   * ink strokes (a stable reorder); the ranges are returned in `strokes`
   * order. Buffers are frame-temporary (in `f.temp`) and can be copied from.
   */
  #encode(strokes: readonly Prepared[], f: Encoding & { jobs?: readonly BrushJob[]; each: (b: Batch, ranges: readonly (readonly SampleRange[])[]) => void }): BrushOutputs & { stamps: number } {
    const t0 = performance.now();
    let drawing = 0;
    const { jobs } = f;
    const isInk = (i: number): number => (jobs?.[i]?.brush.kind === "ink" ? 1 : 0);
    const order = [...strokes.keys()].toSorted((x, y) => isInk(x) - isInk(y));
    const limit = this.limit;
    const packed = pack(order.flatMap((i) => strokes[i] ?? []), { jobs: jobs === undefined ? undefined : order.flatMap((i) => jobs[i] ?? []), limit });
    const ranges: SampleRange[][] = [];
    let stamps = 0;
    for (const [k, i] of order.entries()) {
      ranges[i] = packed.ranges[k] ?? [];
      if (isInk(i) === 0) stamps += ranges[i].reduce((m, c) => m + c.count, 0);
    }
    const { count, inputs } = packed;
    if (count === 0) return { count, ranges, stamps, batches: 0, inputs: 0, ms: performance.now() - t0 };
    const cap = this.#cap(jobs !== undefined);
    // A capsule batch also computes the sample after its last (in its input), its last capsule's far end.
    const plan = inputs.flatMap((input) => planBatches(input.spans, cap).map((b) => ({ input, ...b, samples: jobs === undefined ? b.count : Math.min(b.first + b.count + 1, input.first + input.count) - b.first })));
    const S = GPUBufferUsage.STORAGE;
    const samples = this.#buffer(f, { size: Math.max(...plan.map((b) => b.samples)) * SAMPLE_FLOATS * 4, usage: S | GPUBufferUsage.COPY_SRC });
    const out = jobs === undefined ? undefined : this.#buffer(f, { size: Math.max(...plan.map((b) => b.count)) * DAB_FLOATS * 4, usage: S | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC });
    const uniform = (input: Input, a: { first: number; count: number; base: number }): GPUBuffer => {
      const words = new Uint32Array(UNIFORM_WORDS);
      words.set([a.first, a.count, input.contours, a.base, input.cbase]);
      return this.#buffer(f, { size: words.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, data: words });
    };
    const pipes = this.#pipelines;
    let bound: { input: Input; records: GPUBuffer; geometry: GPUBuffer } | undefined;
    for (const b of plan) {
      const { input } = b;
      if (bound?.input !== input) {
        bound = {
          input,
          records: this.#buffer(f, { size: input.records.byteLength, usage: S | GPUBufferUsage.COPY_DST, data: input.records }),
          geometry: this.#buffer(f, { size: input.geometry.byteLength, usage: S | GPUBufferUsage.COPY_DST, data: input.geometry }),
        };
      }
      const { records, geometry } = bound;
      const cp = f.enc.beginComputePass(timed(f, "brush"));
      cp.setPipeline(pipes.samples);
      cp.setBindGroup(0, this.#bind(pipes.samples, [[0, records], [1, geometry], [2, samples], [4, uniform(input, { first: b.first, count: b.samples, base: b.first })]]));
      cp.dispatchWorkgroups(Math.ceil(b.samples / SAMPLES_WORKGROUP));
      if (out !== undefined) {
        const end = b.first + b.count;
        for (const [pipe, lo, hi] of [[pipes.dabs, b.first, Math.min(end, stamps)], [pipes.capsules, Math.max(b.first, stamps), end]] as const) {
          if (hi <= lo) continue;
          cp.setPipeline(pipe);
          cp.setBindGroup(0, this.#bind(pipe, [[0, records], [2, samples], [3, out], [4, uniform(input, { first: lo, count: hi - lo, base: b.first })]]));
          cp.dispatchWorkgroups(Math.ceil((hi - lo) / SAMPLES_WORKGROUP));
        }
      }
      cp.end();
      const t1 = performance.now();
      f.each({ buffer: out ?? samples, first: b.first, count: b.count, total: count }, ranges);
      drawing += performance.now() - t1;
    }
    return { count, ranges, stamps, batches: plan.length, inputs: inputs.length, ms: performance.now() - t0 - drawing };
  }

  /** The `samples` dispatch alone, for `strokes` of any kind (verification and measurement); `each` reads each batch's samples. */
  encode(strokes: readonly Prepared[], f: Encoding & { each: (b: Batch) => void }): BrushOutputs {
    return this.#encode(strokes, f);
  }

  /**
   * The stamp and ink strokes' samples and instances: stroke i's instances
   * are `strokes[i]`; every stamp's come before every ink's, otherwise in
   * `jobs` order. `each` draws (or reads) each batch's instances; it is
   * given the strokes' ranges too.
   */
  encodeMarks(jobs: readonly BrushJob[], f: Encoding & { each: (b: Batch, strokes: readonly SampleRange[]) => void }): InstanceOutputs {
    const strokesOf = (ranges: readonly (readonly SampleRange[])[]): SampleRange[] => ranges.map((r) => ({ first: r[0]?.first ?? 0, count: r.reduce((n, c) => n + c.count, 0) }));
    let strokes: SampleRange[] | undefined;
    const out = this.#encode(jobs.map((s) => s.prepared), { ...f, jobs, each: (b, ranges) => f.each(b, (strokes ??= strokesOf(ranges))) });
    return { count: out.count, strokes: strokes ?? strokesOf(out.ranges), stamps: out.stamps, batches: out.batches, inputs: out.inputs, ms: out.ms };
  }
}

/**
 * Verification and measurement: encode with `encode` on a new command
 * encoder, copying each batch's output (`bytes` per item) back into readback
 * buffers of at most `limit` bytes each (a frame's items can exceed the
 * device's `maxBufferSize`), and join them on the CPU. Reports the CPU time to
 * encode, the brush passes' GPU time when timing, and how many readback
 * buffers it used.
 */
export async function readBrushPass<T>(device: GPUDevice, a: { timer: PassTimer | undefined; bytes: number; limit: number; encode: (f: Encoding & { each: (b: Batch) => void }) => T }): Promise<{ out: T; data: ArrayBuffer; reads: number; encodeMs: number; gpuMs: number | undefined }> {
  const temp: GPUBuffer[] = [];
  const per = Math.floor(Math.min(a.limit, device.limits.maxBufferSize) / a.bytes);
  try {
    a.timer?.begin();
    const enc = device.createCommandEncoder();
    // Made at the first batch, which gives the total.
    const held: { reads?: GPUBuffer[]; total?: number } = {};
    const each = (b: Batch): void => {
      const reads = (held.reads ??= Array.from({ length: Math.ceil(b.total / per) }, (_, i) => device.createBuffer({ size: Math.min(per, b.total - i * per) * a.bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })));
      if (held.total === undefined) {
        held.total = b.total;
        temp.push(...reads);
      }
      for (const c of readCopies(b, per)) {
        const r = reads[c.chunk];
        if (r === undefined) throw new GpuRenderError({ detail: `a brush batch reads back past its frame's ${b.total} items` });
        enc.copyBufferToBuffer(b.buffer, c.src * a.bytes, r, c.dst * a.bytes, c.count * a.bytes);
      }
    };
    const t0 = performance.now();
    const out = a.encode({ enc, temp, timer: a.timer, each });
    const encodeMs = performance.now() - t0;
    const times = a.timer?.resolve(enc, temp);
    device.queue.submit([enc.finish()]);
    const reads = held.reads ?? [];
    const data = new Uint8Array((held.total ?? 0) * a.bytes);
    for (const [i, r] of reads.entries()) {
      await r.mapAsync(GPUMapMode.READ);
      data.set(new Uint8Array(r.getMappedRange()), i * per * a.bytes);
      r.unmap();
    }
    const gpu = times === undefined || a.timer === undefined ? undefined : await a.timer.read(times);
    return { out, data: data.buffer, reads: reads.length, encodeMs, gpuMs: gpu?.kinds.brush?.ms };
  } finally {
    for (const b of temp) b.destroy();
  }
}
