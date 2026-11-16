// The Elm-Architecture (TEA) sketch contract: the *only* module a TEA sketch
// imports. Everything here is a type — capability objects (View, Util) are
// constructed by the runtime and handed in, never imported. See TEA.md.
// Drawing-data types, re-exported (below) so a sketch, which imports only this
// module, can name them.
import type { ClipShape, ColorStop, LinearGradient, Paint, PathCommand, RadialGradient, Vec2 } from "./paint.js";
import type { Paper } from "./brush/types.js";
import type { ScaleName } from "./sound/notes.js";
import type { Voice } from "./sound/voice.js";
import type { AtOptions, Bounds, Drawing, DrawingNode, FlowOptions, GroupOptions, Light, Picture, PictureOptions, PlaceOptions, RootDrawing, Style, TextBounds, TextBox, TextOptions } from "./paint.js";

import type { TubeOptions } from "./shapes.js";
import type { EaseName, Keyframe } from "./ease.js";

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
export type { BristleBrush, Brush, BrushKind, BrushOverrides, Envelope, EnvelopePreset, Gesture, InkBrush, Paper, SmearBrush, StampBrush } from "./brush/types.js";
export type { BrushName } from "./brush/presets.js";
export type { Drawing, DrawingNode, RootDrawing } from "./paint.js";
export type { AtOptions, Bounds, BrushPreset, Effects, FlowOptions, GroupOptions, Hatching, Light, Lighting, Material, Picture, PictureOptions, PlaceOptions, Shadow, Style, TextBounds, TextBox, TextOptions, Wash } from "./paint.js";
export type { EaseName, Keyframe } from "./ease.js";
export type { TubeOptions } from "./shapes.js";
export type { NoiseVoice, NoteVoice, PluckVoice, SampleVoice, ToneVoice, Voice } from "./sound/voice.js";
export type { Instrument } from "./sound/instruments.js";
export type { SampleName } from "./sound/library/catalog.js";
export type { ScaleName } from "./sound/notes.js";

export type { TextStyle } from "./paint.js";
/** Pointer shapes for `cursor`. */
export type CursorKind = "default" | "pointer" | "grab" | "grabbing" | "crosshair" | "move" | "text" | "not-allowed";

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
/**
 * Typed text: `{ type: "text", default, placeholder?, multiline?, maxLength? }`.
 * A native text box (a textarea with `multiline`); empty is allowed. Each edit
 * arrives as a `param` msg, and a link can set it like any other param.
 */
export interface TextParam extends ParamText {
  type: "text";
  default: string;
  /** Grey words shown while the box is empty. */
  placeholder?: string;
  multiline?: boolean;
  /** The longest value accepted; the box stops typing there and a longer value is rejected. */
  maxLength?: number;
}
/** A fire-and-forget button — no value, arrives only as a `trigger` Msg. */
export interface TriggerParam extends ParamText {
  type: "trigger";
}
export type ParamDecl = NumberParam | BooleanParam | SelectParam | TextParam | TriggerParam;

/** A sketch's `params` export: a record of named parameter declarations. */
export type ParamsDecl = Record<string, ParamDecl>;

// Value type for a single declaration: number→number, boolean→boolean,
// select→the union of its options (literal when declared `as const`), text→string, and
// triggers carry no value (filtered out of ParamValues below).
type ParamValue<P extends ParamDecl> = P extends NumberParam
  ? number
  : P extends BooleanParam
    ? boolean
    : P extends SelectParam
      ? P["options"][number]
      : P extends TextParam
        ? string
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
 * Where a mouse message is, in canvas pixels, and the named drawings under it
 * in the last frame drawn before the message (none at frame 0).
 */
export interface Pointer {
  x: number;
  y: number;
  /** The innermost named drawing under the pointer (`targets[0]`), or undefined. */
  target: string | undefined;
  /** That name and the names of the named drawings around it, innermost first; empty when nothing named is under the pointer. */
  targets: readonly string[];
}

/**
 * The runtime-defined discriminated union folded through `update`. Time is a
 * message (`tick`); scripted input, parameter edits, and triggers are the rest.
 * Switch exhaustively on `msg.type`.
 */
