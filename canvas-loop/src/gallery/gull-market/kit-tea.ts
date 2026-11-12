// Shared painting helpers for the gull-market page: point utilities, the
// palette, and a "paint a form" routine (flat base, light/shadow inside a
// clip, a brushed outline last). Light comes from the sun, upper right.
import type { BrushName, Style, Vec2, View } from "@ianbicking/canvas-loop";

export const INK = "#2b2230";
/** Unit vector toward the sun (upper right). */
export const LIGHT: Vec2 = [0.6, -0.8];

export function shift(pts: readonly Vec2[], dx: number, dy: number): Vec2[] {
  return pts.map(([x, y]): Vec2 => [x + dx, y + dy]);
}

/** Points on part of an ellipse from angle a0 to a1 (radians). */
export function arcPts(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  n = 14,
): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

export function ring(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n = 16,
): Vec2[] {
  return arcPts(cx, cy, rx, ry, 0, Math.PI * 2 * (1 - 1 / n), n - 1);
}

export interface FormOptions {
  base: string;
  shade: string;
  /** Lit edge colour; omitted means no highlight pass. */
  light?: string;
  /** How far the shade crescent reaches in from the shadow side. */
  depth?: number;
  line?: string;
  weight?: number;
  /** Closed smooth curve (default) or straight-edged polygon. */
  sharp?: boolean;
  seed?: number;
  /** Colour of loose bristle strokes laid across the form, so it reads painted. */
  strokes?: string;
  /** Slope of those strokes (dy per dx); default a slight rise. */
  slope?: number;
}

function outlineOf(
  v: View,
  pts: readonly Vec2[],
  sharp: boolean,
  style: Style,
): void {
  if (sharp) v.polygon(pts, style);
  else v.curve(pts, true, style);
}

/**
 * Paint a closed form: flat base, a shade crescent on the side away from the
 * sun, an optional lit rim, a wash softening the terminator, and an ink line.
 */
export function form(v: View, pts: readonly Vec2[], o: FormOptions): void {
  const sharp = o.sharp ?? false;
  const depth = o.depth ?? 10;
  const clipShape = sharp ? pts : v.curvePath(pts, true);
  outlineOf(v, pts, sharp, { fill: o.base });
  // Nested clips instead of group + erase: an erase inside a group under a
  // rotate only cleared a rectangle of the gull's body.
  const away = shift(pts, -LIGHT[0] * depth * 0.45, -LIGHT[1] * depth * 0.45);
  const shadeAndBase = (): void => {
    // shade everywhere, then base over the shape shifted toward the sun,
    // which leaves a shade crescent on the side away from it
    outlineOf(v, pts, sharp, { fill: o.shade });
    outlineOf(v, shift(pts, LIGHT[0] * depth, LIGHT[1] * depth), sharp, {
      fill: o.base,
    });
  };
  const { light } = o;
  v.clip(clipShape, () => {
    if (light === undefined) {
      shadeAndBase();
      return;
    }
    // lit rim: light everywhere; the rest only inside the shape shifted away
    outlineOf(v, pts, sharp, { fill: light });
    v.clip(sharp ? away : v.curvePath(away, true), shadeAndBase);
  });
  if (o.strokes !== undefined) brushOver(v, pts, o);
  if (o.weight !== undefined && o.weight > 0) {
    outlineOf(v, pts, sharp, {
      stroke: o.line ?? INK,
      weight: o.weight,
      brush: "ink",
      gesture: {
        pressure: [
          [0, 0.3],
          [0.2, 1],
          [0.45, 0.4],
          [0.7, 1],
          [1, 0.3],
        ],
        wobble: 0.6,
        seed: o.seed ?? 1,
      },
    });
  }
}

/** Loose bristle strokes across a form's bounding box, kept inside it. */
function brushOver(v: View, pts: readonly Vec2[], o: FormOptions): void {
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  const [x0, x1, y0, y1] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const slope = o.slope ?? -0.06;
  const weight = Math.max(8, Math.min(22, (y1 - y0) / 4));
  const rows = Math.ceil((y1 - y0) / (weight * 0.8)) + 1;
  const seed = o.seed ?? 1;
  v.clip(o.sharp === true ? pts : v.curvePath(pts, true), () => {
    for (let i = 0; i < rows; i += 1) {
      const y = y0 + i * weight * 0.8 + (hash(seed + i) - 0.5) * 4;
      const a = x0 - 12 + hash(seed + i * 3) * (x1 - x0) * 0.3;
      const b = x1 + 12 - hash(seed + i * 5) * (x1 - x0) * 0.3;
      mark(
        v,
        [
          [a, y],
          [(a + b) / 2, y + ((b - a) / 2) * slope + 1.5],
          [b, y + (b - a) * slope],
        ],
        {
          color: o.strokes ?? INK,
          weight,
          brush: "bristle",
          opacity: 0.4,
          wobble: 1.5,
          seed: seed * 31 + i,
        },
      );
    }
  });
}

export interface MarkOptions {
  color: string;
  weight: number;
  brush?: BrushName;
  opacity?: number;
  wobble?: number;
  seed?: number;
  pressure?: "taper" | "taper-in" | "taper-out" | "even" | "swell" | "press";
}

/** One brushed open stroke through `pts`. */
export function mark(v: View, pts: readonly Vec2[], o: MarkOptions): void {
  const preset = o.brush ?? "ink";
  const style: Style = {
    stroke: o.color,
    weight: o.weight,
    brush: o.opacity === undefined ? preset : { preset, opacity: o.opacity },
    gesture: {
      pressure: o.pressure ?? "taper",
      wobble: o.wobble ?? 0.8,
      ...(o.seed === undefined ? {} : { seed: o.seed }),
    },
  };
  if (pts.length === 2) {
    const [a, b] = pts;
    if (a !== undefined && b !== undefined)
      v.line(a[0], a[1], b[0], b[1], style);
  } else v.curve(pts, false, style);
}

/** Small deterministic hash in 0..1 for scatter that must not depend on draw order. */
export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
