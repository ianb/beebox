// Shared drawing-data types for the View and the Painter. Everything here is DATA, not calls on a live context: point
// arrays, a tagged path mini-language, and gradient handles. That keeps the
// surface serializable-in-principle — a later browser renderer could emit these
// as JSON draw commands — and keeps live `CanvasGradient`/`Path2D` objects from
// leaking into sketch code. The `trace*`/`resolveGradient` helpers below are the
// one place those data forms are turned into ctx calls; the engine calls them.

import type { BrushName } from "./brush/presets.js";
import type { Brush, BrushOverrides, Gesture } from "./brush/types.js";

// ── Structural 2D-context subset ─────────────────────────────────────
// The drawing engine (paint.ts helpers + Painter) is typed against this
// structural subset rather than a concrete `SKRSContext2D`/`CanvasRenderingContext2D`.
// Both the headless Skia context and the browser's DOM context satisfy it, so one
// drawing implementation serves both the CLI and the browser harness. The two
// concrete contexts are handed in through a single boundary cast each (their
// `fillStyle` unions are wider — they include `CanvasPattern` — so structural
// assignability doesn't hold, but every method/property the engine touches is
// shared and behaves identically).

/** Text weight and slant, as p5's `textStyle`. */
export type TextStyle = "normal" | "italic" | "bold" | "bold italic";

/**
 * Where `text` writes. Without `w`, `align` places the text about `x`; without
 * `h`, `valign` places it about `y`. With `w`, lines wrap to it.
 */
export interface TextBox {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/** How `text` lays out and styles one call. Keys left out take the defaults: size 12, sans-serif, normal, black, left, top. */
export interface TextOptions {
  align?: "left" | "center" | "right";
  /** Default "top". "baseline": `y` is the first line's alphabetic baseline. */
  valign?: "top" | "middle" | "bottom" | "baseline";
  /** Wrap at word breaks to the box width (default: on when `w` is set). */
  wrap?: boolean;
  /** Shrink the size until the text fits the box (never grows it). */
  fit?: boolean;
  /** Line spacing as a multiple of the size (default 1.25). */
  lineHeight?: number;
  size?: number;
  font?: string;
  style?: TextStyle;
  /** Default black. */
  fill?: Paint;
  /** Slide the text back inside the canvas (4px margin) when it would cross an edge; alignment holds otherwise. */
  keepInside?: boolean;
  /** A band of this color around the letters, drawn under them, so text reads over lines and busy ground. */
  halo?: Paint;
  blend?: BlendMode;
  erase?: boolean;
}

/** What `text` drew: the ink box in logical pixels, the line count, and the size used. */
export interface TextBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: number;
  size: number;
  /** True when the text overflows the box at that size. */
  overflow: boolean;
}

/**
 * How one drawing call paints: plain data, held in variables and spread to
 * vary (`{ ...ink, stroke: "red" }`). A key left out means none (no fill, no
 * stroke, no brush) or the default (weight 1, blend "normal").
 */
export interface Style {
  readonly fill?: Paint;
  readonly stroke?: Paint;
  /** Stroke width in logical pixels (default 1). */
  readonly weight?: number;
  /** Strokes become brushed marks: a preset name, a preset with fields changed (`{ preset: "pencil", opacity: 0.6 }`), or a Brush. */
  readonly brush?: BrushName | BrushPreset | Brush;
  /** How the hand moves for brushed marks (pressure, wobble, seed). */
  readonly gesture?: Gesture;
  readonly blend?: BlendMode;
  /** Remove pixels instead of adding them. */
  readonly erase?: boolean;
  /** Dash a plain stroke: lengths on, off, on, … in logical pixels (`[6, 4]`). Brushed strokes cannot be dashed. */
  readonly dash?: readonly number[];
}

/** A brush preset with some fields changed, as plain data. */
export type BrushPreset = { readonly preset: BrushName } & BrushOverrides;

/** How `image` pastes a sprite. */
export interface PasteOptions {
  readonly opacity?: number;
  readonly blend?: BlendMode;
  readonly erase?: boolean;
}

/** A transform scope for `at`: applied as translate, then rotate, then scale. */
export interface AtOptions {
  readonly translate?: readonly [number, number];
  readonly rotate?: number;
  readonly scale?: number | readonly [number, number];
}

/** Horizontal text alignment — mirrors the (unexported) `CanvasTextAlign`. */
export type CtxTextAlign = "center" | "end" | "left" | "right" | "start";
/** Text baseline — mirrors the (unexported) `CanvasTextBaseline`. */
export type CtxTextBaseline = "alphabetic" | "bottom" | "hanging" | "ideographic" | "middle" | "top";

/** A gradient handle as both contexts expose it — the one shared method is `addColorStop`. */
export interface Ctx2DGradient {
  addColorStop(offset: number, color: string): void;
}

/**
 * An offscreen surface's image, as `drawImage` accepts it. Opaque: each runtime
 * hands its real canvas through one boundary cast in its `makeLayer` factory.
 */
export interface LayerImage {
  readonly layerImageBrand: never;
}

/** An offscreen drawing surface: a context to draw on and the image to composite. */
export interface Layer {
  readonly ctx: Ctx2D;
  readonly image: LayerImage;
}