export type Msg =
  | { type: "tick"; frame: number }
  | ({ type: "mousedown" } & Pointer)
  | ({ type: "mouseup" } & Pointer)
  | ({ type: "mousemove" } & Pointer)
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
  /**
   * The note name `step` scale steps above `root` (default "C4"; negative
   * steps go below) on `scale` (default pentatonic, which never clashes), for
   * a `note` voice: `u.scaleNote(model.count)`.
   */
  scaleNote(step: number, options?: { root?: string; scale?: ScaleName }): string;
  /**
   * The width `v.text` gives `content` with these options, measured without
   * drawing (cached), so hit areas and layout in `update` match what `draw` shows.
   */
  textWidth(content: string, options?: TextOptions): number;
  /**
   * The bounds `v.text(content, box, options)` would draw, measured without
   * drawing: wrapping, `fit` and `keepInside` included, as for text drawn
   * without a `v.at` transform.
   */
  textBounds(content: string, box: TextBox, options?: TextOptions): TextBounds;
}

/**
 * The drawing surface handed to `draw`. Each drawing call returns a node;
 * `draw` returns the frame's drawing (a node, a list, or `null`), which the
 * renderer draws; each frame starts clear. Scopes (`at`, `group`, `clip`,
 * `mask`, `paper`) take their children as a list. A node belongs to the frame
 * that made it; keep drawing across frames with `picture`. No randomness and
 * no parameter store beyond the `p` argument — `draw` cannot change the world,
 * only describe it.
 */
