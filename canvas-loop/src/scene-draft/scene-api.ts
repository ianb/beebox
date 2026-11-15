// Stage 1 draft of the scene API (beebox/docs/plans/canvas-loop-scene.md).
// Types only: nothing here runs. It is today's View with the changes the draft
// proposes, so the example sketches beside it type-check. Read it as a diff:
// what is removed from today's View, what changes, what is new.
import type { BlendMode, Effects as EffectsToday, GroupOptions as GroupToday, Paint, Style as StyleToday, Vec2 } from "../core/paint.js";
import type { View as ViewToday } from "../core/tea.js";

// Everything a sketch needs comes from this module (draft 2.2).
export type { BrushPreset, TextOptions } from "../core/paint.js";
export type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util } from "../core/tea.js";

// --- Transforms ------------------------------------------------------------------------

/** `at` gains skew and a full matrix (replaces `v.ctx.transform`). Applied as
 * matrix, then translate, rotate, skew, scale. */
export interface AtOptions {
  readonly translate?: readonly [number, number];
  readonly rotate?: number;
  readonly scale?: number | readonly [number, number];
  /** Shear angles in radians, `[x, y]`, as CSS `skew()`. */
  readonly skew?: readonly [number, number];
  /** `[a, b, c, d, e, f]` as Canvas2D `transform()` and CSS `matrix()`. */
  readonly matrix?: readonly [number, number, number, number, number, number];
}

// --- Effects ---------------------------------------------------------------------------

/** Watercolour wash over what the group drew (Bousseau et al. 2006). */
export interface Wash {
  /** Pigment settling into the paper's valleys, 0..1. */
  readonly granulate?: number;
  /** Darker pigment where colours meet, 0..1. */
  readonly edges?: number;
  /** Blotchy pigment density, 0..1. */
  readonly blotch?: number;
  /** Edges wander, in logical pixels. */
  readonly bleed?: number;
}
/** Pencil hatching revealed by darkness (Praun et al. 2001). */
export interface Hatching {
  /** Hatch strength, 0..1. */
  readonly amount: number;
  /** Line angle in radians (default π/4); a second layer crosses it in the darkest tones. */
  readonly angle?: number;
  /** Line spacing in logical pixels (default 4.5). */
  readonly spacing?: number;
  readonly color?: string;
}
/**
 * Effects on a group, applied in this fixed order (draft 2, R5): colour
 * adjustments, blur, wash, hatching, paper; then glow and shadow are drawn
 * beneath the result. Lengths are in the coordinates where the group is
 * called. For another order, nest groups.
 */
export interface Effects extends EffectsToday {
  readonly wash?: Wash;
  readonly hatching?: Hatching;
  /** Paper texture over what the group drew, only where it drew, 0..1 (replaces `v.paperTexture`). */
  readonly paper?: number;
}

// --- Light -----------------------------------------------------------------------------

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
  /** Blocks light from lights behind it, casting a 2D shadow. */
  readonly castsShadow?: boolean;
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
}

// --- Styles and groups ----------------------------------------------------------------

export interface Style extends StyleToday {
  /** Line ends of a plain stroke, as Canvas2D `lineCap`. */
  readonly cap?: "butt" | "round" | "square";
  /** Corners of a plain stroke, as Canvas2D `lineJoin`. */
  readonly join?: "miter" | "round" | "bevel";
  /** How the shape takes light (only inside a lit group). */
  readonly material?: Material;
  /** Effects on this shape alone: it draws into its own layer, the effects apply, then the layer composites with `blend` or `erase` (draft 2.1, R2). */
  readonly effects?: Effects;
}

export interface GroupOptions extends Omit<GroupToday, "effects"> {
  /** Names the group in warnings, scene outlines and diffs; draws nothing. */
  readonly name?: string;
  readonly effects?: Effects;
  readonly lighting?: Lighting;
  /** Clip the group's drawing (applied after its effects, as CSS `clip-path`). */
  readonly clip?: ViewToday extends { clip(shape: infer S, body: () => void): void } ? S : never;
}

// --- Pictures (replace cache and sprite) ------------------------------------------------

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
}
export interface PlaceOptions {
  /** A material for the picture's shapes that have none (used only inside a lit group). */
  readonly material?: Material;
  readonly opacity?: number;
  readonly blend?: BlendMode;
  readonly erase?: boolean;
}

// --- The view --------------------------------------------------------------------------

type Removed = "ctx" | "cache" | "sprite" | "image" | "paperTexture" | "at" | "group" | keyof DrawingCalls;
type DrawingCalls = Pick<ViewToday, "rect" | "roundRect" | "circle" | "ellipse" | "line" | "triangle" | "arc" | "polygon" | "path" | "curve">;

export interface View extends Omit<ViewToday, Removed> {
  rect(x: number, y: number, w: number, h: number, style: Style): void;
  roundRect(x: number, y: number, w: number, h: number, radius: number, style: Style): void;
  circle(x: number, y: number, radius: number, style: Style): void;
  ellipse(x: number, y: number, rx: number, ry: number, style: Style): void;
  line(x1: number, y1: number, x2: number, y2: number, style: Style): void;
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, style: Style): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, style: Style): void;
  polygon(points: readonly Vec2[], style: Style): void;
  path(commands: Parameters<ViewToday["path"]>[0], style: Style): void;
  curve(points: readonly Vec2[], closed: boolean, style: Style): void;
  /** Transform `body`. No layer: what it draws composites with its siblings. */
  at(options: AtOptions, body: () => void): void;
  /** `body` as one isolated layer: opacity, blend, clip, effects and lighting apply to it as a whole. */
  group(options: GroupOptions, body: () => void): void;
  /** Record a reusable drawing (see PictureOptions); place it with `place`. */
  picture(options: PictureOptions, body: () => void): Picture;
  /** A fixed-resolution image: `fill` writes RGBA bytes into `data` (width × height × 4, zeroed) when the version is new. */
  pixels(options: PictureOptions, fill: (image: { data: Uint8ClampedArray; width: number; height: number }) => void): Picture;
  /** Draw a picture with its top-left at (x, y) under the current transform. */
  place(picture: Picture, x: number, y: number, options?: PlaceOptions): void;
  /** A light, in the current coordinates; it lights the nearest enclosing lit group. */
  light(light: Light): void;
  /** A point in canvas coordinates under the current transform (Canvas2D `getTransform` applied to it). */
  toCanvas(point: Vec2): Vec2;
  /** Seeded value noise of coordinates, 0..1: a pure function, as p5 `noise`. */
  noise(x: number, y?: number, z?: number): number;
}

export type { Paint, Vec2 };
