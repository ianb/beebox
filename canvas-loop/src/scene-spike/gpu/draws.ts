// Encode one job: its clip masks, then its items in order into its own layer.
// A draw whose blend reads what is below (every mode but normal, add, screen
// and erase) ends the pass, copies its box of the layer, and blends in the
// shader (W3C formulas); the others are fixed-function blends.
import { encodeFx } from "./fx.js";
import type { Frame } from "./frame.js";
import { beginPass, storage } from "./frame.js";
import type { ClipMask, Item, Job, Piece, R } from "./jobs.js";
import { heightOf, inter, isEmpty, widthOf } from "./jobs.js";
import type { PaintRec } from "./paint.js";
import type { DrawPipe } from "./pipelines.js";

const WORDS = 56;
const FIXED: Readonly<Partial<Record<number, DrawPipe>>> = { 0: "normal", 10: "add", 2: "screen" };

interface Rec {
  readonly box: R;
  readonly kind: number;
  readonly mode?: number;
  readonly paint?: PaintRec;
  readonly piece?: Piece;
  readonly src?: Job;
  readonly mask?: Job;
  readonly clip?: boolean;
  readonly bd?: R;
  readonly opacity?: number;
  /** A clip's rings: coverage from their summed winding, computed per pixel. */
  readonly rings?: readonly (readonly number[])[];
}

interface Textures {
  src?: GPUTexture | undefined;
  mask?: GPUTexture | undefined;
  clip?: GPUTexture | undefined;
  bd?: GPUTexture | undefined;
  piece?: Piece | undefined;
}

const layerO = (j: Job): number[] => [j.rect.x0, j.rect.y0, widthOf(j.rect), heightOf(j.rect)];
const rectO = (r: R): number[] => [r.x0, r.y0, widthOf(r), heightOf(r)];

/** Pack records and their gradient stops for one job. */
function pack(recs: readonly Rec[], tgt: { rect: R; tex: GPUTexture }): { draws: ArrayBuffer; stops: ArrayBuffer; edges: ArrayBuffer } {
  const buf = new ArrayBuffer(Math.max(1, recs.length) * WORDS * 4);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const stops: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  const edges: number[] = [0, 0, 0, 0];
  for (const [i, r] of recs.entries()) {
    const o = i * WORDS;
    f.set([r.box.x0, r.box.y0, r.box.x1, r.box.y1, tgt.rect.x0, tgt.rect.y0, tgt.tex.width, tgt.tex.height], o);
    const p = r.paint;
    if (p !== undefined) {
      f.set([...p.color, p.inv[0], p.inv[1], p.inv[2], p.inv[3], p.inv[4], p.inv[5], p.scaleY, 0, ...p.grad], o + 8);
      u[o + 50] = stops.length / 4;
      u[o + 51] = p.stops.length;
      for (const s of p.stops) stops.push(s.offset, 0, 0, 0, ...s.color);
      if (p.stops.length === 0) stops.push(0, 0, 0, 0, 0, 0, 0, 0);
    }
    const pc = r.piece;
    if (pc?.slot !== undefined) f.set([...rectO(pc.box), pc.slot.x, pc.slot.y, 0, 0], o + 24);
    if (r.rings !== undefined) {
      const start = edges.length / 4;
      for (const ring of r.rings) {
        for (let k = 0; k + 1 < ring.length; k += 2) {
          const j = (k + 2) % ring.length;
          edges.push(ring[k] ?? 0, ring[k + 1] ?? 0, ring[j] ?? 0, ring[j + 1] ?? 0);
        }
      }
      f.set([start, edges.length / 4 - start], o + 30);
    }
    if (r.src !== undefined) f.set(layerO(r.src), o + 32);
    if (r.mask !== undefined) f.set(layerO(r.mask), o + 36);
    if (r.clip === true) f.set(rectO(tgt.rect), o + 40);
    if (r.bd !== undefined) f.set(rectO(r.bd), o + 44);
    u[o + 48] = r.kind;
    u[o + 49] = r.mode ?? 0;
    f[o + 52] = r.opacity ?? 1;
  }
  return { draws: buf, stops: new Float32Array(stops).buffer, edges: new Float32Array(edges).buffer };
}

function textures(f: Frame, t: Textures): GPUBindGroup {
  const page = t.piece?.slot === undefined ? undefined : f.atlas[t.piece.slot.page]?.tex;
  const views = [t.src, t.mask, t.clip, t.bd, page].map((x) => (x ?? f.pipes.dummy).createView());
  return f.device.createBindGroup({ layout: f.pipes.g1, entries: views.map((resource, binding) => ({ binding, resource })) });
}

