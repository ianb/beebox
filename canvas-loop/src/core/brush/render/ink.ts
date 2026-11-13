// The colour each dab or bristle paints: black coverage (coloured later, in one
// pass), or, for a brush with hueJitter/lightJitter, each one's own colour.
import { SketchUsageError } from "../../errors.js";
import type { Ctx2D, Paint } from "../../paint.js";
import { cssColour, parseColour, shiftColour } from "./colour.js";
import type { Rgba } from "./colour.js";
import { rand } from "../random.js";
import type { Brush } from "../types.js";

/** How much the brush varies its colour per dab or bristle, or undefined when it does not. */
export function jitterOf(brush: Brush): { hue: number; light: number } | undefined {
  if (brush.kind === "ink" || brush.kind === "smear") return undefined;
  const hue = brush.hueJitter ?? 0;
  const light = brush.lightJitter ?? 0;
  return hue > 0 || light > 0 ? { hue, light } : undefined;
}

export const BLACK = (_index: number, alpha: number): string => `rgba(0, 0, 0, ${alpha})`;

/** Dab or bristle `index`'s own colour: the paint shifted by seeded amounts within the jitter. */
export function jitteredInk(base: Rgba, args: { jitter: { hue: number; light: number }; seed: number }): (index: number, alpha: number) => string {
  const { jitter, seed } = args;
  return (index, alpha) => {
    const hue = jitter.hue * (2 * rand(seed, { channel: 13, index }) - 1);
    const light = jitter.light * (2 * rand(seed, { channel: 14, index }) - 1);
    // Opaque here: the paint's own alpha is applied once, when the finished mark is composited.
    return cssColour({ ...shiftColour(base, { hue, light }), a: 1 }, alpha);
  };
}

/** The colour a jittered brush varies around, or undefined for a brush that paints black coverage. */
export function jitterBase(brush: Brush, args: { paint: Paint; ctx: Ctx2D }): Rgba | undefined {
  if (jitterOf(brush) === undefined) return undefined;
  if (typeof args.paint !== "string") throw new SketchUsageError({ detail: "hueJitter and lightJitter need a solid stroke colour, not a gradient" });
  return parseColour(args.ctx, args.paint);
}
