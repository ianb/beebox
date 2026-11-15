// `style.dash` for plain strokes, with today's Canvas2D semantics
// (`setLineDash`, offset 0): lengths on, off, on, … in the shape's own
// coordinates; an odd list is repeated to make it even; the pattern starts
// again at the start of each subpath; a closed subpath is dashed along its
// closing segment too, and its first and last dashes are not joined. Each
// dash becomes an open polyline the stroke code outlines with its joins and
// caps; a dash of zero length is a point that draws only its caps (a dotted
// line with round caps).
import type { Poly } from "./flatten.js";

type V = readonly [number, number];

/** A dash of zero length: where it is and the direction of the path there. */
export interface Dot {
  readonly p: V;
  readonly d: V;
}

/** The dash list as Canvas2D uses it: an odd list repeated once. */
function pattern(dash: readonly number[]): readonly number[] {
  return dash.length % 2 === 1 ? [...dash, ...dash] : dash;
}

/** One subpath split into dashes. */
export function dashPolys(poly: Poly, dash: readonly number[]): { pieces: Poly[]; dots: Dot[] } {
  const pat = pattern(dash);
  const pts = poly.pts;
  const n = pts.length / 2;
  const at = (k: number): V => [pts[2 * (k % n)] ?? 0, pts[2 * (k % n) + 1] ?? 0];
  const pieces: Poly[] = [];
  const dots: Dot[] = [];
  let index = 0;
  let left = pat[0] ?? 0;
  let cur: number[] | undefined = [...at(0)];
  const segs = poly.closed ? n : n - 1;
  for (let s = 0; s < segs; s++) {
    const a = at(s);
    const b = at(s + 1);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const d: V = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const point = (t: number): V => [a[0] + d[0] * t, a[1] + d[1] * t];
    let t = 0;
    for (;;) {
      const step = Math.min(left, len - t);
      t += step;
      left -= step;
      if (cur !== undefined && step > 0) cur.push(...point(t));
      if (left > 0) break;
      // The current entry is used up: an on entry ends its dash here, an off entry starts one.
      const here = point(t);
      if (index % 2 === 0) {
        if (cur !== undefined && cur.length >= 4) pieces.push({ pts: cur, closed: false });
        else dots.push({ p: here, d });
        cur = undefined;
      } else {
        cur = [...here];
      }
      index = (index + 1) % pat.length;
      left = pat[index] ?? 0;
      if (t >= len && left > 0) break;
    }
  }
  if (cur !== undefined && cur.length >= 4) pieces.push({ pts: cur, closed: false });
  return { pieces, dots };
}
