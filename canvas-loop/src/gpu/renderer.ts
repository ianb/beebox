// The GPU renderer: a scene in, a premultiplied RGBA layer out. Per frame it
// lowers the scene to jobs, accumulates every shape's coverage in the atlas,
// lays brushed marks in the mark atlas and glyphs on glyph pages, encodes jobs
// children first (one texture each), and submits once. Brush expansions,
// rasterised glyphs and `pixels` images are kept between frames while used.
import { BrushExpander } from "../scene/brush/expand.js";
import type { Prepared } from "../scene/brush/expand.js";
import type { GpuHandle } from "../device/open.js";
import { GpuRenderError } from "../scene/errors.js";
import type { Scene } from "../scene/nodes.js";
import { CoverageAtlas } from "./atlas.js";
import { encodeJob } from "./draws.js";
import type { Frame, FrameStats } from "./frame.js";
import { emptyStats } from "./frame.js";
import { GlyphCache, GlyphWatch } from "./glyphs.js";
import type { GlyphCell } from "./glyphs.js";
import { ImageCache } from "./images.js";
import type { ClipMask, Job, Piece, TexMark } from "./jobs.js";
import { buildClipPages } from "./clip-pages.js";
import { heightOf, postOrder, widthOf } from "./jobs.js";
import { Lowering } from "./lower.js";
import { MarkAtlas } from "./mark-atlas.js";
import type { Pipelines } from "./pipelines.js";
import { makePipelines } from "./pipelines.js";
import { TexturePool } from "./pool.js";
import { SmearPass } from "./smear.js";
import { readBrushPass } from "./brush-pass.js";
import type { BrushJob, BrushOutputs, InstanceOutputs, StripOutputs } from "./brush-pass.js";
import { DAB_FLOATS, SAMPLE_FLOATS } from "./shader-brush.js";
import { RUN_FLOATS } from "./shader-bristle.js";
import { PainterlyPasses } from "./painterly.js";
import { LightPass } from "./light.js";
import type { GpuTimes } from "./timing.js";
import { PassTimer } from "./timing.js";
import { KeptValues } from "./geometry-cache.js";
import { RasterCache } from "./rasters.js";
import type { PictureVersion } from "../scene/nodes.js";
import type { R } from "./jobs.js";
import { ErrorScopes } from "./error-scopes.js";
import type { MarkPeak, PeakPlan } from "./peaks.js";
import { bindPeaks, copyPeaks, peaksOf, planPeaks, readPeaks } from "./peaks.js";


export type { MarkPeak } from "./peaks.js";
/** A picture tile drawn this frame, kept once the frame has succeeded. */
interface NewTile {
  readonly version: PictureVersion;
  readonly key: string;
  readonly rect: R;
  readonly tex: GPUTexture;
}

/** Pixels read back: premultiplied RGBA bytes, row by row. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** What a frame's items and clips need packed: coverage pieces, marks for the mark atlas, glyph cells, clips. */
function packablesOf(jobs: readonly Job[]): { pieces: Piece[]; marks: TexMark[]; cells: GlyphCell[]; clips: ClipMask[] } {
  const pieces = new Set<Piece>();
  const marks: TexMark[] = [];
  const cells = new Set<GlyphCell>();
  const clips: ClipMask[] = [];
  for (const j of jobs) {
    for (const c of j.clips) {
      clips.push(c);
      if (c.piece !== undefined) pieces.add(c.piece);
    }
    for (const it of j.items) {
      if (it.k === "shape") pieces.add(it.piece);
      else if (it.k === "mark") {
        if (it.source.kind === "piece") pieces.add(it.source.piece);
        else marks.push(it.source.mark);
      }
      else if (it.k === "glyphs") for (const q of it.quads) cells.add(q.cell);
    }
  }
  return { pieces: [...pieces], marks, cells: [...cells], clips };
}

/** A submitted frame: its readback buffer (none when drawn into a target), size, and counts. */
interface Encoded {
  readonly read: GPUBuffer | undefined;
  readonly width: number;
  readonly height: number;
  readonly bytesPerRow: number;
  readonly stats: FrameStats;
  /** The pass timestamps to read once the frame is done, when timing. */
  readonly times: GPUBuffer | undefined;
  /** Testing mode: the marks' peak slots to read once the frame is done, when measuring them. */
  readonly peaks: { readonly read: GPUBuffer | undefined; readonly plan: PeakPlan } | undefined;
}

