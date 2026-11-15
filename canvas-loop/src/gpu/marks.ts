// A brushed stroke (R1, draft section 9) as draws: the shared CPU expansion
// (brush/expand.ts, cached across frames) placed in device pixels. Ink
// outlines become coverage pieces (exact area, as fills); dabs and bristle
// runs become a mark in the mark atlas; smudge and wet become a smear that
// reads the target (smear.ts). Grain is cut against paper anchored to the
// picture or the scene (`toPaper`), then the brush opacity applies once.
// Every stroke drawn is also prepared for the GPU sample pass (brush-pass.ts).
import type { BrushExpander, Expanded, MarkSet, Prepared, SmearSet } from "../scene/brush/expand.js";
import type { ColorParser } from "../scene/colors.js";
import { invert } from "../scene/mat.js";
import type { BrushStroke, Mat, ShapeNode } from "../scene/nodes.js";
import type { Paint } from "../core/paint.js";
import type { BrushRec, MarkSource, PaperRec, R, SmearRec } from "./jobs.js";
import { EMPTY, cutOf, inter, isEmpty, pad } from "./jobs.js";
import type { PaintRec } from "./paint.js";
import { paintRec } from "./paint.js";
import { PAPER_ROW, paperParams } from "./painterly.js";
import { orientShape } from "./rings.js";
import type { KeptValues, LinShape } from "./geometry-cache.js";
import { linShape, placePiece } from "./geometry-cache.js";
import { linearKey } from "../scene/hash.js";
import type { Dab, Run } from "../scene/brush/expand.js";

/** What lowering a brushed stroke needs from the frame. */
export interface BrushFrame {
  readonly expander: BrushExpander;
  readonly colors: ColorParser;
  readonly ratio: number;
  readonly kept: KeptValues;
  /** Brushed strokes drawn this frame, prepared for the GPU sample pass (brush-pass.ts). */
  readonly drawn: Prepared[];
}


export type BrushDraw =
  | { readonly k: "mark"; readonly source: MarkSource; readonly tinted: boolean; readonly paint: PaintRec; readonly brush: BrushRec; readonly box: R }
  | { readonly k: "smear"; readonly smear: SmearRec; readonly box: R };

const map = (...[e, x, y]: [Mat, number, number]): [number, number] => [e[0] * x + e[2] * y + e[4], e[1] * x + e[3] * y + e[5]];

function bounds(points: readonly { x: number; y: number; reach: number }[]): R {
  if (points.length === 0) return EMPTY;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x - p.reach);
    y0 = Math.min(y0, p.y - p.reach);
    x1 = Math.max(x1, p.x + p.reach);
    y1 = Math.max(y1, p.y + p.reach);
  }
  return { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) };
}

/** A mark set under a linear map (no translation): ink outlines as one shape, or dabs and runs with the bounds they reach. */
type LinMarks =
  | { readonly kind: "piece"; readonly shape: LinShape }
  | { readonly kind: "tex"; readonly dabs: readonly Dab[]; readonly runs: readonly Run[]; readonly reach: { x0: number; y0: number; x1: number; y1: number } };

const lin = (...[e, x, y]: [Mat, number, number]): [number, number] => [e[0] * x + e[2] * y, e[1] * x + e[3] * y];

function linMarks(set: MarkSet, a: { e: Mat; ratio: number }): LinMarks {
  const { e, ratio } = a;
  if (set.polys.length > 0) {
    const rings = set.polys.map((p) => {
      const out: number[] = [];
      for (let i = 0; i + 1 < p.length; i += 2) {
        const x = p[i] ?? 0;
        const y = p[i + 1] ?? 0;
        out.push(e[0] * x + e[2] * y, e[1] * x + e[3] * y);
      }
      return orientShape([out])[0] ?? out;
    });
    return { kind: "piece", shape: linShape(rings) };
  }
  const dabs = set.dabs.map((d) => ({ x: e[0] * d.x + e[2] * d.y, y: e[1] * d.x + e[3] * d.y, r: d.r * ratio, a: d.a, soft: d.soft, rgb: d.rgb }));
  const runs = set.runs.map((r) => {
    const pts: number[] = [];
    for (let i = 0; i + 1 < r.pts.length; i += 2) pts.push(...lin(e, r.pts[i] ?? 0, r.pts[i + 1] ?? 0));
    return { ...r, pts, width: r.width * ratio };
  });
  const reach = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (...[x, y, k]: [number, number, number]): void => {
    reach.x0 = Math.min(reach.x0, x - k);
    reach.y0 = Math.min(reach.y0, y - k);
    reach.x1 = Math.max(reach.x1, x + k);
    reach.y1 = Math.max(reach.y1, y + k);
  };
  for (const d of dabs) grow(d.x, d.y, d.r + 1);
  for (const r of runs) for (let i = 0; i + 1 < r.pts.length; i += 2) grow(r.pts[i] ?? 0, r.pts[i + 1] ?? 0, r.width + 2);
  return { kind: "tex", dabs, runs, reach };
}

