// Draw records: one per quad the draw shader runs (the WGSL `Draw` struct in
// shader-draw.ts), packed with their gradient stops and clip edges.
import type { Rgba } from "../scene/colors.js";
import type { BrushRec, GlyphQuad, Item, Job, R, Slot } from "./jobs.js";
import { heightOf, inter, widthOf } from "./jobs.js";
import type { PaintRec } from "./paint.js";
import { WORDS } from "./shader-draw.js";

/** A clip as a record reads it: its box in device pixels and where it sits on its clip page. */
export interface ClipRef {
  readonly box: R;
  readonly slot?: Slot | undefined;
}

export interface Rec {
  readonly box: R;
  /** The draw's source (see shader-draw.ts). */
  readonly src: number;
  readonly mode?: number;
  readonly paint?: PaintRec;
  /** Where the source's cell sits: its device rectangle (x, y, w, h) and its slot on a page. */
  readonly cov?: { readonly o: readonly number[]; readonly slot: readonly [number, number] };
  readonly job?: Job;
  /** Whole device pixels from the job's raster space to the target's. */
  readonly shift?: readonly [number, number];
  readonly mask?: Job;
  readonly clip?: ClipRef | undefined;
  /** On a clip page: the parent clip this one is multiplied by. */
  readonly parent?: ClipRef | undefined;
  readonly bd?: R;
  readonly opacity?: number;
  /** pap0, pap1, pap2: the paper map and settings of a grainy mark, or a glyph's texel map. */
  readonly pap?: readonly number[];
  readonly seed?: number;
  readonly pwidth?: number;
  /** A clip's rings: coverage from their summed winding, computed per pixel. */
  readonly rings?: readonly (readonly number[])[];
  /** In a material layer (R8): the material, straight, drawn in place of the colour. */
  readonly mat?: Rgba | undefined;
  /** Testing mode: the slot (1 and up) the peak-writing draw keeps this mark's largest alpha in (peaks.ts). */
  readonly peak?: number;
}

const rectO = (r: R): number[] => [r.x0, r.y0, widthOf(r), heightOf(r)];
const NO_PAPER = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0] as const;

function brushPap(b: BrushRec): number[] {
  const t = b.paper.toPaper;
  return [t[0], t[1], t[2], t[3], t[4], t[5], b.paper.scale, b.grain, b.paper.lo, b.paper.hi, b.opacity, 0];
}

function glyphRec(q: GlyphQuad, a: { paint: PaintRec; clip: ClipRef | undefined; mode: number }): Rec {
  const slot = q.cell.slot;
  return { box: q.box, src: 5, mode: a.mode, paint: a.paint, clip: a.clip, cov: { o: [0, 0, q.cell.w, q.cell.h], slot: [slot?.x ?? 0, slot?.y ?? 0] }, pap: [...q.a, ...q.t, 0, 0, 0, 0, 1, 0] };
}

/** The records an item draws, cut to `rect` (glyph items give one per glyph). */
export function itemRecs(it: Item, rect: R): Rec[] {
  const box = inter(it.box, rect);
  const clip = it.clip ?? undefined;
  const mode = it.mode;
  const mat = it.k === "smear" ? undefined : it.mat;
  return itemRecsOf(it, { box, clip, mode, rect }).map((r) => (mat === undefined ? r : { ...r, mat }));
}

function itemRecsOf(it: Item, a: { box: R; clip: ClipRef | undefined; mode: number; rect: R }): Rec[] {
  const { box, clip, mode, rect } = a;
  switch (it.k) {
    case "shape": {
      const p = it.piece;
      return [{ box, src: 0, mode, paint: it.paint, clip, cov: { o: rectO(p.box), slot: [p.slot?.x ?? 0, p.slot?.y ?? 0] } }];
    }
    case "layer":
      return [{ box, src: it.mask === undefined ? 1 : 2, mode, job: it.job, ...(it.mask === undefined ? {} : { mask: it.mask }), ...(it.shift === undefined ? {} : { shift: it.shift }), clip, opacity: it.opacity }];
    case "mark": {
      const cell = it.mark;
      const paper = it.brush.paper;
      return [{ box, src: it.tinted ? 4 : 3, mode, paint: it.paint, clip, cov: { o: rectO(cell.box), slot: [cell.slot?.x ?? 0, cell.slot?.y ?? 0] }, pap: brushPap(it.brush), seed: paper.seed, pwidth: paper.width }];
    }
    case "glyphs":
      return it.quads.map((q) => ({ ...glyphRec(q, { paint: it.paint, clip, mode }), box: inter(q.box, rect) }));
    case "smear":
      return [];
  }
}