/** Map a frame's readback buffer and copy out its rows. */
async function readPixels(out: Encoded): Promise<Pixels> {
  const { read, width, height, bytesPerRow } = out;
  if (read === undefined) throw new GpuRenderError({ detail: "no readback buffer" });
  await read.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(read.getMappedRange());
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) data.set(src.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
  read.unmap();
  return { width, height, data };
}

export class GpuRenderer {
  readonly #gpu: GpuHandle;
  readonly #pool: TexturePool;
  readonly #pipes: Pipelines;
  readonly #atlas: CoverageAtlas;
  readonly #marks: MarkAtlas;
  readonly #smear: SmearPass;
  readonly #painterly: PainterlyPasses;
  readonly #light: LightPass;
  readonly #expander: BrushExpander;
  readonly #kept: KeptValues;
  readonly #rasters: RasterCache;
  readonly #glyphs: GlyphCache;
  readonly #images: ImageCache;
  readonly #timer: PassTimer | undefined;
  readonly #measurePeaks: boolean;
  /** Headless testing mode: whether a font has no glyph for a character, asked of the glyph atlas's rasteriser. */
  readonly glyphMissing: GlyphWatch["missing"];
  /** Testing mode (`peaks`): each brushed mark's strength in the last frame `render` drew. */
  peaks: readonly MarkPeak[] = [];
  /** Counts from the last frame. */
  stats: FrameStats = emptyStats();
  /** GPU time per pass kind in the last frame, when timing. */
  gpuTimes: GpuTimes | undefined;

  /**
   * `timing` times every pass (the device must have been opened with
   * timestamps). `caches: false` keeps nothing between frames (brush
   * expansions, coverage geometry, picture rasters): cache-equivalence checks
   * compare its frames with a caching renderer's. `peaks` (testing mode)
   * measures each brushed mark's peak alpha in every frame `render` draws, for
   * the faint-mark check; its colour output is the same. `brushLimit` (tests)
   * forces the brush pass's buffer limit below the device's, in bytes, so its
   * inputs and batches split; the pixels are the same.
   */
  constructor(gpu: GpuHandle, options?: { timing?: boolean; caches?: boolean; peaks?: boolean; brushLimit?: number | undefined }) {
    const caches = options?.caches ?? true;
    this.#measurePeaks = options?.peaks ?? false;
    this.#expander = new BrushExpander({ enabled: caches });
    this.#kept = new KeptValues(caches);
    this.#rasters = new RasterCache(gpu.device, caches);
    this.#timer = options?.timing === true && gpu.timestamps ? new PassTimer(gpu.device) : undefined;
    this.#gpu = gpu;
    this.#pool = new TexturePool(gpu.device);
    this.#pipes = makePipelines(gpu.device);
    this.#atlas = new CoverageAtlas(gpu.device, gpu.atlasFormat);
    this.#marks = new MarkAtlas(gpu.device, { brushLimit: options?.brushLimit });
    this.#smear = new SmearPass(gpu.device, this.#marks.brushes);
    this.#painterly = new PainterlyPasses(gpu.device);
    this.#light = new LightPass(gpu.device);
    this.#glyphs = new GlyphCache(gpu.raster);
    this.glyphMissing = new GlyphWatch(gpu.raster).missing;
    this.#images = new ImageCache(gpu.device);
  }

