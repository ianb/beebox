// The mark atlas: every stamp, ink and bristle mark of a frame gets a slot on
// an rgba8 page, where the GPU lays its dabs, capsules or bristle strips
// (shader-mark.ts). Stamp marks' dabs and ink marks' capsules are written
// on the GPU (brush-pass.ts) into one buffer per batch, dabs then capsules,
// each ordered by page; after each batch, each page draws its part of it.
// Bristle marks' strips follow, in batches of their own (cut between
// bristles), and a bristle contour of one sample is a dab laid with the
// stamps'. A mark's draw then reads its slot (src 3 or 4 in the draw shader),
// so a mark's opacity applies once however many dabs, capsules or strips
// overlap.
import type { BristleBrush } from "../core/brush/types.js";
import type { AtlasPage } from "./atlas.js";
import { shelfPack } from "./atlas.js";
import type { R, TexMark } from "./jobs.js";
import { ATLAS_MAX, heightOf, widthOf } from "./jobs.js";
import type { TexturePool } from "./pool.js";
import { timed } from "./frame.js";
import type { PassTimer } from "./timing.js";
import { MARK_WGSL } from "./shader-mark.js";
import { BrushPass } from "./brush-pass.js";
import type { Batch, BrushJob, SampleRange } from "./brush-pass.js";
import { scratchNeed } from "./brush-pack.js";
import type { Prepared } from "../scene/brush/expand.js";
import type { FrameStats } from "./frame.js";
import { DAB_FLOATS } from "./shader-brush.js";
import { RUN_FLOATS } from "./shader-bristle.js";

const MAX = ATLAS_MAX;

/** A mark with its slot (packed). */
type GpuMark = TexMark & { slot: NonNullable<TexMark["slot"]> };

/** A stamp, ink or bristle mark (packed) as the `dabs`, `capsules` or `bristles` entry takes it. */
function brushJob(m: GpuMark): BrushJob {
  const [x0, y0, x1, y1] = slotRect(m.box, m.slot);
  return { ...m.gpu, offset: [m.ox - m.box.x0, m.oy - m.box.y0], slot: [x0 ?? 0, y0 ?? 0, x1 ?? 0, y1 ?? 0] };
}

/**
 * A bristle stroke's contours of one sample, as a stamp job: such a contour
 * is one hard dab of radius
 * `width / 2 × (0.35 + 0.65 p)` at the brush flow, in bristle 0's colour, which
 * is the `dabs` entry's dab 0 with sizeByPressure 0.65 and nothing else
 * varied; `dot` keeps the stamp skip rule off, since a bristle stroke draws every
 * dot. Undefined when the stroke has none.
 */
export function bristleDots(job: BrushJob, brush: BristleBrush): BrushJob | undefined {
  const contours = job.prepared.contours.filter((c) => c.count === 1);
  if (contours.length === 0) return undefined;
  const dot = { kind: "stamp", opacity: brush.opacity, grain: brush.grain, tip: "hard", spacing: 1, flow: brush.flow, sizeByPressure: 0.65, opacityByPressure: 0, scatter: 0, sizeJitter: 0, hueJitter: brush.hueJitter ?? 0, lightJitter: brush.lightJitter ?? 0 } as const;
  return { ...job, prepared: { ...job.prepared, contours }, brush: dot, dot: true };
}

/** Each page's range of instances or vertices, for one kind. */
type PageRanges = Map<number, { first: number; count: number }>;

/** What one batch draws on each page: per pipeline, the pages' ranges; instanced (six vertices per dab or capsule) or a vertex range (bristle strips). */
interface BatchDraws {
  readonly batch: Batch;
  readonly draws: readonly { readonly pipe: GPURenderPipeline; readonly ranges: PageRanges; readonly instanced: boolean }[];
}

/** Each page's range of items: stroke i's range is `strokes[i]` and its page `pages[i]` (undefined: not this kind); a page's strokes are consecutive. */
function pageRanges(pages: readonly (number | undefined)[], strokes: readonly SampleRange[]): PageRanges {
  const by: PageRanges = new Map();
  for (const [i, page] of pages.entries()) {
    const r = strokes[i] ?? { first: 0, count: 0 };
    if (page === undefined) continue;
    const at = by.get(page);
    by.set(page, at === undefined ? { ...r } : { first: at.first, count: at.count + r.count });
  }
  return by;
}

export class MarkAtlas {
  readonly #device: GPUDevice;
  readonly #dab: GPURenderPipeline;
  readonly #run: GPURenderPipeline;
  readonly #capsule: GPURenderPipeline;
  /** The GPU brush expansion: stamp marks' dabs and ink marks' capsules. */
  readonly brushes: BrushPass;