/** A kept linear mark set moved by the transform's translation and cut to what can be seen. */
function marks(l: LinMarks, a: { tx: number; ty: number; visible: R }): MarkSource | undefined {
  const cut = cutOf(a.visible);
  if (l.kind === "piece") {
    const piece = placePiece(l.shape, { tx: a.tx, ty: a.ty, cut });
    return piece === undefined ? undefined : { kind: "piece", piece };
  }
  const r = l.reach;
  if (!(r.x1 >= r.x0)) return undefined;
  const box = inter({ x0: Math.floor(r.x0 + a.tx), y0: Math.floor(r.y0 + a.ty), x1: Math.ceil(r.x1 + a.tx), y1: Math.ceil(r.y1 + a.ty) }, cut);
  return isEmpty(box) ? undefined : { kind: "tex", mark: { box, dabs: l.dabs, runs: l.runs, ox: a.tx, oy: a.ty } };
}

function smear(set: SmearSet, a: { e: Mat; ratio: number; visible: R; paper: PaperRec; paint: PaintRec | undefined; node: ShapeNode }): BrushDraw | undefined {
  const brush = a.node.style.brush?.brush;
  if (brush?.kind !== "smear") return undefined;
  const dabs = set.contours.flatMap((c) => c.map((d, k) => {
    const [x, y] = map(a.e, d.x, d.y);
    return { x, y, r: d.r * a.ratio, a: d.a, first: k === 0 };
  }));
  const size = 2 * Math.ceil((set.width * a.ratio) / 2) + 4;
  const box = inter(bounds(dabs.map((d) => ({ x: d.x, y: d.y, reach: size + 2 }))), pad(a.visible, 2));
  if (isEmpty(box) || dabs.length === 0) return undefined;
  const color = a.paint?.color ?? [0, 0, 0, 0];
  const straight = color[3] > 0 ? [color[0] / color[3], color[1] / color[3], color[2] / color[3], color[3]] as const : color;
  return { k: "smear", smear: { dabs, size, brush, paint: straight, paper: a.paper }, box };
}

/** The draw for brushed stroke `n` under device transform `matrix`, or undefined when nothing can be seen; a drawn stroke joins `frame.drawn`. */
export function brushDraw(n: ShapeNode, a: { frame: BrushFrame; matrix: Mat; visible: R }): BrushDraw | undefined {
  const stroke = n.style.brush;
  const paint = n.style.stroke;
  if (stroke === undefined || paint === undefined || n.style.weight <= 0) return undefined;
  const { ratio, colors } = a.frame;
  const m = a.matrix;
  const ex = a.frame.expander.expand({ geom: n.geom, weight: n.style.weight, stroke, paint, linear: [m[0] / ratio, m[1] / ratio, m[2] / ratio, m[3] / ratio, 0, 0], colors });
  if (ex === undefined) return undefined;
  const d = placed(n, { ...a, ex, stroke, paint });
  const prepared = d === undefined ? undefined : ex.prepared();
  if (prepared !== undefined) a.frame.drawn.push(prepared);
  return d;
}

/** An expanded stroke placed under `matrix`: a mark or a smear, cut to what can be seen. */
function placed(n: ShapeNode, a: { frame: BrushFrame; matrix: Mat; visible: R; ex: Expanded; stroke: BrushStroke; paint: Paint }): BrushDraw | undefined {
  const { ex, stroke, paint } = a;
  const { ratio, colors } = a.frame;
  const m = a.matrix;
  const q = ex.q;
  const e: Mat = [ratio * q[0], ratio * q[1], ratio * q[2], ratio * q[3], m[4], m[5]];
  // Paper pixels are the call's own coordinates times the pixel ratio, so grain moves with the stroke (draft 2.4).
  const inv = invert(m);
  if (inv === undefined) return undefined;
  const toPaper: Mat = [inv[0] * ratio, inv[1] * ratio, inv[2] * ratio, inv[3] * ratio, inv[4] * ratio, inv[5] * ratio];
  const paper: PaperRec = { toPaper, ...paperParams(stroke.paper, ratio), width: PAPER_ROW };
  const rec = paintRec(paint, { matrix: m, colors });
  if (ex.set.kind === "smear") return smear(ex.set, { e, ratio, visible: a.visible, paper, paint: rec, node: n });
  if (rec === undefined) return undefined;
  const set = ex.set;
  const l = a.frame.kept.get(`m|${ex.key}|${linearKey(e)}`, () => linMarks(set, { e, ratio }));
  const source = marks(l, { tx: e[4], ty: e[5], visible: a.visible });
  if (source === undefined) return undefined;
  const brush: BrushRec = { grain: stroke.brush.grain, opacity: stroke.brush.opacity * (ex.set.tint ?? 1), paper };
  const box = source.kind === "piece" ? source.piece.box : source.mark.box;
  return { k: "mark", source, tinted: ex.set.tint !== undefined, paint: rec, brush, box };
}
