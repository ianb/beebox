// Drawing by hand: wobbly outlines, inked edges, washes inside shapes, and a few
// small numeric helpers shared by the town, the folk and the live layer.
import type { BrushPreset, Drawing, Style, Vec2, View } from "@ianbicking/canvas-loop";

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
export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 0 at a, 1 at b, smooth between. */
export const ramp = (x: number, a: number, b: number): number => smooth(clamp01((x - a) / (b - a)));

export type RGB = readonly [number, number, number];
export function rgba(c: RGB, a = 1): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${clamp01(a).toFixed(3)})`;
}
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
export function hex(s: string): RGB {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(s: string, k: number): string {
  const c = hex(s);
  return k >= 0 ? rgba(mix(c, [255, 250, 235], k)) : rgba(mix(c, [40, 28, 40], -k));
}

/** Resample an outline every `step` px and push each point in or out a little,
 * smoothly, so edges waver like a hand's. */
export function wobble(pts: readonly Vec2[], a: { seed: number; amp?: number; step?: number; closed?: boolean }): Vec2[] {
  const amp = a.amp ?? 1.4, step = a.step ?? 12;
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
      const off = wave((along + t * len) / 36, a.seed) * amp;
      out.push([p[0] + (q[0] - p[0]) * t + nx * off, p[1] + (q[1] - p[1]) * t + ny * off]);
    }
    along += len;
  }
  if (!closed) out.push(pts[n - 1] ?? [0, 0]);
  return out;
}

export const INK = "#2b2020";
export function ink(seed: number, weight = 2, colour = INK): Style {
  return { stroke: colour, weight, brush: { preset: "ink", thinning: 0.55 }, gesture: { wobble: 0.6, seed, pressure: [[0, 0.55], [0.25, 1], [0.75, 0.9], [1, 0.5]] } };
}
const WASH: BrushPreset = { preset: "wash", opacity: 0.4 };

/** A filled shape drawn by hand: flat colour, a few washes of lighter and darker
 * paint inside it, and an inked outline (unless `line` is 0). */
export function blob(v: View, pts: readonly Vec2[], a: { fill: string; light?: string; dark?: string; seed: number; line?: number; amp?: number; lineColour?: string; curve?: boolean }): Drawing {
  const outline = a.amp === 0 ? [...pts] : wobble(pts, { seed: a.seed, amp: a.amp ?? 1.2 });
  const curve = a.curve ?? false;
  const shape = curve ? v.curve(outline, true, { fill: a.fill }) : v.polygon(outline, { fill: a.fill });
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const clipShape = curve ? v.curvePath(outline, true) : outline;
  const washes = (a.light !== undefined || a.dark !== undefined) && v.clip(clipShape, [0, 1, 2].map((i): Drawing => {
    const tone = i === 1 ? a.dark : a.light;
    if (tone === undefined) return null;
    const y = y0 + (y1 - y0) * (0.2 + hash(a.seed, i, 1) * 0.6);
    return v.line(x0 - 4, y + (hash(a.seed, i, 2) - 0.5) * 8, x1 + 4, y + (hash(a.seed, i, 3) - 0.5) * 8, { stroke: tone, weight: Math.max(6, (y1 - y0) * 0.4), brush: WASH, gesture: { seed: a.seed + i, wobble: 3, faint: true } });
  }));
  const line = a.line ?? 2;
  return [
    shape,
    washes,
    line > 0 && (curve ? v.curve(outline, true, ink(a.seed, line, a.lineColour)) : v.polygon(outline, ink(a.seed, line, a.lineColour))),
  ];
}

/** A hand-drawn line through points. */
export function stroke(v: View, pts: readonly Vec2[], a: { seed: number; weight?: number; colour?: string; amp?: number }): Drawing {
  const line = a.amp === 0 ? [...pts] : wobble(pts, { seed: a.seed, amp: a.amp ?? 0.8, closed: false, step: 10 });
  return v.curve(line, false, ink(a.seed, a.weight ?? 1.6, a.colour));
}

export function rectPts(x: number, y: number, w: number, h: number): Vec2[] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}
export function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 16): Vec2[] {
  return Array.from({ length: n }, (_, i): Vec2 => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry]);
}
