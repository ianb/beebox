// The mark atlas: every dab-and-run mark of a frame gets a slot on an rgba8
// page; per page, one instanced draw lays every dab and one draw every bristle
// run (shader-mark.ts). A mark's draw then reads its slot (src 3 or 4 in the
// draw shader), so a mark's opacity applies once however many dabs overlap.
import type { Run } from "../scene/brush/expand.js";
import type { AtlasPage } from "./atlas.js";
import { shelfPack } from "./atlas.js";
import type { R, TexMark } from "./jobs.js";
import { ATLAS_MAX, heightOf, widthOf } from "./jobs.js";
import type { TexturePool } from "./pool.js";
import { timed } from "./frame.js";
import type { PassTimer } from "./timing.js";
import { MARK_WGSL } from "./shader-mark.js";

const MAX = ATLAS_MAX;
/** Floats per dab instance and per run vertex. */
const DAB_FLOATS = 12;
const RUN_FLOATS = 24;
/** A strip quad's two triangles, as offsets into the per-point [left x, left y, right x, right y] list: (L_i, R_i, L_i+1), (L_i+1, R_i, R_i+1). */
const TRIS = [[0, 2, 4], [4, 2, 6]] as const;

/** Each point's left and right strip corners in the mark's own pixels (`local`: device point → mark pixel), mitred, `e` from the centre line. */
function stripSides(pts: readonly number[], a: { e: number; local: readonly [number, number, number, number] }): Float64Array {
  const { e } = a;
  const n = pts.length / 2;
  const [ox, oy, x0, y0] = a.local;
  const side = new Float64Array(n * 4);
  const at = (i: number): [number, number] => [pts[2 * i] ?? 0, pts[2 * i + 1] ?? 0];
  for (let i = 0; i < n; i++) {
    const [px, py] = at(i);
    const [qx, qy] = at(Math.max(0, i - 1));
    const [rx, ry] = at(Math.min(n - 1, i + 1));
    // Unit normals of the segments before and after this point (one of them at an end).
    let [ax, ay] = [px - qx, py - qy];
    let [bx, by] = [rx - px, ry - py];
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
    const lx = px + ox - x0;
    const ly = py + oy - y0;
    side.set([lx + mx * k, ly + my * k, lx - mx * k, ly - my * k], i * 4);
  }
  return side;
}

/**
 * Write one run as a mitred strip of triangles into `out` at float `o`,
 * extruded a pixel past its half width for the edge filter; returns the next
 * offset. Every vertex carries its triangle's corners (in the mark's own
 * pixels) and their signed distances across, so the fragment shader finds the
 * distance at a pixel from the mark's own pixels, wherever the mark is packed.
 */
