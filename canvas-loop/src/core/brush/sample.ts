// Even arc-length resampling of a device-space contour.
import type { Vec2 } from "../paint.js";

/** One point along a mark, in device pixels. */
export interface Sample {
  x: number;
  y: number;
  /** Unit normal (left of the direction of travel). */
  readonly nx: number;
  readonly ny: number;
  /** Arc length from the mark's start, in device pixels. */
  readonly s: number;
  /** Position along the mark, 0..1. */
  readonly t: number;
  /** Pressure at this point, 0..1 (filled in from the gesture). */
  p: number;
}

function segmentLengths(points: readonly Vec2[]): number[] {
  const lengths: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    lengths.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return lengths;
}

/** Remove consecutive duplicate points; close the loop by repeating the start. */
function prepare(points: readonly Vec2[], closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const prev = out.at(-1);
    if (prev === undefined || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  const first = out[0];
  const last = out.at(-1);
  if (closed && first !== undefined && last !== undefined && out.length > 2) {
    if (first[0] !== last[0] || first[1] !== last[1]) out.push(first);
  }
  return out;
}

/**
 * Resample `points` every `step` device pixels. Returns at least one sample;
 * a contour shorter than one step (a dot) returns its single start point.
 */
export function resample(points: readonly Vec2[], args: { closed: boolean; step: number }): Sample[] {
  const pts = prepare(points, args.closed);
  const lengths = segmentLengths(pts);
  const total = lengths.reduce((a, b) => a + b, 0);
  const first = pts[0];
  if (first === undefined) return [];
  if (total < args.step || pts.length < 2) return [{ x: first[0], y: first[1], nx: 0, ny: -1, s: 0, t: 0, p: 1 }];
  // Fixed spacing from the start (plus the exact end point), so editing the end
  // of a mark leaves the samples before the edit where they were.
  const positions: number[] = [];
  for (let s = 0; s < total - args.step * 0.5; s += args.step) positions.push(s);
  positions.push(total);
  const samples: Sample[] = [];
  let seg = 0;
  let segStart = 0;
  for (const s of positions) {
    while (seg < lengths.length - 1 && segStart + (lengths[seg] ?? 0) < s) {
      segStart += lengths[seg] ?? 0;
      seg += 1;
    }
    const a = pts[seg] ?? first;
    const b = pts[seg + 1] ?? a;
    const len = lengths[seg] ?? 0;
    const f = len > 0 ? Math.min(1, Math.max(0, (s - segStart) / len)) : 0;
    const dx = len > 0 ? (b[0] - a[0]) / len : 1;
    const dy = len > 0 ? (b[1] - a[1]) / len : 0;
    samples.push({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, nx: dy, ny: -dx, s, t: s / total, p: 1 });
  }
  return samples;
}
