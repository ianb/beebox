// Ink-and-colour painting on rice paper: a small palette, thick-and-thin ink
// outlines, dry bristle strokes, pale washes inside shapes, and the numeric
// helpers the cast and the board share.
import type { BrushPreset, Drawing, Style, Vec2, View } from "@ianbicking/canvas-loop";

export const PAPER = "#f2e9d3";
export const INK = "#1d1916";
export const GREY = "#5b554d";
export const PALE = "#a39a8b";
export const VERMILION = "#cf3f28";
export const OCHRE = "#c8963f";
export const INDIGO = "#36557a";
export const SAGE = "#88a072";
export const PLUM = "#9c4a64";

export function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2147483587);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** Smooth 1D noise in -1..1. */
export function wave(x: number, salt: number): number {
  const i = Math.floor(x), f = smooth(x - i);
  return (hash(i, 0, salt) * (1 - f) + hash(i + 1, 0, salt) * f) * 2 - 1;
}
export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

type RGB = readonly [number, number, number];
function hex(s: string): RGB {
  const n = Number.parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(s: string, a: number): string {
  const c = hex(s);
  return `rgba(${c[0]},${c[1]},${c[2]},${clamp01(a).toFixed(3)})`;
}
/** Toward paper (k > 0) or toward ink (k < 0). */
export function tone(s: string, k: number): string {
  const c = hex(s), to = k >= 0 ? hex(PAPER) : hex(INK), a = Math.abs(k);
  return `rgb(${Math.round(lerp(c[0], to[0], a))},${Math.round(lerp(c[1], to[1], a))},${Math.round(lerp(c[2], to[2], a))})`;
}

/** Resample an outline and push each point in or out a little, smoothly, like a hand. */
export function wobble(pts: readonly Vec2[], a: { seed: number; amp?: number; step?: number; closed?: boolean }): Vec2[] {
  const amp = a.amp ?? 1.2, step = a.step ?? 10, closed = a.closed ?? true;
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
      const off = wave((along + t * len) / 30, a.seed) * amp;
      out.push([p[0] + (q[0] - p[0]) * t + nx * off, p[1] + (q[1] - p[1]) * t + ny * off]);
    }
    along += len;
  }
  if (!closed) out.push(pts[n - 1] ?? [0, 0]);
  return out;
}

/** A thick-and-thin ink line, as a soft brush makes it. */
export function inkStyle(seed: number, weight = 2.4, colour = INK): Style {
  return { stroke: colour, weight, brush: { preset: "ink", thinning: 0.75 }, gesture: { wobble: 0.5, seed, pressure: [[0, 0.35], [0.18, 1], [0.7, 0.85], [1, 0.3]] } };
}
/** A dry, broken bristle stroke. */
export function dryStyle(seed: number, weight: number, colour = INK, load = 0.55): Style {
  return { stroke: colour, weight, brush: { preset: "bristle", load, bristles: 16, spread: 0.5, lightJitter: 0.06 }, gesture: { seed, pressure: "press", wobble: 1 } };
}
const WASH: BrushPreset = { preset: "wash", opacity: 0.45 };

export interface BlobOpts {
  readonly fill: string;
  readonly seed: number;
  /** Outline weight; 0 for none. */
  readonly line?: number;
  readonly lineColour?: string;
  readonly amp?: number;
  /** A darker wash across the lower part, a lighter one across the top. */
  readonly dark?: string;
  readonly light?: string;
  readonly sharp?: boolean;
}

/** A shape painted by hand: flat colour, a wash or two inside, an ink outline. */
export function blob(v: View, pts: readonly Vec2[], a: BlobOpts): Drawing {
  const outline = a.amp === 0 ? [...pts] : wobble(pts, { seed: a.seed, amp: a.amp ?? 0.9 });
  const sharp = a.sharp === true;
  const ys = outline.map((p) => p[1]), xs = outline.map((p) => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const clipShape = sharp ? outline : v.curvePath(outline, true);
  const h = y1 - y0;
  const washes = (a.dark !== undefined || a.light !== undefined) && v.clip(clipShape, [
    a.light !== undefined && v.line(x0 - 6, y0 + h * 0.22, x1 + 6, y0 + h * 0.12, { stroke: a.light, weight: Math.max(5, h * 0.35), brush: WASH, gesture: { seed: a.seed + 1, wobble: 2, faint: true } }),
    a.dark !== undefined && v.line(x0 - 6, y1 - h * 0.12, x1 + 6, y1 - h * 0.22, { stroke: a.dark, weight: Math.max(6, h * 0.45), brush: WASH, gesture: { seed: a.seed + 2, wobble: 2, faint: true } }),
  ]);
  const line = a.line ?? 2.8;
  const outlineStyle = inkStyle(a.seed, line, a.lineColour);
  return [
    sharp ? v.polygon(outline, { fill: a.fill }) : v.curve(outline, true, { fill: a.fill }),
    washes,
    line > 0 && (sharp ? v.polygon(outline, outlineStyle) : v.curve(outline, true, outlineStyle)),
  ];
}

/** An open hand-drawn ink line through points. */
export function stroke(v: View, pts: readonly Vec2[], a: { seed: number; weight?: number; colour?: string; amp?: number }): Drawing {
  const line = a.amp === 0 ? [...pts] : wobble(pts, { seed: a.seed, amp: a.amp ?? 0.6, closed: false, step: 8 });
  return v.curve(line, false, inkStyle(a.seed, a.weight ?? 2, a.colour));
}

export function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 16): Vec2[] {
  return Array.from({ length: n }, (_, i): Vec2 => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry]);
}
export function rectPts(x: number, y: number, w: number, h: number): Vec2[] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/** A round eye with a glint; `look` shifts the pupil (-1 left, 1 right). */
export function eye(v: View, a: { x: number; y: number; r: number; look?: number; shut?: boolean; dizzy?: boolean; seed: number }): Drawing {
  if (a.shut === true) return stroke(v, [[a.x - a.r, a.y], [a.x, a.y + a.r * 0.4], [a.x + a.r, a.y]], { seed: a.seed, weight: Math.max(1.6, a.r * 0.35), amp: 0 });
  if (a.dizzy === true) {
    const r = a.r * 0.7;
    return [
      v.line(a.x - r, a.y - r, a.x + r, a.y + r, inkStyle(a.seed, Math.max(1.6, a.r * 0.35))),
      v.line(a.x - r, a.y + r, a.x + r, a.y - r, inkStyle(a.seed + 1, Math.max(1.6, a.r * 0.35))),
    ];
  }
  const px = a.x + (a.look ?? 0) * a.r * 0.35;
  return [
    v.circle(a.x, a.y, a.r, { fill: "#fbf7ea" }),
    v.circle(a.x, a.y, a.r, inkStyle(a.seed, Math.max(1.2, a.r * 0.18))),
    v.circle(px, a.y + a.r * 0.1, a.r * 0.52, { fill: INK }),
    v.circle(px + a.r * 0.18, a.y - a.r * 0.15, a.r * 0.18, { fill: "#ffffff" }),
  ];
}

/** A soft round shadow on the ground under something. */
export function groundShadow(v: View, x: number, y: number, rx: number): Drawing {
  return v.ellipse(x, y, rx, rx * 0.22, { fill: rgba(INK, 0.16) });
}
