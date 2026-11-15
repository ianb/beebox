// The painterly effects (R5 step 2, after colour adjustments and blur): wash,
// hatching, paper, in that order (shader-painterly.ts). Their patterns live in
// the coordinates where the group is called, so `toLocal` maps device pixels
// back to them; the paper is the scope's at the end of the group's body (R9).
import type { Effects } from "../../scene-draft/scene-api.js";
import type { ColorParser, Rgba } from "../colors.js";
import { det } from "../mat.js";
import type { Mat, PaperSettings } from "../scene.js";
import type { Sigma } from "./effects.js";
import type { Frame } from "./frame.js";
import { beginPass } from "./frame.js";
import type { R } from "./jobs.js";
import { heightOf, widthOf } from "./jobs.js";
import { PAINTERLY_WGSL, TONE_WGSL } from "./shader-painterly.js";

/** The row width of the paper's per-pixel hash: a constant, so texture never depends on the canvas size. */
export const PAPER_ROW = 4096;

/** A paper in paper pixels (the call's coordinates × the pixel ratio), as the shaders read it. */
export interface PaperParams {
  readonly scale: number;
  readonly lo: number;
  readonly hi: number;
  readonly seed: number;
}

export function paperParams(paper: PaperSettings, ratio: number): PaperParams {
  const c = paper.contrast;
  return { scale: paper.scale * ratio, lo: 0.5 - 0.35 * c, hi: 0.5 + 0.15 * (1 - c), seed: paper.seed >>> 0 };
}

export interface PainterlyPlan {
  readonly wash: { readonly granulate: number; readonly edges: number; readonly blotch: number; readonly bleed: number; readonly sigma: Sigma } | undefined;
  readonly hatching: { readonly amount: number; readonly angle: number; readonly spacing: number; readonly color: Rgba | undefined; readonly sigma: Sigma } | undefined;
  readonly paper: number | undefined;
  /** Device pixel → the coordinates where the group is called. */
  readonly toLocal: Mat;
  readonly ratio: number;
  readonly paperParams: PaperParams;
}

const DEFAULT_PAPER: PaperSettings = { scale: 3, contrast: 0.7, seed: 1 };
const times = (s: Sigma, k: number): Sigma => ({ x: s.x * k, y: s.y * k });

/** The painterly part of `effects`, or undefined when it has none. `scale` is device pixels per local unit along each axis. */
export function painterlyPlanOf(effects: Effects, a: { scale: Sigma; toLocal: Mat; ratio: number; paper: PaperSettings | undefined; colors: ColorParser }): PainterlyPlan | undefined {
  const { wash, hatching, paper } = effects;
  if (wash === undefined && hatching === undefined && paper === undefined) return undefined;
  return {
    wash: wash === undefined ? undefined : { granulate: wash.granulate ?? 0.5, edges: wash.edges ?? 0.5, blotch: wash.blotch ?? 0.4, bleed: wash.bleed ?? 0, sigma: times(a.scale, 2) },
    hatching: hatching === undefined ? undefined : {
      amount: hatching.amount,
      angle: hatching.angle ?? Math.PI / 4,
      spacing: hatching.spacing ?? 4.5,
      color: hatching.color === undefined ? undefined : a.colors(hatching.color),
      sigma: times(a.scale, 0.8 * (hatching.spacing ?? 4.5)),
    },
    paper,
    toLocal: a.toLocal,
    ratio: a.ratio,
    paperParams: paperParams(a.paper ?? DEFAULT_PAPER, a.ratio),
  };
}

/** The wash, hatching and paper pipelines, made once per device. */
export class PainterlyPasses {
  readonly #device: GPUDevice;
  readonly #layout: GPUBindGroupLayout;
  readonly #pipes: Readonly<Record<"wash" | "hatch" | "paperFx", GPURenderPipeline>>;
  readonly #histogram: GPUComputePipeline;
  readonly #range: GPUComputePipeline;

