// The scene that one `draw` records (draft 2.3, beebox/docs/plans/canvas-loop-scene/scene-api-draft.md):
// plain data, captured by value at each call. A renderer draws it by the
// lowering contract (R1–R9). Transforms are `at` nodes; every other node's
// geometry is in the coordinates of its enclosing `at` scopes. Pictures are
// versions shared by reference between the frames that place them.
import type { Brush, Gesture } from "../core/brush/types.js";
import type { BlendMode, Paint, PathCommand, TextStyle, Vec2 } from "../core/paint.js";
import type { Effects, Light, Material } from "./api.js";

/** A 2D affine transform `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f (Canvas2D order). */
export type Mat = readonly [number, number, number, number, number, number];

/** A shape's outline as data. Round shapes stay exact here; the renderer flattens them for its pixel size. */
export type Geom =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: "ellipse"; readonly x: number; readonly y: number; readonly rx: number; readonly ry: number }
  /** Canvas2D `arc`: the fill closes the chord; the stroke is the open arc. */
  | { readonly kind: "arc"; readonly x: number; readonly y: number; readonly r: number; readonly start: number; readonly end: number }
  | { readonly kind: "poly"; readonly points: readonly Vec2[]; readonly closed: boolean }
  | { readonly kind: "path"; readonly commands: readonly PathCommand[] };

/** The paper a brushed stroke's grain bites into (R9), defaults filled in. */
export interface PaperSettings {
  readonly scale: number;
  readonly contrast: number;
  readonly seed: number;
}

/** A brushed stroke: the brush, the gesture, its blends and the paper in scope at the call. */
export interface BrushStroke {
  readonly brush: Brush;
  readonly gesture: Gesture;
  /** R1: the style's `blend` when the style sets one (including "normal"), else the brush's. */
  readonly blend: BlendMode;
  /** R2: the brush's own blend, used inside a shape's effects layer. */
  readonly own: BlendMode;
  readonly paper: PaperSettings;
}

/** A style with its defaults filled in (draft 2.3 `Style`, minus what the renderer does not draw yet). */
export interface ShapeStyle {
  readonly fill: Paint | undefined;
  readonly stroke: Paint | undefined;
  readonly weight: number;
  readonly cap: "butt" | "round" | "square";
  readonly join: "miter" | "round" | "bevel";
  /** A plain stroke's dash lengths, on, off, … (Canvas2D `setLineDash`); undefined for a solid stroke. */
  readonly dash: readonly number[] | undefined;
  readonly blend: BlendMode;
  readonly erase: boolean;
  /** R2: the shape draws into its own layer, these apply, then the layer composites with `blend` or `erase`. */
  readonly effects: Effects | undefined;
  /** The stroke is brushed (draft section 9). */
  readonly brush: BrushStroke | undefined;
  /** How the shape takes light; used only inside a lit group (R8). */
  readonly material: Material | undefined;
  /** The paper `effects.wash` and `effects.paper` use: the scope's at the call (R9); undefined without effects. */
  readonly effectsPaper: PaperSettings | undefined;
}

