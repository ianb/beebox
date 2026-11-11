// Named brush presets and brush validation.
import { SketchUsageError } from "../errors.js";
import type { BlendMode } from "../paint.js";
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
  opacity: 0.95,
  grain: 0.35,
  bristles: 14,
  flow: 0.55,
  load: 0.9,
  spread: 0.6,
};

export const BRUSH_PRESETS = { ink: INK, pencil: PENCIL, bristle: BRISTLE } as const satisfies Record<string, Brush>;

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

const BLENDS: readonly BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "soft-light",
  "hard-light",
  "color-dodge",
  "color-burn",
];

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
