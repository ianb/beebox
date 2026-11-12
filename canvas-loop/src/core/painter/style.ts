// Styles: checking one where a call receives it, filling in its defaults, and
// spotting a call that can draw nothing.
import { resolveBrush } from "../brush/presets.js";
import type { Brush, Gesture } from "../brush/types.js";
import type { BlendMode, Paint, Style } from "../paint.js";
import { SketchUsageError } from "../errors.js";

/** A Style with every default filled in: what one drawing call paints with. */
export interface ResolvedStyle {
  readonly fill: Paint | undefined;
  readonly stroke: Paint | undefined;
  readonly weight: number;
  readonly brush: Brush | undefined;
  readonly gesture: Gesture;
  readonly blend: BlendMode;
  readonly erase: boolean;
}

const STYLE_KEYS = new Set(["fill", "stroke", "weight", "brush", "gesture", "blend", "erase"]);

/** Check a Style at the call that received it; errors name the call and the key. */
export function assertStyle(style: Style, call: string): void {
  for (const key of Object.keys(style)) {
    if (!STYLE_KEYS.has(key)) throw new SketchUsageError({ detail: `${call}: unknown style key "${key}" (fill, stroke, weight, brush, gesture, blend, erase)` });
  }
  const { weight } = style;
  if (weight !== undefined && !(Number.isFinite(weight) && weight >= 0)) {
    throw new SketchUsageError({ detail: `${call}: style.weight must be a number ≥ 0 (got ${String(weight)})` });
  }
}

function brushFrom(brush: Style["brush"]): Brush | undefined {
  if (brush === undefined) return undefined;
  if (typeof brush === "string" || "kind" in brush) return resolveBrush(brush, undefined);
  const { preset, ...overrides } = brush;
  return resolveBrush(preset, overrides);
}

/** Validate `style` and fill in its defaults. */
export function resolveStyle(style: Style, call: string): ResolvedStyle {
  assertStyle(style, call);
  return {
    fill: style.fill,
    stroke: style.stroke,
    weight: style.weight ?? 1,
    brush: brushFrom(style.brush),
    gesture: style.gesture ?? {},
    blend: style.blend ?? "normal",
    erase: style.erase ?? false,
  };
}

/** Why a call with this style would draw nothing, or undefined. `open` shapes (lines, open curves) have no fill. */
export function styleProblem(call: string, args: { style: ResolvedStyle; open: boolean }): string | undefined {
  const { style, open } = args;
  if (open && style.stroke === undefined) {
    return style.fill === undefined ? `${call}: the style has no stroke, so nothing is drawn` : `${call}: a line has no inside, so its fill draws nothing; give the style a stroke`;
  }
  if (!open && style.fill === undefined && style.stroke === undefined) return `${call}: the style has neither fill nor stroke, so nothing is drawn`;
  return undefined;
}
