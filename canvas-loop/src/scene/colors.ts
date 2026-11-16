// CSS colours as numbers, parsed the way the runtime's 2D canvas parses them:
// set `fillStyle` and read back the normalised `#rrggbb` or `rgba(…)` (both
// runtimes normalise; brush/render/colour.ts does the same for brushes).
import type { Ctx2D } from "../core/ctx2d.js";
import { SketchUsageError } from "../core/errors.js";

/** Red, green, blue, alpha in 0..1, unpremultiplied. */
export type Rgba = readonly [number, number, number, number];

/** Parses a CSS colour string; throws for one the runtime does not know. */
export type ColorParser = (css: string) => Rgba;

// Two sentinels: a colour the context rejects leaves `fillStyle` at whichever was set before.
const SENTINELS = ["#010203", "#040506"] as const;

function parseWith(ctx: Ctx2D, css: string): Rgba {
  const seen = SENTINELS.map((s) => {
    ctx.fillStyle = s;
    ctx.fillStyle = css;
    return ctx.fillStyle;
  });
  const text = typeof seen[0] === "string" && seen[0] === seen[1] ? seen[0] : "";
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(text);
  if (hex !== null) return [parseInt(hex[1] ?? "0", 16) / 255, parseInt(hex[2] ?? "0", 16) / 255, parseInt(hex[3] ?? "0", 16) / 255, 1];
  const rgba = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(text);
  if (rgba !== null) return [Number(rgba[1]) / 255, Number(rgba[2]) / 255, Number(rgba[3]) / 255, rgba[4] === undefined ? 1 : Number(rgba[4])];
  throw new SketchUsageError({ detail: `"${css}" is not a CSS colour` });
}

/** A parser over `ctx` that remembers each answer: sketches repeat a few colours many times. */
export function colorsFrom(ctx: Ctx2D): ColorParser {
  const seen = new Map<string, Rgba>();
  return (css) => {
    const hit = seen.get(css);
    if (hit !== undefined) return hit;
    const c = parseWith(ctx, css);
    seen.set(css, c);
    return c;
  };
}
