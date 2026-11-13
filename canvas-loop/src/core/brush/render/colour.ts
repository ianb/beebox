// Solid colours for brushes that vary or mix their paint: parse any CSS colour
// through a context (both runtimes normalise `fillStyle` to `#rrggbb` or
// `rgba(r, g, b, a)`), then shift hue and lightness in HSL.
import { SketchUsageError } from "../../errors.js";
import type { Ctx2D } from "../../paint.js";

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Two sentinels: a colour the context rejects leaves `fillStyle` at whichever was set before. */
const SENTINELS = ["#010203", "#040506"] as const;

function normalise(ctx: Ctx2D, colour: string): string | undefined {
  const seen = SENTINELS.map((sentinel) => {
    ctx.fillStyle = sentinel;
    ctx.fillStyle = colour;
    return ctx.fillStyle;
  });
  return typeof seen[0] === "string" && seen[0] === seen[1] ? seen[0] : undefined;
}

/** Parse a CSS colour to 0..255 channels and 0..1 alpha. Uses and restores `ctx.fillStyle`. */
export function parseColour(ctx: Ctx2D, colour: string): Rgba {
  const before = ctx.fillStyle;
  let text: string | undefined;
  try {
    text = normalise(ctx, colour);
  } finally {
    ctx.fillStyle = before;
  }
  const hex = text === undefined ? undefined : /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(text);
  if (hex !== null && hex !== undefined) {
    return { r: parseInt(hex[1] ?? "0", 16), g: parseInt(hex[2] ?? "0", 16), b: parseInt(hex[3] ?? "0", 16), a: 1 };
  }
  const rgba = text === undefined ? undefined : /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(text);
  if (rgba !== null && rgba !== undefined) {
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  }
  throw new SketchUsageError({ detail: `"${colour}" is not a colour this brush can vary or mix (use a CSS colour such as "#c0392b" or "hsl(10 60% 45%)")` });
}

function toHsl(c: Rgba): [number, number, number] {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl(hsl: readonly [number, number, number], a: number): Rgba {
  const [h, s, l] = hsl;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const sectors: readonly (readonly [number, number, number])[] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = sectors[sector] ?? [0, 0, 0];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255), a };
}

/** Shift a colour's hue by `hue` degrees and its HSL lightness by `light` (clamped to 0..1). */
export function shiftColour(c: Rgba, shift: { hue: number; light: number }): Rgba {
  const [h, s, l] = toHsl(c);
  return fromHsl([(((h + shift.hue) % 360) + 360) % 360, s, Math.min(1, Math.max(0, l + shift.light))], c.a);
}

/** A CSS `rgba(…)` string for a colour, at `alpha` times its own alpha. */
export function cssColour(c: Rgba, alpha: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a * alpha})`;
}
