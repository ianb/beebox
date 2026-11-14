// Drawing by hand: wobbly outlines, inked edges, washes and hatching, on an
// isometric floor. Nothing here is a true straight line or a true box.
import type { BrushPreset, Style, Vec2, View } from "@ianbicking/canvas-loop";

export function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2147483587);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
/** Smooth 1D noise in -1..1. */
export function wave(x: number, salt: number): number {
  const i = Math.floor(x), f = smooth(x - i);
  return (hash(i, 0, salt) * (1 - f) + hash(i + 1, 0, salt) * f) * 2 - 1;
}

// --- The isometric floor -----------------------------------------------------------------

/** The far corner of the floor, on screen. */
export const BACK: Vec2 = [600, 300];
/** Floor directions: u runs along the right-hand far wall, w along the left-hand one. */
const A: Vec2 = [0.894, 0.447];
const B: Vec2 = [-0.894, 0.447];
/** A point on the floor (u, w) at height h, on screen. */
export function iso(u: number, w: number, h = 0): Vec2 {
  return [BACK[0] + u * A[0] + w * B[0], BACK[1] + u * A[1] + w * B[1] - h];
}

// --- Hand-drawn shapes -------------------------------------------------------------------

/** Resample a closed outline every `step` px and push each point in or out a little,
 * smoothly, so edges waver like a hand's. */
export function wobble(pts: readonly Vec2[], a: { seed: number; amp?: number; step?: number; closed?: boolean }): Vec2[] {
  const amp = a.amp ?? 1.6, step = a.step ?? 14;
  const closed = a.closed ?? true;
  const out: Vec2[] = [];
  const n = pts.length;
  let along = 0;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p = pts[i] ?? [0, 0], q = pts[(i + 1) % n] ?? p;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const nx = -(q[1] - p[1]) / (len || 1), ny = (q[0] - p[0]) / (len || 1);
    const steps = Math.max(1, Math.round(len / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const off = wave((along + t * len) / 40, a.seed) * amp;
      out.push([p[0] + (q[0] - p[0]) * t + nx * off, p[1] + (q[1] - p[1]) * t + ny * off]);
    }
    along += len;
  }
  if (!closed) out.push(pts[n - 1] ?? [0, 0]);
  return out;
}

export const INK = "#241c17";
export function ink(seed: number, weight = 2.2): Style {
  return { stroke: INK, weight, brush: { preset: "ink", thinning: 0.55 }, gesture: { wobble: 0.8, seed, pressure: [[0, 0.6], [0.3, 1], [0.7, 0.85], [1, 0.6]] } };
}
const WASH: BrushPreset = { preset: "wash", opacity: 0.35 };
const HATCH: BrushPreset = { preset: "pencil", opacity: 0.5 };

/** A filled shape: flat colour, then inside it a few washes of lighter and darker
 * paint, hatching on its shaded side, and an inked outline. */
export function blob(v: View, pts: readonly Vec2[], a: { fill: string; light?: string | undefined; dark?: string | undefined; seed: number; shadeSide?: "left" | "right" | "bottom"; line?: number; amp?: number }): void {
  const outline = wobble(pts, { seed: a.seed, amp: a.amp ?? 1.4 });
  v.curve(outline, true, { fill: a.fill });
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  v.clip(v.curvePath(outline, true), () => {
    // Washes: a few broad, uneven strokes of the light and dark tones.
    for (let i = 0; i < 4; i++) {
      const y = y0 + (y1 - y0) * (0.15 + hash(a.seed, i, 1) * 0.7);
      const tone = i % 2 === 0 ? a.light : a.dark;
      if (tone === undefined) continue;
      v.line(x0 - 4, y + (hash(a.seed, i, 2) - 0.5) * 10, x1 + 4, y + (hash(a.seed, i, 3) - 0.5) * 10, { stroke: tone, weight: Math.max(8, (y1 - y0) * 0.35), brush: WASH, gesture: { seed: a.seed + i, wobble: 3, faint: true } });
    }
    // Hatching on the side away from the light.
    if (a.shadeSide !== undefined && a.dark !== undefined) {
      const spacing = 4.5;
      for (let x = x0 - (y1 - y0); x < x1; x += spacing) {
        const frac = a.shadeSide === "left" ? 1 - (x - x0) / (x1 - x0) : a.shadeSide === "right" ? (x - x0) / (x1 - x0) : 0.6;
        if (frac < 0.55 || hash(Math.round(x), a.seed, 4) > frac) continue;
        const top = a.shadeSide === "bottom" ? y0 + (y1 - y0) * 0.55 : y0;
        v.line(x, y1 + 2, x + (y1 - top) * 0.55, top, { stroke: a.dark, weight: 1, brush: HATCH, gesture: { seed: a.seed + Math.round(x), faint: true } });
      }
    }
  });
  v.curve(outline, true, ink(a.seed, a.line ?? 2.2));
}