function runStrip(out: Float32Array, a: { o: number; run: Run; local: readonly [number, number, number, number]; slot: readonly number[] }): number {
  const { pts, width } = a.run;
  const hw = width / 2;
  const e = hw + 1;
  const n = pts.length / 2;
  const [sx = 0, sy = 0] = a.slot;
  const side = stripSides(pts, { e, local: a.local });
  const tail = [...a.run.rgb, a.run.a, ...a.slot];
  // u is the signed distance across: +e on the left side, −e on the right.
  const uOf = (c: number): number => (c % 4 === 0 ? e : -e);
  let o = a.o;
  for (let i = 0; i + 1 < n; i++) {
    const q = i * 4;
    for (const tri of TRIS) {
      const ks = tri.map((t) => q + t);
      const corners = ks.flatMap((k) => [side[k] ?? 0, side[k + 1] ?? 0]);
      const us = tri.map((t) => uOf(t));
      for (const k of ks) {
        out.set([(side[k] ?? 0) + sx, (side[k + 1] ?? 0) + sy, hw, 0, ...tail, ...corners, ...us], o);
        o += RUN_FLOATS;
      }
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
    const attrs = (step: GPUVertexStepMode, count: number): GPUVertexBufferLayout => ({
      arrayStride: count * 16,
      stepMode: step,
      attributes: Array.from({ length: count }, (_, shaderLocation) => ({ shaderLocation, offset: shaderLocation * 16, format: "float32x4" as const })),
    });
    this.#dab = device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "dabVs", buffers: [attrs("instance", DAB_FLOATS / 4)] }, fragment: { module, entryPoint: "dabFs", targets: [target] } });
    this.#run = device.createRenderPipeline({ layout: "auto", primitive: { topology: "triangle-list", cullMode: "none" }, vertex: { module, entryPoint: "runVs", buffers: [attrs("vertex", RUN_FLOATS / 4)] }, fragment: { module, entryPoint: "runFs", targets: [target] } });
  }

  /** Pack `marks`, lay their dabs and runs, and return the pages (pool textures the caller releases). */
  build(marks: readonly TexMark[], f: { enc: GPUCommandEncoder; pool: TexturePool; temp: GPUBuffer[]; timer: PassTimer | undefined }): AtlasPage[] {
    const widest = marks.reduce((w, m) => Math.max(w, widthOf(m.box) + 1), 0);
    const sizes = shelfPack(marks, Math.min(MAX, Math.max(widest, 1024)));
    return sizes.map((size, page) => {
      const tex = f.pool.acquire({ w: size.w, h: size.h, format: "rgba8unorm" });
      const mine = marks.filter((m) => m.slot?.page === page);
      const { dabs, runs } = this.#lay(mine);
      const pass = f.enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: "clear", clearValue: [0, 0, 0, 0], storeOp: "store" }], ...timed(f, "marks") });
      const uni = this.#buffer(new Float32Array([tex.width, tex.height, 0, 0]), { usage: GPUBufferUsage.UNIFORM, temp: f.temp });
      for (const [pipe, data] of [[this.#dab, dabs], [this.#run, runs]] as const) {
        if (data.length === 0) continue;
        pass.setPipeline(pipe);
        pass.setBindGroup(0, this.#device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uni } }] }));
        pass.setVertexBuffer(0, this.#buffer(data, { usage: GPUBufferUsage.VERTEX, temp: f.temp }));
        if (pipe === this.#dab) pass.draw(6, data.length / DAB_FLOATS);
        else pass.draw(data.length / RUN_FLOATS);
      }
      pass.end();
      return { tex, width: tex.width, height: tex.height };
    });
  }

  /** Every dab (one instance each) and every run's strip vertices of `marks`, in each mark's own pixels with its slot. */
  #lay(marks: readonly TexMark[]): { dabs: Float32Array; runs: Float32Array } {
    let nd = 0;
    let nv = 0;
    for (const m of marks) {
      nd += m.dabs.length;
      for (const r of m.runs) nv += Math.max(0, r.pts.length / 2 - 1) * 6;
    }
    const dabs = new Float32Array(nd * DAB_FLOATS);
    const runs = new Float32Array(nv * RUN_FLOATS);
    let od = 0;
    let ov = 0;
    for (const m of marks) {
      const s = m.slot;
      if (s === undefined) continue;
      const slot = slotRect(m.box, s);
      // Device point (+ ox, oy) → the mark's own pixel (− box corner); the slot only places it on the page.
      for (const d of m.dabs) {
        dabs[od] = d.x + m.ox - m.box.x0;
        dabs[od + 1] = d.y + m.oy - m.box.y0;
        dabs[od + 2] = d.r;
        dabs[od + 3] = d.a;
        dabs[od + 4] = d.soft ? 1 : 0;
        dabs[od + 5] = d.rgb[0];
        dabs[od + 6] = d.rgb[1];
        dabs[od + 7] = d.rgb[2];
        dabs.set(slot, od + 8);
        od += DAB_FLOATS;
      }
      for (const run of m.runs) ov = runStrip(runs, { o: ov, run, local: [m.ox, m.oy, m.box.x0, m.box.y0], slot });
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
