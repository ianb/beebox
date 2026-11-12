// Named brush presets and brush validation.
import { SketchUsageError } from "../errors.js";
import { BLEND_MODES, type BlendMode } from "../compose.js";
import type { BristleBrush, Brush, BrushKind, BrushOverrides, InkBrush, StampBrush } from "./types.js";

const INK: InkBrush = { kind: "ink", opacity: 1, grain: 0, thinning: 0.75 };

const PENCIL: StampBrush = {
  kind: "stamp",
  opacity: 0.95,
  grain: 0.75,
  tip: "hard",
  spacing: 0.3,
  flow: 0.35,
  sizeByPressure: 0.5,
  opacityByPressure: 0.7,
  scatter: 0.15,
  sizeJitter: 0.3,
};

const BRISTLE: BristleBrush = {
  kind: "bristle",
  opacity: 1,
  grain: 0.35,
  bristles: 14,
  flow: 0.75,
  load: 1,
  spread: 0.9,
};

/** Broad, flat, slightly see-through; multiplies over what is under it. */
const MARKER: InkBrush = { kind: "ink", opacity: 0.7, grain: 0.1, thinning: 0.15, blend: "multiply" };

const CHALK: StampBrush = {
  kind: "stamp",
  opacity: 1,
  grain: 0.8,
  tip: "hard",
  spacing: 0.15,
  flow: 0.6,
  sizeByPressure: 0.3,
  opacityByPressure: 0.5,
  scatter: 0.25,
  sizeJitter: 0.4,
};

/** A soft, even spray with no paper texture: gradients and glows. */
const AIRBRUSH: StampBrush = {
  kind: "stamp",
  opacity: 1,
  grain: 0,
  tip: "soft",
  spacing: 0.1,
  flow: 0.14,
  sizeByPressure: 0.2,
  opacityByPressure: 0.8,
  scatter: 0,
  sizeJitter: 0,
};

/** A broad, soft-edged, translucent wash with a little paper texture: shadows and tone. */
const WASH: StampBrush = {
  kind: "stamp",
  opacity: 0.8,
  grain: 0.25,
  tip: "soft",
  spacing: 0.08,
  flow: 0.3,
  sizeByPressure: 0.25,
  opacityByPressure: 0.4,
  scatter: 0.05,
  sizeJitter: 0.15,
};

export const BRUSH_PRESETS = {
  ink: INK,
  marker: MARKER,
  pencil: PENCIL,
  chalk: CHALK,
  airbrush: AIRBRUSH,
  wash: WASH,
  bristle: BRISTLE,
} as const satisfies Record<string, Brush>;

/** A preset name accepted by `brush()`. */
export type BrushName = keyof typeof BRUSH_PRESETS;

const PRESET_NAMES = Object.keys(BRUSH_PRESETS).join(", ");

/** Fields each kind accepts, with the numeric range of each (undefined = not numeric). */
const UNIT: readonly [number, number] = [0, 1];
const KIND_FIELDS: Record<BrushKind, Record<string, readonly [number, number] | undefined>> = {
  ink: { opacity: UNIT, grain: UNIT, blend: undefined, thinning: UNIT },
  stamp: {
    opacity: UNIT,
    grain: UNIT,
    blend: undefined,
    tip: undefined,
    spacing: [0.02, 10],
    flow: UNIT,
    sizeByPressure: UNIT,
    opacityByPressure: UNIT,
    scatter: [0, 10],
    sizeJitter: UNIT,
  },
  bristle: { opacity: UNIT, grain: UNIT, blend: undefined, bristles: [1, 64], flow: UNIT, load: [0.01, 10], spread: UNIT },
};

const BLENDS: readonly BlendMode[] = BLEND_MODES;

function isBrushName(name: string): name is BrushName {
  return Object.hasOwn(BRUSH_PRESETS, name);
}

function checkField(kind: BrushKind, entry: readonly [string, unknown]): void {
  const [key, value] = entry;
  const fields = KIND_FIELDS[kind];
  if (key === "kind") return;
  if (!Object.hasOwn(fields, key)) {
    throw new SketchUsageError({ detail: `brush field "${key}" does not apply to a ${kind} brush (fields: ${Object.keys(fields).join(", ")})` });
  }
  const range = fields[key];
  if (key === "blend" && !new Set<unknown>(BLENDS).has(value)) {
    throw new SketchUsageError({ detail: `brush blend "${String(value)}" is not one of: ${BLENDS.join(", ")}` });
  }
  if (key === "tip" && value !== "hard" && value !== "soft") {
    throw new SketchUsageError({ detail: 'brush tip must be "hard" or "soft"' });
  }
  if (range === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]) {
    throw new SketchUsageError({ detail: `brush ${key} must be a number in ${range[0]}..${range[1]}, got ${String(value)}` });
  }
}

/** Resolve `brush(name | Brush, overrides?)` to a validated brush. */
export function resolveBrush(base: BrushName | Brush, overrides: BrushOverrides | undefined): Brush {
  let brush: Brush;
  if (typeof base === "string") {
    if (!isBrushName(base)) throw new SketchUsageError({ detail: `unknown brush "${String(base)}" (presets: ${PRESET_NAMES})` });
    brush = BRUSH_PRESETS[base];
  } else {
    if (!Object.hasOwn(KIND_FIELDS, base.kind)) throw new SketchUsageError({ detail: `unknown brush kind "${String(base.kind)}"` });
    brush = base;
  }
  const merged: Brush = overrides === undefined ? brush : { ...brush, ...overrides };
  for (const entry of Object.entries(merged)) checkField(merged.kind, entry);
  return merged;
}
