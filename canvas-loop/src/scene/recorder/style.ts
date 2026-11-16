// Checking and copying what a call receives: styles, paints, effects, group
// options and clip shapes. Everything is copied, so a sketch that changes an
// array after the call does not change the recorded scene (draft 2.2 section 6).
import { compositeOp } from "../../core/compose.js";
import { SketchUsageError, assertUnit } from "../../core/errors.js";
import type { BlendMode, ClipShape, Paint, PathCommand, Vec2 } from "../../core/paint.js";
import { isPathShape } from "../../core/paint.js";
import type { Effects, GroupOptions, Material, PlaceOptions, Style } from "../../core/tea.js";
import { UnsupportedCallError } from "../errors.js";
import type { Geom, LightingRec, PaperSettings, ShapeStyle } from "../nodes.js";
import { resolveBrushStroke } from "./brush-style.js";
import { checkPainterly, copyMaterial, resolveLighting } from "./light.js";

const STYLE_KEYS = new Set(["fill", "stroke", "weight", "brush", "gesture", "blend", "erase", "dash", "cap", "join", "material", "effects"]);

export function copyPoints(points: readonly Vec2[]): Vec2[] {
  return points.map((p): Vec2 => [p[0], p[1]]);
}

const ARITY: Record<PathCommand[0], number> = { move: 3, line: 3, quad: 5, bezier: 7, close: 1 };

/** One command, element by element (a command is a flat tuple, and structuredClone per command was most of a recording's copying cost). */
function copyCommand(c: PathCommand): PathCommand {
  // A command of the wrong length is kept whole, so `checkCommands` reports it.
  if (c.length !== ARITY[c[0]]) return structuredClone(c);
  switch (c[0]) {
    case "move":
    case "line":
      return [c[0], c[1], c[2]];
    case "quad":
      return [c[0], c[1], c[2], c[3], c[4]];
    case "bezier":
      return [c[0], c[1], c[2], c[3], c[4], c[5], c[6]];
    case "close":
      return [c[0]];
  }
}

export function copyCommands(commands: readonly PathCommand[]): PathCommand[] {
  return commands.map(copyCommand);
}

/** A paint, checked and copied. Gradients the renderer cannot draw yet are errors here, at the call. */
export function copyPaint(paint: Paint, where: string): Paint {
  if (typeof paint === "string") return paint;
  if (paint.kind === "radial-gradient" && (paint.x1 !== paint.x2 || paint.y1 !== paint.y2)) {
    throw new UnsupportedCallError({ call: `${where} radial gradient with two centres`, detail: "concentric radial gradients only" });
  }
  return structuredClone(paint);
}

// The group effect ranges (the Canvas2D painter's, kept): [key, min, max].
const RANGES: readonly (readonly [string, number, number])[] = [
  ["hue", -Infinity, Infinity], ["saturation", 0, Infinity], ["brightness", 0, Infinity], ["contrast", 0, Infinity],
  ["grayscale", 0, 1], ["sepia", 0, 1], ["invert", 0, 1], ["blur", 0, Infinity],
];
const EFFECT_KEYS = new Set([...RANGES.map(([k]) => k), "glow", "shadow", "wash", "hatching", "paper"]);

function effectError(detail: string): SketchUsageError {
  return new SketchUsageError({ detail: `group effects: ${detail}` });
}

function checkNumber(value: unknown, range: readonly [string, number, number]): void {
  const [name, min, max] = range;
  if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) return;
  const want = max === Infinity ? (min === -Infinity ? "a finite number" : `a number ≥ ${min}`) : `a number in ${min}..${max}`;
  throw effectError(`${name} must be ${want}, got ${String(value)}`);
}

function checkPart(part: object, a: { name: string; keys: readonly string[] }): void {
  for (const key of Object.keys(part)) if (!a.keys.includes(key)) throw effectError(`${a.name} has no "${key}" (${a.keys.join(", ")})`);
  const color: unknown = Reflect.get(part, "color");
  if (typeof color !== "string" || color.trim() === "") throw effectError(`${a.name}.color must be a CSS colour string`);
}

function checkEffects(effects: Effects): void {
  for (const key of Object.keys(effects)) if (!EFFECT_KEYS.has(key)) throw effectError(`unknown effect "${key}" (${[...EFFECT_KEYS].join(", ")})`);
  for (const range of RANGES) {
    const value: unknown = Reflect.get(effects, range[0]);
    if (value !== undefined) checkNumber(value, range);
  }
  const { glow, shadow } = effects;
  if (glow !== undefined) {
    checkPart(glow, { name: "glow", keys: ["blur", "color", "strength"] });
    checkNumber(glow.blur, ["glow.blur", 0, Infinity]);
    checkNumber(glow.strength ?? 2, ["glow.strength", 1, 6]);
  }
  if (shadow !== undefined) {
    checkPart(shadow, { name: "shadow", keys: ["x", "y", "blur", "color"] });
    checkNumber(shadow.x ?? 0, ["shadow.x", -Infinity, Infinity]);
    checkNumber(shadow.y ?? 0, ["shadow.y", -Infinity, Infinity]);
    checkNumber(shadow.blur ?? 0, ["shadow.blur", 0, Infinity]);
  }
}

