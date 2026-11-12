// The Elm-Architecture (TEA) sketch contract: the *only* module a TEA sketch
// imports. Everything here is a type — capability objects (View, Util) are
// constructed by the runtime and handed in, never imported. See TEA.md.
import type { SKRSContext2D } from "@napi-rs/canvas";
// Drawing-data types shared with the mutable tier, re-exported (below) so a TEA
// sketch — which imports only this module — can name them.
import type { BlendMode, ClipShape, ColorStop, LinearGradient, Paint, PathCommand, RadialGradient, Sprite, TextStyle, Vec2 } from "./paint.js";
import type { Brush, BrushOverrides, Gesture, Paper } from "./brush/types.js";
import type { BrushName } from "./brush/presets.js";
import type { AtOptions, GroupOptions, PasteOptions, SpriteOptions, Style, TextArgs, TextBounds, TextOptions } from "./paint.js";

import type { TubeOptions } from "./shapes.js";

/** Where a param's input sits over the canvas: logical pixels; `h` defaults to the input's natural height. */
export interface ControlBox {
  x: number;
  y: number;
  w: number;
  h?: number;
  /** The input's text size in logical pixels (default 14). */
  size?: number;
  /** The input's text alignment (default left). */
  align?: "left" | "center" | "right";
  /** Bold input text. */
  bold?: boolean;
}
export type { BlendMode, ClipShape, ColorStop, Gradient, LinearGradient, Paint, PathCommand, RadialGradient, Vec2 } from "./paint.js";
export type { BristleBrush, Brush, BrushKind, BrushOverrides, Envelope, EnvelopePreset, Gesture, InkBrush, Paper, StampBrush } from "./brush/types.js";
export type { BrushName } from "./brush/presets.js";
export type { AtOptions, BrushPreset, GroupOptions, PasteOptions, SpriteOptions, Style, TextArgs, TextBounds, TextBox, TextOptions } from "./paint.js";
export type { Sprite } from "./paint.js";
export type { TubeOptions } from "./shapes.js";

// Mirror @napi-rs/canvas's (unexported) text-align unions — see sketch.ts.
export type TextAlign = "center" | "end" | "left" | "right" | "start";
export type { TextStyle } from "./paint.js";
/** Pointer shapes for `cursor`. */
export type CursorKind = "default" | "pointer" | "grab" | "grabbing" | "crosshair" | "move" | "text" | "not-allowed";
export type TextBaseline = "alphabetic" | "bottom" | "hanging" | "ideographic" | "middle" | "top";

// ── Parameter declarations ───────────────────────────────────────────
/**
 * A number: `{ type: "number", min, max, default, step?, control? }`. Shown as a
 * slider, or with `control: "field"` as a box the person types into (only a
 * valid, in-range value is sent; `step: 1` also requires a whole number).
 */
/** Words for a param's control: a human `label` (default: the param's name) and a short `hint` shown with it. */
export interface ParamText {
  label?: string;
  hint?: string;
  /** `false`: no input in the side panel; the param shows only where `v.control` places it. */
  panel?: boolean;
}
export interface NumberParam extends ParamText {
  type: "number";
  min: number;
  max: number;
  default: number;
  step?: number;
  control?: "slider" | "field";
}
/** A boolean toggle: `{ type: "boolean", default }`. */
export interface BooleanParam extends ParamText {
  type: "boolean";
  default: boolean;
}
/** A choice from a fixed list: `{ type: "select", options, default }`. */
export interface SelectParam extends ParamText {
  type: "select";
  options: readonly string[];
  default: string;
}
/** A fire-and-forget button — no value, arrives only as a `trigger` Msg. */
export interface TriggerParam extends ParamText {
  type: "trigger";
}
export type ParamDecl = NumberParam | BooleanParam | SelectParam | TriggerParam;

/** A sketch's `params` export: a record of named parameter declarations. */
export type ParamsDecl = Record<string, ParamDecl>;

// Value type for a single declaration: number→number, boolean→boolean,
// select→the union of its options (literal when declared `as const`), and
// triggers carry no value (filtered out of ParamValues below).
type ParamValue<P extends ParamDecl> = P extends NumberParam
  ? number
  : P extends BooleanParam
    ? boolean
    : P extends SelectParam
      ? P["options"][number]
      : never;

/**
 * The resolved parameter values a sketch reads: `u.params` in `update` and the
 * `p` argument to `draw`. Triggers are omitted (they have no value); a select
 * declared `as const` narrows to the union of its options.
 */
