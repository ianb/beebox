// Effect passes over one finished layer (R5 step 2): colour adjustments, blur,
// wash, hatching and paper (painterly.ts), then glow and shadow drawn beneath,
// both made from the layer as it was before the effects. One texture per pass; the compositing probe's shared pages are
// not built yet.
import { blurKernel } from "./effects.js";
import type { FxPlan, Sigma } from "./effects.js";
import type { Frame } from "./frame.js";
import { beginPass, storage } from "./frame.js";
import type { Job } from "./jobs.js";
import { heightOf, widthOf } from "./jobs.js";
import type { FxPipe } from "./pipelines.js";

interface Stage {
  readonly pipe: FxPipe;
  /** v[1] onward of the effect record (v[0] is the layer's region, v[9] its texture size). */
  readonly fields: readonly number[];
  readonly inputs: readonly GPUTexture[];
  readonly kernel?: readonly number[];
}

function runStage(s: Stage, a: { f: Frame; w: number; h: number }): GPUTexture {
  const { f, w, h } = a;
  const out = f.pool.acquire({ w, h, format: "rgba8unorm" });
  const rec = new Float32Array(40);
  rec.set([0, 0, w, h], 0);
  rec.set(s.fields, 4);
  rec.set([out.width, out.height], 36);
  const g0 = f.device.createBindGroup({ layout: f.pipes.f0, entries: [
    { binding: 0, resource: { buffer: storage(f, rec.buffer) } },
    { binding: 1, resource: { buffer: storage(f, new Float32Array(s.kernel ?? [1]).buffer) } },
  ] });
  const views = [0, 1, 2].map((i) => (s.inputs[i] ?? f.pipes.dummy).createView());
  const g1 = f.device.createBindGroup({ layout: f.pipes.f1, entries: views.map((resource, binding) => ({ binding, resource })) });
  const pass = beginPass(f, { tex: out, clear: true, kind: "effect" });
  pass.setPipeline(f.pipes.fx[s.pipe]);
  pass.setBindGroup(0, g0);
  pass.setBindGroup(1, g1);
  pass.draw(6, 1, 0, 0);
  pass.end();
  f.stats.effectPasses++;
  return out;
}

/** A separable blur: horizontal (σx) into a temporary layer, then vertical (σy). */
export function blur2(src: GPUTexture, a: { sigma: Sigma; f: Frame; w: number; h: number }): GPUTexture {
  const kx = blurKernel(a.sigma.x);
  const ky = blurKernel(a.sigma.y);
  const across = runStage({ pipe: "fxBlur", fields: [1, 0, 0, kx.length - 1], inputs: [src], kernel: kx }, a);
  const down = runStage({ pipe: "fxBlur", fields: [0, 1, 0, ky.length - 1], inputs: [across], kernel: ky }, a);
  a.f.pool.release(across);
  return down;
}

/** v[1] = (has shadow, has glow, dx, dy), v[2] shadow colour, v[3] glow colour, v[4].x glow passes. */
function combineFields(plan: FxPlan): number[] {
  const { glow, shadow } = plan;
  const head = [shadow === undefined ? 0 : 1, glow === undefined ? 0 : 1, shadow?.dx ?? 0, shadow?.dy ?? 0];
  return [...head, ...(shadow?.color ?? [0, 0, 0, 0]), ...(glow?.color ?? [0, 0, 0, 0]), glow?.passes ?? 1];
}

/** Apply `job.fx` to its layer `tex`; returns the result and releases what it no longer needs. */
export function encodeFx(job: Job, a: { tex: GPUTexture; f: Frame }): GPUTexture {
  const plan: FxPlan | undefined = job.fx;
  if (plan === undefined) return a.tex;
  const { f, tex } = a;
  const size = { f, w: widthOf(job.rect), h: heightOf(job.rect) };
  const temps: GPUTexture[] = [];
  let effected = tex;
  if (plan.adjust.length > 0) {
    effected = runStage({ pipe: "fxMatrix", fields: [plan.adjust.length, 0, 0, 0, ...plan.adjust.flatMap(([k, v]) => [k, v, 0, 0])], inputs: [tex] }, size);
    temps.push(effected);
  }
  if (plan.blur.x > 0 || plan.blur.y > 0) {
    effected = blur2(effected, { ...size, sigma: plan.blur });
    temps.push(effected);
  }
  if (plan.painterly !== undefined) {
    effected = f.painterly.encode(plan.painterly, { f, src: effected, rect: job.rect, blur: (t, sigma) => blur2(t, { ...size, sigma }) });
    temps.push(effected);
  }
  let result = effected;
  const { glow, shadow } = plan;
  if (glow !== undefined || shadow !== undefined) {
    const g = glow === undefined ? undefined : blur2(tex, { ...size, sigma: glow.sigma });
    const s = shadow === undefined ? undefined : blur2(tex, { ...size, sigma: shadow.sigma });
    result = runStage({ pipe: "fxCombine", fields: combineFields(plan), inputs: [effected, s ?? f.pipes.dummy, g ?? f.pipes.dummy] }, size);
    for (const t of [g, s]) if (t !== undefined) f.pool.release(t);
  }
  for (const t of temps) if (t !== result) f.pool.release(t);
  if (result !== tex) f.pool.release(tex);
  return result;
}
