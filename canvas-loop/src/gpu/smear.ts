// Encode one smudge or wet stroke onto its target layer (shader-smear.ts). The
// caller ends its render pass first: the stroke reads what is drawn before it.
import type { Frame } from "./frame.js";
import { timed } from "./frame.js";
import type { ClipMask, R, SmearRec } from "./jobs.js";
import { heightOf, widthOf } from "./jobs.js";
import { SMEAR_WGSL } from "./shader-smear.js";

export class SmearPass {
  readonly #device: GPUDevice;
  readonly #pipe: GPUComputePipeline;

  constructor(device: GPUDevice) {
    this.#device = device;
    this.#pipe = device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code: SMEAR_WGSL }), entryPoint: "smear" } });
  }

  #buffer(f: Frame, a: { size: number; usage: number; data?: ArrayBuffer }): GPUBuffer {
    const buf = this.#device.createBuffer({ size: Math.max(16, Math.ceil(a.size / 4) * 4), usage: a.usage | GPUBufferUsage.COPY_DST });
    if (a.data !== undefined) this.#device.queue.writeBuffer(buf, 0, a.data);
    f.temp.push(buf);
    return buf;
  }

  /** The texels the stroke can read or write, inside the layer `rect`, holding every pick-up patch. */
  static region(s: SmearRec, rect: R): R {
    const ext = { x: widthOf(rect), y: heightOf(rect) };
    const xs = s.dabs.map((d) => d.x - rect.x0);
    const ys = s.dabs.map((d) => d.y - rect.y0);
    const side = (vs: readonly number[], n: number): [number, number] => {
      const lo = Math.max(0, Math.min(Math.floor(Math.min(...vs) - s.size - 2), n - s.size));
      return [lo, Math.min(n, Math.max(Math.ceil(Math.max(...vs) + s.size + 2), lo + s.size))];
    };
    const [x0, x1] = side(xs, ext.x);
    const [y0, y1] = side(ys, ext.y);
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
    const dd = new Float32Array(s.dabs.length * 8);
    for (const [k, d] of s.dabs.entries()) dd.set([d.x - rect.x0, d.y - rect.y0, d.r, d.a, d.first ? 1 : 0, 0, 0, 0], k * 8);
    const dabs = this.#buffer(f, { size: dd.byteLength, usage: S, data: dd.buffer });
    const ub = new ArrayBuffer(176);
    const ui = new Int32Array(ub);
    const uu = new Uint32Array(ub);
    const uf = new Float32Array(ub);
    ui.set([reg.x0, reg.y0, rw, rh, widthOf(rect), heightOf(rect)], 0);
    uu.set([bpr / 4, s.dabs.length], 6);
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
    const buffers = [pix, fb, before, load, dabs, u];
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