export type ParamValues<D extends ParamsDecl> = {
  [K in keyof D as D[K] extends TriggerParam ? never : K]: ParamValue<D[K]>;
};

// ── Deep readonly ────────────────────────────────────────────────────
/** Recursively `readonly` — the Model type `update`/`draw` see, so mutation is a compile error. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? number extends T["length"]
      ? ReadonlyArray<DeepReadonly<T[number]>>
      : { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

// ── Messages ─────────────────────────────────────────────────────────
/**
 * The runtime-defined discriminated union folded through `update`. Time is a
 * message (`tick`); scripted input, parameter edits, and triggers are the rest.
 * Switch exhaustively on `msg.type`.
 */
export type Msg =
  | { type: "tick"; frame: number }
  | { type: "mousedown"; x: number; y: number }
  | { type: "mouseup"; x: number; y: number }
  | { type: "mousemove"; x: number; y: number }
  | { type: "keydown"; key: string }
  | { type: "keyup"; key: string }
  | { type: "param"; name: string; value: number | boolean | string }
  | { type: "trigger"; name: string };

// ── Injected capabilities ────────────────────────────────────────────
/**
 * The capability object handed to `init` and `update`: seeded randomness, the
 * resolved parameter values, and `log`. No drawing — `update` cannot paint.
 */
export interface Util<D extends ParamsDecl = ParamsDecl> {
  /** Seeded random in [0, 1) — or scaled to [0, max) / [min, max). */
  random(): number;
  random(max: number): number;
  random(min: number, max: number): number;
  /** Seeded uniform pick from a non-empty array. */
  randomChoice<T>(items: readonly T[]): T;
  /** Current resolved parameter values. */
  readonly params: ParamValues<D>;
  /** Frame-tagged log line into the transcript. */
  log(...args: readonly unknown[]): void;
  /**
   * Acknowledge that this dispatch engaged with a name — the input's engagement
   * verdict in the transcript. Callable multiple times per dispatch; names
   * accumulate (joined by ", "). Distinct from both "code ran" and "state
   * changed": a tick changes everything and handles nothing; an absorbed click
   * handles and may change nothing. See TEA.md "Engagement verdicts".
   */
  handled(name: string): void;
  /** A record with one entry per key: `u.record(IDS, () => 0)` gives `Record<Id, number>`. */
  record<K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V>;
}

/**
 * The drawing surface handed to `draw`: the p5-like subset plus `log`,
 * `snapshot`, and the raw `ctx` escape hatch. No randomness and no parameter
 * store beyond the `p` argument — `draw` cannot change the world, only render it.
 */
