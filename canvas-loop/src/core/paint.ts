// The drawing-data types of the View: styles, effects, light, pictures, text
// options. Everything here is DATA, not calls on a live context: point arrays,
// a tagged path mini-language, and gradient handles, which the scene recorder
// copies at the call.

import type { BrushName } from "./brush/presets.js";
import type { BlendMode, Effects } from "./compose.js";
import type { Brush, BrushOverrides, Gesture, Paper } from "./brush/types.js";

export { BLEND_MODES, compositeOp } from "./compose.js";
export type { BlendMode, Effects, Hatching, Shadow, Wash } from "./compose.js";

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
  /** The text floats over the drawing on purpose (a tooltip, a hover hint, a dragged label): the overlap check skips it. Drawing is unchanged. */
  overlay?: boolean;
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
 * A drawing's layout box (`v.bounds`), in the coordinates where it is
 * returned: shape geometry plus half the stroke, text's line boxes, a placed
 * picture's declared size. `baseline` is the first text's alphabetic baseline
 * y, or null when it holds no text or a rotation or skew moves it.
 */
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
  baseline: number | null;
}

/**
 * Where `v.row` and `v.column` put their children: in order, `gap` apart,
 * about (x, y) (default 0, 0). In a row, `align` places the whole row about
 * `x` and `valign` lines each child up at `y`; in a column, `align` lines each
 * child up at `x` and `valign` places the whole column about `y`.
 */
export interface FlowOptions {
  readonly x?: number;
  readonly y?: number;
  readonly gap?: number;
  readonly align?: "left" | "center" | "right";
  /** "baseline" (rows only): each child's first text baseline on `y`; a child with none by its bottom. */
  readonly valign?: "top" | "middle" | "bottom" | "baseline";
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
  /** Line ends of a plain stroke, as Canvas2D `lineCap`. */
  readonly cap?: "butt" | "round" | "square";
  /** Corners of a plain stroke, as Canvas2D `lineJoin`. */
  readonly join?: "miter" | "round" | "bevel";
  /** How the shape takes light (only inside a lit group). */
  readonly material?: Material;
  /** Effects on this shape alone: it draws into its own layer, the effects apply, then the layer composites with `blend` or `erase`. */
  readonly effects?: Effects;
}

/** A brush preset with some fields changed, as plain data. */
export type BrushPreset = { readonly preset: BrushName } & BrushOverrides;

