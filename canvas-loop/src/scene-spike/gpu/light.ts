// Lit groups (R8) on the GPU: the lights a group gathered while lowering, in
// device pixels, and the passes that shade its colour layer from its two
// material layers (shader-light.ts) and give a bevelled shape its normals.
import type { ColorParser, Rgba } from "../colors.js";
import { apply, applyLinear, det } from "../mat.js";
import type { LightRec, LightingRec, Mat } from "../scene.js";
import type { Sigma } from "./effects.js";
import type { Frame } from "./frame.js";
import { beginPass } from "./frame.js";
import type { Job } from "./jobs.js";
import { heightOf, isEmpty, widthOf } from "./jobs.js";
import type { BevelPlan } from "./material.js";
import { BEVEL_WGSL, LIGHT_WGSL } from "./shader-light.js";

/** A light met while lowering a lit group's body, with the device transform at its call (placements included). */
export interface LightOut {
  readonly light: LightRec;
  readonly matrix: Mat;
}

/** How much the shadow march's caster layer is blurred, in logical pixels. */
const CASTER_SOFTEN = 3;
const KIND = { point: 0, spot: 1, directional: 2 } as const;
const SHADOWS = { none: 0, hard: 1, soft: 2 } as const;

export interface LightPlan {
  /** 12 floats per light, device pixels (see shader-light.ts `Lt`). */
  readonly lights: readonly (readonly number[])[];
  readonly ambient: Rgba;
  readonly shadows: number;
  /** Device pixels a caster stands per unit of its squared encoded height (material.ts). */
  readonly heightScale: number;
  /** The tallest caster, device pixels: how far a directional light's shadow can reach. */
  readonly tallest: number;
  /** 2^exposure, and the tone curve's strength. */
  readonly exposure: number;
  readonly toneCurve: number;
  readonly ratio: number;
}

/**
 * The plan for a lit group called under device transform `matrix`, from the lights its body
 * held; `tallest` is its tallest caster and `encodeMax` the height its material layer encodes
 * as 1, both in its own units.
 */
export function lightPlanOf(outs: readonly LightOut[], a: { lighting: LightingRec; matrix: Mat; colors: ColorParser; ratio: number; tallest: number; encodeMax: number }): LightPlan {
  const unit = Math.sqrt(Math.abs(det(a.matrix)));
  const lights = outs.map(({ light: l, matrix: m }) => {
    const s = Math.sqrt(Math.abs(det(m)));
    const [x, y] = apply(m, l.at);
    const [dx, dy] = applyLinear(m, [Math.cos(l.direction), Math.sin(l.direction)]);
    const c = a.colors(l.color);
    return [x, y, l.height * s, KIND[l.kind], c[0], c[1], c[2], l.energy * c[3], l.reach * s, Math.atan2(dy, dx), l.cone, l.height / 100];
  });
  const amb = a.colors(a.lighting.ambient);
  return {
    lights,
    ambient: [amb[0] * amb[3], amb[1] * amb[3], amb[2] * amb[3], 1],
    shadows: SHADOWS[a.lighting.shadows],
    heightScale: a.encodeMax * unit,
    tallest: a.tallest * unit,
    exposure: 2 ** a.lighting.exposure,
    toneCurve: a.lighting.toneCurve,
    ratio: a.ratio,
  };
}

/** The lighting and bevel pipelines, made once per device. */
export class LightPass {
  readonly #device: GPUDevice;
  readonly #light: GPURenderPipeline;
  readonly #bevel: GPURenderPipeline;