/** Make an offscreen layer of the given device-pixel size (runtime-specific). */
export type MakeLayer = (size: { width: number; height: number }) => Layer;

/** A 2D affine transform, `[a b c d e f]` as Canvas2D reports it. */
export interface CtxTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/** Pixel data from `createImageData`. */
export interface CtxImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** The exact 2D-context surface the drawing engine uses. */
export interface Ctx2D {
  fillStyle: string | Ctx2DGradient;
  strokeStyle: string | Ctx2DGradient;
  lineWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "bevel" | "miter" | "round";
  globalAlpha: number;
  globalCompositeOperation: string;
  font: string;
  textAlign: CtxTextAlign;
  textBaseline: CtxTextBaseline;
  save(): void;
  restore(): void;
  resetTransform(): void;
  getTransform(): CtxTransform;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(image: LayerImage, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  createImageData(width: number, height: number): CtxImageData;
  getImageData(x: number, y: number, w: number, h: number): CtxImageData;
  putImageData(imageData: CtxImageData, dx: number, dy: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, startAngle: number, endAngle: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  setLineDash(segments: number[]): void;
  measureText(text: string): { readonly width: number };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): Ctx2DGradient;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Ctx2DGradient;
}

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

/**
 * How drawn pixels combine with what is already there. `"normal"` is Canvas2D's
 * `source-over`; the rest are Canvas2D composite modes that Skia and browsers share.
 */
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "soft-light"
  | "hard-light"
  | "color-dodge"
  | "color-burn";

/** The Canvas2D `globalCompositeOperation` value for a blend mode. */
export function compositeOp(blend: BlendMode): string {
  return blend === "normal" ? "source-over" : blend;
}

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
  /** Vertical squash about the centre (height ÷ width); absent means circular. */
  readonly scaleY?: number;
  readonly stops: readonly ColorStop[];
}

/** A linear gradient from (x1, y1) to (x2, y2). */
export function linearGradient(...args: [number, number, number, number, readonly ColorStop[]]): LinearGradient {
  const [x1, y1, x2, y2, stops] = args;
  return { kind: "linear-gradient", x1, y1, x2, y2, stops };
}

/** A circular radial gradient around (x, y). */
export function radialGradient(...args: [number, number, number, readonly ColorStop[]]): RadialGradient {
  const [x, y, radius, stops] = args;
  return { kind: "radial-gradient", x1: x, y1: y, r1: 0, x2: x, y2: y, r2: radius, stops };
}

/** A radial gradient filling an ellipse of width `w` and height `h` around (x, y), like `ellipse`. */
export function ellipseGradient(...args: [number, number, number, number, readonly ColorStop[]]): RadialGradient {
  const [x, y, w, h, stops] = args;
  return { kind: "radial-gradient", x1: x, y1: y, r1: 0, x2: x, y2: y, r2: w / 2, scaleY: h / w, stops };
}

/** A sprite handle from `sprite(...)`: plain data naming a stored picture; draw it with `image`. */
export interface Sprite {
  readonly kind: "sprite";
  readonly key: string;
  readonly width: number;
  readonly height: number;
}

/** What `sprite` stores: a key naming everything the picture depends on, and its size in pixels. */
export interface SpriteOptions {
  readonly key: string;
  readonly width: number;
  readonly height: number;
}

/** Options for `group`: opacity applied once to the finished group, and its blend mode. */
export interface GroupOptions {
  readonly opacity?: number;
  readonly blend?: BlendMode;
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
export function tracePolygon(ctx: Ctx2D, points: readonly Vec2[]): void {
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
export function tracePath(ctx: Ctx2D, commands: readonly PathCommand[]): void {
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

/**
 * Run a fill in the paint's own space. An elliptical radial gradient is a
 * circular one under a vertical scale about its centre; Canvas2D reads a
 * gradient in the transform current at fill time, while the path was already
 * traced, so only the gradient is squashed. Only fills use this: a stroke
 * would squash its line width too.
 */
/** Run `body` between `ctx.save()` and `ctx.restore()`; the restore runs even if `body` throws. */
export function withSaved<T>(ctx: Ctx2D, body: () => T): T {
  ctx.save();
  try {
    return body();
  } finally {
    ctx.restore();
  }
}

export function inPaintSpace(ctx: Ctx2D, args: { paint: Paint | string | Ctx2DGradient; fill: () => void }): void {
  const { paint } = args;
  if (typeof paint === "string" || !("kind" in paint) || paint.kind !== "radial-gradient" || paint.scaleY === undefined) {
    args.fill();
    return;
  }
  const { x2, y2, scaleY } = paint;
  withSaved(ctx, () => {
    ctx.translate(x2, y2);
    ctx.scale(1, scaleY);
    ctx.translate(-x2, -y2);
    args.fill();
  });
}

/** Build the ctx-bound gradient for a gradient handle. */
export function resolveGradient(ctx: Ctx2D, g: Gradient): Ctx2DGradient {
  const grad =
    g.kind === "linear-gradient"
      ? ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2)
      : ctx.createRadialGradient(g.x1, g.y1, g.r1, g.x2, g.y2, g.r2);
  for (const [offset, color] of g.stops) grad.addColorStop(offset, color);
  return grad;
}
