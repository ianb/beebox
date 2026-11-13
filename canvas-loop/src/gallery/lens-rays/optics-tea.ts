// Thin-lens optics for the ray diagram: pure numbers, no drawing.
//
// Sign convention ("real is positive"), as taught at 15–17:
//   1/f = 1/u + 1/v, u > 0 for a real object, v > 0 for a real image on the
//   far side, v < 0 for a virtual image on the object's side, f < 0 for a
//   diverging lens. Magnification m = −v/u: negative means inverted.

export const LENS_KINDS = ["converging", "diverging"] as const;
export type LensKind = (typeof LENS_KINDS)[number];

/** Where the image is, or that there is none (object at F of a converging lens). */
export type Image =
  | { type: "none" }
  | {
      type: "image";
      /** Image distance, cm (signed). */
      v: number;
      /** Magnification −v/u (signed). */
      m: number;
      /** Image height, cm (signed; negative is below the axis). */
      hi: number;
    };

export interface Solution {
  kind: LensKind;
  /** Signed focal length, cm. */
  f: number;
  u: number;
  h: number;
  image: Image;
}

const EPS = 1e-9;

export function signedFocal(kind: LensKind, focal: number): number {
  return kind === "converging" ? focal : -focal;
}

export function solve(args: {
  kind: LensKind;
  focal: number;
  u: number;
  h: number;
}): Solution {
  const { kind, u, h } = args;
  const f = signedFocal(kind, args.focal);
  if (Math.abs(u - f) < EPS) return { kind, f, u, h, image: { type: "none" } };
  const v = (u * f) / (u - f);
  const m = -v / u;
  return { kind, f, u, h, image: { type: "image", v, m, hi: m * h } };
}

export interface Character {
  real: boolean;
  upright: boolean;
  size: "magnified" | "diminished" | "same size";
}

export function character(img: { v: number; m: number }): Character {
  const am = Math.abs(img.m);
  let size: Character["size"] = "same size";
  if (am > 1 + 1e-6) size = "magnified";
  else if (am < 1 - 1e-6) size = "diminished";
  return { real: img.v > 0, upright: img.m > 0, size };
}

/** The textbook case the object is in, as one sentence. */
export function caseSentence(s: Solution): string {
  if (s.kind === "diverging")
    return "A diverging lens always gives a virtual, upright, diminished image between F′ and the lens.";
  const { u, f } = s;
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  if (near(u, f))
    return "Object at F: the rays leave the lens parallel and never meet, so no image forms.";
  if (near(u, 2 * f))
    return "Object at 2F: the image is at 2F′, real, inverted and the same size.";
  if (u > 2 * f)
    return "Object beyond 2F: the image is between F′ and 2F′, real, inverted and diminished.";
  if (u > f)
    return "Object between F and 2F: the image is beyond 2F′, real, inverted and magnified.";
  return "Object between F and the lens: the image is on the object's side, virtual, upright and magnified (a magnifying glass).";
}

/** A number for display: at most `dp` decimals, trailing zeros dropped, a real minus sign. */
export function fmt(n: number, dp = 1): string {
  const fixed = n.toFixed(dp);
  const s = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
  const t = s === "-0" ? "0" : s;
  return t.replace("-", "−");
}
