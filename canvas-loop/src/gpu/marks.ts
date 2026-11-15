// A brushed stroke (R1, draft section 9) as draws: the shared expansion
// (brush/expand.ts, cached across frames) placed in device pixels. A stamp,
// ink or bristle stroke becomes a mark whose dabs, capsules or strips the GPU
// lays (brush-pass.ts); smudge and wet become a smear that reads the target
// (smear.ts). `linMarks` still places the CPU
// expansion (dabs, ink outlines, bristle runs), for the tests. Grain is cut
// against paper anchored to the picture or the scene (`toPaper`), then the
// brush opacity applies once.
import { bristleReach } from "../core/brush/render/kinds.js";
import type { BrushExpander, GpuSet, MarkSet, SmearSet } from "../scene/brush/expand.js";
import type { ColorParser } from "../scene/colors.js";
import { invert } from "../scene/mat.js";
import type { Mat, ShapeNode } from "../scene/nodes.js";
import type { BrushRec, MarkSource, PaperRec, R, SmearRec } from "./jobs.js";
import { EMPTY, cutOf, inter, isEmpty, pad } from "./jobs.js";
import type { PaintRec } from "./paint.js";
import { paintRec } from "./paint.js";
import { PAPER_ROW, paperParams } from "./painterly.js";
import { orientShape } from "./rings.js";
import type { LinShape } from "./geometry-cache.js";
import { linShape } from "./geometry-cache.js";
import type { Dab, Run } from "../scene/brush/expand.js";
import { checkBristles, checkContours } from "./brush-pack.js";

/** What lowering a brushed stroke needs from the frame. */
export interface BrushFrame {
  readonly expander: BrushExpander;
  readonly colors: ColorParser;
  readonly ratio: number;
  /** The brush pass's largest buffer (brush-pass.ts): a GPU stroke with a contour that cannot fit one fails here, naming the call. */
  readonly brushLimit: number;
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

/** Box `b` (brush space) grown by `g` on each side and mapped by `e`: the box of its four corners, unrounded. */
function mappedBox(b: { x0: number; y0: number; x1: number; y1: number }, a: { e: Mat; g: number }): R {
  const { e, g } = a;
  const corners = [map(e, b.x0 - g, b.y0 - g), map(e, b.x1 + g, b.y0 - g), map(e, b.x0 - g, b.y1 + g), map(e, b.x1 + g, b.y1 + g)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** A mark set under a linear map (no translation): ink outlines as one shape, or dabs and runs with the bounds they reach. */
type LinMarks =
  | { readonly kind: "piece"; readonly shape: LinShape }
  | { readonly kind: "tex"; readonly dabs: readonly Dab[]; readonly runs: readonly Run[]; readonly reach: { x0: number; y0: number; x1: number; y1: number } };

const lin = (...[e, x, y]: [Mat, number, number]): [number, number] => [e[0] * x + e[2] * y, e[1] * x + e[3] * y];

export function linMarks(set: MarkSet, a: { e: Mat; ratio: number }): LinMarks {
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

/** How far past the prepared box (brush space) a stroke's marks reach before the quad or strip edge: see `gpuBox`. */
function growth(set: GpuSet): number {
  const w = set.prepared.width;
  switch (set.kind) {
    case "ink":
      return w / 2;
    case "stamp":
      return (w / 2) * (1 + set.brush.sizeJitter / 2) + (set.brush.scatter * w) / 2;
    case "bristle":
      // The outermost bristle point and half the thickest bristle (kinds.ts), and the other half again for the mitre.
      return bristleReach(w, set.brush) + (w / Math.max(1, Math.round(set.brush.bristles))) * 1.1 * (1 + set.brush.spread / 2);
  }
}

/**
 * Where a stamp, ink or bristle stroke's marks can reach under `e` (brush
 * space → device pixels, translation included): the prepared box (wobble
 * included) grown, for a stamp, by the largest dab, `width / 2 × (1 +
 * sizeJitter / 2)`, and the largest scatter, `scatter × width / 2`; for ink,
 * by the largest capsule radius, `width / 2` (pressure 1); for bristle, by the
 * outermost bristle and its whole thickness, since a strip's mitre reaches up
 * to twice its half width plus one pixel; mapped by `e`, plus the edge of a
 * dab's or capsule's quad, one pixel, or a strip's, two. Undefined when the
 * stroke has no samples.
 */
export function gpuBox(set: GpuSet, e: Mat): R | undefined {
  const p = set.prepared;
  if (!p.contours.some((c) => c.count > 0)) return undefined;
  const edge = set.kind === "bristle" ? 2 : 1;
  const b = mappedBox(p.box, { e, g: growth(set) });
  return { x0: Math.floor(b.x0 - edge), y0: Math.floor(b.y0 - edge), x1: Math.ceil(b.x1 + edge), y1: Math.ceil(b.y1 + edge) };
}

function gpuMark(set: GpuSet, a: { e: Mat; ratio: number; visible: R; limit: number }): MarkSource | undefined {
  checkContours(set.prepared, a.limit);
  if (set.kind === "bristle") checkBristles(set.prepared, a.limit);
  const reach = gpuBox(set, a.e);
  if (reach === undefined) return undefined;
  const box = inter(reach, cutOf(a.visible));
  if (isEmpty(box)) return undefined;
  const { e } = a;
  return { kind: "tex", mark: { box, dabs: [], runs: [], ox: e[4], oy: e[5], gpu: { prepared: set.prepared, brush: set.brush, lin: [e[0], e[1], e[2], e[3]], ratio: a.ratio } } };
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

/** The draw for brushed stroke `n` under device transform `matrix`, or undefined when nothing can be seen. */
export function brushDraw(n: ShapeNode, a: { frame: BrushFrame; matrix: Mat; visible: R }): BrushDraw | undefined {
  const stroke = n.style.brush;
  const paint = n.style.stroke;
  if (stroke === undefined || paint === undefined || n.style.weight <= 0) return undefined;
  const { ratio, colors } = a.frame;
  const m = a.matrix;
  const ex = a.frame.expander.expand({ geom: n.geom, weight: n.style.weight, stroke, paint, linear: [m[0] / ratio, m[1] / ratio, m[2] / ratio, m[3] / ratio, 0, 0], colors });
  if (ex === undefined) return undefined;
  const q = ex.q;
  const e: Mat = [ratio * q[0], ratio * q[1], ratio * q[2], ratio * q[3], m[4], m[5]];
  // Paper pixels are the call's own coordinates times the pixel ratio, so grain moves with the stroke (draft 2.4).
  const inv = invert(m);
  if (inv === undefined) return undefined;
  const toPaper: Mat = [inv[0] * ratio, inv[1] * ratio, inv[2] * ratio, inv[3] * ratio, inv[4] * ratio, inv[5] * ratio];
  const paper: PaperRec = { toPaper, ...paperParams(stroke.paper, ratio), width: PAPER_ROW };
  const rec = paintRec(paint, { matrix: m, colors });
  if (ex.set.kind === "smear") return smear(ex.set, { e, ratio, visible: a.visible, paper, paint: rec, node: n });
  if (rec === undefined || ex.set.kind === "marks") return undefined;
  const source = gpuMark(ex.set, { e, ratio, visible: a.visible, limit: a.frame.brushLimit });
  if (source === undefined) return undefined;
  const brush: BrushRec = { grain: stroke.brush.grain, opacity: stroke.brush.opacity * (ex.set.tint ?? 1), paper };
  const box = source.kind === "piece" ? source.piece.box : source.mark.box;
  return { k: "mark", source, tinted: ex.set.tint !== undefined, paint: rec, brush, box };
}
