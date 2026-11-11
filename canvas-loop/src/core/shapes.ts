// Shape helpers that return data (point lists or path commands), so their
// results work with fill, stroke, brushes and clip alike.
import { evalEnvelope, validateEnvelope } from "./brush/envelope.js";
import { resample } from "./brush/sample.js";
import type { Envelope } from "./brush/types.js";
import { curveCommands, pathContours } from "./contours.js";
import { SketchUsageError } from "./errors.js";
import type { PathCommand, Vec2 } from "./paint.js";

/** Options for `tube`: full width in pixels, and how it varies along the tube (0 → 1). */
export interface TubeOptions {
  readonly width: number;
  readonly profile?: Envelope;
}

const CAP_STEPS = 8;

/**
 * The closed outline of a tube (a limb, a tail, a stem) around a smooth
 * centreline through `points`, with round ends. Width follows `profile` along
 * the centreline; `"even"` by default.
 */
export function tubePath(points: readonly Vec2[], options: TubeOptions): PathCommand[] {
  if (!Number.isFinite(options.width) || options.width <= 0) {
    throw new SketchUsageError({ detail: `tube width must be a positive number, got ${options.width}` });
  }
  const profile = options.profile ?? "even";
  validateEnvelope(profile, "tube profile");
  const centre = pathContours(curveCommands(points, false), 0.5)[0]?.points ?? [];
  let length = 0;
  for (const [i, p] of centre.entries()) {
    const q = centre[i + 1];
    if (q !== undefined) length += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  // Step small enough that even a very short tube keeps both ends.
  const samples = resample(centre, { closed: false, step: Math.max(length / 2000, Math.min(options.width / 8, length / 2)) });
  if (samples.length < 2) throw new SketchUsageError({ detail: "tube needs at least two distinct points" });
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const radii = samples.map((s) => (options.width / 2) * Math.max(0.02, evalEnvelope(profile, s.t)));
  for (const [i, s] of samples.entries()) {
    const r = radii[i] ?? 0;
    left.push([s.x + s.nx * r, s.y + s.ny * r]);
    right.push([s.x - s.nx * r, s.y - s.ny * r]);
  }
  const cap = (at: number, from: number): Vec2[] => {
    const s = samples[at];
    const r = radii[at] ?? 0;
    if (s === undefined) return [];
    const base = Math.atan2(s.ny, s.nx) + from;
    return Array.from({ length: CAP_STEPS - 1 }, (_, k) => {
      const a = base + (Math.PI * (k + 1)) / CAP_STEPS;
      return [s.x + Math.cos(a) * r, s.y + Math.sin(a) * r];
    });
  };
  // Left side forward, round end (sweeping through the forward direction),
  // right side back, round start (sweeping through the backward direction).
  const ring = [...left, ...cap(samples.length - 1, 0), ...right.toReversed(), ...cap(0, Math.PI)];
  const [first, ...rest] = ring;
  if (first === undefined) return [];
  return [["move", first[0], first[1]], ...rest.map(([x, y]): PathCommand => ["line", x, y]), ["close"]];
}

function signedArea(points: readonly Vec2[]): number {
  let area = 0;
  for (const [i, a] of points.entries()) {
    const b = points[(i + 1) % points.length] ?? a;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/**
 * Grow (`distance` > 0) or shrink (< 0) a closed outline given as points, by
 * moving each point along the outline's outward normal. Works on the points you
 * would pass to `polygon` or `curve(points, true)`; best on smooth, roundish
 * shapes (a deep inward corner can fold over itself).
 */
export function offsetPoints(points: readonly Vec2[], distance: number): Vec2[] {
  if (!Number.isFinite(distance)) throw new SketchUsageError({ detail: "offset distance must be a finite number" });
  const n = points.length;
  if (n < 3) throw new SketchUsageError({ detail: "offset needs a closed outline of at least 3 points" });
  const outward = signedArea(points) > 0 ? 1 : -1;
  return points.map((p, i) => {
    const prev = points[(i - 1 + n) % n] ?? p;
    const next = points[(i + 1) % n] ?? p;
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    // (ty, -tx) is the right-hand normal; flip it so it points outward.
    return [p[0] + ((outward * ty) / len) * distance, p[1] + ((outward * -tx) / len) * distance];
  });
}
