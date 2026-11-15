// The mark atlas: every dab-and-run mark of a frame gets a slot on an rgba8
// page; per page, one instanced draw lays every dab and one draw every bristle
// run (shader-mark.ts). A mark's draw then reads its slot (src 3 or 4 in the
// draw shader), so a mark's opacity applies once however many dabs overlap.
import type { Run } from "../brush/expand.js";
import type { AtlasPage } from "./atlas.js";
import { shelfPack } from "./atlas.js";
import type { R, TexMark } from "./jobs.js";
import { heightOf, widthOf } from "./jobs.js";
import type { TexturePool } from "./pool.js";
import { MARK_WGSL } from "./shader-mark.js";

const MAX = 8192;
const FLOATS = 12;
/** A strip quad's six corners, as offsets into the per-point [left x, left y, right x, right y] list. */
const CORNER = [0, 2, 4, 4, 2, 6] as const;

/** Write one run as a mitred strip of triangles into `out` at float `o`, extruded a pixel past its half width for the edge filter; returns the next offset. */
function runStrip(out: Float32Array, a: { o: number; run: Run; shift: readonly [number, number]; slot: readonly number[] }): number {
  const { pts, width } = a.run;
  const hw = width / 2;
  const e = hw + 1;
  const n = pts.length / 2;
  const [sx, sy] = a.shift;
  const side = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const px = (pts[2 * i] ?? 0) + sx;
    const py = (pts[2 * i + 1] ?? 0) + sy;
    const j0 = Math.max(0, i - 1);
    const j1 = Math.min(n - 1, i + 1);
    // Unit normals of the segments before and after this point (one of them at an end).
    let ax = (pts[2 * i] ?? 0) - (pts[2 * j0] ?? 0);
    let ay = (pts[2 * i + 1] ?? 0) - (pts[2 * j0 + 1] ?? 0);
    let bx = (pts[2 * j1] ?? 0) - (pts[2 * i] ?? 0);
    let by = (pts[2 * j1 + 1] ?? 0) - (pts[2 * i + 1] ?? 0);
    if (i === 0) [ax, ay] = [bx, by];
    if (i === n - 1) [bx, by] = [ax, ay];
    const la = Math.hypot(ax, ay) || 1;
    const lb = Math.hypot(bx, by) || 1;
    const n1x = -ay / la;
    const n1y = ax / la;
    const mx0 = n1x - by / lb;
    const my0 = n1y + bx / lb;
    const ml = Math.hypot(mx0, my0) || 1;
    const mx = mx0 / ml;
    const my = my0 / ml;
    const k = Math.min(2, 1 / Math.max(0.05, mx * n1x + my * n1y)) * e;
    side[i * 4] = px + mx * k;
    side[i * 4 + 1] = py + my * k;
    side[i * 4 + 2] = px - mx * k;
    side[i * 4 + 3] = py - my * k;
  }
  // Every vertex of the run shares its tail: half width, colour, alpha, slot.
  const tail = [hw, ...a.run.rgb, a.run.a, ...a.slot];
  let o = a.o;
  for (let i = 0; i + 1 < n; i++) {
    const q = i * 4;
    // Left and right of this point, then of the next: two triangles; u is the signed distance across.
    for (let v = 0; v < 6; v++) {
      const c = q + (CORNER[v] ?? 0);
      out[o] = side[c] ?? 0;
      out[o + 1] = side[c + 1] ?? 0;
      out[o + 2] = (c - q) % 4 === 0 ? e : -e;
      out.set(tail, o + 3);
      o += FLOATS;
    }
  }
  return o;
}

export class MarkAtlas {
  readonly #device: GPUDevice;
  readonly #dab: GPURenderPipeline;
  readonly #run: GPURenderPipeline;