/** A transform scope for `at`: applied as matrix, then translate, rotate, skew, scale. */
export interface AtOptions {
  readonly translate?: readonly [number, number];
  readonly rotate?: number;
  readonly scale?: number | readonly [number, number];
  /** Shear angles in radians, `[x, y]`, as CSS `skew()`. */
  readonly skew?: readonly [number, number];
  /** `[a, b, c, d, e, f]` as Canvas2D `transform()` and CSS `matrix()`. */
  readonly matrix?: readonly [number, number, number, number, number, number];
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

/** A radial gradient filling an ellipse with radii `rx` and `ry` around (x, y), like `ellipse`. */
export function ellipseGradient(...args: [number, number, number, number, readonly ColorStop[]]): RadialGradient {
  const [x, y, rx, ry, stops] = args;
  return { kind: "radial-gradient", x1: x, y1: y, r1: 0, x2: x, y2: y, r2: rx, scaleY: ry / rx, stops };
}

/** Options for `group`: opacity applied once to the finished group, its blend mode, clip, effects and lighting. */
export interface GroupOptions {
  /** Names the group in warnings, scene outlines and diffs; draws nothing. */
  readonly name?: string;
  readonly opacity?: number;
  readonly blend?: BlendMode;
  readonly effects?: Effects;
  readonly lighting?: Lighting;
  /** Clip the group's drawing (applied after its effects, as CSS `clip-path`). */
  readonly clip?: ClipShape | readonly ClipShape[];
}

// ── Light ────────────────────────────────────────────────────────────

/** How a surface takes light. Without one, a shape in a lit group is flat matte. */
export interface Material {
  /** Rounded edges, in logical pixels: the surface bends away near the outline (0 = flat). */
  readonly bevel?: number;
  /** How far the surface rises from the page, 0..1; with `bevel` it shapes the normals. */
  readonly relief?: number;
  /** Highlights, 0..1. */
  readonly shine?: number;
  /** Glows by itself: lights don't darken it (screens, lamps), 0..1. */
  readonly emissive?: number;
  /**
   * Blocks light, casting a 2D shadow. `true` stands 32 logical pixels above
   * the page; a number is the caster's height (0..1024), so a taller caster
   * casts a longer shadow, and a lower light a longer one still. A pixel on a
   * caster sits at its height: only taller casters shadow it.
   */
  readonly castsShadow?: boolean | number;
  /**
   * `false`: no light's shadow falls on this shape, for a backdrop in a side
   * view (a sky behind a figure). It is still lit, and still casts if it has
   * `castsShadow`. Default `true`.
   */
  readonly receivesShadow?: boolean;
}

export interface Light {
  readonly kind: "point" | "spot" | "directional";
  /** Position (point, spot) in the current coordinates. */
  readonly at?: Vec2;
  /** Height above the picture plane in logical pixels: higher gives a wider, softer pool and shorter shadows; low lights rake across relief. */
  readonly height?: number;
  readonly color?: string;
  /** Brightness, 0.. (1 is a normal lamp). */
  readonly energy?: number;
  /** Distance where it fades out, logical pixels. */
  readonly reach?: number;
  /** Spot and directional: the direction it points, radians from +x, clockwise (y down), as `arc`. */
  readonly direction?: number;
  /** Spot: half-angle of the cone, radians. */
  readonly cone?: number;
}

/** A group with `lighting` lights everything inside it with its lights. */
export interface Lighting {
  /** The light everywhere, before any lamp (default a dim neutral). */
  readonly ambient?: string;
  /** Soft or hard shadows from `castsShadow` shapes. */
  readonly shadows?: "none" | "hard" | "soft";
  /** Brightness of the lit result in stops (default 0): +1 doubles the light, −1 halves it. */
  readonly exposure?: number;
  /**
   * How light maps to colour, 0..1 (default 0: lit colour clips at white).
   * Toward 1, a film-like curve: shadows go deeper and highlights roll off
   * softly instead of clipping. Middle tones stay about where they were.
   */
  readonly toneCurve?: number;
}

// ── Drawings ─────────────────────────────────────────────────────────

/** The key under which a drawing node keeps the frame that made it; a node from an earlier frame is refused. */
export const MADE_IN: unique symbol = Symbol("canvas-loop frame");

/** What a drawing call returns: one node of this frame's drawing, opaque to the sketch. Return it from `draw`, or put it in a scope's children. */
export interface DrawingNode {
  readonly [MADE_IN]: object;
}

/** A scope's children, or a component's result: a node, a list (nested lists are flattened), or `null`, `undefined` or `false` for nothing. */
export type Drawing = DrawingNode | readonly Drawing[] | null | undefined | false;

/** What `draw` returns: a `Drawing`, but not `undefined`, so a `draw` that forgets to return its drawing is an error. */
export type RootDrawing = DrawingNode | readonly Drawing[] | null | false;

// ── Pictures ─────────────────────────────────────────────────────────

/** A reusable drawing, recorded once and placed any number of times. */
export interface Picture {
  readonly pictureBrand: never;
  readonly width: number;
  readonly height: number;
}

export interface PictureOptions {
  /** With width, height and deps, identifies a version; an existing version is reused without running `body`. */
  readonly key: string;
  /** Everything the body reads that can change. Omitted: never changes. Testing mode re-records to catch missing deps. */
  readonly deps?: readonly unknown[];
  /** The picture's layout box (0..width, 0..height); drawing outside it is kept. */
  readonly width: number;
  readonly height: number;
  /** The paper its brushed strokes and effects use (part of the version); default the default paper. A picture never takes the paper of where it is placed. */
  readonly paper?: Paper;
}

export interface PlaceOptions {
  /** A material for the picture's shapes that have none (used only inside a lit group). */
  readonly material?: Material;
  readonly opacity?: number;
  readonly blend?: BlendMode;
  readonly erase?: boolean;
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
