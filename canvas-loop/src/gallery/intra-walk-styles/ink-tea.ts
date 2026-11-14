// Drawing by hand, seen from the side: wobbly outlines, inked edges, washes and
// hatching, and rim light painted on the edges that face a light.
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
/** A light that paints bright edges on the sides of shapes facing it. */
export interface Rim {
  x: number;
  y: number;
  colour: string;
  /** How far it reaches, px. */
  reach: number;
}

export function blob(v: View, pts: readonly Vec2[], a: { fill: string; light?: string | undefined; dark?: string | undefined; seed: number; shadeSide?: "left" | "right" | "bottom"; line?: number; amp?: number; rim?: Rim | undefined }): void {
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
  if (a.rim) rimLight(v, outline, a.rim);
  v.curve(outline, true, ink(a.seed, a.line ?? 2.2));
}

/** Bright strokes just inside the outline wherever it faces the light. */
export function rimLight(v: View, outline: readonly Vec2[], rim: Rim): void {
  const n = outline.length;
  // Which way round the outline goes decides which side is outward.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p = outline[i] ?? [0, 0], q = outline[(i + 1) % n] ?? p;
    area += p[0] * q[1] - q[0] * p[1];
  }
  const out = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const p = outline[i] ?? [0, 0], q = outline[(i + 1) % n] ?? p;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const nx = ((q[1] - p[1]) / len) * out, ny = (-(q[0] - p[0]) / len) * out;
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    const lx = rim.x - mx, ly = rim.y - my;
    const d = Math.hypot(lx, ly) || 1;
    const facing = (nx * lx + ny * ly) / d;
    const k = facing * Math.max(0, 1 - d / rim.reach);
    if (k < 0.12) continue;
    v.line(p[0] - nx * 1.8, p[1] - ny * 1.8, q[0] - nx * 1.8, q[1] - ny * 1.8, { stroke: rim.colour, weight: 2.6, blend: "screen", brush: { preset: "chalk", opacity: Math.min(1, k * 1.4) }, gesture: { seed: i, faint: true } });
  }
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

