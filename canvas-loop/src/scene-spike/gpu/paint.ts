// Paints as GPU records: a solid colour (premultiplied), or a gradient read in
// the shape's own coordinates through the inverse of its device transform.
// Colour stops interpolate unpremultiplied, as the Stage 3 probes matched Skia.
import type { Paint } from "../../core/paint.js";
import type { ColorParser, Rgba } from "../colors.js";
import { invert } from "../mat.js";
import type { Mat, PixelsVersion } from "../scene.js";

export interface PaintRec {
  /** 0 solid, 1 linear gradient, 2 radial gradient, 3 a `pixels` image (bilinear, in local coordinates). */
  readonly kind: 0 | 1 | 2 | 3;
  /** Solid colour, premultiplied. */
  readonly color: Rgba;
  /** Linear: x1, y1, x2, y2. Radial: cx, cy, r1, r2. Local coordinates. */
  readonly grad: readonly [number, number, number, number];
  /** Device pixel → local coordinates. */
  readonly inv: Mat;
  /** Radial: the ellipse's height ÷ width (1 for a circle). */
  readonly scaleY: number;
  readonly stops: readonly { readonly offset: number; readonly color: Rgba }[];
  readonly image?: PixelsVersion;
}

/** A `pixels` image as paint: its pixel (i, j) covers local [i, i+1) × [j, j+1). */
export function imageRec(image: PixelsVersion, matrix: Mat): PaintRec | undefined {
  const inv = invert(matrix);
  if (inv === undefined) return undefined;
  return { kind: 3, color: [0, 0, 0, 0], grad: [0, 0, 0, 0], inv, scaleY: 1, stops: [], image };
}

export function premultiply(c: Rgba): Rgba {
  return [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]];
}

/** The record for `paint` drawn under the device transform `matrix`; undefined when the transform is singular (nothing draws). */
export function paintRec(paint: Paint, a: { matrix: Mat; colors: ColorParser }): PaintRec | undefined {
  const inv = invert(a.matrix);
  if (inv === undefined) return undefined;
  if (typeof paint === "string") return { kind: 0, color: premultiply(a.colors(paint)), grad: [0, 0, 0, 0], inv, scaleY: 1, stops: [] };
  const stops = paint.stops.map(([offset, css]) => ({ offset, color: a.colors(css) }));
  if (paint.kind === "linear-gradient") return { kind: 1, color: [0, 0, 0, 0], grad: [paint.x1, paint.y1, paint.x2, paint.y2], inv, scaleY: 1, stops };
  return { kind: 2, color: [0, 0, 0, 0], grad: [paint.x2, paint.y2, paint.r1, paint.r2], inv, scaleY: paint.scaleY ?? 1, stops };
}
