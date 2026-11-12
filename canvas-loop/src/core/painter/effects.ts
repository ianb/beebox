// Group effects: a finished group layer passes through one Canvas2D filter as
// it is composited, over an optional glow painted from its silhouette. Effects
// are data on `group`; the filter is a CSS filter string both runtimes
// (browsers, @napi-rs/canvas) understand.
import type { Ctx2D, Layer } from "../paint.js";
import type { Effects } from "../compose.js";
import { drawLayer, type LayerPool } from "./layers.js";
import { SketchUsageError } from "../errors.js";

const EFFECT_KEYS = ["hue", "saturation", "brightness", "contrast", "grayscale", "sepia", "invert", "blur", "glow", "shadow"] as const;
const KEY_SET = new Set<string>(EFFECT_KEYS);

/** Adjustments in filter order, with the CSS function, unit and valid range. */
const ADJUSTMENTS = [
  { key: "hue", fn: "hue-rotate", unit: "deg", min: -Infinity, max: Infinity },
  { key: "saturation", fn: "saturate", unit: "", min: 0, max: Infinity },
  { key: "brightness", fn: "brightness", unit: "", min: 0, max: Infinity },
  { key: "contrast", fn: "contrast", unit: "", min: 0, max: Infinity },
  { key: "grayscale", fn: "grayscale", unit: "", min: 0, max: 1 },
  { key: "sepia", fn: "sepia", unit: "", min: 0, max: 1 },
  { key: "invert", fn: "invert", unit: "", min: 0, max: 1 },
] as const;

function bad(detail: string): SketchUsageError {
  return new SketchUsageError({ detail: `group effects: ${detail}` });
}

function num(...args: [unknown, string, number, number]): number {
  const [value, name, min, max] = args;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    const range = max === Infinity ? (min === -Infinity ? "a finite number" : `a number ≥ ${min}`) : `a number in ${min}..${max}`;
    throw bad(`${name} must be ${range}, got ${String(value)}`);
  }
  return value;
}

function color(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw bad(`${name}.color must be a CSS colour string`);
  return value;
}

function onlyKeys(value: object, args: { name: string; keys: readonly string[] }): void {
  for (const key of Object.keys(value)) {
    if (!args.keys.includes(key)) throw bad(`${args.name} has no "${key}" (${args.keys.join(", ")})`);
  }
}

function shadowPart(effects: Effects, pr: number): string | undefined {
  const o = effects.shadow;
  if (o === undefined) return undefined;
  if (typeof o !== "object") throw bad(`shadow must be { x?, y?, blur?, color }, got ${String(o)}`);
  onlyKeys(o, { name: "shadow", keys: ["x", "y", "blur", "color"] });
  const x = num(o.x ?? 0, "shadow.x", -Infinity, Infinity);
  const y = num(o.y ?? 0, "shadow.y", -Infinity, Infinity);
  const blur = num(o.blur ?? 0, "shadow.blur", 0, Infinity);
  return `drop-shadow(${x * pr}px ${y * pr}px ${blur * pr}px ${color(o.color, "shadow")})`;
}

/** A resolved glow: blur radius in device pixels, colour, passes. */
export interface Glow {
  readonly blur: number;
  readonly color: string;
  readonly strength: number;
}

/** The group's glow, validated, with lengths at `pixelRatio`; undefined for none. */
export function glowOf(effects: Effects | undefined, pixelRatio: number): Glow | undefined {
  const o = effects?.glow;
  if (o === undefined) return undefined;
  if (typeof o !== "object") throw bad(`glow must be { blur, color, strength? }, got ${String(o)}`);
  onlyKeys(o, { name: "glow", keys: ["blur", "color", "strength"] });
  const blur = num(o.blur, "glow.blur", 0, Infinity) * pixelRatio;
  const strength = num(o.strength ?? 2, "glow.strength", 1, 6);
  return { blur, color: color(o.color, "glow"), strength };
}

/**
 * Paint `glow` for `layer` into the empty `halo`: the layer's silhouette,
 * blurred `strength` times over itself, then tinted the glow colour.
 */
export function paintGlow(halo: Layer, args: { layer: Layer; glow: Glow; width: number; height: number }): void {
  const { layer, glow, width, height } = args;
  for (let i = 0; i < Math.round(glow.strength); i++) {
    drawLayer(halo.ctx, { image: layer.image, width, height, opacity: 1, op: "source-over", filter: `blur(${glow.blur}px)` });
  }
  const { ctx } = halo;
  ctx.save();
  ctx.resetTransform();
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = glow.color;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * The filter string for `effects` at `pixelRatio` (lengths are canvas pixels;
 * the layer is composited at device scale), or undefined for none. Order:
 * colour adjustments, blur, shadow. The glow is painted separately (`paintGlow`).
 */
export function effectsFilter(effects: Effects | undefined, pixelRatio: number): string | undefined {
  if (effects === undefined) return undefined;
  if (typeof effects !== "object") throw bad(`effects must be an object (${EFFECT_KEYS.join(", ")})`);
  for (const key of Object.keys(effects)) {
    if (!KEY_SET.has(key)) throw bad(`unknown effect "${key}" (${EFFECT_KEYS.join(", ")})`);
  }
  const parts: string[] = [];
  for (const a of ADJUSTMENTS) {
    const value = effects[a.key];
    if (value !== undefined) parts.push(`${a.fn}(${num(value, a.key, a.min, a.max)}${a.unit})`);
  }
  if (effects.blur !== undefined) parts.push(`blur(${num(effects.blur, "blur", 0, Infinity) * pixelRatio}px)`);
  const shadow = shadowPart(effects, pixelRatio);
  if (shadow !== undefined) parts.push(shadow);
  return parts.length === 0 ? undefined : parts.join(" ");
}

/** A group's effects, validated: the filter for the layer itself and the glow beneath it. */
export interface ResolvedEffects {
  readonly filter: string | undefined;
  readonly glow: Glow | undefined;
}

export function resolveEffects(effects: Effects | undefined, pixelRatio: number): ResolvedEffects {
  return { filter: effectsFilter(effects, pixelRatio), glow: glowOf(effects, pixelRatio) };
}

/** Composite a finished group `layer` onto `ctx` once: the layer through its filter, over its glow. */
export function compositeGroup(ctx: Ctx2D, args: { layer: Layer; effects: ResolvedEffects; pool: LayerPool; opacity: number; op: string; width: number; height: number }): void {
  const { layer, effects, pool, opacity, op, width, height } = args;
  const { glow, filter } = effects;
  const withFilter = filter === undefined ? {} : { filter };
  if (glow === undefined) {
    drawLayer(ctx, { image: layer.image, width, height, opacity, op, ...withFilter });
    return;
  }
  // Halo and group meet on one layer, so opacity and blend apply to them once, together.
  pool.borrow((halo) => {
    paintGlow(halo, { layer, glow, width, height });
    drawLayer(halo.ctx, { image: layer.image, width, height, opacity: 1, op: "source-over", ...withFilter });
    drawLayer(ctx, { image: halo.image, width, height, opacity, op });
  });
}