  /** Textures the renderer holds between frames, and their size. */
  get held(): { textures: number; bytes: number; inUse: number; images: number; imageBytes: number; strokes: number; geometry: number; tiles: number; tileBytes: number } {
    const r = this.#rasters.held;
    return { textures: this.#pool.count, bytes: this.#pool.bytes, inUse: this.#pool.inUse, images: this.#images.count, imageBytes: this.#images.bytes, strokes: this.#expander.size, geometry: this.#kept.size, tiles: r.tiles, tileBytes: r.bytes };
  }

  /** Lower, encode and submit one frame; the canvas is copied into `target` when given, and into `read` without a target or when `read` is asked for. Throws before submitting on a bad scene. */
  #encode(scene: Scene, a: { ratio: number; temp: GPUBuffer[]; tiles: NewTile[]; target?: GPUTexture; read?: boolean }): Encoded {
    const device = this.#gpu.device;
    const t0 = performance.now();
    this.#timer?.begin();
    this.#expander.beginFrame();
    this.#kept.beginFrame();
    this.#rasters.beginFrame();
    const lowering = new Lowering({ colors: this.#gpu.colors, width: scene.width, height: scene.height, ratio: a.ratio, expander: this.#expander, glyphs: this.#glyphs, kept: this.#kept, rasters: this.#rasters, brushLimit: this.#marks.brushes.limit });
    const root = lowering.lower(scene);
    const jobs = postOrder(root, []);
    const { pieces, marks, cells, clips } = packablesOf(jobs);
    const enc = device.createCommandEncoder();
    const stats = { ...emptyStats(), strokes: this.#expander.stats.strokes, expanded: this.#expander.stats.expanded, cacheHits: this.#expander.stats.hits, glyphs: cells.length };
    const t1 = performance.now();
    const timer = this.#timer;
    const atlas = this.#atlas.build(pieces, { enc, pool: this.#pool, temp: a.temp, minWidth: widthOf(root.rect), timer });
    const markPages = this.#marks.build(marks, { enc, pool: this.#pool, temp: a.temp, timer, stats });
    const glyphPages = this.#glyphs.build(cells, { device, pool: this.#pool });
    stats.pieces = pieces.length;
    stats.atlasPages = atlas.length;
    stats.markPages = markPages.length;
    const plan = this.#measurePeaks ? planPeaks(jobs) : undefined;
    const peaks = plan === undefined || plan.slots.size === 0 ? undefined : bindPeaks(plan, { device, pipes: this.#pipes.peak(), temp: a.temp });
    const f: Frame = { device, enc, pool: this.#pool, pipes: this.#pipes, atlas, markPages, glyphPages, image: (v) => this.#images.get(v), smear: this.#smear, painterly: this.#painterly, light: this.#light, temp: a.temp, stats, timer, bindGroups: new Map(), peaks: peaks?.binding };
    buildClipPages(clips, f);
    const t2 = performance.now();
    for (const j of jobs) {
      encodeJob(j, f);
      if (j.keep !== undefined && j.tex !== undefined) {
        // A drawn picture tile moves into a texture of its own, kept between frames.
        const tex = this.#rasters.texture(j.rect);
        enc.copyTextureToTexture({ texture: j.tex }, { texture: tex }, [widthOf(j.rect), heightOf(j.rect)]);
        f.pool.release(j.tex);
        j.tex = tex;
        a.tiles.push({ version: j.keep.version, key: j.keep.key, rect: j.rect, tex });
      }
    }
    const t3 = performance.now();
    stats.tileHits = this.#rasters.hits;
    stats.tilesDrawn = a.tiles.length;
    stats.keptHits = this.#kept.hits;
    stats.keptMisses = this.#kept.misses;
    stats.cpu = { lower: t1 - t0, atlas: t2 - t1, encode: t3 - t2, submit: 0, brush: lowering.brushMs + stats.cpu.brush };
    const times = timer?.resolve(enc, a.temp);
    const peakRead = plan === undefined ? undefined : { read: peaks === undefined ? undefined : copyPeaks(peaks.buffer, { enc, device, temp: a.temp }), plan };
    const submit = (): void => {
      device.queue.submit([enc.finish()]);
      stats.cpu.submit = performance.now() - t3;
    };
    const out = root.tex;
    if (out === undefined) throw new GpuRenderError({ detail: "the canvas job produced no layer" });
    const width = widthOf(root.rect);
    const height = heightOf(root.rect);
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    if (a.target !== undefined) {
      // A WebGPU canvas must be configured with format rgba8unorm and COPY_DST usage to receive the frame.
      if (a.target.format !== "rgba8unorm" || (a.target.usage & GPUTextureUsage.COPY_DST) === 0) throw new GpuRenderError({ detail: `present needs a canvas configured with format "rgba8unorm" and COPY_DST usage; got ${a.target.format}` });
      enc.copyTextureToTexture({ texture: out }, { texture: a.target }, [Math.min(width, a.target.width), Math.min(height, a.target.height)]);
      if (a.read !== true) {
        submit();
        return { read: undefined, width, height, bytesPerRow, stats, times, peaks: peakRead };
      }
    }
    const read = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    a.temp.push(read);
    enc.copyTextureToBuffer({ texture: out }, { buffer: read, bytesPerRow }, [width, height]);
    submit();
    return { read, width, height, bytesPerRow, stats, times, peaks: peakRead };
  }

  /**
   * Render `scene` at `ratio` device pixels per logical pixel and read the
   * canvas back. Whether the frame succeeds or throws (a bad colour, a GPU
   * error), its error scopes are popped and its buffers and textures freed.
   */
  async render(scene: Scene, ratio: number): Promise<Pixels> {
    return this.#frame(scene, { ratio }, async (out) => {
      const pixels = await readPixels(out);
      if (out.peaks !== undefined) this.peaks = await this.#peaksOf(out.peaks);
      return pixels;
    });
  }

  /** Testing mode: the frame's marks' strengths; each tile drawn this frame keeps its own beside its raster. */
  async #peaksOf(p: { read: GPUBuffer | undefined; plan: PeakPlan }): Promise<MarkPeak[]> {
    const raw = p.read === undefined ? [] : await readPeaks(p.read);
    for (const t of p.plan.tiles) if (t.job.keep !== undefined) this.#rasters.notePeaks(t.job.keep.version, { key: t.job.keep.key, peaks: peaksOf(t.parts, raw) });
    return peaksOf(p.plan.frame, raw);
  }

  /**
   * Render `scene` into `target` (an rgba8unorm texture, such as a WebGPU
   * canvas's). With `read`, the same frame is also read back (the bytes the
   * target received), else nothing is.
   */
  async present(scene: Scene, a: { ratio: number; target: GPUTexture; read?: boolean }): Promise<Pixels | undefined> {
    return this.#frame(scene, a, async (out) => (out.read === undefined ? undefined : readPixels(out)));
  }

  /**
   * Free every texture and forget every kept value (brush expansions, coverage
   * geometry, picture rasters, glyphs, images, pooled textures and atlas
   * pages): a figure going to sleep (draft section 8). Pipelines and the
   * device stay; the next frame is drawn cold, with the same pixels. With
   * `keepCpu`, brush expansions, coverage geometry and glyph bitmaps (CPU
   * memory) are kept, and only GPU textures are freed.
   */
  release(options?: { keepCpu?: boolean }): void {
    this.#pool.destroy();
    this.#images.destroy();
    this.#rasters.destroy();
    if (options?.keepCpu === true) return;
    this.#expander.clear();
    this.#kept.clear();
    this.#glyphs.clear();
  }

  async #frame<T>(...[scene, a, finish]: [Scene, { ratio: number; target?: GPUTexture; read?: boolean }, (out: Encoded) => Promise<T>]): Promise<T> {
    const device = this.#gpu.device;
    const most = device.limits.maxTextureDimension2D;
    const [w, h] = [Math.ceil(scene.width * a.ratio), Math.ceil(scene.height * a.ratio)];
    if (w > most || h > most) throw new GpuRenderError({ detail: `the canvas ${scene.width}×${scene.height} at pixel ratio ${a.ratio} is ${w}×${h} device px, larger than this GPU's largest texture (${most} px a side)` });
    const temp: GPUBuffer[] = [];
    const tiles: NewTile[] = [];
    let kept = false;
    const scopes = new ErrorScopes(device);
    try {
      scopes.push(["validation", "out-of-memory"]);
      const out = this.#encode(scene, { ...a, temp, tiles });
      // Popped in the same synchronous step as the pushes and the encode, so no other figure on the device can take this frame's scopes.
      const errors = await scopes.popAll();
      if (errors.length > 0) throw new GpuRenderError({ detail: errors.map((e) => e.message).join("; ") });
      for (const t of tiles) this.#rasters.store(t.version, t);
      kept = true;
      const result = await finish(out);
      this.stats = out.stats;
      this.gpuTimes = out.times === undefined || this.#timer === undefined ? undefined : await this.#timer.read(out.times);
      return result;
    } finally {
      await scopes.popAll();
      for (const b of temp) b.destroy();
      if (!kept) for (const t of tiles) this.#rasters.discard(t.tex);
      this.#rasters.endFrame();
      // Nothing in the pool outlives a frame: every texture goes back to it, and unused ones are freed.
      this.#pool.releaseAll();
      this.#pool.trim();
      this.#images.endFrame();
    }
  }

  /**
   * Verification and measurement: run the GPU sample pass over `strokes` on
   * its own and read the samples back (`SAMPLE_FLOATS` floats each, the
   * eighth a u32), with each stroke's contour ranges, the CPU time to pack,
   * upload and encode, and the pass's GPU time when timing.
   */
  async sampleBrushes(strokes: readonly Prepared[]): Promise<{ data: ArrayBuffer; count: number; ranges: BrushOutputs["ranges"]; batches: number; inputs: number; reads: number; encodeMs: number; gpuMs: number | undefined }> {
    const r = await readBrushPass(this.#gpu.device, { timer: this.#timer, bytes: SAMPLE_FLOATS * 4, limit: this.#marks.brushes.limit, encode: (f) => this.#marks.brushes.encode(strokes, f) });
    return { data: r.data, count: r.out.count, ranges: r.out.ranges, batches: r.out.batches, inputs: r.out.inputs, reads: r.reads, encodeMs: r.encodeMs, gpuMs: r.gpuMs };
  }

  /** Verification: the `dabs` and `capsules` entries' instances for `jobs` (`DAB_FLOATS` floats each, one per sample), as the mark atlas draws them, each stroke's range, and the batches and input buffers they took. */
  async brushInstances(jobs: readonly BrushJob[]): Promise<{ data: ArrayBuffer; count: number; strokes: InstanceOutputs["strokes"]; batches: number; inputs: number; reads: number }> {
    const r = await readBrushPass(this.#gpu.device, { timer: this.#timer, bytes: DAB_FLOATS * 4, limit: this.#marks.brushes.limit, encode: (f) => this.#marks.brushes.encodeMarks(jobs, f) });
    return { data: r.data, count: r.out.count, strokes: r.out.strokes, batches: r.out.batches, inputs: r.out.inputs, reads: r.reads };
  }

  /** Verification: the `smears` entry's dabs for one smudge or wet stroke `job` (`DAB_FLOATS` floats each, one per sample, shader-smear.ts's layout), as the smear pass reads them, and the batches it took. */
  async smearDabs(job: BrushJob): Promise<{ data: ArrayBuffer; count: number; batches: number }> {
    const r = await readBrushPass(this.#gpu.device, { timer: this.#timer, bytes: DAB_FLOATS * 4, limit: this.#marks.brushes.limit, encode: (f) => this.#marks.brushes.encodeSmear(job, f) });
    return { data: r.data, count: r.out.count, batches: r.out.batches };
  }

  /** Verification: the `bristles` entry's run vertices for bristle `jobs` (`RUN_FLOATS` floats each), as the mark atlas draws them, each stroke's range, and the batches (each one's range) and input buffers they took. */
  async bristleStrips(jobs: readonly BrushJob[]): Promise<{ data: ArrayBuffer; count: number; strokes: StripOutputs["strokes"]; batches: number; plan: StripOutputs["plan"]; inputs: number; reads: number }> {
    const r = await readBrushPass(this.#gpu.device, { timer: this.#timer, bytes: RUN_FLOATS * 4, limit: this.#marks.brushes.limit, encode: (f) => this.#marks.brushes.encodeBristles(jobs, f) });
    return { data: r.data, count: r.out.count, strokes: r.out.strokes, batches: r.out.batches, plan: r.out.plan, inputs: r.out.inputs, reads: r.reads };
  }

  /** Verification: draw capsule instances (the `capsules` entry's layout, slots on one page of `size`) in their order with the mark atlas's capsule pipeline, and read the page's alpha back, row by row. */
  async capsulePage(capsules: Float32Array<ArrayBuffer>, size: { width: number; height: number }): Promise<Uint8Array> {
    const device = this.#gpu.device;
    const temp: GPUBuffer[] = [];
    const tex = device.createTexture({ size: [size.width, size.height], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    try {
      const enc = device.createCommandEncoder();
      this.#marks.drawCapsules(capsules, { enc, tex, temp });
      const bytesPerRow = Math.ceil((size.width * 4) / 256) * 256;
      const read = device.createBuffer({ size: bytesPerRow * size.height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      temp.push(read);
      enc.copyTextureToBuffer({ texture: tex }, { buffer: read, bytesPerRow }, [size.width, size.height]);
      device.queue.submit([enc.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(read.getMappedRange());
      const alpha = new Uint8Array(size.width * size.height);
      for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) alpha[y * size.width + x] = src[y * bytesPerRow + x * 4 + 3] ?? 0;
      read.unmap();
      return alpha;
    } finally {
      for (const b of temp) b.destroy();
      tex.destroy();
    }
  }

  /** Free every texture the renderer made. The device stays open. */
  destroy(): void {
    this.#pool.destroy();
    this.#images.destroy();
    this.#rasters.destroy();
    this.#pipes.dummy.destroy();
    this.#timer?.destroy();
  }
}