function itemRec(it: Item, rect: R): Rec {
  const box = inter(it.box, rect);
  const clip = it.clip !== null;
  if (it.k === "shape") return { box, kind: it.paint.kind, mode: it.mode, paint: it.paint, piece: it.piece, clip };
  return { box, kind: it.mask === undefined ? 3 : 4, mode: it.mode, src: it.job, ...(it.mask === undefined ? {} : { mask: it.mask }), clip, opacity: it.opacity };
}

function pipeOf(it: Item): DrawPipe {
  return it.erase ? "erase" : (FIXED[it.mode] ?? "backdrop");
}

/** Clip masks: each clip's coverage, times its parent, inside the clip's box. */
function clipRecs(job: Job): { clip: ClipMask; recs: Rec[]; mul: Rec | undefined }[] {
  return job.clips.map((clip) => {
    const box = inter(clip.box, job.rect);
    const recs: Rec[] = isEmpty(box) ? [] : [{ box, kind: 0, rings: clip.rings }];
    const mul = clip.parent === null || isEmpty(box) ? undefined : { box, kind: 0, clip: true };
    return { clip, recs, mul };
  });
}

/** Encode `job` (its sources already encoded) and leave its finished layer in `job.tex`. */
export function encodeJob(job: Job, f: Frame): void {
  f.stats.jobs++;
  const w = widthOf(job.rect);
  const h = heightOf(job.rect);
  const tex = f.pool.acquire({ w, h, format: "rgba8unorm" });
  const clips = clipRecs(job);
  const items = job.items.map((it) => ({ it, rec: itemRec(it, job.rect) })).filter((x) => !isEmpty(x.rec.box));
  // Backdrop draws carry their copy's box.
  const all: Rec[] = [...clips.flatMap((c) => [...c.recs, ...(c.mul === undefined ? [] : [c.mul])]), ...items.map((x) => (pipeOf(x.it) === "backdrop" ? { ...x.rec, bd: x.rec.box } : x.rec))];
  const packed = pack(all, { rect: job.rect, tex });
  const g0 = f.device.createBindGroup({ layout: f.pipes.g0, entries: [{ binding: 0, resource: { buffer: storage(f, packed.draws) } }, { binding: 1, resource: { buffer: storage(f, packed.stops) } }, { binding: 2, resource: { buffer: storage(f, packed.edges) } }] });
  let index = 0;
  const draw = (pass: GPURenderPassEncoder, t: Textures): void => {
    pass.setBindGroup(0, g0);
    pass.setBindGroup(1, textures(f, t));
    pass.draw(6, 1, 0, index);
    index++;
    f.stats.draws++;
  };
  for (const c of clips) {
    c.clip.tex = f.pool.acquire({ w, h, format: "r8unorm" });
    const pass = beginPass(f, { tex: c.clip.tex, clear: true });
    pass.setPipeline(f.pipes.draw.clipCov);
    for (const _r of c.recs) draw(pass, {});
    if (c.mul !== undefined) {
      pass.setPipeline(f.pipes.draw.clipMul);
      draw(pass, { clip: c.clip.parent?.tex });
    }
    pass.end();
  }
  const held: GPUTexture[] = [];
  let pass = beginPass(f, { tex, clear: true });
  for (const { it, rec } of items) {
    const pipe = pipeOf(it);
    let bd: GPUTexture | undefined;
    if (pipe === "backdrop") {
      pass.end();
      bd = f.pool.acquire({ w: widthOf(rec.box), h: heightOf(rec.box), format: "rgba8unorm" });
      f.enc.copyTextureToTexture({ texture: tex, origin: [rec.box.x0 - job.rect.x0, rec.box.y0 - job.rect.y0] }, { texture: bd }, [widthOf(rec.box), heightOf(rec.box)]);
      f.stats.copies++;
      held.push(bd);
      pass = beginPass(f, { tex, clear: false });
    }
    pass.setPipeline(f.pipes.draw[pipe]);
    const clip = it.clip?.tex;
    if (it.k === "shape") draw(pass, { piece: it.piece, clip, bd });
    else draw(pass, { src: it.job.tex, mask: it.mask?.tex, clip, bd });
  }
  pass.end();
  for (const t of held) f.pool.release(t);
  for (const c of clips) {
    if (c.clip.tex !== undefined) f.pool.release(c.clip.tex);
    c.clip.tex = undefined;
  }
  for (const it of job.items) {
    if (it.k !== "layer") continue;
    for (const src of [it.job, it.mask]) {
      if (src?.tex === undefined) continue;
      f.pool.release(src.tex);
      src.tex = undefined;
    }
  }
  job.tex = job.fx === undefined ? tex : encodeFx(job, { tex, f });
}
