// The ink gate's union check (canvas-loop-gpu-brushes.subplan.md, chunk 1;
// prototype in scratch/stage5/brushes/gate/union.ts), for
// mark-atlas.ink.gpu.test.ts: the gate's synthetic cases as capsules, a 16×16
// supersampled reference of their union, and the error of a coverage against
// it. A subsample is inside when any capsule holds it, by the capsule's own
// shape: the unsigned distance from the axis segment at most the radius
// interpolated along it; the larger end disc alone when one holds the other or
// the segment has no length.

/** One capsule in pixels: its ends and their radii, ax, ay, ra, bx, by, rb (a disc when both ends are equal). */
export type Capsule = readonly [number, number, number, number, number, number];
type S = readonly [number, number, number];

const SS = 16;

function inside(c: Capsule, [x, y]: readonly [number, number]): boolean {
  const [ax, ay, ra, bx, by, rb] = c;
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  if (l2 === 0 || Math.abs(rb - ra) >= Math.sqrt(l2)) return ra >= rb ? Math.hypot(x - ax, y - ay) <= ra : Math.hypot(x - bx, y - by) <= rb;
  const t = Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / l2));
  return Math.hypot(x - (ax + t * ex), y - (ay + t * ey)) <= ra + t * (rb - ra);
}

/** The supersampled coverage of the capsules' union over pixels [0, w) × [0, h), row by row. */
export function supersampled(capsules: readonly Capsule[], size: { w: number; h: number }): Float64Array {
  const { w, h } = size;
  // The capsules that can reach each pixel.
  const near: Capsule[][] = Array.from({ length: w * h }, () => []);
  for (const c of capsules) {
    const [ax, ay, ra, bx, by, rb] = c;
    if (Math.max(ra, rb) <= 0) continue;
    const r = Math.max(ra, rb);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const x1 = Math.min(w, Math.ceil(Math.max(ax, bx) + r) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
    const y1 = Math.min(h, Math.ceil(Math.max(ay, by) + r) + 1);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) near[y * w + x]?.push(c);
  }
  const out = new Float64Array(w * h);
  for (const [k, cs] of near.entries()) {
    if (cs.length === 0) continue;
    const px = k % w;
    const py = Math.floor(k / w);
    let n = 0;
    for (let j = 0; j < SS; j++) {
      for (let i = 0; i < SS; i++) {
        const x = px + (i + 0.5) / SS;
        const y = py + (j + 0.5) / SS;
        if (cs.some((c) => inside(c, [x, y]))) n++;
      }
    }
    out[k] = n / (SS * SS);
  }
  return out;
}

/** Error of `coverage` against `ref`: the sum and count over edge pixels (0 < ref < 1), and the largest over every pixel. */
export interface UnionError {
  sum: number;
  n: number;
  max: number;
}

export function unionError(coverage: (k: number) => number, a: { ref: Float64Array; into: UnionError }): void {
  const { into } = a;
  for (const [k, r] of a.ref.entries()) {
    const e = Math.abs(coverage(k) - r);
    into.max = Math.max(into.max, e);
    if (r > 0 && r < 1) {
      into.sum += e;
      into.n++;
    }
  }
}

/** A contour's samples as capsules: one per segment, or a disc for a single sample. */
function capsulesOf(contour: readonly S[]): Capsule[] {
  const [first] = contour;
  if (first === undefined) return [];
  if (contour.length === 1) return [[...first, ...first]];
  return contour.slice(1).map((b, i) => {
    const a = contour[i] ?? first;
    return [...a, ...b];
  });
}

/** A polyline through `pts` sampled every `step` as `resample` does (the last sample at the end), radius by `r(t)`. */
function stroke(pts: readonly (readonly [number, number])[], how: { step: number; r: (t: number) => number }): S[] {
  const { step, r } = how;
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - (pts[i]?.[0] ?? 0), p[1] - (pts[i]?.[1] ?? 0)));
  const total = lens.reduce((a, b) => a + b, 0);
  const out: S[] = [];
  let seg = 0;
  let segStart = 0;
  for (let s = 0, last = false; !last; s += step) {
    if (!(s < total - step * 0.5)) {
      s = total;
      last = true;
    }
    while (seg < lens.length - 1 && segStart + (lens[seg] ?? 0) < s) {
      segStart += lens[seg] ?? 0;
      seg++;
    }
    const a = pts[seg] ?? [0, 0];
    const b = pts[seg + 1] ?? a;
    const f = Math.min(1, Math.max(0, (s - segStart) / (lens[seg] ?? 1)));
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, r(s / total)]);
  }
  return out;
}