/** Effects, checked (as today's group effects, plus the draft's new ones) and copied. */
export function copyEffects(effects: Effects | undefined, where: string): Effects | undefined {
  if (effects === undefined) return undefined;
  if (typeof effects !== "object") throw effectError(`${where}: effects must be an object`);
  checkEffects(effects);
  checkPainterly(effects);
  return structuredClone(effects);
}

/** `style.dash`, checked as the Canvas2D painter checked it, and copied; a brushed stroke cannot be dashed. */
function copyDash(style: Style, call: string): readonly number[] | undefined {
  const { dash } = style;
  if (dash === undefined) return undefined;
  const ok = Array.isArray(dash) && dash.length > 0 && dash.every((n) => Number.isFinite(n) && n >= 0) && dash.some((n) => n > 0);
  if (!ok) throw new SketchUsageError({ detail: `${call}: style.dash must be lengths ≥ 0, at least one over 0 (got ${JSON.stringify(dash)})` });
  if (style.brush !== undefined) throw new SketchUsageError({ detail: `${call}: style.dash works on plain strokes; a brushed stroke cannot be dashed, so draw each dash as its own line or curve with the brush` });
  return [...dash];
}

/** Check a draft 2.2 Style at the call and fill in its defaults. */
export function resolveStyle(style: Style, at: { call: string; paper: PaperSettings }): ShapeStyle {
  const { call } = at;
  for (const key of Object.keys(style)) {
    if (!STYLE_KEYS.has(key)) throw new SketchUsageError({ detail: `${call}: unknown style key "${key}" (${[...STYLE_KEYS].join(", ")})` });
  }
  const { weight, cap, join } = style;
  if (weight !== undefined && !(Number.isFinite(weight) && weight >= 0)) throw new SketchUsageError({ detail: `${call}: style.weight must be a number ≥ 0 (got ${String(weight)})` });
  compositeOp(style.blend ?? "normal");
  const effects = copyEffects(style.effects, call);
  const dash = copyDash(style, call);
  return {
    fill: style.fill === undefined ? undefined : copyPaint(style.fill, call),
    stroke: style.stroke === undefined ? undefined : copyPaint(style.stroke, call),
    weight: weight ?? 1,
    cap: cap ?? "butt",
    join: join ?? "miter",
    dash,
    blend: style.blend ?? "normal",
    erase: style.erase ?? false,
    effects,
    brush: resolveBrushStroke(style, at),
    material: copyMaterial(style.material, call),
    effectsPaper: effects === undefined ? undefined : at.paper,
  };
}

function clipGeom(shape: ClipShape): Geom {
  return isPathShape(shape) ? { kind: "path", commands: copyCommands(shape) } : { kind: "poly", points: copyPoints(shape), closed: true };
}

/** A list of shapes, as opposed to one shape: its first element's first element is itself an array. */
function isShapeList(shape: ClipShape | readonly ClipShape[]): shape is readonly ClipShape[] {
  return Array.isArray(shape[0]?.[0]);
}

/** A clip shape or a list of them (their union), as geometry. */
export function clipGeoms(shape: ClipShape | readonly ClipShape[]): Geom[] {
  return (isShapeList(shape) ? shape : [shape]).map((s) => clipGeom(s));
}

/** Group options, checked and copied. */
export function resolveGroup(options: GroupOptions): { name: string | undefined; opacity: number; blend: BlendMode; effects: Effects | undefined; lighting: LightingRec | undefined; clip: Geom[] | undefined } {
  const opacity = options.opacity ?? 1;
  assertUnit(opacity, "group opacity");
  const blend = options.blend ?? "normal";
  compositeOp(blend);
  return { name: options.name, opacity, blend, effects: copyEffects(options.effects, "group"), lighting: resolveLighting(options.lighting), clip: options.clip === undefined ? undefined : clipGeoms(options.clip) };
}

/** Placement options (R7), checked and copied. */
export function resolvePlace(options: PlaceOptions | undefined): { opacity: number; blend: BlendMode; erase: boolean; material: Material | undefined } {
  const o = options ?? {};
  const opacity = o.opacity ?? 1;
  assertUnit(opacity, "place opacity");
  const blend = o.blend ?? "normal";
  compositeOp(blend);
  return { opacity, blend, erase: o.erase ?? false, material: copyMaterial(o.material, "place") };
}

/** A rounded rectangle as path commands (corner arcs as quadratic curves), as today's `roundRect`. */
export function roundedRect(b: { x: number; y: number; w: number; h: number; r: number }): PathCommand[] {
  const { x, y, w, h, r } = b;
  return [
    ["move", x + r, y], ["line", x + w - r, y], ["quad", x + w, y, x + w, y + r],
    ["line", x + w, y + h - r], ["quad", x + w, y + h, x + w - r, y + h],
    ["line", x + r, y + h], ["quad", x, y + h, x, y + h - r],
    ["line", x, y + r], ["quad", x, y, x + r, y], ["close"],
  ];
}
