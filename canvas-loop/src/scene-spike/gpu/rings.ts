// Device-space rings (closed polygons, flat [x0, y0, x1, y1, …]): cut to a
// rectangle before they reach the atlas, and oriented for clip unions.
import type { R } from "./jobs.js";

function ringArea(r: readonly number[]): number {
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
