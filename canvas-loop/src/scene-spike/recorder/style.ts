// Checking and copying what a call receives: styles, paints, effects, group
// options and clip shapes. Everything is copied, so a sketch that changes an
// array after the call does not change the recorded scene (draft 2.2 section 6).
import { compositeOp } from "../../core/compose.js";
import { SketchUsageError, assertUnit } from "../../core/errors.js";
import type { BlendMode, ClipShape, Paint, PathCommand, Vec2 } from "../../core/paint.js";
import { isPathShape } from "../../core/paint.js";
import type { Effects, GroupOptions, Style } from "../../scene-draft/scene-api.js";
import { UnsupportedCallError } from "../errors.js";
import type { Geom, ShapeStyle } from "../scene.js";

const STYLE_KEYS = new Set(["fill", "stroke", "weight", "brush", "gesture", "blend", "erase", "dash", "cap", "join", "material", "effects"]);
const CAPS = new Set(["butt", "round", "square"]);
const JOINS = new Set(["miter", "round", "bevel"]);

export function copyPoints(points: readonly Vec2[]): Vec2[] {
  return points.map((p): Vec2 => [p[0], p[1]]);
}

export function copyCommands(commands: readonly PathCommand[]): PathCommand[] {
  return commands.map((c): PathCommand => structuredClone(c));
}

/** A paint, checked and copied. Gradients the renderer cannot draw yet are errors here, at the call. */
export function copyPaint(paint: Paint, where: string): Paint {
  if (typeof paint === "string") return paint;
  if (paint.kind === "radial-gradient" && (paint.x1 !== paint.x2 || paint.y1 !== paint.y2)) {
    throw new UnsupportedCallError({ call: `${where} radial gradient with two centres`, detail: "concentric radial gradients only" });
  }
  return structuredClone(paint);
}

// Today's group effect ranges (core/painter/effects.ts), checked here so the spike
// does not reach into the painter: [key, min, max].
const RANGES: readonly (readonly [string, number, number])[] = [
  ["hue", -Infinity, Infinity], ["saturation", 0, Infinity], ["brightness", 0, Infinity], ["contrast", 0, Infinity],
  ["grayscale", 0, 1], ["sepia", 0, 1], ["invert", 0, 1], ["blur", 0, Infinity],
];
const EFFECT_KEYS = new Set([...RANGES.map(([k]) => k), "glow", "shadow"]);

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
  for (const key of ["wash", "hatching", "paper"] as const) {
    if (effects[key] !== undefined) throw new UnsupportedCallError({ call: `${where} effects.${key}` });
  }
  checkEffects(effects);
  return structuredClone(effects);
}

/** Check a draft 2.2 Style at the call and fill in its defaults. */
export function resolveStyle(style: Style, call: string): ShapeStyle {
  for (const key of Object.keys(style)) {
    if (!STYLE_KEYS.has(key)) throw new SketchUsageError({ detail: `${call}: unknown style key "${key}" (${[...STYLE_KEYS].join(", ")})` });
  }
  if (style.brush !== undefined) throw new UnsupportedCallError({ call: `${call} with style.brush`, detail: "brushed strokes come in chunk 3" });
  if (style.dash !== undefined) throw new UnsupportedCallError({ call: `${call} with style.dash` });
  const { weight, cap, join } = style;
  if (weight !== undefined && !(Number.isFinite(weight) && weight >= 0)) throw new SketchUsageError({ detail: `${call}: style.weight must be a number ≥ 0 (got ${String(weight)})` });
  if (cap !== undefined && !CAPS.has(cap)) throw new SketchUsageError({ detail: `${call}: style.cap must be butt, round or square (got ${String(cap)})` });
  if (join !== undefined && !JOINS.has(join)) throw new SketchUsageError({ detail: `${call}: style.join must be miter, round or bevel (got ${String(join)})` });
  compositeOp(style.blend ?? "normal");
  // `material` is ignored outside a lit group (R8), and the spike has no lit groups yet.
  return {
    fill: style.fill === undefined ? undefined : copyPaint(style.fill, call),
    stroke: style.stroke === undefined ? undefined : copyPaint(style.stroke, call),
    weight: weight ?? 1,
    cap: cap ?? "butt",
    join: join ?? "miter",
    blend: style.blend ?? "normal",
    erase: style.erase ?? false,
    effects: copyEffects(style.effects, call),
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
export function resolveGroup(options: GroupOptions): { name: string | undefined; opacity: number; blend: BlendMode; effects: Effects | undefined; clip: Geom[] | undefined } {
  if (options.lighting !== undefined) throw new UnsupportedCallError({ call: "group({ lighting })" });
  const opacity = options.opacity ?? 1;
  assertUnit(opacity, "group opacity");
  const blend = options.blend ?? "normal";
  compositeOp(blend);
  return { name: options.name, opacity, blend, effects: copyEffects(options.effects, "group"), clip: options.clip === undefined ? undefined : clipGeoms(options.clip) };
}
