// How far a brushed stroke's marks reach past its centreline, in the units of
// its width: the GPU's mark boxes (gpu/marks.ts) and the scene's conservative
// boxes (bounds.ts) both use it, so a picture that sizes itself from its
// drawing holds every mark the GPU lays.
import type { BristleBrush, Brush } from "../core/brush/types.js";

/** How far a bristle wanders sideways, as a fraction of the brush's half-width (the `bristles` entry, shader-bristle.ts). */
const BRISTLE_DRIFT = 0.12;

/**
 * How far past the centreline a bristle mark can reach: the outermost
 * bristle's offset (with spread and drift) plus half its thickest line.
 */
export function bristleReach(width: number, brush: BristleBrush): number {
  const n = Math.max(1, Math.round(brush.bristles));
  const offset = 1 + (brush.spread * 2) / n + BRISTLE_DRIFT;
  const thickest = (width / n) * 2.2 * (1 + brush.spread / 2);
  return (offset * width) / 2 + thickest / 2;
}

/**
 * How far past its centreline (wobble not included) a stroke of `width` with
 * `brush` can lay paint: for a stamp the largest dab, `width / 2 × (1 +
 * sizeJitter / 2)`, plus the largest scatter, `scatter × width / 2`; for ink
 * the largest capsule radius, `width / 2`; for bristle the outermost bristle
 * and the other half of its thickness again for a strip's mitre; for a smear
 * one pick-up patch, `width`.
 */
export function brushGrowth(brush: Brush, width: number): number {
  switch (brush.kind) {
    case "ink":
      return width / 2;
    case "stamp":
      return (width / 2) * (1 + brush.sizeJitter / 2) + (brush.scatter * width) / 2;
    case "bristle":
      return bristleReach(width, brush) + (width / Math.max(1, Math.round(brush.bristles))) * 1.1 * (1 + brush.spread / 2);
    case "smear":
      return width;
  }
}