function packPaint(p: PaintRec, a: { f: Float32Array; u: Uint32Array; o: number; stops: number[] }): void {
  const { f, u, o, stops } = a;
  f.set([...p.color, p.inv[0], p.inv[1], p.inv[2], p.inv[3], p.inv[4], p.inv[5], p.scaleY, 0, ...p.grad], o + 8);
  u[o + 60] = p.kind;
  u[o + 62] = stops.length / 4;
  u[o + 63] = p.stops.length;
  for (const s of p.stops) stops.push(s.offset, 0, 0, 0, ...s.color);
  if (p.stops.length === 0) stops.push(0, 0, 0, 0, 0, 0, 0, 0);
}

/** A clip's rings as edges appended to `edges`; returns (first edge, count). */
function packRings(rings: readonly (readonly number[])[], edges: number[]): [number, number] {
  const start = edges.length / 4;
  for (const ring of rings) {
    for (let k = 0; k + 1 < ring.length; k += 2) {
      const j = (k + 2) % ring.length;
      edges.push(ring[k] ?? 0, ring[k + 1] ?? 0, ring[j] ?? 0, ring[j + 1] ?? 0);
    }
  }
  return [start, edges.length / 4 - start];
}

/** Where a record's layer, mask, clip and parent clip sit. */
function packSources(r: Rec, a: { f: Float32Array; o: number }): void {
  const { f, o } = a;
  if (r.job !== undefined) {
    const [sx, sy] = r.shift ?? [0, 0];
    f.set([r.job.rect.x0 + sx, r.job.rect.y0 + sy, widthOf(r.job.rect), heightOf(r.job.rect)], o + 32);
  }
  if (r.mask !== undefined) f.set(rectO(r.mask.rect), o + 36);
  if (r.clip !== undefined) {
    f.set(rectO(r.clip.box), o + 40);
    f.set([r.clip.slot?.x ?? 0, r.clip.slot?.y ?? 0], o + 72);
  }
  if (r.parent !== undefined) {
    f.set(rectO(r.parent.box), o + 32);
    f.set([r.parent.slot?.x ?? 0, r.parent.slot?.y ?? 0], o + 36);
  }
}

/** Pack records and their gradient stops for one job. */
export function pack(recs: readonly Rec[], tgt: { rect: R; tex: GPUTexture }): { draws: ArrayBuffer; stops: ArrayBuffer; edges: ArrayBuffer } {
  const buf = new ArrayBuffer(Math.max(1, recs.length) * WORDS * 4);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const i32 = new Int32Array(buf);
  const stops: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  const edges: number[] = [0, 0, 0, 0];
  for (const [i, r] of recs.entries()) {
    const o = i * WORDS;
    f.set([r.box.x0, r.box.y0, r.box.x1, r.box.y1, tgt.rect.x0, tgt.rect.y0, tgt.tex.width, tgt.tex.height], o);
    if (r.paint !== undefined) packPaint(r.paint, { f, u, o, stops });
    if (r.cov !== undefined) f.set([...r.cov.o, ...r.cov.slot], o + 24);
    if (r.rings !== undefined) f.set(packRings(r.rings, edges), o + 30);
    packSources(r, { f, o });
    if (r.bd !== undefined) f.set(rectO(r.bd), o + 44);
    f.set(r.pap ?? NO_PAPER, o + 48);
    u[o + 61] = r.mode ?? 0;
    u[o + 64] = r.src;
    u[o + 65] = r.seed ?? 0;
    i32[o + 66] = r.pwidth ?? 0;
    f[o + 67] = r.opacity ?? 1;
    if (r.mat !== undefined) f.set([r.mat[0], r.mat[1], r.mat[2], 1], o + 68);
    if (r.peak !== undefined) f[o + 74] = r.peak;
  }
  return { draws: buf, stops: new Float32Array(stops).buffer, edges: new Float32Array(edges).buffer };
}
