// Hand-drawn marks for the file room: ink lines that overshoot their corners,
// wobble and thin out; rectangles whose corners are a little off; pencil
// hatching clipped to a shape. Every mark has a fixed seed, so it never boils.
import type { BrushPreset, Drawing, Style, Vec2, View } from "@ianbicking/canvas-loop";
import { hash } from "./file-room-layout-tea.js";

export const INK = "#17110d";

/** A repeatable offset in -1..1. */
const jit = (seed: number, i: number): number => (hash(seed * 13.7 + i * 7.3) - 0.5) * 2;

export interface BoxSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  seed: number;
  /** How far a corner may stray, in pixels (default 1.6). */
  off?: number;
}

/** The four corners of a rectangle, each a little off. */
export function corners(spec: BoxSpec): Vec2[] {
  const { x, y, w, h, seed, off = 1.6 } = spec;
  return [
    [x + off * jit(seed, 0), y + off * jit(seed, 1)],
    [x + w + off * jit(seed, 2), y + off * jit(seed, 3)],
    [x + w + off * jit(seed, 4), y + h + off * jit(seed, 5)],
    [x + off * jit(seed, 6), y + h + off * jit(seed, 7)],
  ];
}

const PEN: BrushPreset = { preset: "ink", thinning: 0.35 };

export interface LineSpec {
  a: Vec2;
  b: Vec2;
  seed: number;
  weight?: number | undefined;
  color?: string | undefined;
}

/** One ink stroke from a to b that overshoots both ends a little, as a hand does. */
export function penLine(v: View, spec: LineSpec): Drawing {
  const { a, b, seed, weight = 2.4, color = INK } = spec;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const o1 = 1.5 + hash(seed) * 2.5;
  const o2 = 1.5 + hash(seed + 5) * 2.5;
  return v.line(a[0] - (dx / len) * o1, a[1] - (dy / len) * o1, b[0] + (dx / len) * o2, b[1] + (dy / len) * o2, {
    stroke: color,
    weight,
    brush: PEN,
    gesture: { pressure: "taper", wobble: 0.9, seed },
  });
}

/** A rectangle drawn as four separate ink strokes, with the corners crossing slightly. */
export function penBox(v: View, spec: BoxSpec & { weight?: number; color?: string }): Drawing {
  const c = corners(spec);
  const { seed, weight, color } = spec;
  const sides: [Vec2, Vec2][] = [[c[0] ?? [0, 0], c[1] ?? [0, 0]], [c[1] ?? [0, 0], c[2] ?? [0, 0]], [c[2] ?? [0, 0], c[3] ?? [0, 0]], [c[3] ?? [0, 0], c[0] ?? [0, 0]]];
  return sides.map(([a, b], i) => penLine(v, { a, b, seed: seed * 4 + i, weight, color }));
}

export interface HatchSpec {
  clip: Vec2[];
  /** Box the lines cover. */
  x: number;
  y: number;
  w: number;
  h: number;
  seed: number;
  spacing?: number;
  color?: string;
  weight?: number;
}

/** Slanted pencil lines over a box, clipped to a shape: shadow tone drawn by hand. */
export function pencilHatch(v: View, spec: HatchSpec): Drawing {
  const { clip, x, y, w, h, seed, spacing = 6, color = "rgba(15,10,12,0.55)", weight = 1.6 } = spec;
  const style: Style = { stroke: color, weight, brush: { preset: "pencil", opacity: 0.8 } };
  const n = Math.ceil((w + h) / spacing);
  return v.clip(
    clip,
    Array.from({ length: n }, (_, i) => {
      const s = i * spacing + 1.5 * jit(seed, i);
      return v.line(x + s, y, x + s - h * 0.6, y + h, { ...style, gesture: { wobble: 0.7, seed: seed * 50 + i, faint: true } });
    }),
  );
}
