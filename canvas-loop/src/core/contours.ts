// Shape geometry as data for brushes. A brush cannot read a Canvas2D path back,
// so every stroked primitive also describes itself as contours: polylines with
// a `closed` flag. A path with two `move` commands is two contours, so a brush
// never bridges the gap between them.
import { SketchUsageError } from "./errors.js";
import type { PathCommand, Vec2 } from "./paint.js";

/** One connected run of a shape's outline, in user (pre-transform) space. */
export interface Contour {
  readonly points: readonly Vec2[];
  readonly closed: boolean;
}

const MAX_SEGMENTS = 4000;

function segmentsFor(length: number, step: number): number {
  return Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(length / step)));
}

/**
 * The Catmull-Rom curve through `points` as bezier commands: the curve p5's
 * `curveVertex` draws. An open curve starts and ends at the end points; a
 * closed one wraps around and ends with `close`.
 */
export function curveCommands(points: readonly Vec2[], closed: boolean): PathCommand[] {
  const n = points.length;
  const first = points[0];
  if (first === undefined) return [];
  const get = (index: number): Vec2 => {
    const p = points[index];
    if (p === undefined) throw new SketchUsageError({ detail: `curve() point ${index} is missing` });
    return p;
  };
  // An open curve's phantom end points mirror the neighbouring point, so the
  // ends leave in the direction of the next point (no pinch on short curves).
  const at = (i: number): Vec2 => {
    if (closed) return get((i + n) % n);
    if (i < 0) {
      const [a, b] = [get(0), get(Math.min(1, n - 1))];
      return [2 * a[0] - b[0], 2 * a[1] - b[1]];
    }
    if (i > n - 1) {
      const [a, b] = [get(n - 1), get(Math.max(0, n - 2))];
      return [2 * a[0] - b[0], 2 * a[1] - b[1]];
    }
    return get(i);
  };
  const commands: PathCommand[] = [["move", first[0], first[1]]];
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    commands.push([
      "bezier",
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
      p2[0],
      p2[1],
    ]);
  }
  if (closed) commands.push(["close"]);
  return commands;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function flattenBezier(out: Vec2[], args: { from: Vec2; c1: Vec2; c2: Vec2; to: Vec2; step: number }): void {
  const { from, c1, c2, to } = args;
  const n = segmentsFor(dist(from, c1) + dist(c1, c2) + dist(c2, to), args.step);
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push([a * from[0] + b * c1[0] + c * c2[0] + d * to[0], a * from[1] + b * c1[1] + c * c2[1] + d * to[1]]);
  }
}

/** Flatten a `PathCommand` list into contours; `step` is the longest segment, in user units. */
export function pathContours(commands: readonly PathCommand[], step: number): Contour[] {
  const contours: Contour[] = [];
  let current: Vec2[] = [];
  // Canvas2D has no current point until the first command; a drawing command
  // then starts a subpath where it is (line) or at its first control point.
  let start: Vec2 | undefined;
  const last = (fallback: Vec2): Vec2 => current.at(-1) ?? start ?? fallback;
  const finish = (closed: boolean): void => {
    if (current.length > 0) contours.push({ points: current, closed });
    current = [];
  };
  for (const cmd of commands) {
    switch (cmd[0]) {
      case "move":
        finish(false);
        start = [cmd[1], cmd[2]];
        current = [start];
        break;
      case "line":
        if (start === undefined) {
          start = [cmd[1], cmd[2]];
          current = [start];
          break;
        }
        if (current.length === 0) current = [start];
        current.push([cmd[1], cmd[2]]);
        break;
      case "quad": {
        const from = last([cmd[1], cmd[2]]);
        start ??= from;
        if (current.length === 0) current = [from];
        // Elevate the quadratic to a cubic so one flattener serves both.
        const c1: Vec2 = [from[0] + ((cmd[1] - from[0]) * 2) / 3, from[1] + ((cmd[2] - from[1]) * 2) / 3];
        const c2: Vec2 = [cmd[3] + ((cmd[1] - cmd[3]) * 2) / 3, cmd[4] + ((cmd[2] - cmd[4]) * 2) / 3];
        flattenBezier(current, { from, c1, c2, to: [cmd[3], cmd[4]], step });
        break;
      }
      case "bezier": {
        const from = last([cmd[1], cmd[2]]);
        start ??= from;
        if (current.length === 0) current = [from];
        flattenBezier(current, { from, c1: [cmd[1], cmd[2]], c2: [cmd[3], cmd[4]], to: [cmd[5], cmd[6]], step });
        break;
      }
      case "close":
        finish(true);
        current = [];
        break;
    }
  }
  finish(false);
  return contours;
}

/** An elliptical arc (or the full ellipse) as one contour. */
export function ellipseContour(args: {
  x: number;
  y: number;
  rx: number;
  ry: number;
  start: number;
  end: number;
  step: number;
}): Contour {
  // Canvas2D's clockwise arc: a sweep of a full turn or more is the whole
  // ellipse; otherwise the end wraps forward to within one turn of the start.
  const turn = Math.PI * 2;
  const raw = args.end - args.start;
  // A nonzero whole number of turns (either direction) draws the whole ellipse, as Skia does.
  const wholeTurns = raw !== 0 && Math.abs(raw / turn - Math.round(raw / turn)) < 1e-9;
  const full = raw >= turn - 1e-9 || wholeTurns;
  const sweep = full ? turn : ((raw % turn) + turn) % turn;
  const n = Math.max(8, segmentsFor(Math.abs(sweep) * Math.max(args.rx, args.ry), args.step));
  const points: Vec2[] = [];
  const count = full ? n : n + 1;
  for (let i = 0; i < count; i += 1) {
    const a = args.start + (sweep * i) / n;
    points.push([args.x + args.rx * Math.cos(a), args.y + args.ry * Math.sin(a)]);
  }
  return { points, closed: full };
}
