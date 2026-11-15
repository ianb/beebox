// 2D affine matrices in Canvas2D order, `[a, b, c, d, e, f]`.
import type { Vec2 } from "../core/paint.js";
import type { AtOptions } from "../scene-draft/scene-api.js";
import type { Mat } from "./scene.js";

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
