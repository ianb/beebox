// Brushed strokes and paper at the call: the brush resolved and checked as
// today (presets.ts), the gesture checked and copied, the blend chosen by R1,
// and the paper in scope (R9) captured. A smudge or wet brush with effects,
// a blend or erase is an error here, at the call.
import { SketchUsageError } from "../../core/errors.js";
import { validateEnvelope } from "../../core/brush/envelope.js";
import { resolveBrush } from "../../core/brush/presets.js";
import type { Brush, Gesture } from "../../core/brush/types.js";
import type { BlendMode } from "../../core/paint.js";
import type { Style } from "../../scene-draft/scene-api.js";
import type { BrushStroke, PaperSettings } from "../scene.js";

export const DEFAULT_PAPER: PaperSettings = { scale: 3, contrast: 0.7, seed: 1 };

function brushFrom(brush: NonNullable<Style["brush"]>): Brush {
  if (typeof brush === "string" || "kind" in brush) return resolveBrush(brush, undefined);
  const { preset, ...overrides } = brush;
  return resolveBrush(preset, overrides);
}

function copyGesture(g: Gesture | undefined, call: string): Gesture {
  if (g === undefined) return {};
  for (const key of Object.keys(g)) {
    if (!["pressure", "wobble", "seed", "faint"].includes(key)) throw new SketchUsageError({ detail: `${call}: unknown gesture key "${key}" (pressure, wobble, seed, faint)` });
  }
  if (g.pressure !== undefined) validateEnvelope(g.pressure, "gesture pressure");
  if (g.wobble !== undefined && !(Number.isFinite(g.wobble) && g.wobble >= 0)) throw new SketchUsageError({ detail: "gesture wobble must be a finite number ≥ 0" });
  if (g.seed !== undefined && !Number.isFinite(g.seed)) throw new SketchUsageError({ detail: "gesture seed must be a finite number" });
  return structuredClone(g);
}

/** The brushed stroke of `style`, or undefined when its stroke is plain. */
export function resolveBrushStroke(style: Style, at: { call: string; paper: PaperSettings }): BrushStroke | undefined {
  if (style.brush === undefined) return undefined;
  const brush = brushFrom(style.brush);
  const own: BlendMode = brush.kind === "smear" ? "normal" : (brush.blend ?? "normal");
  if (brush.kind === "smear") {
    const what = brush.color > 0 ? "wet" : "smudge";
    if (style.effects !== undefined) throw new SketchUsageError({ detail: `${at.call}: a ${what} brush with effects has nothing to read (R2): draw it without effects, or put it in a group` });
    if ((style.blend !== undefined && style.blend !== "normal") || style.erase === true) throw new SketchUsageError({ detail: `${at.call}: a ${what} brush cannot erase or blend; draw it with the normal blend` });
    if (brush.color > 0 && style.stroke !== undefined && typeof style.stroke !== "string") throw new SketchUsageError({ detail: `${at.call}: a wet brush needs a solid stroke colour, not a gradient` });
  }
  return { brush, gesture: copyGesture(style.gesture, at.call), blend: style.blend ?? own, own, paper: at.paper };
}

/** `v.paper(settings)`, checked, with defaults filled in. */
export function resolvePaper(settings: unknown): PaperSettings {
  if (typeof settings !== "object" || settings === null) throw new SketchUsageError({ detail: "paper() takes { scale?, contrast?, seed? }" });
  const out: Record<string, number> = { ...DEFAULT_PAPER };
  for (const [key, value] of Object.entries(settings)) {
    if (!(key in DEFAULT_PAPER)) throw new SketchUsageError({ detail: `paper has no "${key}" (scale, contrast, seed)` });
    const ok = typeof value === "number" && Number.isFinite(value) && (key === "seed" || value >= 0) && (key !== "scale" || value > 0) && (key !== "contrast" || value <= 1);
    if (!ok || typeof value !== "number") throw new SketchUsageError({ detail: `paper ${key} must be ${key === "contrast" ? "a number in 0..1" : key === "scale" ? "a number > 0" : "a finite number"}, got ${String(value)}` });
    out[key] = value;
  }
  return { scale: out.scale ?? DEFAULT_PAPER.scale, contrast: out.contrast ?? DEFAULT_PAPER.contrast, seed: out.seed ?? DEFAULT_PAPER.seed };
}
