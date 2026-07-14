// Shared drawing-data types for both tiers (the mutable Sketch engine and the
// TEA View facade). Everything here is DATA, not calls on a live context: point
// arrays, a tagged path mini-language, and gradient handles. That keeps the
// surface serializable-in-principle — a later browser renderer could emit these
// as JSON draw commands — and keeps live `CanvasGradient`/`Path2D` objects from
// leaking into sketch code. The `trace*`/`resolveGradient` helpers below are the
// one place those data forms are turned into ctx calls; the engine calls them.
import type { SKRSContext2D } from "@napi-rs/canvas";

/** A single point, `[x, y]`. The vertex form used by `polygon` and `clip`. */
export type Vec2 = readonly [number, number];

/**
 * One step of a `path`, a tagged tuple so the whole path is a JSON array literal
 * (the discriminant is element 0, so a switch narrows cleanly):
 *
 *   [["move", x, y], ["line", x, y], ["quad", cx, cy, x, y],
 *    ["bezier", c1x, c1y, c2x, c2y, x, y], ["close"]]
 */
export type PathCommand =
  | readonly ["move", number, number]
  | readonly ["line", number, number]
  | readonly ["quad", number, number, number, number]
  | readonly ["bezier", number, number, number, number, number, number]
  | readonly ["close"];

/** A gradient color stop, `[offset0to1, cssColor]`. */
export type ColorStop = readonly [number, string];

/**
 * A linear gradient handle. Opaque to sketch code — you get it from
 * `linearGradient(...)` and hand it back to `fill`/`stroke`/`background`; the
 * engine builds the real `CanvasGradient` at paint time. Plain data, so it
 * serializes.
 */
export interface LinearGradient {
  readonly kind: "linear-gradient";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stops: readonly ColorStop[];
}

/**
 * A radial gradient handle. Stored in the general two-circle form (so the data
 * is fully expressive and serializable) even though `radialGradient(x, y, r,
 * stops)` only exposes the concentric glow/sky case.
 */
export interface RadialGradient {
  readonly kind: "radial-gradient";
  readonly x1: number;
  readonly y1: number;
  readonly r1: number;
  readonly x2: number;
  readonly y2: number;
  readonly r2: number;
  readonly stops: readonly ColorStop[];
}

/** Any gradient handle. */
export type Gradient = LinearGradient | RadialGradient;

/** What `fill`/`stroke`/`background` accept: a CSS color string or a gradient handle. */
export type Paint = string | Gradient;

/**
 * A clip region: either a polygon (point array) or a path (command array). The
 * two are distinguishable at compile time (a `PathCommand`'s element 0 is a
 * string, a `Vec2`'s is a number) and at runtime the same way.
 */
export type ClipShape = readonly Vec2[] | readonly PathCommand[];

// ── data → ctx (the one crossing point) ──────────────────────────────
/** A `ClipShape` whose first element is a `PathCommand` (its element 0 is a string). */
export function isPathShape(shape: ClipShape): shape is readonly PathCommand[] {
  const first = shape[0];
  return first !== undefined && typeof first[0] === "string";
}

/** Trace a closed polygon onto `ctx`'s current path (no fill/stroke). */
export function tracePolygon(ctx: SKRSContext2D, points: readonly Vec2[]): void {
  ctx.beginPath();
  let started = false;
  for (const [x, y] of points) {
    if (started) {
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(x, y);
      started = true;
    }
  }
  ctx.closePath();
}

/** Trace a `PathCommand` list onto `ctx`'s current path (no fill/stroke). */
export function tracePath(ctx: SKRSContext2D, commands: readonly PathCommand[]): void {
  ctx.beginPath();
  for (const cmd of commands) {
    switch (cmd[0]) {
      case "move":
        ctx.moveTo(cmd[1], cmd[2]);
        break;
      case "line":
        ctx.lineTo(cmd[1], cmd[2]);
        break;
      case "quad":
        ctx.quadraticCurveTo(cmd[1], cmd[2], cmd[3], cmd[4]);
        break;
      case "bezier":
        ctx.bezierCurveTo(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]);
        break;
      case "close":
        ctx.closePath();
        break;
    }
  }
}

/** Build the ctx-bound `CanvasGradient` for a gradient handle. */
export function resolveGradient(ctx: SKRSContext2D, g: Gradient): ReturnType<SKRSContext2D["createLinearGradient"]> {
  const grad =
    g.kind === "linear-gradient"
      ? ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2)
      : ctx.createRadialGradient(g.x1, g.y1, g.r1, g.x2, g.y2, g.r2);
  for (const [offset, color] of g.stops) grad.addColorStop(offset, color);
  return grad;
}