  /** `brushLimit` (tests) forces the brush pass's buffer limit down, so its batches split. */
  constructor(device: GPUDevice, options?: { brushLimit?: number | undefined }) {
    this.#device = device;
    this.brushes = new BrushPass(device, { limit: options?.brushLimit });
    const module = device.createShaderModule({ code: MARK_WGSL });
    const over: GPUBlendState = { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } };
    const target: GPUColorTargetState = { format: "rgba8unorm", blend: over };
    const attrs = (step: GPUVertexStepMode, count: number): GPUVertexBufferLayout => ({
      arrayStride: count * 16,
      stepMode: step,
      attributes: Array.from({ length: count }, (_, shaderLocation) => ({ shaderLocation, offset: shaderLocation * 16, format: "float32x4" as const })),
    });
    this.#dab = device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "dabVs", buffers: [attrs("instance", DAB_FLOATS / 4)] }, fragment: { module, entryPoint: "dabFs", targets: [target] } });
    this.#run = device.createRenderPipeline({ layout: "auto", primitive: { topology: "triangle-list", cullMode: "none" }, vertex: { module, entryPoint: "runVs", buffers: [attrs("vertex", RUN_FLOATS / 4)] }, fragment: { module, entryPoint: "runFs", targets: [target] } });
    // The capsule union: each channel keeps the larger value (WebGPU's max takes factors "one").
    const most: GPUBlendComponent = { operation: "max", srcFactor: "one", dstFactor: "one" };
    this.#capsule = device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "capVs", buffers: [attrs("instance", DAB_FLOATS / 4)] }, fragment: { module, entryPoint: "capFs", targets: [{ format: "rgba8unorm", blend: { color: most, alpha: most } }] } });
  }

  /**
   * Pack `marks`, lay their dabs, capsules and strips, and return the pages
   * (pool textures the caller releases). The instances come in batches
   * (brush-pass.ts); after each batch's dispatch, each page with instances in
   * it draws them, its first pass clearing it and later ones with `loadOp:
   * "load"`. With one batch, each page has one pass.
   */
  build(marks: readonly TexMark[], f: { enc: GPUCommandEncoder; pool: TexturePool; temp: GPUBuffer[]; timer: PassTimer | undefined; stats: FrameStats }): AtlasPage[] {
    const widest = marks.reduce((w, m) => Math.max(w, widthOf(m.box) + 1), 0);
    const sizes = shelfPack(marks, Math.min(MAX, Math.max(widest, 1024)));
    const texs = sizes.map((size) => f.pool.acquire({ w: size.w, h: size.h, format: "rgba8unorm" }));
    const begun = new Set<number>();
    const pass = (page: number, gpu: BatchDraws | undefined): void => {
      const tex = texs[page];
      if (tex === undefined) return;
      const first = !begun.has(page);
      begun.add(page);
      const p = f.enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: first ? "clear" : "load", clearValue: [0, 0, 0, 0], storeOp: "store" }], ...timed(f, "marks") });
      const uni = this.#buffer(new Float32Array([tex.width, tex.height, 0, 0]), { usage: GPUBufferUsage.UNIFORM, temp: f.temp });
      const bind = (pipe: GPURenderPipeline): void => {
        p.setPipeline(pipe);
        p.setBindGroup(0, this.#device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uni } }] }));
      };
      for (const d of gpu?.draws ?? []) {
        const r = gpu === undefined ? undefined : within(d.ranges.get(page), gpu.batch);
        if (gpu === undefined || r === undefined) continue;
        bind(d.pipe);
        p.setVertexBuffer(0, gpu.batch.buffer);
        if (d.instanced) p.draw(6, r.count, 0, r.first - gpu.batch.first);
        else p.draw(r.count, 1, r.first - gpu.batch.first);
      }
      p.end();
    };
    const brushed = this.#gpuMarks(marks, { ...f, each: (gpu) => {
      for (const page of texs.keys()) if (!begun.has(page) || gpu.draws.some((d) => within(d.ranges.get(page), gpu.batch) !== undefined)) pass(page, gpu);
    } });
    f.stats.brushBatches = brushed.batches;
    f.stats.cpu.brush += brushed.ms;
    for (const page of texs.keys()) if (!begun.has(page)) pass(page, undefined);
    return texs.map((tex) => ({ tex, width: tex.width, height: tex.height }));
  }

  /**
   * Encode the stamp marks' dabs (with bristle marks' one-sample dots) and
   * the ink marks' capsules (stamps first, each kind ordered by page), then
   * the bristle marks' strips (ordered by page), calling `each` after each
   * batch with what each page draws from it; returns the number of batches
   * and the CPU milliseconds to pack, upload and encode them (draws excluded).
   */
  #gpuMarks(marks: readonly TexMark[], f: { enc: GPUCommandEncoder; temp: GPUBuffer[]; timer: PassTimer | undefined; each: (gpu: BatchDraws) => void }): { batches: number; ms: number } {
    const placed = marks.flatMap((m): GpuMark[] => (m.slot === undefined ? [] : [{ ...m, slot: m.slot }]));
    if (placed.length === 0) return { batches: 0, ms: 0 };
    const items = placed.flatMap((m): { m: GpuMark; job: BrushJob }[] => {
      const job = brushJob(m);
      if (m.gpu.brush.kind !== "bristle") return [{ m, job }];
      const dots = bristleDots(job, m.gpu.brush);
      return dots === undefined ? [] : [{ m, job: dots }];
    });
    const ink = (it: { job: BrushJob }): number => (it.job.brush.kind === "ink" ? 1 : 0);
    const sorted = items.toSorted((a, b) => ink(a) - ink(b) || a.m.slot.page - b.m.slot.page);
    let draws: BatchDraws["draws"] | undefined;
    const drawsOf = (strokes: readonly SampleRange[]): BatchDraws["draws"] => {
      const at = (k: number): (number | undefined)[] => sorted.map((it) => (ink(it) === k ? it.m.slot.page : undefined));
      return [{ pipe: this.#dab, ranges: pageRanges(at(0), strokes), instanced: true }, { pipe: this.#capsule, ranges: pageRanges(at(1), strokes), instanced: true }];
    };
    const out = sorted.length === 0 ? { batches: 0, ms: 0 } : this.brushes.encodeMarks(sorted.map((it) => it.job), { ...f, each: (batch, strokes) => f.each({ batch, draws: (draws ??= drawsOf(strokes)) }) });
    const bristles = placed.filter((m) => m.gpu.brush.kind === "bristle").toSorted((a, b) => a.slot.page - b.slot.page);
    let runs: BatchDraws["draws"] | undefined;
    const strips = bristles.length === 0 ? { batches: 0, ms: 0 } : this.brushes.encodeBristles(bristles.map(brushJob), { ...f, each: (batch, strokes) => f.each({ batch, draws: (runs ??= [{ pipe: this.#run, ranges: pageRanges(bristles.map((m) => m.slot.page), strokes), instanced: false }]) }) });
    return { batches: out.batches + strips.batches, ms: out.ms + strips.ms };
  }

  /** Reserve the frame's one brush sample buffer and output buffer, shared by this atlas's batches and every smear (`smears`, drawn later); returns its bytes, 0 when the frame has no brushes. */
  reserve(marks: readonly TexMark[], f: { smears: readonly Prepared[]; temp: GPUBuffer[] }): number {
    const need = scratchNeed({ gpu: marks.map((m) => m.gpu), smears: f.smears, limit: this.brushes.limit });
    return need.samples > 0 || need.out > 0 ? this.brushes.reserve(f, need) : 0;
  }

  /** Verification: draw capsule instances into `tex` (cleared first), in their order. */
  drawCapsules(data: Float32Array<ArrayBuffer>, f: { enc: GPUCommandEncoder; tex: GPUTexture; temp: GPUBuffer[] }): void {
    const pass = f.enc.beginRenderPass({ colorAttachments: [{ view: f.tex.createView(), loadOp: "clear", clearValue: [0, 0, 0, 0], storeOp: "store" }] });
    const uni = this.#buffer(new Float32Array([f.tex.width, f.tex.height, 0, 0]), { usage: GPUBufferUsage.UNIFORM, temp: f.temp });
    pass.setPipeline(this.#capsule);
    pass.setBindGroup(0, this.#device.createBindGroup({ layout: this.#capsule.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uni } }] }));
    pass.setVertexBuffer(0, this.#buffer(data, { usage: GPUBufferUsage.VERTEX, temp: f.temp }));
    pass.draw(6, data.length / DAB_FLOATS);
    pass.end();
  }

  #buffer(data: Float32Array, b: { usage: number; temp: GPUBuffer[] }): GPUBuffer {
    const buf = this.#device.createBuffer({ size: Math.max(16, data.byteLength), usage: b.usage | GPUBufferUsage.COPY_DST });
    this.#device.queue.writeBuffer(buf, 0, data);
    b.temp.push(buf);
    return buf;
  }
}

/** The part of a page's range of instances in `batch`, or undefined when none is. */
function within(r: { first: number; count: number } | undefined, batch: Batch): { first: number; count: number } | undefined {
  if (r === undefined) return undefined;
  const first = Math.max(r.first, batch.first);
  const end = Math.min(r.first + r.count, batch.first + batch.count);
  return end > first ? { first, count: end - first } : undefined;
}

function slotRect(box: R, s: { x: number; y: number }): number[] {
  return [s.x, s.y, s.x + widthOf(box), s.y + heightOf(box)];
}
