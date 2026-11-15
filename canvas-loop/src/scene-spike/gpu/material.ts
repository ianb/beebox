// A lit group's two material layers (R8), drawn by lowering its body a second
// and third time with each draw's colour replaced by its material and the
// paint's alpha kept, so materials composite by coverage, erase, clip, mask
// and fade exactly as colour does. Premultiplied, with 0.5 as a flat normal:
// - layer 0: surface normal x, y (as 0.5 + n/2), shine, coverage;
// - layer 1: emissive, shadow-casting amount, 0, coverage.
// A shape without a material is flat matte (zeros apart from the flat normal).
import type { Material } from "../../scene-draft/scene-api.js";
import type { Rgba } from "../colors.js";
import type { FxPlan, Sigma } from "./effects.js";
import { premultiply } from "./paint.js";

export type MaterialLayer = 0 | 1;

/** How a subtree draws into a material layer. */
export interface MatMode {
  readonly layer: MaterialLayer;
  /** From `place(…, { material })`: for the picture's shapes that have none. */
  readonly fallback: Material | undefined;
}

/** A nested lit group, to the enclosing lighting: emissive, so it is not lit twice (R8). */
export const LIT_RESULT: Material = { emissive: 1 };

/** The material a shape draws with in `mode`. */
export function materialOf(own: Material | undefined, mode: MatMode): Material | undefined {
  return own ?? mode.fallback;
}

/** The straight colour standing for `m` in layer `layer` (bevel normals come from their own pass). */
export function materialColor(m: Material | undefined, layer: MaterialLayer): Rgba {
  if (layer === 0) return [0.5, 0.5, m?.shine ?? 0, 1];
  return [m?.emissive ?? 0, m?.castsShadow === true ? 1 : 0, 0, 1];
}

/** A bevelled shape's normals in layer 0: its coverage blurred by half the bevel, shaped into a rounded rim. */
export interface BevelPlan {
  readonly sigma: Sigma;
  /** The rim's height in device pixels. */
  readonly height: number;
  readonly shine: number;
}

/** The bevel of `m` under device scale `scale` (per axis), or undefined for a flat shape. */
export function bevelOf(m: Material | undefined, scale: Sigma): BevelPlan | undefined {
  const bevel = m?.bevel ?? 0;
  if (bevel <= 0) return undefined;
  const s = Math.sqrt(scale.x * scale.y);
  return { sigma: { x: (scale.x * bevel) / 2, y: (scale.y * bevel) / 2 }, height: bevel * s * (0.25 + 0.75 * (m?.relief ?? 0.5)), shine: m?.shine ?? 0 };
}

/**
 * A group's effects as they act on a material layer: colour adjustments,
 * blur and the painterly effects change colour only, so they go; a glow adds
 * emissive pixels and a shadow adds flat matte ones (R8).
 */
export function materialPlan(plan: FxPlan | undefined, layer: MaterialLayer): FxPlan | undefined {
  if (plan === undefined || (plan.glow === undefined && plan.shadow === undefined)) return undefined;
  const as = (c: Rgba, m: Material): Rgba => {
    const v = materialColor(m, layer);
    // `c` is premultiplied: its alpha is the coverage the glow or shadow adds.
    return premultiply([v[0], v[1], v[2], c[3]]);
  };
  return {
    adjust: [],
    blur: { x: 0, y: 0 },
    painterly: undefined,
    glow: plan.glow === undefined ? undefined : { ...plan.glow, color: as(plan.glow.color, { emissive: 1 }) },
    shadow: plan.shadow === undefined ? undefined : { ...plan.shadow, color: as(plan.shadow.color, {}) },
  };
}