export interface View {
  readonly width: number;
  readonly height: number;
  background(paint: Paint): void;
  fill(paint: Paint): void;
  noFill(): void;
  stroke(paint: Paint): void;
  noStroke(): void;
  strokeWeight(weight: number): void;
  rect(x: number, y: number, w: number, h: number, style?: number | Style): void;
  /** A rectangle with corners rounded to `radius`. */
  roundRect(x: number, y: number, w: number, h: number, radius: number, style: Style): void;
  circle(x: number, y: number, diameter: number, style?: Style): void;
  ellipse(x: number, y: number, w: number, h: number, style?: Style): void;
  line(x1: number, y1: number, x2: number, y2: number, style?: Style): void;
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, style?: Style): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, style?: Style): void;
  /** Closed polygon through `points`. */
  polygon(points: readonly Vec2[], style?: Style): void;
  /** Render a data-encoded `PathCommand` list. */
  path(commands: readonly PathCommand[], style?: Style): void;
  /** Build a linear-gradient handle usable anywhere a `Paint` is accepted. */
  linearGradient(x1: number, y1: number, x2: number, y2: number, stops: readonly ColorStop[]): LinearGradient;
  /** Build a concentric radial-gradient handle (center→radius) usable as a `Paint`. */
  radialGradient(x: number, y: number, radius: number, stops: readonly ColorStop[]): RadialGradient;
  /** A radial gradient filling an ellipse of width `w` and height `h` around (x, y), like `ellipse`. */
  ellipseGradient(x: number, y: number, w: number, h: number, stops: readonly ColorStop[]): RadialGradient;
  /** Clip to a polygon/path, or to the union of several, for the duration of `body`. */
  clip(shape: ClipShape | readonly ClipShape[], body: () => void): void;
  /** A smooth curve through every point (Catmull-Rom, like p5's curveVertex). */
  curve(points: readonly Vec2[], closed?: boolean, style?: Style): void;
  /** The path commands `curve` would draw, for `clip(...)` or `path(...)`. */
  curvePath(points: readonly Vec2[], closed?: boolean): PathCommand[];
  /** A tube's closed outline around a smooth centreline (limbs, stems, tails). */
  tube(points: readonly Vec2[], options: TubeOptions): PathCommand[];
  /** A closed outline grown (`distance` > 0) or shrunk (< 0) along its normals. */
  offset(points: readonly Vec2[], distance: number): Vec2[];
  /** Show the paper's texture across everything drawn so far (0..1). */
  paperTexture(amount: number): void;
  /** Draw `body` once into a stored layer; later calls with the same key paste it (with `paste`'s blend or erase). */
  cache(key: string, body: () => void, paste?: { blend?: BlendMode; erase?: boolean }): void;
  /** A picture drawn once in its own coordinates and kept under `options.key`; place it with `image`. */
  sprite(options: SpriteOptions, body: () => void): Sprite;
  /** Draw a sprite with its top-left at (x, y) under the current transform, with paste options. */
  image(sprite: Sprite, x: number, y: number, paste?: number | PasteOptions): void;
  /** A preset brush with some fields changed, for a style's `brush`. */
  brushOf(base: BrushName, overrides: BrushOverrides): Brush;
  /** Draw `body` translated, rotated, then scaled; the transform ends with `body`. */
  at(options: AtOptions, body: () => void): void;
  /** Strokes from now on are brushed marks (a preset name with overrides, or a Brush). */
  brush(base: BrushName | Brush, overrides?: BrushOverrides): void;
  /** Back to plain Canvas2D strokes. */
  noBrush(): void;
  /** How the hand moves for the marks that follow: pressure, wobble, seed. */
  gesture(gesture: Gesture): void;
  /** The canvas's paper texture, which grainy brushes read. */
  paper(paper: Paper): void;
  /** Draw `body` on its own layer, then composite it once with opacity and blend. */
  group(options: GroupOptions, body: () => void): void;
  blendMode(blend: BlendMode): void;
  /** Fills, strokes and marks remove pixels until `noErase()`. */
  erase(): void;
  noErase(): void;
  /**
   * `text(s, x, y)` writes at a point with the current alignment.
   * `text(s, {x, y, w?, h?}, {align, valign, wrap, fit, lineHeight, size, font, style, fill})`
   * lays out in a box (or about a point when `w`/`h` are absent) with per-call
   * style that leaves the current settings alone. Both return the bounds drawn.
   */
  text(...args: TextArgs): TextBounds;
  textSize(size: number): void;
  /** How wide `text` would draw with these options (logical pixels). */
  textWidth(content: string, options?: TextOptions): number;
  /** Font family for `text` (CSS names, e.g. `"Georgia, serif"`); which fonts exist depends on the machine. */
  textFont(family: string): void;
  textStyle(style: TextStyle): void;
  /** The pointer's look over the canvas in a browser figure (until changed); nothing headless. */
  cursor(kind: CursorKind): void;
  /**
   * Put param `name`'s native input over the canvas at `box` (logical pixels)
   * for this frame. In a browser figure the real `<input>`/`<select>` sits
   * there and leaves the side panel; headless renders draw a stand-in showing
   * the current value. Call it every frame the input should show.
   */
  control(name: string, box: ControlBox): void;
  /** With `run --outline`, a labelled box drawn over the frame (e.g. a hit area); otherwise nothing. */
  debugBox(label: string, x: number, y: number, w: number, h: number): void;
  textAlign(horizontal: TextAlign, vertical?: TextBaseline): void;
  push(): void;
  pop(): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  scale(x: number, y?: number): void;
  log(...args: readonly unknown[]): void;
  snapshot(label?: string): void;
  readonly ctx: SKRSContext2D;
}

/** Optional `canvas` export: the drawing surface size (default 400×300). */
export interface CanvasSize {
  width: number;
  height: number;
}

/**
 * The shape of a TEA sketch module. Sketches don't have to name this type —
 * exporting `init`, `update`, `draw` (and optionally `params`/`canvas`) is
 * enough — but `satisfies TeaModule<typeof params, Model>` type-checks the whole
 * contract.
 */
export interface TeaModule<D extends ParamsDecl, M> {
  params?: D;
  canvas?: CanvasSize;
  init(u: Util<D>): M;
  update(model: DeepReadonly<M>, msg: Msg, u: Util<D>): M;
  draw(v: View, model: DeepReadonly<M>, p: ParamValues<D>): void;
}
