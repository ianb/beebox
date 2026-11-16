// How a finished drawing combines with what is under it: blend modes, and the
// effects a group applies as it is composited. Re-exported from paint.ts.
import { SketchUsageError } from "./errors.js";

/**
 * How drawn pixels combine with what is already there. `"normal"` is Canvas2D's
 * `source-over` and `"add"` is `lighter` (light sums toward white); the rest
 * are Canvas2D composite modes that Skia and browsers share.
 */
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "soft-light",
  "hard-light",
  "color-dodge",
  "color-burn",
  "add",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

const BLEND_SET = new Set<string>(BLEND_MODES);

/**
 * The Canvas2D `globalCompositeOperation` value for a blend mode. An unknown
 * name is an error: Canvas2D would ignore it and draw with the last mode set.
 */
export function compositeOp(blend: BlendMode): string {
  if (!BLEND_SET.has(blend)) throw new SketchUsageError({ detail: `blend "${String(blend)}" is not one of: ${BLEND_MODES.join(", ")}` });
  if (blend === "normal") return "source-over";
  return blend === "add" ? "lighter" : blend;
}

/** A drop shadow: offset `x`, `y` and `blur` in canvas pixels. */
export interface Shadow {
  readonly x?: number;
  readonly y?: number;
  readonly blur?: number;
  readonly color: string;
}

/** Watercolour wash over what the group drew (Bousseau et al. 2006). */
export interface Wash {
  /** Pigment settling faintly into the paper's tooth, 0..1 (default 0.5). */
  readonly granulate?: number;
  /** Pigment gathering at edges, 0..1 (default 0.5): a dark drying line where a colour meets paper or another colour, heavier near a region's edges and bottom, lighter in its middle. */
  readonly edges?: number;
  /** Uneven pigment, 0..1 (default 0.4): pooling in patches about a shape's size and, above about 0.2, occasional blooms (lighter backruns with a hard dark rim). */
  readonly blotch?: number;
  /** Edges wander, in logical pixels. */
  readonly bleed?: number;
}

/**
 * Pencil hatching revealed by darkness (Praun et al. 2001), by tone relative
 * to the group's own range: the lightest part bare, half tones single lines,
 * shadows crossed lines. Under the lines the colour lifts toward paper, so the
 * lines carry the tone.
 */
export interface Hatching {
  /** Hatch strength, 0..1. */
  readonly amount: number;
  /** Line angle in radians (default π/4); a second layer crosses it in the darkest tones. */
  readonly angle?: number;
  /** Line spacing in logical pixels (default 6). */
  readonly spacing?: number;
  readonly color?: string;
}

/**
 * Effects on a group, applied in this fixed order: colour adjustments, blur,
 * wash, hatching, paper; then glow and shadow are drawn beneath the result.
 * Lengths are in the coordinates where the group is called. For another
 * order, nest groups.
 */
export interface Effects {
  /** Rotate hues, in degrees. */
  readonly hue?: number;
  /** 1 unchanged, 0 grey, above 1 more vivid. */
  readonly saturation?: number;
  /** 1 unchanged, 0 black. */
  readonly brightness?: number;
  /** 1 unchanged, 0 flat grey. */
  readonly contrast?: number;
  /** 0..1 toward grey. */
  readonly grayscale?: number;
  /** 0..1 toward sepia. */
  readonly sepia?: number;
  /** 0..1 toward the negative. */
  readonly invert?: number;
  /** Gaussian blur radius. */
  readonly blur?: number;
  /**
   * A coloured halo under what the group drew: its silhouette blurred by
   * `blur`, tinted, and layered `strength` times (default 2, 1..6).
   */
  readonly glow?: { readonly blur: number; readonly color: string; readonly strength?: number };
  readonly shadow?: Shadow;
  readonly wash?: Wash;
  readonly hatching?: Hatching;
  /** Paper texture over what the group drew, only where it drew, 0..1. */
  readonly paper?: number;
}