export interface ShapeNode {
  readonly kind: "shape";
  /** The View call that made it (`rect`, `curve`, …), for messages and outlines. */
  readonly call: string;
  readonly geom: Geom;
  readonly style: ShapeStyle;
}
/** `background(paint)`: the whole canvas, ignoring transforms, source-over onto the current target. */
export interface BackgroundNode {
  readonly kind: "background";
  readonly paint: Paint;
}
/** R3: a transform for the children; no layer. */
export interface AtNode {
  readonly kind: "at";
  readonly matrix: Mat;
  readonly children: readonly SceneNode[];
}
/** A lit group's settings (R8), defaults filled in. */
export interface LightingRec {
  /** CSS colour; its channels multiply the surface colour everywhere, before any lamp. */
  readonly ambient: string;
  readonly shadows: "none" | "hard" | "soft";
  /** Stops: the lit result is multiplied by 2^exposure before the tone curve. */
  readonly exposure: number;
  /** 0 clips at white; toward 1, the film curve (shader-light.ts `tone`). */
  readonly toneCurve: number;
}
/** The tallest a shadow caster can stand, in logical pixels (the material layer encodes heights up to it). */
export const MAX_CASTER_HEIGHT = 1024;
/** R5: the children as one isolated layer; with `lighting`, a lit group (R8). */
export interface GroupNode {
  readonly kind: "group";
  readonly name: string | undefined;
  readonly opacity: number;
  readonly blend: BlendMode;
  readonly effects: Effects | undefined;
  readonly lighting: LightingRec | undefined;
  /** A lit group whose body holds a material with `receivesShadow: false`: only it draws a third material layer. */
  readonly nonReceiving: boolean;
  /** The paper at the end of the body (R9), for `effects.wash` and `effects.paper`. */
  readonly paper: PaperSettings;
  /** The group's `clip` option (after its effects), as a union of shapes. */
  readonly clip: readonly Geom[] | undefined;
  readonly children: readonly SceneNode[];
}
/** R4: the children draw onto the current target, inside the union of `shapes`. */
export interface ClipNode {
  readonly kind: "clip";
  readonly shapes: readonly Geom[];
  readonly children: readonly SceneNode[];
}
/** R6: `body` kept in proportion to the alpha of `mask`. */
export interface MaskNode {
  readonly kind: "mask";
  readonly mask: readonly SceneNode[];
  readonly body: readonly SceneNode[];
}

/** One laid-out line: each glyph and its pen position, in the call's coordinates. */
export interface TextLine {
  readonly glyphs: readonly string[];
  readonly xs: readonly number[];
  /** Where the line's `baseline` sits. */
  readonly y: number;
}
/** `text`: measured and laid out when recorded (draft section 7); drawn through a glyph atlas. */
export interface TextNode {
  readonly kind: "text";
  readonly content: string;
  readonly family: string;
  readonly style: TextStyle;
  readonly size: number;
  /** The Canvas2D `textBaseline` each line's `y` is measured to. */
  readonly baseline: "top" | "middle" | "bottom" | "alphabetic";
  readonly lines: readonly TextLine[];
  readonly fill: Paint;
  readonly halo: { readonly paint: Paint; readonly width: number } | undefined;
  readonly blend: BlendMode;
  readonly erase: boolean;
}

/** A recorded picture (section 5): its body as nodes in its own coordinates. */
export interface PictureVersion {
  readonly kind: "picture";
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly deps: readonly unknown[] | undefined;
  /** The paper in scope where `v.picture` was called (R9), part of the version. */
  readonly paper: PaperSettings;
  readonly children: readonly SceneNode[];
}
/** A fixed-resolution image (`v.pixels`): `width × height` unpremultiplied RGBA bytes. */
export interface PixelsVersion {
  readonly kind: "pixels";
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly deps: readonly unknown[] | undefined;
  readonly data: Uint8Array;
}
/** R7: a picture replayed under the current transform plus (x, y), into its own layer. */
export interface PlaceNode {
  readonly kind: "place";
  readonly picture: PictureVersion | PixelsVersion;
  readonly x: number;
  readonly y: number;
  readonly opacity: number;
  readonly blend: BlendMode;
  readonly erase: boolean;
  /** A material for the picture's shapes that have none, inside a lit group (R8). */
  readonly material: Material | undefined;
}

/** A light with its defaults filled in, in the coordinates of its call (R8). */
export type LightRec = Required<Omit<Light, "at">> & { readonly at: Vec2 };
/** `light`: lights the nearest enclosing lit group, under the transforms and placements around it. */
export interface LightNode {
  readonly kind: "light";
  readonly light: LightRec;
}

/** `debugBox`: drawn only with `run --outline`; inside a picture it is part of the recording and moves with each placement (section 8). */
export interface DebugNode {
  readonly kind: "debug";
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type SceneNode = ShapeNode | BackgroundNode | AtNode | GroupNode | ClipNode | MaskNode | TextNode | PlaceNode | DebugNode | LightNode;

/** What one `draw` recorded: the canvas size in logical pixels and the top-level nodes. */
export interface Scene {
  readonly width: number;
  readonly height: number;
  readonly children: readonly SceneNode[];
}