  constructor(device: GPUDevice) {
    this.#device = device;
    const module = device.createShaderModule({ code: MARK_WGSL });
    const over: GPUBlendState = { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } };
    const target: GPUColorTargetState = { format: "rgba8unorm", blend: over };
    const attrs = (step: GPUVertexStepMode, formats: readonly GPUVertexFormat[]): GPUVertexBufferLayout => {
      let offset = 0;
      const attributes = formats.map((format, shaderLocation) => {
        const a = { shaderLocation, offset, format };
        offset += format === "float32x2" ? 8 : 16;
        return a;
      });
      return { arrayStride: FLOATS * 4, stepMode: step, attributes };
    };
    this.#dab = device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "dabVs", buffers: [attrs("instance", ["float32x4", "float32x4", "float32x4"])] }, fragment: { module, entryPoint: "dabFs", targets: [target] } });
    this.#run = device.createRenderPipeline({ layout: "auto", primitive: { topology: "triangle-list", cullMode: "none" }, vertex: { module, entryPoint: "runVs", buffers: [attrs("vertex", ["float32x2", "float32x2", "float32x4", "float32x4"])] }, fragment: { module, entryPoint: "runFs", targets: [target] } });
  }

  /** Pack `marks`, lay their dabs and runs, and return the pages (pool textures the caller releases). */
  build(marks: readonly TexMark[], f: { enc: GPUCommandEncoder; pool: TexturePool; temp: GPUBuffer[] }): AtlasPage[] {
    const widest = marks.reduce((w, m) => Math.max(w, widthOf(m.box) + 1), 0);
    const sizes = shelfPack(marks, Math.min(MAX, Math.max(widest, 1024)));
    return sizes.map((size, page) => {
      const tex = f.pool.acquire({ w: size.w, h: size.h, format: "rgba8unorm" });
      const mine = marks.filter((m) => m.slot?.page === page);
      const { dabs, runs } = this.#lay(mine);
      const pass = f.enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: "clear", clearValue: [0, 0, 0, 0], storeOp: "store" }] });
      const uni = this.#buffer(new Float32Array([tex.width, tex.height, 0, 0]), { usage: GPUBufferUsage.UNIFORM, temp: f.temp });
      for (const [pipe, data] of [[this.#dab, dabs], [this.#run, runs]] as const) {
        if (data.length === 0) continue;
        pass.setPipeline(pipe);
        pass.setBindGroup(0, this.#device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uni } }] }));
        pass.setVertexBuffer(0, this.#buffer(data, { usage: GPUBufferUsage.VERTEX, temp: f.temp }));
        if (pipe === this.#dab) pass.draw(6, data.length / FLOATS);
        else pass.draw(data.length / FLOATS);
      }
      pass.end();
      return { tex, width: tex.width, height: tex.height };
    });
  }

  /** Every dab (one instance each) and every run's strip vertices of `marks`, in page pixels. */
  #lay(marks: readonly TexMark[]): { dabs: Float32Array; runs: Float32Array } {
    let nd = 0;
    let nv = 0;
    for (const m of marks) {
      nd += m.dabs.length;
      for (const r of m.runs) nv += Math.max(0, r.pts.length / 2 - 1) * 6;
    }
    const dabs = new Float32Array(nd * FLOATS);
    const runs = new Float32Array(nv * FLOATS);
    let od = 0;
    let ov = 0;
    for (const m of marks) {
      const s = m.slot;
      if (s === undefined) continue;
      const sx = s.x - m.box.x0;
      const sy = s.y - m.box.y0;
      const slot = slotRect(m.box, s);
      for (const d of m.dabs) {
        dabs.set([d.x + sx, d.y + sy, d.r, d.a, d.soft ? 1 : 0, d.rgb[0], d.rgb[1], d.rgb[2], slot[0] ?? 0, slot[1] ?? 0, slot[2] ?? 0, slot[3] ?? 0], od);
        od += FLOATS;
      }
      for (const run of m.runs) ov = runStrip(runs, { o: ov, run, shift: [sx, sy], slot });
    }
    return { dabs, runs };
  }

  #buffer(data: Float32Array, b: { usage: number; temp: GPUBuffer[] }): GPUBuffer {
    const buf = this.#device.createBuffer({ size: Math.max(16, data.byteLength), usage: b.usage | GPUBufferUsage.COPY_DST });
    this.#device.queue.writeBuffer(buf, 0, data);
    b.temp.push(buf);
    return buf;
  }
}

function slotRect(box: R, s: { x: number; y: number }): number[] {
  return [s.x, s.y, s.x + widthOf(box), s.y + heightOf(box)];
}
