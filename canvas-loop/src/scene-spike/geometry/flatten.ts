// Flatten a shape's geometry to polylines in its own coordinates, fine enough
// for its size on screen: `scale` is the device pixels per unit (the largest
// singular value of the transform), and the chord error stays under TOL
// device pixels. Ported from the Stage 3 geometry probe (scratch/stage3/geometry/tess.ts).
import type { PathCommand } from "../../core/paint.js";
import type { Geom } from "../scene.js";

/** One connected run of an outline: flat `[x0, y0, x1, y1, …]`. A fill closes every run; a stroke closes only `closed` ones. */
export interface Poly {
  readonly pts: number[];
  readonly closed: boolean;
}

const TOL = 0.05;
const TURN = Math.PI * 2;

function arcSteps(args: { radius: number; scale: number; sweep: number }): number {
  const r = args.radius * args.scale;
  if (r <= TOL) return Math.max(2, Math.ceil(args.sweep / (Math.PI / 2)));
  return Math.max(4, Math.ceil(args.sweep / (2 * Math.acos(1 - TOL / r))));
}

/** Points along an elliptical arc from `a0` to `a1`, both ends included (the first skipped with `skipFirst`). */
export function arcPoints(out: number[], a: { cx: number; cy: number; rx: number; ry: number; a0: number; a1: number; scale: number; skipFirst?: boolean }): void {
  const n = arcSteps({ radius: Math.max(a.rx, a.ry), scale: a.scale, sweep: Math.abs(a.a1 - a.a0) });
  for (let i = a.skipFirst === true ? 1 : 0; i <= n; i++) {
    const t = a.a0 + ((a.a1 - a.a0) * i) / n;
    out.push(a.cx + a.rx * Math.cos(t), a.cy + a.ry * Math.sin(t));
  }
}

/** Canvas2D's clockwise arc sweep: a whole number of turns draws the whole circle; otherwise the end wraps to within a turn of the start. */
function arcSweep(start: number, end: number): { sweep: number; full: boolean } {
  const raw = end - start;
  const whole = raw !== 0 && Math.abs(raw / TURN - Math.round(raw / TURN)) < 1e-9;
  if (raw >= TURN - 1e-9 || whole) return { sweep: TURN, full: true };
  return { sweep: ((raw % TURN) + TURN) % TURN, full: false };
}

function cubic(out: number[], c: { x0: number; y0: number; c: readonly [number, number, number, number, number, number]; scale: number }): void {
  const [c1x, c1y, c2x, c2y, x, y] = c.c;
  const { x0, y0 } = c;
  // Wang's formula on the device-scaled control polygon.
  const dd = Math.max(Math.hypot(x0 - 2 * c1x + c2x, y0 - 2 * c1y + c2y), Math.hypot(c1x - 2 * c2x + x, c1y - 2 * c2y + y)) * c.scale;
  const n = Math.min(4000, Math.max(1, Math.ceil(Math.sqrt((0.75 * dd) / TOL))));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const k = 3 * u * t * t;
    const d = t * t * t;
    out.push(a * x0 + b * c1x + k * c2x + d * x, a * y0 + b * c1y + k * c2y + d * y);
  }
}

/** Path commands as polylines, with Canvas2D's rules for a subpath begun without `move`. */
function pathPolys(commands: readonly PathCommand[], scale: number): Poly[] {
  const out: Poly[] = [];
  let cur: number[] = [];
  let start: [number, number] | undefined;
  const end = (closed: boolean): void => {
    if (cur.length >= 4 || (closed && cur.length >= 2)) out.push({ pts: cur, closed });
    cur = [];
  };
  const from = (fx: number, fy: number): [number, number] => {
    if (cur.length === 0) {
      const p = start ?? [fx, fy];
      start = p;
      cur.push(p[0], p[1]);
    }
    return [cur.at(-2) ?? fx, cur.at(-1) ?? fy];
  };
  for (const c of commands) {
    switch (c[0]) {
      case "move":
        end(false);
        start = [c[1], c[2]];
        cur.push(c[1], c[2]);
        break;
      case "line":
        from(c[1], c[2]);
        cur.push(c[1], c[2]);
        break;
      case "quad": {
        const [x0, y0] = from(c[1], c[2]);
        // Elevate to a cubic so one flattener serves both.
        const k = [x0 + ((c[1] - x0) * 2) / 3, y0 + ((c[2] - y0) * 2) / 3, c[3] + ((c[1] - c[3]) * 2) / 3, c[4] + ((c[2] - c[4]) * 2) / 3, c[3], c[4]] as const;
        cubic(cur, { x0, y0, c: k, scale });
        break;
      }
      case "bezier": {
        const [x0, y0] = from(c[1], c[2]);
        cubic(cur, { x0, y0, c: [c[1], c[2], c[3], c[4], c[5], c[6]], scale });
        break;
      }
      case "close": {
        const p = start;
        end(true);
        // After close the current point is the subpath's start.
        if (p !== undefined) start = p;
        break;
      }
    }
  }
  end(false);
  return out;
}

/** A shape's outline as polylines in its own coordinates. */
export function polylines(g: Geom, scale: number): Poly[] {
  switch (g.kind) {
    case "rect":
      return [{ pts: [g.x, g.y, g.x + g.w, g.y, g.x + g.w, g.y + g.h, g.x, g.y + g.h], closed: true }];
    case "ellipse": {
      const pts: number[] = [];
      arcPoints(pts, { cx: g.x, cy: g.y, rx: Math.abs(g.rx), ry: Math.abs(g.ry), a0: 0, a1: TURN, scale });
      pts.length -= 2;
      return [{ pts, closed: true }];
    }
    case "arc": {
      const { sweep, full } = arcSweep(g.start, g.end);
      const pts: number[] = [];
      arcPoints(pts, { cx: g.x, cy: g.y, rx: g.r, ry: g.r, a0: g.start, a1: g.start + sweep, scale });
      if (full) pts.length -= 2;
      return [{ pts, closed: full }];
    }
    case "poly":
      return [{ pts: g.points.flatMap((p) => [p[0], p[1]]), closed: g.closed }];
    case "path":
      return pathPolys(g.commands, scale);
  }
}