  constructor(device: GPUDevice) {
    this.#device = device;
    const F = GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX;
    const tex = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } });
    this.#layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: F, buffer: { type: "uniform" } }, tex(1), tex(2), { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.#layout] });
    const module = device.createShaderModule({ code: PAINTERLY_WGSL });
    const mk = (entryPoint: string): GPURenderPipeline => device.createRenderPipeline({ layout, vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint, targets: [{ format: "rgba8unorm" }] } });
    this.#pipes = { wash: mk("wash"), hatch: mk("hatch"), paperFx: mk("paperFx") };
    const tone = device.createShaderModule({ code: TONE_WGSL });
    this.#histogram = device.createComputePipeline({ layout: "auto", compute: { module: tone, entryPoint: "histogram" } });
    this.#range = device.createComputePipeline({ layout: "auto", compute: { module: tone, entryPoint: "range" } });
  }

  #buffer(f: Frame, a: { size: number; usage: number; data?: ArrayBuffer }): GPUBuffer {
    const buf = this.#device.createBuffer({ size: a.size, usage: a.usage | GPUBufferUsage.COPY_DST });
    if (a.data !== undefined) this.#device.queue.writeBuffer(buf, 0, a.data);
    f.temp.push(buf);
    return buf;
  }

  /** The shaders' record for `plan` over a layer at device rectangle `rect`. */
  #uniform(plan: PainterlyPlan, a: { f: Frame; rect: R; size: readonly [number, number] }): GPUBuffer {
    const data = new ArrayBuffer(160);
    const v = new Float32Array(data);
    const u = new Uint32Array(data);
    const t = plan.toLocal;
    const { x0, y0 } = a.rect;
    // texel position x → device pixel x + (x0, y0) → local.
    const e = t[0] * x0 + t[2] * y0 + t[4];
    const g = t[1] * x0 + t[3] * y0 + t[5];
    const d = det(t);
    const inv = [t[3] / d, -t[1] / d, -t[2] / d, t[0] / d];
    const w = plan.wash;
    const h = plan.hatching;
    const p = plan.paperParams;
    v.set([a.size[0], a.size[1], 0, 0, 0, 0, widthOf(a.rect), heightOf(a.rect)], 0);
    v.set([t[0], t[1], t[2], t[3], e, g, plan.ratio, Math.sqrt(Math.abs(d))], 8);
    v.set(inv, 16);
    v.set([w?.granulate ?? 0, w?.edges ?? 0, w?.blotch ?? 0, w?.bleed ?? 0], 20);
    v.set([h?.amount ?? 0, h?.angle ?? 0, h?.spacing ?? 4.5, h?.color === undefined ? 0 : 1, ...(h?.color ?? [0, 0, 0, 0])], 24);
    v.set([plan.paper ?? 0, p.scale, p.lo, p.hi], 32);
    u.set([p.seed, PAPER_ROW], 36);
    return this.#buffer(a.f, { size: 160, usage: GPUBufferUsage.UNIFORM, data });
  }

  #pass(pipe: "wash" | "hatch" | "paperFx", a: { f: Frame; uniform: GPUBuffer; src: GPUTexture; aux?: GPUTexture; tone?: GPUBuffer; w: number; h: number }): GPUTexture {
    const { f } = a;
    const out = f.pool.acquire({ w: a.w, h: a.h, format: "rgba8unorm" });
    const tone = a.tone ?? this.#buffer(f, { size: 264, usage: GPUBufferUsage.STORAGE });
    const group = this.#device.createBindGroup({ layout: this.#layout, entries: [
      { binding: 0, resource: { buffer: a.uniform } },
      { binding: 1, resource: a.src.createView() },
      { binding: 2, resource: (a.aux ?? f.pipes.dummy).createView() },
      { binding: 3, resource: { buffer: tone } },
    ] });
    const pass = beginPass(f, { tex: out, clear: true });
    pass.setPipeline(this.#pipes[pipe]);
    pass.setBindGroup(0, group);
    pass.draw(6);
    pass.end();
    f.stats.effectPasses++;
    return out;
  }

  /** The group's tone range: a histogram of `toneTex` inside the layer, then its percentiles. */
  #toneRange(a: { f: Frame; toneTex: GPUTexture; w: number; h: number }): GPUBuffer {
    const { f } = a;
    const hist = this.#buffer(f, { size: 264, usage: GPUBufferUsage.STORAGE });
    const region = this.#buffer(f, { size: 16, usage: GPUBufferUsage.UNIFORM, data: new Float32Array([0, 0, a.w, a.h]).buffer });
    const cp = f.enc.beginComputePass();
    cp.setPipeline(this.#histogram);
    cp.setBindGroup(0, this.#device.createBindGroup({ layout: this.#histogram.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: region } }, { binding: 1, resource: a.toneTex.createView() }, { binding: 2, resource: { buffer: hist } }] }));
    cp.dispatchWorkgroups(Math.ceil(a.w / 8), Math.ceil(a.h / 8));
    cp.setPipeline(this.#range);
    cp.setBindGroup(0, this.#device.createBindGroup({ layout: this.#range.getBindGroupLayout(0), entries: [{ binding: 2, resource: { buffer: hist } }] }));
    cp.dispatchWorkgroups(1);
    cp.end();
    f.stats.effectPasses += 2;
    return hist;
  }

  /** Apply `plan` to layer `src` (device rectangle `rect`); `blur` is the frame's separable blur. Returns the result; `src` stays the caller's. */
  encode(plan: PainterlyPlan, a: { f: Frame; src: GPUTexture; rect: R; blur: (tex: GPUTexture, sigma: Sigma) => GPUTexture }): GPUTexture {
    const { f } = a;
    const w = widthOf(a.rect);
    const h = heightOf(a.rect);
    const temps: GPUTexture[] = [];
    let cur = a.src;
    const step = (next: GPUTexture): void => {
      if (cur !== a.src) temps.push(cur);
      cur = next;
    };
    const base = { f, w, h };
    if (plan.wash !== undefined || plan.hatching !== undefined || plan.paper !== undefined) {
      const uniform = this.#uniform(plan, { f, rect: a.rect, size: [a.src.width, a.src.height] });
      if (plan.wash !== undefined) {
        const blurred = a.blur(cur, plan.wash.sigma);
        step(this.#pass("wash", { ...base, uniform, src: cur, aux: blurred }));
        temps.push(blurred);
      }
      if (plan.hatching !== undefined) {
        const blurred = a.blur(cur, plan.hatching.sigma);
        const tone = this.#toneRange({ f, toneTex: blurred, w, h });
        step(this.#pass("hatch", { ...base, uniform, src: cur, aux: blurred, tone }));
        temps.push(blurred);
      }
      if (plan.paper !== undefined) step(this.#pass("paperFx", { ...base, uniform, src: cur }));
    }
    for (const t of temps) f.pool.release(t);
    return cur;
  }
}