export interface View {
  readonly width: number;
  readonly height: number;
  /** Fill the whole canvas, ignoring transforms. */
  background(paint: Paint): DrawingNode;
  rect(x: number, y: number, w: number, h: number, style: Style): DrawingNode;
  /** A rectangle with corners rounded to `radius`. */
  roundRect(x: number, y: number, w: number, h: number, radius: number, style: Style): DrawingNode;
  /** A circle of `radius` around (x, y). Round shapes take radii: `circle`, `ellipse`, `arc`, the gradients. */
  circle(x: number, y: number, radius: number, style: Style): DrawingNode;
  /** An ellipse with radii `rx` (across) and `ry` (down) around (x, y). */
  ellipse(x: number, y: number, rx: number, ry: number, style: Style): DrawingNode;
  line(x1: number, y1: number, x2: number, y2: number, style: Style): DrawingNode;
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, style: Style): DrawingNode;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, style: Style): DrawingNode;
  /** Closed polygon through `points`. */
  polygon(points: readonly Vec2[], style: Style): DrawingNode;
  /** Render a data-encoded `PathCommand` list. */
  path(commands: readonly PathCommand[], style: Style): DrawingNode;
  /** A smooth curve through every point (Catmull-Rom). */
  curve(points: readonly Vec2[], closed: boolean, style: Style): DrawingNode;
  /** The path commands `curve` would draw, for `clip(...)` or `path(...)`. */
  curvePath(points: readonly Vec2[], closed?: boolean): PathCommand[];
  /** A tube's closed outline around a smooth centreline (limbs, stems, tails). */
  tube(points: readonly Vec2[], options: TubeOptions): PathCommand[];
  /** A closed outline grown (`distance` > 0) or shrunk (< 0) along its normals. */
  offset(points: readonly Vec2[], distance: number): Vec2[];
  /** Build a linear-gradient handle usable anywhere a `Paint` is accepted. */
  linearGradient(x1: number, y1: number, x2: number, y2: number, stops: readonly ColorStop[]): LinearGradient;
  /** Build a concentric radial-gradient handle (center→radius) usable as a `Paint`. */
  radialGradient(x: number, y: number, radius: number, stops: readonly ColorStop[]): RadialGradient;
  /** A radial gradient filling an ellipse with radii `rx` and `ry` around (x, y), like `ellipse`. */
  ellipseGradient(x: number, y: number, rx: number, ry: number, stops: readonly ColorStop[]): RadialGradient;
  /**
   * Write text at a point (`{x, y}`) or in a box (`{x, y, w, h}`: wrap, align,
   * valign, fit). Options left out take the defaults: size 12, sans-serif,
   * black, left, top. To place a label by its size, measure it first with
   * `textBounds` or `textWidth`.
   */
  text(content: string, box: TextBox, options?: TextOptions): DrawingNode;
  /** The bounds `text` would draw for these arguments where no transform moves it (inside the canvas, or the picture's box in a body). */
  textBounds(content: string, box: TextBox, options?: TextOptions): TextBounds;
  /** How wide `text` would draw with these options (logical pixels). */
  textWidth(content: string, options?: TextOptions): number;
  /** The layout box of `drawing` (any drawing of this frame), or null when it draws nothing. It does not count as returning it. */
  bounds(drawing: Drawing): Bounds | null;
  /** `children` left to right by their layout boxes, `gap` apart; one node holding each child in its own translating `at`. */
  row(options: FlowOptions, children: Drawing): DrawingNode;
  /** `children` top to bottom by their layout boxes, `gap` apart; its baseline is its first child's. */
  column(options: Omit<FlowOptions, "valign"> & { valign?: "top" | "middle" | "bottom" }, children: Drawing): DrawingNode;
  /** Transform `children` (matrix, then translate, rotate, skew, scale). No layer: they composite with their siblings. */
  at(options: AtOptions, children: Drawing): DrawingNode;
  /** `children` as one isolated layer: opacity, blend, clip, effects and lighting apply to it as a whole. */
  group(options: GroupOptions, children: Drawing): DrawingNode;
  /** Draw `children` kept where `maskArt` paints, in proportion to its alpha (a gradient mask fades them). */
  mask(maskArt: Drawing, children: Drawing): DrawingNode;
  /** A number between keyframes `[[time, value], …]` at time `t`, eased within each span. */
  tween(keys: readonly Keyframe<number>[], t: number, ease?: EaseName): number;
  /** `tween` for tuples (points, colour channels). */
  tweenPoint(keys: readonly Keyframe<readonly number[]>[], t: number, ease?: EaseName): number[];
  /** An easing curve at `u` (clamped to 0..1). */
  ease(name: EaseName, u: number): number;
  /** `children` clipped to a polygon/path, or to the union of several. */
  clip(shape: ClipShape | readonly ClipShape[], children: Drawing): DrawingNode;
  /** Record a reusable drawing (see PictureOptions): `body` returns it, and runs only when the version is new. Place it with `place`. */
  picture(options: PictureOptions, body: () => Drawing): Picture;
  /** A fixed-resolution image: `fill` writes RGBA bytes into `data` (width × height × 4, zeroed) when the version is new. */
  pixels(options: PictureOptions, fill: (image: { data: Uint8ClampedArray; width: number; height: number }) => void): Picture;
  /** A picture with its top-left at (x, y), under the transforms around it. */
  place(picture: Picture, x: number, y: number, options?: PlaceOptions): DrawingNode;
  /** The paper texture that grainy brushes and `effects.paper` read, for every drawing in `children`. A picture takes its own `paper` option instead. */
  paper(paper: Paper, children: Drawing): DrawingNode;
  /** A light, in the coordinates around it; it lights the nearest enclosing lit group. */
  light(light: Light): DrawingNode;
  /** `point` in canvas coordinates, inside the `at` scopes listed outermost first (Canvas2D `getTransform` applied to it). */
  toCanvas(point: Vec2, scopes: readonly AtOptions[]): Vec2;
  /** Seeded value noise of coordinates, 0..1: a pure function, as p5 `noise`. */
  noise(x: number, y?: number, z?: number): number;
  /** The pointer's look over the canvas in a browser figure (until changed); nothing headless. */
  cursor(kind: CursorKind): void;
  /**
   * Put param `name`'s native input over the canvas at `box` (canvas
   * coordinates in logical pixels; `at` scopes do not move it) for this frame. In a browser figure the real `<input>`/`<select>` sits
   * there and leaves the side panel; headless renders draw a stand-in showing
   * the current value. Call it every frame the input should show.
   */
  control(name: string, box: ControlBox): void;
  /** With `run --outline`, a labelled box drawn over the frame (e.g. a hit area); otherwise nothing. */
  debugBox(label: string, x: number, y: number, w: number, h: number): DrawingNode;
  log(...args: readonly unknown[]): void;
  snapshot(label?: string): void;
}

/** Optional `canvas` export: the drawing surface size (default 400×300). */
export interface CanvasSize {
  width: number;
  height: number;
}

/**
 * The shape of a TEA sketch module. Sketches don't have to name this type —
 * exporting `init`, `update`, `draw` (and optionally `params`/`canvas`) is
 * enough — and `cli run` checks the exports against it, with `M` taken from
 * `init`'s return type and `D` from `typeof params`, and each member's
 * parameters compared strictly (headless/sketch-types.ts).
 */
export interface TeaModule<D extends ParamsDecl, M> {
  params?: D;
  canvas?: CanvasSize;
  init(u: Util<D>): M;
  update(model: DeepReadonly<M>, msg: Msg, u: Util<D>): M;
  draw(v: View, model: DeepReadonly<M>, p: ParamValues<D>): RootDrawing;
  /**
   * Optional: the sounds the model holds, as voices. Called after every tick.
   * A voice is one occurrence (a new id for each new sound), starting at its
   * `at` frame, which may not be earlier than the frame that first returns it.
   */
  sound?(model: DeepReadonly<M>, p: ParamValues<D>): readonly Voice[];
  /** Optional: what the state means now, as data; added to handled events. */
  activity?(model: DeepReadonly<M>): Record<string, unknown>;
}
