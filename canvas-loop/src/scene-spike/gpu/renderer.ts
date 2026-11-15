// The GPU renderer: a scene in, a premultiplied RGBA layer out. Per frame it
// lowers the scene to jobs, accumulates every shape's coverage in the atlas,
// encodes jobs children first (one texture each), and submits once.
import type { GpuHandle } from "../device.js";
import { GpuRenderError } from "../errors.js";
import type { Scene } from "../scene.js";
import { CoverageAtlas } from "./atlas.js";
import { encodeJob } from "./draws.js";
import type { Frame, FrameStats } from "./frame.js";
import { emptyStats } from "./frame.js";
import type { Job, Piece } from "./jobs.js";
import { heightOf, postOrder, widthOf } from "./jobs.js";
import { Lowering } from "./lower.js";
import type { Pipelines } from "./pipelines.js";
import { makePipelines } from "./pipelines.js";
import { TexturePool } from "./pool.js";

/** Pixels read back: premultiplied RGBA bytes, row by row. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

function piecesOf(jobs: readonly Job[]): Piece[] {
  const out: Piece[] = [];
  for (const j of jobs) {
    for (const it of j.items) if (it.k === "shape") out.push(it.piece);
  }
  return [...new Set(out)];
}

export class GpuRenderer {
  readonly #gpu: GpuHandle;
  readonly #pool: TexturePool;
  readonly #pipes: Pipelines;
  readonly #atlas: CoverageAtlas;
  /** Counts from the last frame. */
  stats: FrameStats = emptyStats();

  constructor(gpu: GpuHandle) {
    this.#gpu = gpu;
    this.#pool = new TexturePool(gpu.device);
    this.#pipes = makePipelines(gpu.device);
    this.#atlas = new CoverageAtlas(gpu.device, gpu.atlasFormat);
  }

  /** Textures the renderer holds between frames, and their size. */
  get held(): { textures: number; bytes: number; inUse: number } {
    return { textures: this.#pool.count, bytes: this.#pool.bytes, inUse: this.#pool.inUse };
  }

  /** Lower, encode and submit one frame; the canvas is copied into `read`. Throws before submitting on a bad scene. */
  #encode(scene: Scene, a: { ratio: number; temp: GPUBuffer[] }): { read: GPUBuffer; width: number; height: number; bytesPerRow: number; stats: FrameStats } {
    const device = this.#gpu.device;
    const root = new Lowering({ colors: this.#gpu.colors, width: scene.width, height: scene.height, ratio: a.ratio }).lower(scene);
    const jobs = postOrder(root, []);
    const pieces = piecesOf(jobs);
    const enc = device.createCommandEncoder();
    const stats = emptyStats();
    const atlas = this.#atlas.build(pieces, { enc, pool: this.#pool, temp: a.temp, minWidth: widthOf(root.rect) });
    stats.pieces = pieces.length;
    stats.atlasPages = atlas.length;
    const f: Frame = { device, enc, pool: this.#pool, pipes: this.#pipes, atlas, temp: a.temp, stats };
    for (const j of jobs) encodeJob(j, f);
    const out = root.tex;
    if (out === undefined) throw new GpuRenderError({ detail: "the canvas job produced no layer" });
    const width = widthOf(root.rect);
    const height = heightOf(root.rect);
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const read = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    a.temp.push(read);
    enc.copyTextureToBuffer({ texture: out }, { buffer: read, bytesPerRow }, [width, height]);
    device.queue.submit([enc.finish()]);
    return { read, width, height, bytesPerRow, stats };
  }

  /**
   * Render `scene` at `ratio` device pixels per logical pixel and read the
   * canvas back. Whether the frame succeeds or throws (a bad colour, a GPU
   * error), its error scopes are popped and its buffers and textures freed.
   */
  async render(scene: Scene, ratio: number): Promise<Pixels> {
    const device = this.#gpu.device;
    const temp: GPUBuffer[] = [];
    let open = 0;
    try {
      device.pushErrorScope("validation");
      open++;
      device.pushErrorScope("out-of-memory");
      open++;
      const { read, width, height, bytesPerRow, stats } = this.#encode(scene, { ratio, temp });
      const errors: GPUError[] = [];
      for (; open > 0; open--) {
        const e = await device.popErrorScope();
        if (e !== null) errors.push(e);
      }
      if (errors.length > 0) throw new GpuRenderError({ detail: errors.map((e) => e.message).join("; ") });
      await read.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(read.getMappedRange());
      const data = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) data.set(src.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
      read.unmap();
      this.stats = stats;
      return { width, height, data };
    } finally {
      for (; open > 0; open--) await device.popErrorScope();
      for (const b of temp) b.destroy();
      // Nothing outlives a frame: every texture goes back to the pool, and unused ones are freed.
      this.#pool.releaseAll();
      this.#pool.trim();
    }
  }

  /** Free every texture the renderer made. The device stays open. */
  destroy(): void {
    this.#pool.destroy();
    this.#pipes.dummy.destroy();
  }
}