/** Each case is drawn in a 42 × 42 cell. */
export const CELL = 42;
// A subpixel-offset centre.
const C = 20.37;
const D = 20.61;
const polar = (deg: number, len: number): [number, number] => [C + Math.cos((deg * Math.PI) / 180) * len, D + Math.sin((deg * Math.PI) / 180) * len];
const k = (r: number) => (): number => r;
const taper = (r0: number, r1: number) => (t: number): number => r0 + (r1 - r0) * t;
// A walker-like pressure envelope (ink-tea.ts) on a peak radius.
const env = (rmax: number) => (t: number): number => {
  const p = t < 0.3 ? 0.6 + (0.4 * t) / 0.3 : t < 0.7 ? 1 - (0.15 * (t - 0.3)) / 0.4 : 0.85 - (0.25 * (t - 0.7)) / 0.3;
  return (rmax / 0.775) * (0.5 - 0.55 * (0.5 - p));
};

function gateCases(): { group: string; name: string; capsules: Capsule[] }[] {
  const out: { group: string; name: string; contours: S[][] }[] = [];
  for (const r of [0.3, 0.8, 1.5, 2.2]) for (const deg of [0, 9, 30, 45, 71]) out.push({ group: "straight segments", name: `r=${r} at ${deg}°`, contours: [stroke([polar(deg + 180, 14), polar(deg, 14)], { step: Math.max(0.5, (r * 2) / 6) * 2, r: k(r) })] });
  for (const r of [0.3, 1, 2.2, 4]) {
    out.push({ group: "round ends", name: `single segment r=${r}`, contours: [[[C - 4, D, r], [C + 4.3, D + 1.2, r]]] }, { group: "round ends", name: `dot r=${r}`, contours: [[[C, D, r]]] });
  }
  for (const r of [0.3, 1, 2.2]) for (const turn of [30, 90, 135, 160, 175]) out.push({ group: "sharp bends", name: `r=${r}, turn ${turn}°`, contours: [stroke([polar(200, 12), [C, D], polar(200 - 180 + turn, 12)], { step: Math.max(1, (r * 2) / 3), r: k(r) })] });
  for (const r of [0.25, 0.4, 0.6, 1]) for (const ang of [90, 30, 10]) out.push({ group: "subpixel crossings", name: `two lines r=${r} crossing at ${ang}°`, contours: [stroke([polar(180, 14), polar(0, 14)], { step: 1, r: k(r) }), stroke([polar(180 + ang, 14), polar(ang, 14)], { step: 1, r: k(r) })] });
  for (const r of [0.3, 0.6]) for (const gap of [0.5, 1, 1.5]) out.push({ group: "subpixel crossings", name: `parallel lines r=${r}, ${gap} px apart`, contours: [stroke([[C - 12, D], [C + 12, D + 3]], { step: 1, r: k(r) }), stroke([[C - 12, D + gap], [C + 12, D + 3 + gap]], { step: 1, r: k(r) })] });
  for (const [r0, r1, len, step] of [[0.3, 3, 20, 1], [0.3, 3, 6, 1], [3, 0.3, 4, 0.5], [0.5, 4, 3, 1], [1, 2.2, 12, 1]] as const) {
    out.push({ group: "varying radii", name: `taper ${r0}→${r1} over ${len} px, step ${step}`, contours: [stroke([[C - len / 2, D - 1.3], [C + len / 2, D + 2.1]], { step, r: taper(r0, r1) })] });
  }
  for (const rmax of [1.1, 2.2, 4]) out.push({ group: "varying radii", name: `walker envelope, peak r=${rmax}, curve`, contours: [stroke(Array.from({ length: 30 }, (_, i): [number, number] => [C - 15 + i, D + 6 * Math.sin(i / 4)]), { step: Math.max(1, rmax / 1.5), r: env(rmax) })] });
  return out.map((c) => ({ group: c.group, name: c.name, capsules: c.contours.flatMap(capsulesOf) }));
}

/** The gate's 69 cases: straight segments, round ends and dots, sharp bends, subpixel crossings, varying radii. */
export const UNION_CASES = gateCases();
