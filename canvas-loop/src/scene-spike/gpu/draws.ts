// Encode one job: its clip masks, then its items in order into its own layer.
// A draw whose blend reads what is below (every mode but normal, add, screen
// and erase) ends the pass, copies its box of the layer, and blends in the
// shader (W3C formulas); the others are fixed-function blends. A smudge or wet
// stroke ends the pass and runs as a compute dispatch on the layer (R1).
import { blur2, encodeFx } from "./fx.js";
import type { Frame } from "./frame.js";
import { beginPass, storage } from "./frame.js";
import type { ClipMask, Item, Job } from "./jobs.js";
import { heightOf, inter, isEmpty, widthOf } from "./jobs.js";
import type { DrawPipe } from "./pipelines.js";
import type { Rec } from "./records.js";
import { itemRecs, pack } from "./records.js";

const FIXED: Readonly<Partial<Record<number, DrawPipe>>> = { 0: "normal", 10: "add", 2: "screen" };

interface Textures {
  src?: GPUTexture | undefined;
  mask?: GPUTexture | undefined;
  clip?: GPUTexture | undefined;
  bd?: GPUTexture | undefined;
  atlas?: GPUTexture | undefined;
  aux?: GPUTexture | undefined;
  image?: GPUTexture | undefined;
}

function textures(f: Frame, t: Textures): GPUBindGroup {
  const views = [t.src, t.mask, t.clip, t.bd, t.atlas, t.aux, t.image].map((x) => (x ?? f.pipes.dummy).createView());
  return f.device.createBindGroup({ layout: f.pipes.g1, entries: views.map((resource, binding) => ({ binding, resource })) });
}

/**
 * The textures one item's draws read, by the page each record needs (glyph
 * items may span pages). Shapes and marks bind both their coverage page and
 * their mark page, so a run of them shares one draw.
 */
function itemTextures(it: Item, f: Frame): { page: number; t: Textures }[] {
  const clip = it.clip?.tex;
  const image = (p: { image?: Parameters<Frame["image"]>[0] }): GPUTexture | undefined => (p.image === undefined ? undefined : f.image(p.image));
  const pages = (a: { atlas: number; marks: number }): Textures => ({ atlas: f.atlas[a.atlas]?.tex, aux: f.markPages[a.marks]?.tex });
  switch (it.k) {
    case "shape":
      return [{ page: 0, t: { clip, image: image(it.paint), ...pages({ atlas: it.piece.slot?.page ?? 0, marks: 0 }) } }];
    case "layer":
      return [{ page: 0, t: { src: it.job.tex, mask: it.mask?.tex, clip } }];
    case "mark": {
      const s = it.source;
      const at = s.kind === "piece" ? { atlas: s.piece.slot?.page ?? 0, marks: 0 } : { atlas: 0, marks: s.mark.slot?.page ?? 0 };
      return [{ page: 0, t: { clip, image: image(it.paint), ...pages(at) } }];
    }
    case "glyphs": {
      const used = [...new Set(it.quads.map((q) => q.cell.slot?.page ?? 0))];
      return used.map((page) => ({ page, t: { clip, aux: f.glyphPages[page]?.tex, image: image(it.paint) } }));
    }
    case "smear":
      return [];
  }
}

const TEXTURE_KEYS = ["src", "mask", "clip", "bd", "atlas", "aux", "image"] as const;
const sameTextures = (a: Textures, b: Textures): boolean => TEXTURE_KEYS.every((k) => a[k] === b[k]);

function pipeOf(it: Item): DrawPipe {
  return it.erase ? "erase" : (FIXED[it.mode] ?? "backdrop");
}

/** Clip masks: each clip's coverage, times its parent, inside the clip's box. */
function clipRecs(job: Job): { clip: ClipMask; recs: Rec[]; mul: Rec | undefined }[] {
  return job.clips.map((clip) => {
    const box = inter(clip.box, job.rect);
    const recs: Rec[] = isEmpty(box) ? [] : [{ box, src: 0, rings: clip.rings }];
    const mul = clip.parent === null || isEmpty(box) ? undefined : { box, src: 0, clip: true };
    return { clip, recs, mul };
  });
}

/** Release what `job`'s items and clips held once the job is encoded. */
function releaseSources(job: Job, f: Frame): void {
  for (const c of job.clips) {
    if (c.tex !== undefined) f.pool.release(c.tex);
    c.tex = undefined;
  }
  for (const it of job.items) {
    if (it.k !== "layer") continue;
    for (const src of [it.job, it.mask]) {
      if (src?.tex === undefined) continue;
      f.pool.release(src.tex);
      src.tex = undefined;
    }
  }
}

