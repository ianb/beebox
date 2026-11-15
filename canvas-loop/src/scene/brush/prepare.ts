// One brushed contour prepared for the GPU sample pass, from its points in the
// call's own coordinates: mapped into brush space, repeated points dropped and
// a closed contour closed (as `sample.ts`'s `preparePoints`), its segments
// measured and its first samples placed (as `sampleSegments`), and packed as
// `PreparedContour.geom`. The numbers are the same as building those arrays of
// points would give, operation for operation; the points live in reused flat
// buffers instead, since every moving stroke is prepared again each frame.
import type { Contour } from "../../core/contours.js";
import { firstSamples } from "../../core/brush/sample.js";
import { stepFor, wobbleLattice } from "../../core/brush/render/mark/render.js";
import type { Brush, Gesture } from "../../core/brush/types.js";
import type { Mat } from "../nodes.js";
import type { PreparedContour } from "./expand.js";

/** Words per prepared point in `PreparedContour.geom`. */
export const POINT_WORDS = 4;

// Reused between contours: the prepared points (x, y), segment lengths, and each segment's first sample.
let points = new Float64Array(512);
let lengths = new Float64Array(256);
let firsts = new Uint32Array(256);

function reserve(n: number): void {
  if (points.length < 2 * n) points = new Float64Array(4 * n);
  if (lengths.length < n) {
    lengths = new Float64Array(2 * n);
    firsts = new Uint32Array(2 * n);
  }
}

/** The contour's points under the linear part of `b`, repeats dropped, closed when `closed` (as `preparePoints`): how many. */
function preparedPoints(contour: Contour, b: Mat): number {
  const src = contour.points;
  reserve(src.length + 1);
  const [a0, a1, a2, a3] = b;
  let m = 0;
  for (const p of src) {
    // As `applyLinear`.
    const x = a0 * p[0] + a2 * p[1];
    const y = a1 * p[0] + a3 * p[1];
    if (m === 0 || points[2 * m - 2] !== x || points[2 * m - 1] !== y) {
      points[2 * m] = x;
      points[2 * m + 1] = y;
      m++;
    }
  }
  if (contour.closed && m > 2 && (points[0] !== points[2 * m - 2] || points[1] !== points[2 * m - 1])) {
    points[2 * m] = points[0] ?? 0;
    points[2 * m + 1] = points[1] ?? 0;
    m++;
  }
  return m;
}

/** One contour, prepared in brush space (`b` maps the call's coordinates there); grows `box` by its points. */
export function prepareContour(c: { contour: Contour; seed: number }, a: { b: Mat; brush: Brush; gesture: Gesture; width: number; box: { x0: number; y0: number; x1: number; y1: number } }): PreparedContour {
  // Read the brush before the shared buffers are filled: a getter in it could prepare another contour.
  const step = stepFor(a.brush, a.width);
  const m = preparedPoints(c.contour, a.b);
  const n = Math.max(0, m - 1);
  let total = 0;
  for (let i = 0; i < n; i++) {
    // As `segmentLengths`, summed from 0 in order as `sampleSegments` does.
    const len = Math.hypot((points[2 * i + 2] ?? 0) - (points[2 * i] ?? 0), (points[2 * i + 3] ?? 0) - (points[2 * i + 1] ?? 0));
    lengths[i] = len;
    total += len;
  }
  const count = firstSamples(lengths, { n, points: m, total, step, first: firsts });
  const origin = m === 0 ? ([0, 0] as const) : ([points[0] ?? 0, points[1] ?? 0] as const);
  const geom = new Float32Array(m * POINT_WORDS);
  const words = new Uint32Array(geom.buffer);
  const { box } = a;
  let arc = 0;
  for (let i = 0; i < m; i++) {
    const x = points[2 * i] ?? 0;
    const y = points[2 * i + 1] ?? 0;
    geom[i * POINT_WORDS] = x - origin[0];
    geom[i * POINT_WORDS + 1] = y - origin[1];
    geom[i * POINT_WORDS + 2] = arc;
    words[i * POINT_WORDS + 3] = i < n ? (firsts[i] ?? 0) : count;
    arc += i < n ? (lengths[i] ?? 0) : 0;
    box.x0 = Math.min(box.x0, x);
    box.y0 = Math.min(box.y0, y);
    box.x1 = Math.max(box.x1, x);
    box.y1 = Math.max(box.y1, y);
  }
  const { period, cell } = wobbleLattice(c.contour.closed, count === 1 ? 0 : total);
  return { geom, origin, count, step, total, seed: c.seed, pressure: a.gesture.pressure ?? (c.contour.closed ? "even" : "taper"), period, cell };
}
