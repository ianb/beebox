// Encode one smudge or wet stroke onto its target layer (shader-smear.ts). The
// caller ends its render pass first: the stroke reads what is drawn before it.
// Its dabs are written on the GPU from its samples (brush-pass.ts
// `encodeSmear`, one batch), in the layer's texels, and the smear dispatch
// reads them.
import type { Batch, BrushPass } from "./brush-pass.js";
import type { Frame } from "./frame.js";
import { timed } from "./frame.js";
import type { ClipMask, R, SmearRec } from "./jobs.js";
import { heightOf, widthOf } from "./jobs.js";
import { SMEAR_WGSL } from "./shader-smear.js";

export class SmearPass {
  readonly #device: GPUDevice;
  readonly #pipe: GPUComputePipeline;
  readonly #brushes: BrushPass;

  constructor(device: GPUDevice, brushes: BrushPass) {
    this.#device = device;
    this.#brushes = brushes;
    this.#pipe = device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code: SMEAR_WGSL }), entryPoint: "smear" } });
  }

  #buffer(f: Frame, a: { size: number; usage: number; data?: ArrayBuffer }): GPUBuffer {
    const buf = this.#device.createBuffer({ size: Math.max(16, Math.ceil(a.size / 4) * 4), usage: a.usage | GPUBufferUsage.COPY_DST });
    if (a.data !== undefined) this.#device.queue.writeBuffer(buf, 0, a.data);
    f.temp.push(buf);
    return buf;
  }

  /** The texels the stroke can read or write, inside the layer `rect`, holding every pick-up patch: around the box that holds every dab centre (`reach`), clamped to the layer. */
  static region(s: SmearRec, rect: R): R {
    const ext = { x: widthOf(rect), y: heightOf(rect) };
    const side = (span: readonly [number, number], n: number): [number, number] => {
      const lo = Math.max(0, Math.min(Math.floor(span[0] - s.size - 2), n - s.size));
      return [lo, Math.min(n, Math.max(Math.ceil(span[1] + s.size + 2), lo + s.size))];
    };
    const [x0, x1] = side([s.reach.x0 - rect.x0, s.reach.x1 - rect.x0], ext.x);
    const [y0, y1] = side([s.reach.y0 - rect.y0, s.reach.y1 - rect.y0], ext.y);
    return { x0, y0, x1, y1 };
  }

  encode(s: SmearRec, a: { f: Frame; tex: GPUTexture; rect: R; clip: ClipMask | undefined }): void {
    const { f, tex, rect } = a;
    const reg = SmearPass.region(s, rect);
    const rw = widthOf(reg);
    const rh = heightOf(reg);
    if (rw <= 0 || rh <= 0) return;
    const bpr = Math.ceil((rw * 4) / 256) * 256;
    const wet = s.brush.color > 0;
    const S = GPUBufferUsage.STORAGE;
    const pix = this.#buffer(f, { size: bpr * rh, usage: S | GPUBufferUsage.COPY_SRC });
    const fb = this.#buffer(f, { size: rw * rh * 16, usage: S });
    const before = this.#buffer(f, { size: wet ? rw * rh * 16 : 16, usage: S });
    const load = this.#buffer(f, { size: s.size * s.size * 16, usage: S });
    // The dabs, in the layer's texels: one batch (lowering's `checkSmear` holds the stroke to one).
    let dabs: Batch | undefined;
    this.#brushes.encodeSmear({ prepared: s.prepared, brush: s.brush, lin: s.lin, ratio: s.ratio, offset: [s.tx - rect.x0, s.ty - rect.y0], slot: [0, 0, 0, 0] }, { enc: f.enc, temp: f.temp, timer: f.timer, each: (b) => void (dabs = b) });
    if (dabs === undefined) return;
    const ub = new ArrayBuffer(176);
    const ui = new Int32Array(ub);
    const uu = new Uint32Array(ub);
    const uf = new Float32Array(ub);
    ui.set([reg.x0, reg.y0, rw, rh, widthOf(rect), heightOf(rect)], 0);
    uu.set([bpr / 4, dabs.count], 6);
    ui[8] = s.size;
    uu.set([s.brush.tip === "soft" ? 1 : 0, wet ? 1 : 0, a.clip === undefined ? 0 : 1], 9);
    uf.set([s.brush.strength, s.brush.color, s.brush.opacity, s.brush.grain, ...s.paint], 12);
    const p = s.paper;
    const t = p.toPaper;
    uf.set([t[0], t[1], t[2], t[3], t[4], t[5], 0, 0, p.scale, p.lo, p.hi, 0], 20);
    uu[32] = p.seed;
    ui[33] = p.width;
    uf.set([rect.x0, rect.y0], 34);
    // The clip's box relative to the layer, and its slot on its clip page.
    const c = a.clip;
    if (c !== undefined) ui.set([c.box.x0 - rect.x0, c.box.y0 - rect.y0, widthOf(c.box), heightOf(c.box), c.slot?.x ?? 0, c.slot?.y ?? 0], 36);
    const u = this.#buffer(f, { size: 176, usage: GPUBufferUsage.UNIFORM, data: ub });
    const buffers = [pix, fb, before, load, dabs.buffer, u];
    const entries: GPUBindGroupEntry[] = [...buffers.map((buffer, binding) => ({ binding, resource: { buffer } })), { binding: 6, resource: (a.clip?.page ?? f.pipes.dummy).createView() }];
    const group = this.#device.createBindGroup({ layout: this.#pipe.getBindGroupLayout(0), entries });
    f.enc.copyTextureToBuffer({ texture: tex, origin: [reg.x0, reg.y0] }, { buffer: pix, bytesPerRow: bpr }, [rw, rh]);
    const cp = f.enc.beginComputePass(timed(f, "smear"));
    cp.setPipeline(this.#pipe);
    cp.setBindGroup(0, group);
    cp.dispatchWorkgroups(1);
    cp.end();
    f.enc.copyBufferToTexture({ buffer: pix, bytesPerRow: bpr }, { texture: tex, origin: [reg.x0, reg.y0] }, [rw, rh]);
    f.stats.smears++;
  }
}
