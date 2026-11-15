// The GPU renderer: a scene in, a premultiplied RGBA layer out. Per frame it
// lowers the scene to jobs, accumulates every shape's coverage in the atlas,
// lays brushed marks in the mark atlas and glyphs on glyph pages, encodes jobs
// children first (one texture each), and submits once. Brush expansions,
// rasterised glyphs and `pixels` images are kept between frames while used.
import { BrushExpander } from "../brush/expand.js";
import type { GpuHandle } from "../device.js";
import { GpuRenderError } from "../errors.js";
import type { Scene } from "../scene.js";
import { CoverageAtlas } from "./atlas.js";
import { encodeJob } from "./draws.js";
import type { Frame, FrameStats } from "./frame.js";
import { emptyStats } from "./frame.js";
import { GlyphCache } from "./glyphs.js";
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
import { PainterlyPasses } from "./painterly.js";
import { LightPass } from "./light.js";
import type { GpuTimes } from "./timing.js";
import { PassTimer } from "./timing.js";
import { KeptValues } from "./geometry-cache.js";
import { RasterCache } from "./rasters.js";
import type { PictureVersion } from "../scene.js";
import type { R } from "./jobs.js";

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
  /** Counts from the last frame. */
  stats: FrameStats = emptyStats();
  /** GPU time per pass kind in the last frame, when timing. */
  gpuTimes: GpuTimes | undefined;

  /**
   * `timing` times every pass (the device must have been opened with
   * timestamps). `caches: false` keeps nothing between frames (brush
   * expansions, coverage geometry, picture rasters): cache-equivalence checks
   * compare its frames with a caching renderer's.
   */
  constructor(gpu: GpuHandle, options?: { timing?: boolean; caches?: boolean }) {
    const caches = options?.caches ?? true;
    this.#expander = new BrushExpander({ enabled: caches });
    this.#kept = new KeptValues(caches);
    this.#rasters = new RasterCache(gpu.device, caches);
    this.#timer = options?.timing === true && gpu.timestamps ? new PassTimer(gpu.device) : undefined;
    this.#gpu = gpu;
    this.#pool = new TexturePool(gpu.device);
    this.#pipes = makePipelines(gpu.device);
    this.#atlas = new CoverageAtlas(gpu.device, gpu.atlasFormat);
    this.#marks = new MarkAtlas(gpu.device);
    this.#smear = new SmearPass(gpu.device);
    this.#painterly = new PainterlyPasses(gpu.device);
    this.#light = new LightPass(gpu.device);
    this.#glyphs = new GlyphCache(gpu.raster);
    this.#images = new ImageCache(gpu.device);
  }

  /** Textures the renderer holds between frames, and their size. */
  get held(): { textures: number; bytes: number; inUse: number; images: number; strokes: number; geometry: number; tiles: number; tileBytes: number } {
    const r = this.#rasters.held;
    return { textures: this.#pool.count, bytes: this.#pool.bytes, inUse: this.#pool.inUse, images: this.#images.count, strokes: this.#expander.size, geometry: this.#kept.size, tiles: r.tiles, tileBytes: r.bytes };
  }

  /** Lower, encode and submit one frame; the canvas is copied into `target` when given, else into `read`. Throws before submitting on a bad scene. */
  #encode(scene: Scene, a: { ratio: number; temp: GPUBuffer[]; tiles: NewTile[]; target?: GPUTexture }): Encoded {
    const device = this.#gpu.device;
    const t0 = performance.now();
    this.#timer?.begin();
    this.#expander.beginFrame();
    this.#kept.beginFrame();
    this.#rasters.beginFrame();
    const root = new Lowering({ colors: this.#gpu.colors, width: scene.width, height: scene.height, ratio: a.ratio, expander: this.#expander, glyphs: this.#glyphs, kept: this.#kept, rasters: this.#rasters }).lower(scene);
    const jobs = postOrder(root, []);
    const { pieces, marks, cells, clips } = packablesOf(jobs);
    const enc = device.createCommandEncoder();
    const stats = { ...emptyStats(), strokes: this.#expander.stats.strokes, expanded: this.#expander.stats.expanded, cacheHits: this.#expander.stats.hits, glyphs: cells.length };
    const t1 = performance.now();
    const timer = this.#timer;
    const atlas = this.#atlas.build(pieces, { enc, pool: this.#pool, temp: a.temp, minWidth: widthOf(root.rect), timer });
    const markPages = this.#marks.build(marks, { enc, pool: this.#pool, temp: a.temp, timer });
    const glyphPages = this.#glyphs.build(cells, { device, pool: this.#pool });
    stats.pieces = pieces.length;
    stats.atlasPages = atlas.length;
    stats.markPages = markPages.length;
    const f: Frame = { device, enc, pool: this.#pool, pipes: this.#pipes, atlas, markPages, glyphPages, image: (v) => this.#images.get(v), smear: this.#smear, painterly: this.#painterly, light: this.#light, temp: a.temp, stats, timer, bindGroups: new Map() };
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
    stats.cpu = { lower: t1 - t0, atlas: t2 - t1, encode: t3 - t2, submit: 0 };
    const times = timer?.resolve(enc, a.temp);
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
      submit();
      return { read: undefined, width, height, bytesPerRow, stats, times };
    }
    const read = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    a.temp.push(read);
    enc.copyTextureToBuffer({ texture: out }, { buffer: read, bytesPerRow }, [width, height]);
    submit();
    return { read, width, height, bytesPerRow, stats, times };
  }

  /**
   * Render `scene` at `ratio` device pixels per logical pixel and read the
   * canvas back. Whether the frame succeeds or throws (a bad colour, a GPU
   * error), its error scopes are popped and its buffers and textures freed.
   */
  async render(scene: Scene, ratio: number): Promise<Pixels> {
    return this.#frame(scene, { ratio }, async ({ read, width, height, bytesPerRow }) => {
      if (read === undefined) throw new GpuRenderError({ detail: "no readback buffer" });
      await read.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(read.getMappedRange());
      const data = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) data.set(src.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
      read.unmap();
      return { width, height, data };
    });
  }

  /** Render `scene` into `target` (an rgba8unorm texture, such as a WebGPU canvas's), with no readback. */
  async present(scene: Scene, a: { ratio: number; target: GPUTexture }): Promise<void> {
    await this.#frame(scene, a, async () => {});
  }

  async #frame<T>(...[scene, a, finish]: [Scene, { ratio: number; target?: GPUTexture }, (out: Encoded) => Promise<T>]): Promise<T> {
    const device = this.#gpu.device;
    const temp: GPUBuffer[] = [];
    const tiles: NewTile[] = [];
    let kept = false;
    let open = 0;
    try {
      device.pushErrorScope("validation");
      open++;
      device.pushErrorScope("out-of-memory");
      open++;
      const out = this.#encode(scene, { ...a, temp, tiles });
      const errors: GPUError[] = [];
      for (; open > 0; open--) {
        const e = await device.popErrorScope();
        if (e !== null) errors.push(e);
      }
      if (errors.length > 0) throw new GpuRenderError({ detail: errors.map((e) => e.message).join("; ") });
      for (const t of tiles) this.#rasters.store(t.version, t);
      kept = true;
      const result = await finish(out);
      this.stats = out.stats;
      this.gpuTimes = out.times === undefined || this.#timer === undefined ? undefined : await this.#timer.read(out.times);
      return result;
    } finally {
      for (; open > 0; open--) await device.popErrorScope();
      for (const b of temp) b.destroy();
      if (!kept) for (const t of tiles) this.#rasters.discard(t.tex);
      this.#rasters.endFrame();
      // Nothing in the pool outlives a frame: every texture goes back to it, and unused ones are freed.
      this.#pool.releaseAll();
      this.#pool.trim();
      this.#images.endFrame();
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
