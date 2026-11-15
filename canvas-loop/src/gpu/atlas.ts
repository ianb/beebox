// The coverage atlas (Stage 3 geometry probe): every piece of a frame gets a
// slot on a float page; one instanced draw per page adds each edge's exact
// signed area into its slot's pixels. A draw then reads its coverage from its
// slot: min(|area|, 1).
import { GpuRenderError } from "../scene/errors.js";
import { EDGE_WGSL } from "./shader-draw.js";
import type { Piece, R, Slot } from "./jobs.js";
import { ATLAS_MAX, heightOf, widthOf } from "./jobs.js";
import type { PoolFormat, TexturePool } from "./pool.js";
import { timed } from "./frame.js";
import type { PassTimer } from "./timing.js";

const MAX = ATLAS_MAX;
const GAP = 1;
/** Floats per edge instance. */
const FLOATS = 8;

export interface AtlasPage {
  readonly tex: GPUTexture;
  readonly width: number;
  readonly height: number;
}

/** Shelf-pack boxes (tallest first) into pages; sets each one's slot. Returns each page's used size. */
export function shelfPack(pieces: readonly { readonly box: R; slot?: Slot }[], pageWidth: number): { w: number; h: number }[] {
  const pages: { w: number; h: number }[] = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  let page = 0;
  for (const p of pieces.toSorted((a, b) => heightOf(b.box) - heightOf(a.box))) {
    const w = widthOf(p.box);
    const h = heightOf(p.box);
    if (w > MAX || h > MAX) throw new GpuRenderError({ detail: `a shape ${w}×${h} device px is larger than the atlas (${MAX}); tiling is not built` });
    if (x + w > pageWidth) {
      x = 0;
      y += shelf + GAP;
      shelf = 0;
    }
    if (y + h > MAX) {
      page++;
      x = 0;
      y = 0;
      shelf = 0;
    }
    p.slot = { page, x, y };
    const used = pages[page] ?? { w: 0, h: 0 };
    // The gap after a piece at the page's edge is left out, so a piece as wide as the atlas fits.
    pages[page] = { w: Math.max(used.w, Math.min(MAX, x + w + GAP)), h: Math.max(used.h, Math.min(MAX, y + h + GAP)) };
    x += w + GAP;
    shelf = Math.max(shelf, h);
  }
  return pages;
}

/**
 * One instance per edge: (x0, y0, x1, y1) relative to its piece's box, then the
 * slot's corner on the page and the box's width. Coverage is computed in the
 * piece's own pixels, so it does not depend on where the piece is packed (which
 * depends on what else the frame draws): a kept and a fresh frame agree.
 */
function edgeData(pieces: readonly Piece[], page: number): Float32Array {
  let n = 0;
  for (const p of pieces) if (p.slot?.page === page) for (const r of p.rings) n += r.length / 2;
  const out = new Float32Array(n * FLOATS);
  let o = 0;
  for (const p of pieces) {
    const s = p.slot;
    if (s?.page !== page) continue;
    // Ring point → device pixel (+ ox, oy) → the piece's own pixel (− box corner).
    const { x0, y0 } = p.box;
    const w = widthOf(p.box);
    for (const r of p.rings) {
      for (let i = 0; i + 1 < r.length; i += 2) {
        const j = (i + 2) % r.length;
        const ay = (r[i + 1] ?? 0) + p.oy - y0;
        const by = (r[j + 1] ?? 0) + p.oy - y0;
        if (ay === by) continue;
        out[o] = (r[i] ?? 0) + p.ox - x0;
        out[o + 1] = ay;
        out[o + 2] = (r[j] ?? 0) + p.ox - x0;
        out[o + 3] = by;
        out[o + 4] = s.x;
        out[o + 5] = s.y;
        out[o + 6] = w;
        o += FLOATS;
      }
    }
  }
  return out.subarray(0, o);
}

export class CoverageAtlas {
  readonly #device: GPUDevice;
  readonly #format: PoolFormat;
  readonly #pipe: GPURenderPipeline;

  constructor(device: GPUDevice, format: "r32float" | "r16float") {
    this.#device = device;
    this.#format = format;
    const module = device.createShaderModule({ code: EDGE_WGSL });
    const add: GPUBlendComponent = { srcFactor: "one", dstFactor: "one", operation: "add" };
    this.#pipe = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "segVs", buffers: [{ arrayStride: FLOATS * 4, stepMode: "instance", attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }, { shaderLocation: 1, offset: 16, format: "float32x4" }] }] },
      fragment: { module, entryPoint: "segFs", targets: [{ format, blend: { color: add, alpha: add } }] },
    });
  }

  /** Pack `pieces`, accumulate their coverage, and return the pages (pool textures the caller releases). */
  build(pieces: readonly Piece[], f: { enc: GPUCommandEncoder; pool: TexturePool; temp: GPUBuffer[]; minWidth: number; timer: PassTimer | undefined }): AtlasPage[] {
    const widest = pieces.reduce((w, p) => Math.max(w, widthOf(p.box) + GAP), 0);
    const sizes = shelfPack(pieces, Math.min(MAX, Math.max(f.minWidth, widest, 256)));
    return sizes.map((size, page) => {
      const tex = f.pool.acquire({ w: size.w, h: size.h, format: this.#format });
      const data = edgeData(pieces, page);
      const pass = f.enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: "clear", clearValue: [0, 0, 0, 0], storeOp: "store" }], ...timed(f, "coverage") });
      if (data.length > 0) {
        const uni = this.#buffer(new Float32Array([tex.width, tex.height, 0, 0]), { usage: GPUBufferUsage.UNIFORM, temp: f.temp });
        const edges = this.#buffer(data, { usage: GPUBufferUsage.VERTEX, temp: f.temp });
        pass.setPipeline(this.#pipe);
        pass.setBindGroup(0, this.#device.createBindGroup({ layout: this.#pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uni } }] }));
        pass.setVertexBuffer(0, edges);
        pass.draw(6, data.length / FLOATS);
      }
      pass.end();
      return { tex, width: tex.width, height: tex.height };
    });
  }

  #buffer(data: Float32Array, b: { usage: number; temp: GPUBuffer[] }): GPUBuffer {
    const buf = this.#device.createBuffer({ size: Math.max(16, data.byteLength), usage: b.usage | GPUBufferUsage.COPY_DST });
    this.#device.queue.writeBuffer(buf, 0, data);
    b.temp.push(buf);
    return buf;
  }
}
