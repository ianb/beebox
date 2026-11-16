// 2D affine matrices in Canvas2D order, `[a, b, c, d, e, f]`.
import type { Vec2 } from "../core/paint.js";
import type { AtOptions } from "../core/tea.js";
import type { Mat } from "./nodes.js";
import { UnsupportedCallError } from "./errors.js";

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** `m · n`: apply `n` first, then `m` (as `ctx.transform(n)` after `m`). */
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Mat, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** Apply only the linear part (directions and offsets). */
export function applyLinear(m: Mat, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[2] * p[1], m[1] * p[0] + m[3] * p[1]];
}

export function det(m: Mat): number {
  return m[0] * m[3] - m[1] * m[2];
}

/** The inverse, or undefined for a singular matrix (a scale of 0 draws nothing). */
export function invert(m: Mat): Mat | undefined {
  const d = det(m);
  if (d === 0 || !Number.isFinite(d)) return undefined;
  const a = m[3] / d;
  const b = -m[1] / d;
  const c = -m[2] / d;
  const e = m[0] / d;
  return [a, b, c, e, -(a * m[4] + c * m[5]), -(b * m[4] + e * m[5])];
}

/** The largest singular value: how much a unit length can grow. */
export function maxScale(m: Mat): number {
  const p = m[0] * m[0] + m[1] * m[1];
  const q = m[2] * m[2] + m[3] * m[3];
  const r = m[0] * m[2] + m[1] * m[3];
  return Math.sqrt((p + q) / 2 + Math.hypot((p - q) / 2, r));
}

/** An `at` scope as one matrix: matrix, then translate, rotate, skew, scale (draft 2.2 `AtOptions`). */
export function matrixOf(at: AtOptions): Mat {
  let m: Mat = at.matrix === undefined ? IDENTITY : [...at.matrix];
  if (at.translate !== undefined) m = mul(m, [1, 0, 0, 1, at.translate[0], at.translate[1]]);
  if (at.rotate !== undefined) {
    const c = Math.cos(at.rotate);
    const s = Math.sin(at.rotate);
    m = mul(m, [c, s, -s, c, 0, 0]);
  }
  if (at.skew !== undefined) m = mul(m, [1, Math.tan(at.skew[1]), Math.tan(at.skew[0]), 1, 0, 0]);
  if (at.scale !== undefined) {
    const [sx, sy] = typeof at.scale === "number" ? [at.scale, at.scale] : at.scale;
    m = mul(m, [sx, 0, 0, sy, 0, 0]);
  }
  return m;
}

/**
 * Device pixels per unit along each device axis, for a round blur in the effect's own coordinates.
 * The recorder calls it at the call too, so an unsupported transform fails at the sketch's line.
 */
export function axisScales(m: Mat, where: string): { readonly x: number; readonly y: number } {
  const [a, b, c, d] = m;
  const p = a * a + b * b;
  const q = c * c + d * d;
  const eps = 1e-9 * Math.max(p, q, 1);
  if (b * b <= eps && c * c <= eps) return { x: Math.abs(a), y: Math.abs(d) };
  // A quarter turn: the effect's y axis lies along the device's x axis.
  if (a * a <= eps && d * d <= eps) return { x: Math.abs(c), y: Math.abs(b) };
  const r = a * c + b * d;
  if (Math.abs(p - q) <= 1e-6 * Math.max(p, q) && Math.abs(r) <= 1e-6 * Math.max(p, q)) {
    const s = Math.sqrt(p);
    return { x: s, y: s };
  }
  throw new UnsupportedCallError({ call: `${where} effects under a rotated non-uniform scale or a skew`, detail: "effects follow axis-aligned scales and rotations with a uniform scale only" });
}