  constructor(device: GPUDevice) {
    this.#device = device;
    const mk = (code: string, entryPoint: string): GPURenderPipeline => {
      const module = device.createShaderModule({ code });
      return device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint, targets: [{ format: "rgba8unorm" }] } });
    };
    this.#light = mk(LIGHT_WGSL, "light");
    this.#bevel = mk(BEVEL_WGSL, "bevel");
  }

  #buffer(f: Frame, a: { usage: number; data: ArrayBuffer }): GPUBuffer {
    const buf = this.#device.createBuffer({ size: Math.max(16, a.data.byteLength), usage: a.usage | GPUBufferUsage.COPY_DST });
    this.#device.queue.writeBuffer(buf, 0, a.data);
    f.temp.push(buf);
    return buf;
  }

  #run(pipe: GPURenderPipeline, a: { f: Frame; job: Job; entries: (GPUBuffer | GPUTexture)[] }): GPUTexture {
    const { f, job } = a;
    const out = f.pool.acquire({ w: widthOf(job.rect), h: heightOf(job.rect), format: "rgba8unorm" });
    const entries = a.entries.map((r, binding): GPUBindGroupEntry => ({ binding, resource: "createView" in r ? r.createView() : { buffer: r } }));
    const pass = beginPass(f, { tex: out, clear: true, kind: "light" });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, this.#device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }));
    pass.draw(6);
    pass.end();
    f.stats.effectPasses++;
    return out;
  }

  /** A bevelled shape's layer (`tex`, its coverage) as material layer 0: normals of a round rim, shine, coverage. */
  bevel(job: Job, a: { f: Frame; tex: GPUTexture; plan: BevelPlan; blur: (tex: GPUTexture, sigma: Sigma) => GPUTexture }): GPUTexture {
    const blurred = a.blur(a.tex, a.plan.sigma);
    const u = new Float32Array([a.tex.width, a.tex.height, 0, 0, 0, 0, widthOf(job.rect), heightOf(job.rect), a.plan.height, a.plan.shine, 0, 0]);
    const out = this.#run(this.#bevel, { f: a.f, job, entries: [this.#buffer(a.f, { usage: GPUBufferUsage.UNIFORM, data: u.buffer }), a.tex, blurred] });
    a.f.pool.release(blurred);
    a.f.pool.release(a.tex);
    return out;
  }

  /**
   * Shade lit group `job`'s colour layer `tex` from its material layers; frees them and `tex`.
   * Soft shadows march through layer 1 blurred a little, so a shadow's sides soften and its
   * samples do not show as grain; hard shadows read it as drawn.
   */
  light(job: Job, a: { f: Frame; tex: GPUTexture; plan: LightPlan; mats: readonly [Job, Job]; blur: (tex: GPUTexture, a: { sigma: Sigma; w: number; h: number }) => GPUTexture }): GPUTexture {
    const { f, plan } = a;
    const casters = a.mats[1];
    const s = CASTER_SOFTEN * plan.ratio;
    const soft = plan.shadows !== SHADOWS.soft || casters.tex === undefined || isEmpty(casters.rect) ? undefined : a.blur(casters.tex, { sigma: { x: s, y: s }, w: widthOf(casters.rect), h: heightOf(casters.rect) });
    const { x0, y0 } = job.rect;
    const offset = (m: Job): number[] => (m.tex === undefined || isEmpty(m.rect) ? [0, 0, 0, 0] : [m.rect.x0 - x0, m.rect.y0 - y0, widthOf(m.rect), heightOf(m.rect)]);
    const u = new Float32Array([
      a.tex.width, a.tex.height, x0, y0, 0, 0, widthOf(job.rect), heightOf(job.rect),
      ...offset(a.mats[0]), ...offset(a.mats[1]),
      ...plan.ambient.slice(0, 3), plan.shadows,
      plan.lights.length, plan.heightScale, plan.ratio, plan.tallest,
      plan.exposure, plan.toneCurve, 0, 0,
    ]);
    const lights = new Float32Array(Math.max(1, plan.lights.length) * 12);
    // Light positions in canvas device px, as the shader shades (its origin is whole pixels).
    for (const [k, l] of plan.lights.entries()) lights.set(l, k * 12);
    const tex = (m: Job): GPUTexture => m.tex ?? f.pipes.dummy;
    const out = this.#run(this.#light, { f, job, entries: [
      this.#buffer(f, { usage: GPUBufferUsage.UNIFORM, data: u.buffer }),
      this.#buffer(f, { usage: GPUBufferUsage.STORAGE, data: lights.buffer }),
      a.tex, tex(a.mats[0]), tex(a.mats[1]), soft ?? tex(a.mats[1]),
    ] });
    if (soft !== undefined) f.pool.release(soft);
    for (const m of [...a.mats, { tex: a.tex }]) {
      if (m.tex !== undefined) f.pool.release(m.tex);
    }
    for (const m of a.mats) m.tex = undefined;
    return out;
  }
}
