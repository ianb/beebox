// A plain stroke as a union of positively wound pieces, in the shape's own
// coordinates (so a squashed shape gets a squashed outline, as Canvas2D does):
// one quad per segment, a wedge per join on the outer side, a cap per open end.
// Coverage of a union is the clamped sum, which is exact where pieces abut.
// Ported from the Stage 3 geometry probe (scratch/stage3/geometry/tess.ts). No dashes yet.
import type { ShapeStyle } from "../scene.js";
import type { Poly } from "./flatten.js";
import { arcPoints } from "./flatten.js";

type V = readonly [number, number];
const MITER_LIMIT = 10;

function dedupe(p: Poly): Poly {
  const o: number[] = [];
  for (let i = 0; i + 1 < p.pts.length; i += 2) {
    const x = p.pts[i] ?? 0;
    const y = p.pts[i + 1] ?? 0;
    const n = o.length;
    if (n > 0 && Math.abs((o[n - 2] ?? 0) - x) < 1e-9 && Math.abs((o[n - 1] ?? 0) - y) < 1e-9) continue;
    o.push(x, y);
  }
  if (p.closed && o.length > 4 && Math.abs((o[0] ?? 0) - (o.at(-2) ?? 0)) < 1e-9 && Math.abs((o[1] ?? 0) - (o.at(-1) ?? 0)) < 1e-9) o.length -= 2;
  return { pts: o, closed: p.closed };
}

function ringArea(r: readonly number[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    a += (r[i] ?? 0) * (r[j + 1] ?? 0) - (r[j] ?? 0) * (r[i + 1] ?? 0);
  }
  return a / 2;
}

/** Add a ring, wound positively (reversed if needed), so overlapping pieces add instead of cancelling. */
function pushRing(out: number[][], r: number[]): void {
  if (r.length < 6) return;
  if (ringArea(r) >= 0) {
    out.push(r);
    return;
  }
  const q: number[] = [];
  for (let i = r.length - 2; i >= 0; i -= 2) q.push(r[i] ?? 0, r[i + 1] ?? 0);
  out.push(q);
}

interface Line {
  readonly n: number;
  readonly at: (i: number) => V;
  readonly dir: (i: number) => V;
}

function lineOf(p: Poly): Line {
  const n = p.pts.length / 2;
  const at = (i: number): V => {
    const k = ((i % n) + n) % n;
    return [p.pts[2 * k] ?? 0, p.pts[2 * k + 1] ?? 0];
  };
  const dir = (i: number): V => {
    const a = at(i);
    const b = at(i + 1);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  return { n, at, dir };
}

function joinAt(out: number[][], j: { line: Line; i: number; hw: number; join: ShapeStyle["join"]; scale: number }): void {
  const { line, i, hw } = j;
  const d0 = line.dir(i - 1);
  const d1 = line.dir(i);
  const cr = d0[0] * d1[1] - d0[1] * d1[0];
  if (Math.abs(cr) < 1e-9 && d0[0] * d1[0] + d0[1] * d1[1] > 0) return;
  const s = cr > 0 ? -1 : 1; // the outer side's normal sign
  const n0: V = [-d0[1] * s, d0[0] * s];
  const n1: V = [-d1[1] * s, d1[0] * s];
  const [cx, cy] = line.at(i);
  const a: V = [cx + n0[0] * hw, cy + n0[1] * hw];
  const b: V = [cx + n1[0] * hw, cy + n1[1] * hw];
  if (j.join === "round") {
    const a0 = Math.atan2(n0[1], n0[0]);
    let a1 = Math.atan2(n1[1], n1[0]);
    while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
    while (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
    const r: number[] = [cx, cy];
    arcPoints(r, { cx, cy, rx: hw, ry: hw, a0, a1, scale: j.scale });
    pushRing(out, r);
    return;
  }
  // Canvas2D: a miter while miterLength / width ≤ the limit, i.e. 1 / sin(θ/2) ≤ 10.
  const dot = n0[0] * n1[0] + n0[1] * n1[1];
  const cosHalf = Math.sqrt(Math.max(0, (1 + dot) / 2));
  if (j.join === "miter" && cosHalf > 1 / MITER_LIMIT) {
    const k = hw / (1 + dot);
    pushRing(out, [cx, cy, a[0], a[1], cx + (n0[0] + n1[0]) * k, cy + (n0[1] + n1[1]) * k, b[0], b[1]]);
  } else {
    pushRing(out, [cx, cy, a[0], a[1], b[0], b[1]]);
  }
}

function capAt(out: number[][], c: { p: V; d: V; hw: number; cap: ShapeStyle["cap"]; scale: number }): void {
  const { p, d, hw } = c; // d points outward
  const nx = -d[1] * hw;
  const ny = d[0] * hw;
  if (c.cap === "square") {
    pushRing(out, [p[0] + nx, p[1] + ny, p[0] + nx + d[0] * hw, p[1] + ny + d[1] * hw, p[0] - nx + d[0] * hw, p[1] - ny + d[1] * hw, p[0] - nx, p[1] - ny]);
  } else if (c.cap === "round") {
    const a0 = Math.atan2(ny, nx);
    const r: number[] = [p[0], p[1]];
    arcPoints(r, { cx: p[0], cy: p[1], rx: hw, ry: hw, a0, a1: a0 - Math.PI, scale: c.scale });
    pushRing(out, r);
  }
}

/** The stroke of one polyline as closed rings in the shape's coordinates. `scale` is device pixels per unit. */
export function strokeRings(poly: Poly, s: { style: ShapeStyle; scale: number }): number[][] {
  const p = dedupe(poly);
  const out: number[][] = [];
  const line = lineOf(p);
  if (line.n < 2) return out;
  const hw = s.style.weight / 2;
  const segs = p.closed ? line.n : line.n - 1;
  for (let i = 0; i < segs; i++) {
    const [dx, dy] = line.dir(i);
    const a = line.at(i);
    const b = line.at(i + 1);
    const nx = -dy * hw;
    const ny = dx * hw;
    pushRing(out, [a[0] + nx, a[1] + ny, b[0] + nx, b[1] + ny, b[0] - nx, b[1] - ny, a[0] - nx, a[1] - ny]);
  }
  const first = p.closed ? 0 : 1;
  const last = p.closed ? line.n : line.n - 1;
  for (let i = first; i < last; i++) joinAt(out, { line, i, hw, join: s.style.join, scale: s.scale });
  if (!p.closed) {
    const ds = line.dir(0);
    capAt(out, { p: line.at(0), d: [-ds[0], -ds[1]], hw, cap: s.style.cap, scale: s.scale });
    capAt(out, { p: line.at(line.n - 1), d: line.dir(line.n - 2), hw, cap: s.style.cap, scale: s.scale });
  }
  return out;
}
