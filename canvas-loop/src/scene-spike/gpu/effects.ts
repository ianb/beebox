// Effects as a plan in device pixels. Lengths follow the transform where the
// group (or shape) is called (draft 2.2 section 4, decision 1): under an
// axis-aligned scale a blur stretches with each axis (σx, σy); under rotation
// with a uniform scale it stays round; a shadow's offset turns with the
// transform. A rotated non-uniform scale or a skew would need a blur along
// rotated axes, which the spike does not build: it throws.
// Glow and shadow are made from the layer before the other effects (R5).
import type { Effects } from "../../scene-draft/scene-api.js";
import type { ColorParser, Rgba } from "../colors.js";
import { applyLinear, axisScales, invert, maxScale } from "../mat.js";
import type { Mat, PaperSettings } from "../scene.js";
import { premultiply } from "./paint.js";
import type { PainterlyPlan } from "./painterly.js";
import { painterlyPlanOf } from "./painterly.js";

const ADJUSTMENTS = ["hue", "saturation", "brightness", "contrast", "grayscale", "sepia", "invert"] as const;

/** A blur size in device pixels along each device axis (0 for none). */
export interface Sigma {
  readonly x: number;
  readonly y: number;
}

export interface FxPlan {
  /** Colour adjustments in CSS filter order: [index into ADJUSTMENTS, value]. */
  readonly adjust: readonly (readonly [number, number])[];
  readonly blur: Sigma;
  readonly glow: { readonly sigma: Sigma; readonly color: Rgba; readonly passes: number } | undefined;
  readonly shadow: { readonly dx: number; readonly dy: number; readonly sigma: Sigma; readonly color: Rgba } | undefined;
  /** Wash, hatching and paper, after the blur. */
  readonly painterly: PainterlyPlan | undefined;
}

const times = (s: Sigma, k: number): Sigma => ({ x: s.x * k, y: s.y * k });
const widest = (s: Sigma): number => Math.max(s.x, s.y);

/** The plan for `effects` called under device transform `matrix` (by `where`), and how far it reaches past the layer's content (device px). `paper` is the scope's (R9), `ratio` the pixel ratio. */
export function fxPlanOf(effects: Effects | undefined, a: { matrix: Mat; colors: ColorParser; where: string; ratio: number; paper: PaperSettings | undefined }): { plan: FxPlan | undefined; reach: number } {
  if (effects === undefined) return { plan: undefined, reach: 0 };
  const scale = axisScales(a.matrix, a.where);
  const toLocal = invert(a.matrix);
  const painterly = toLocal === undefined ? undefined : painterlyPlanOf(effects, { ...a, scale, toLocal });
  const adjust: (readonly [number, number])[] = [];
  for (const [i, key] of ADJUSTMENTS.entries()) {
    const v = effects[key];
    if (v !== undefined) adjust.push([i, v]);
  }
  const blur = times(scale, effects.blur ?? 0);
  let reach = 3 * widest(blur);
  let glow: FxPlan["glow"];
  if (effects.glow !== undefined) {
    const sigma = times(scale, effects.glow.blur);
    glow = { sigma, color: premultiply(a.colors(effects.glow.color)), passes: Math.round(effects.glow.strength ?? 2) };
    reach = Math.max(reach, 3 * widest(sigma));
  }
  let shadow: FxPlan["shadow"];
  if (effects.shadow !== undefined) {
    const s = effects.shadow;
    const [ox, oy] = applyLinear(a.matrix, [s.x ?? 0, s.y ?? 0]);
    // Offsets are whole device pixels; fractional offsets are not resampled yet.
    shadow = { dx: Math.round(ox), dy: Math.round(oy), sigma: times(scale, s.blur ?? 0), color: premultiply(a.colors(s.color)) };
    reach = Math.max(reach, Math.max(Math.abs(shadow.dx), Math.abs(shadow.dy)) + 3 * widest(shadow.sigma));
  }
  // A bleed displaces reads by up to `bleed` along each local axis.
  reach = Math.max(reach, (effects.wash?.bleed ?? 0) * Math.SQRT2 * maxScale(a.matrix));
  const empty = adjust.length === 0 && widest(blur) === 0 && glow === undefined && shadow === undefined && painterly === undefined;
  return { plan: empty ? undefined : { adjust, blur, glow, shadow, painterly }, reach: Math.ceil(reach) + 1 };
}

function boxOf(lo: number, hi: number): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = lo; i <= hi; i++) m.set(i, 1 / (hi - lo + 1));
  return m;
}

function convolve(a: Map<number, number>, b: Map<number, number>): Map<number, number> {
  const m = new Map<number, number>();
  for (const [i, x] of a) for (const [j, y] of b) m.set(i + j, (m.get(i + j) ?? 0) + x * y);
  return m;
}

/**
 * Skia's blur kernel (what @napi-rs/canvas draws for CSS `blur`): the SVG
 * three-box approximation, box width ⌊σ·3·√(2π)/4 + 0.5⌋, two offset boxes and
 * a centred one when the width is even; a Gaussian below σ 2. Returns weights
 * from the centre outward.
 */
export function blurKernel(sigma: number): number[] {
  if (sigma <= 0) return [1];
  if (sigma < 2) {
    const r = Math.ceil(3 * sigma);
    const w = Array.from({ length: r + 1 }, (_, i) => Math.exp(-(i * i) / (2 * sigma * sigma)));
    const sum = 2 * w.reduce((s, x) => s + x, 0) - (w[0] ?? 0);
    return w.map((x) => x / sum);
  }
  const d = Math.floor((sigma * (3 * Math.sqrt(2 * Math.PI))) / 4 + 0.5);
  const h = Math.floor(d / 2);
  const k = d % 2 === 1 ? convolve(convolve(boxOf(-h, h), boxOf(-h, h)), boxOf(-h, h)) : convolve(convolve(boxOf(-h, h - 1), boxOf(-h + 1, h)), boxOf(-h, h));
  const r = Math.max(...[...k.keys()].map((i) => Math.abs(i)));
  return Array.from({ length: r + 1 }, (_, i) => k.get(i) ?? 0);
}
