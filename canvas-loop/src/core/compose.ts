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

/**
 * Effects on a finished group, applied as it is composited, in this order:
 * colour adjustments, `blur`, `shadow`, with the `glow` drawn beneath. Lengths are canvas pixels and
 * are not scaled by an enclosing `at`.
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
}