/** Encode `job` (its sources already encoded) and leave its finished layer in `job.tex`. */
export function encodeJob(job: Job, f: Frame): void {
  f.stats.jobs++;
  const w = widthOf(job.rect);
  const h = heightOf(job.rect);
  const tex = f.pool.acquire({ w, h, format: "rgba8unorm" });
  const clips = clipRecs(job);
  const items = job.items.map((it) => ({ it, recs: itemRecs(it, job.rect), box: inter(it.box, job.rect) })).filter((x) => !isEmpty(x.box));
  // Backdrop draws carry their copy's box.
  const itemRecsAll = items.map((x) => (pipeOf(x.it) === "backdrop" ? x.recs.map((r) => ({ ...r, bd: x.box })) : x.recs));
  const all: Rec[] = [...clips.flatMap((c) => [...c.recs, ...(c.mul === undefined ? [] : [c.mul])]), ...itemRecsAll.flat()];
  const packed = pack(all, { rect: job.rect, tex });
  const g0 = f.device.createBindGroup({ layout: f.pipes.g0, entries: [{ binding: 0, resource: { buffer: storage(f, packed.draws) } }, { binding: 1, resource: { buffer: storage(f, packed.stops) } }, { binding: 2, resource: { buffer: storage(f, packed.edges) } }] });
  let index = 0;
  const draw = (pass: GPURenderPassEncoder, a: { t: Textures; count: number }): void => {
    pass.setBindGroup(0, g0);
    pass.setBindGroup(1, textures(f, a.t));
    pass.draw(6, a.count, 0, index);
    index += a.count;
    f.stats.draws++;
  };
  for (const c of clips) {
    c.clip.tex = f.pool.acquire({ w, h, format: "r8unorm" });
    const pass = beginPass(f, { tex: c.clip.tex, clear: true });
    pass.setPipeline(f.pipes.draw.clipCov);
    for (const _r of c.recs) draw(pass, { t: {}, count: 1 });
    if (c.mul !== undefined) {
      pass.setPipeline(f.pipes.draw.clipMul);
      draw(pass, { t: { clip: c.clip.parent?.tex }, count: 1 });
    }
    pass.end();
  }
  const held: GPUTexture[] = [];
  let pass = beginPass(f, { tex, clear: true });
  // Consecutive draws with one fixed-function pipeline and the same textures go out as one instanced draw.
  let pending: { pipe: DrawPipe; t: Textures; count: number } | undefined;
  const flush = (): void => {
    if (pending === undefined) return;
    pass.setPipeline(f.pipes.draw[pending.pipe]);
    draw(pass, pending);
    pending = undefined;
  };
  for (const [k, { it, box }] of items.entries()) {
    const recs = itemRecsAll[k] ?? [];
    if (it.k === "smear") {
      flush();
      pass.end();
      f.smear.encode(it.smear, { f, tex, rect: job.rect, clip: it.clip?.tex });
      pass = beginPass(f, { tex, clear: false });
      continue;
    }
    const pipe = pipeOf(it);
    const groups = itemTextures(it, f);
    const only = groups.length === 1 ? groups[0] : undefined;
    if (pipe !== "backdrop" && only !== undefined) {
      if (pending?.pipe === pipe && sameTextures(pending.t, only.t)) pending.count += recs.length;
      else {
        flush();
        pending = { pipe, t: only.t, count: recs.length };
      }
      continue;
    }
    flush();
    let bd: GPUTexture | undefined;
    if (pipe === "backdrop") {
      pass.end();
      bd = f.pool.acquire({ w: widthOf(box), h: heightOf(box), format: "rgba8unorm" });
      f.enc.copyTextureToTexture({ texture: tex, origin: [box.x0 - job.rect.x0, box.y0 - job.rect.y0] }, { texture: bd }, [widthOf(box), heightOf(box)]);
      f.stats.copies++;
      held.push(bd);
      pass = beginPass(f, { tex, clear: false });
    }
    pass.setPipeline(f.pipes.draw[pipe]);
    if (only !== undefined || it.k !== "glyphs") {
      draw(pass, { t: { ...only?.t, bd }, count: recs.length });
      continue;
    }
    // Glyphs on several pages: one draw per glyph, with its page.
    for (const q of it.quads) {
      const g = groups.find((x) => x.page === (q.cell.slot?.page ?? 0));
      draw(pass, { t: { ...g?.t, bd }, count: 1 });
    }
  }
  flush();
  pass.end();
  for (const t of held) f.pool.release(t);
  releaseSources(job, f);
  const size = { f, w, h };
  let out = tex;
  if (job.bevel !== undefined) out = f.light.bevel(job, { f, tex: out, plan: job.bevel, blur: (t, sigma) => blur2(t, { ...size, sigma }) });
  // R5: lighting first, then the group's effects.
  if (job.light !== undefined) out = f.light.light(job, { f, tex: out, plan: job.light.plan, mats: job.light.mats });
  job.tex = job.fx === undefined ? out : encodeFx(job, { tex: out, f });
}
