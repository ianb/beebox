// Device-space rings (closed polygons, flat [x0, y0, x1, y1, …]): cut to a
// rectangle before they reach the atlas, and oriented for clip unions.
import type { Piece, R } from "./jobs.js";

export function ringArea(r: readonly number[]): number {
  let a = 0;
  for (let i = 0; i + 1 < r.length; i += 2) {
    const j = (i + 2) % r.length;
    a += (r[i] ?? 0) * (r[j + 1] ?? 0) - (r[j] ?? 0) * (r[i + 1] ?? 0);
  }
  return a / 2;
}

interface Side { readonly axis: 0 | 1; readonly at: number; readonly keepBelow: boolean }

function clipSide(r: readonly number[], s: Side): number[] {
  const out: number[] = [];
  const n = r.length / 2;
  const inside = (i: number): boolean => {
    const v = r[2 * i + s.axis] ?? 0;
    return s.keepBelow ? v <= s.at : v >= s.at;
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[2 * i] ?? 0;
    const ay = r[2 * i + 1] ?? 0;
    const bx = r[2 * j] ?? 0;
    const by = r[2 * j + 1] ?? 0;
    const ia = inside(i);
    const ib = inside(j);
    if (ia) out.push(ax, ay);
    if (ia !== ib) {
      const av = s.axis === 0 ? ax : ay;
      const bv = s.axis === 0 ? bx : by;
      const t = (s.at - av) / (bv - av);
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  }
  return out;
}

/**
 * Cut each ring to `box` (Sutherland–Hodgman). Inside the box every point keeps
 * its winding number, so coverage there is unchanged; outside it is gone, so a
 * shape far off the canvas costs nothing and a huge one fits the atlas.
 */
export function cutRings(rings: readonly (readonly number[])[], box: R): number[][] {
  const sides: Side[] = [
    { axis: 0, at: box.x0, keepBelow: false },
    { axis: 0, at: box.x1, keepBelow: true },
    { axis: 1, at: box.y0, keepBelow: false },
    { axis: 1, at: box.y1, keepBelow: true },
  ];
  const out: number[][] = [];
  for (const r of rings) {
    let c: readonly number[] = r;
    for (const s of sides) if (c.length >= 6) c = clipSide(c, s);
    if (c.length >= 6 && ringArea(c) !== 0) out.push([...c]);
  }
  return out;
}

function reversed(r: readonly number[]): number[] {
  const q: number[] = [];
  for (let i = r.length - 2; i >= 0; i -= 2) q.push(r[i] ?? 0, r[i + 1] ?? 0);
  return q;
}

/**
 * One clip shape's rings, turned so the shape's net area is positive. A hole
 * (a contour wound against its outline) stays a hole; shapes then add their
 * windings, and a pixel is inside the union where the sum is not zero.
 */
export function orientShape(rings: readonly (readonly number[])[]): number[][] {
  const net = rings.reduce((a, r) => a + ringArea(r), 0);
  return rings.map((r) => (net < 0 ? reversed(r) : [...r]));
}

/** Rings as a coverage piece with integer bounds, or undefined when they cover nothing. */
export function pieceOf(rings: number[][]): Piece | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i += 2) {
      const x = r[i] ?? 0;
      const y = r[i + 1] ?? 0;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (!(x1 > x0 && y1 > y0) || !Number.isFinite(x0 + x1 + y0 + y1)) return undefined;
  return { rings, box: { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) }, ox: 0, oy: 0 };
}

const orient = (...[ax, ay, bx, by, cx, cy]: readonly number[]): number => Math.sign(((bx ?? 0) - (ax ?? 0)) * ((cy ?? 0) - (ay ?? 0)) - ((by ?? 0) - (ay ?? 0)) * ((cx ?? 0) - (ax ?? 0)));

/** Whether segments p (x0, y0, x1, y1) and q touch or cross; the x and y ranges are known to overlap. */
function segmentsMeet(p: readonly number[], q: readonly number[]): boolean {
  const [ax = 0, ay = 0, bx = 0, by = 0] = p;
  const [cx = 0, cy = 0, dx = 0, dy = 0] = q;
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  // Collinear or touching counts as meeting: such an outline is not known to be simple.
  return o1 !== o2 && o3 !== o4 ? true : o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0;
}

/**
 * Whether a closed ring (flat x, y pairs) is simple: no two non-adjacent edges
 * touch or cross. A sweep down y compares each edge only with edges whose y
 * ranges overlap it. Such a ring's exact-area coverage equals its winding
 * coverage everywhere, so a clip to it can read the coverage atlas.
 */
export function isSimpleRing(ring: readonly number[]): boolean {
  // Repeated points (a closing point equal to the first, zero-length steps) are dropped first.
  const r: number[] = [];
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const x = ring[i] ?? 0;
    const y = ring[i + 1] ?? 0;
    if (r.length === 0 || x !== r.at(-2) || y !== r.at(-1)) r.push(x, y);
  }
  while (r.length >= 4 && r[0] === r.at(-2) && r[1] === r.at(-1)) r.splice(-2);
  const n = r.length / 2;
  if (n < 3) return false;
  const segs = Array.from({ length: n }, (_, i) => {
    const j = (i + 1) % n;
    const s = [r[2 * i] ?? 0, r[2 * i + 1] ?? 0, r[2 * j] ?? 0, r[2 * j + 1] ?? 0];
    return { i, s, y0: Math.min(s[1] ?? 0, s[3] ?? 0), y1: Math.max(s[1] ?? 0, s[3] ?? 0), x0: Math.min(s[0] ?? 0, s[2] ?? 0), x1: Math.max(s[0] ?? 0, s[2] ?? 0) };
  }).toSorted((a, b) => a.y0 - b.y0);
  for (const [k, a] of segs.entries()) {
    for (let m = k + 1; m < segs.length; m++) {
      const b = segs[m];
      if (b === undefined || b.y0 > a.y1) break;
      const gap = Math.abs(a.i - b.i);
      if (gap === 1 || gap === n - 1 || b.x0 > a.x1 || b.x1 < a.x0) continue;
      if (segmentsMeet(a.s, b.s)) return false;
    }
  }
  return true;
}