/** A line drawn by hand: a cable, a pipe edge, a crack. */
export function stroke(v: View, pts: readonly Vec2[], a: { seed: number; weight?: number; colour?: string; amp?: number }): void {
  const line = a.amp === 0 ? [...pts] : wobble(pts, { seed: a.seed, amp: a.amp ?? 1, closed: false, step: 10 });
  v.curve(line, false, { ...ink(a.seed, a.weight ?? 2), stroke: a.colour ?? INK });
}

/** A rivet: a dot with a highlight. */
export function rivet(v: View, x: number, y: number, r = 1.8): void {
  v.circle(x, y, r, { fill: "#3a2e26" });
  v.circle(x - r * 0.35, y - r * 0.35, r * 0.4, { fill: "#c9b79a" });
}

/** A rounded rectangle's outline as points, for hand-drawn shapes. */
export function roundRectPts(x: number, y: number, w: number, h: number, r: number): Vec2[] {
  const pts: Vec2[] = [];
  const corners: [number, number, number][] = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= 4; i++) {
    const a = a0 + (i / 4) * (Math.PI / 2);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/** An ellipse's outline as points. */
export function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 20): Vec2[] {
  return Array.from({ length: n }, (_, i): Vec2 => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry]);
}

/** The outline around a set of points (gift wrapping): a box's silhouette. */
function hull(pts: readonly Vec2[]): Vec2[] {
  const sorted = pts.toSorted((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [], upper: Vec2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2) ?? p, lower.at(-1) ?? p, p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of sorted.toReversed()) {
    while (upper.length >= 2 && cross(upper.at(-2) ?? p, upper.at(-1) ?? p, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Adds points along each edge, so a smooth curve through them stays close to the
 * edges and only rounds the corners. */
function densify(pts: readonly Vec2[], step = 18): Vec2[] {
  const out: Vec2[] = [];
  for (const [i, p] of pts.entries()) {
    const q = pts[(i + 1) % pts.length] ?? p;
    const n = Math.max(1, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / step));
    for (let k = 0; k < n; k++) out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  }
  return out;
}

export interface IsoBox {
  u: [number, number];
  w: [number, number];
  h: [number, number];
}

/** A box drawn by hand: its silhouette as one softly rounded lump, the top lighter,
 * the right-hand side (facing +u) darker, and inked. */
export function isoBox(v: View, b: IsoBox, a: { fill: string; light?: string; dark?: string; seed: number; line?: number }): void {
  const [u0, u1] = b.u, [w0, w1] = b.w, [h0, h1] = b.h;
  const corners: Vec2[] = [];
  for (const u of [u0, u1]) for (const w of [w0, w1]) for (const h of [h0, h1]) corners.push(iso(u, w, h));
  const outline = densify(hull(corners));
  blob(v, outline, { fill: a.fill, light: a.light, dark: a.dark, seed: a.seed, line: a.line ?? 2.2, amp: 1.6 });
  const top = densify([iso(u0, w0, h1), iso(u1, w0, h1), iso(u1, w1, h1), iso(u0, w1, h1)], 14);
  v.curve(wobble(top, { seed: a.seed + 1, amp: 1 }), true, { fill: "rgba(255,245,225,0.16)" });
  const side = densify([iso(u1, w0, h0), iso(u1, w1, h0), iso(u1, w1, h1), iso(u1, w0, h1)], 14);
  v.curve(wobble(side, { seed: a.seed + 2, amp: 1 }), true, { fill: "rgba(25,15,20,0.3)" });
  stroke(v, [iso(u1, w1, h0 + 2), iso(u1, w1, h1 - 2)], { seed: a.seed + 3, weight: 1.4 });
  stroke(v, [iso(u0 + 2, w1, h1), iso(u1 - 2, w1, h1)], { seed: a.seed + 4, weight: 1.4 });
}
